CREATE OR REPLACE FUNCTION public.handle_collection_commissions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_member          RECORD;
  v_plan            RECORD;

  v_monthly_due     NUMERIC := 0;
  v_monthly_comm    NUMERIC := 0;
  v_outright_comm   NUMERIC := 0;

  v_total_before    NUMERIC := 0;
  v_install_before  INTEGER := 0;
  v_full_months     INTEGER := 0;
  v_install_now     INTEGER := 0;

  v_date_earned     DATE;
  v_py              INTEGER;
  v_pm              INTEGER;

  v_recruiter_id    BIGINT;
  v_recruit_bonus   NUMERIC := 0;

  upline            BIGINT;
  role_text         TEXT;

  as_id             BIGINT := NULL;
  ms_id             BIGINT := NULL;
  mh_id             BIGINT := NULL;
BEGIN
  --------------------------------------------------------------------
  -- 0. VALIDATE
  --------------------------------------------------------------------
  IF NEW.member_id IS NULL OR NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  --------------------------------------------------------------------
  -- 1. LOAD MEMBER + PLAN
  --------------------------------------------------------------------
  SELECT * INTO v_member
  FROM members WHERE id = NEW.member_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT * INTO v_plan
  FROM plan_commission_map
  WHERE UPPER(plan_type) = UPPER(v_member.plan_type)
  LIMIT 1;

  v_monthly_due     := COALESCE(v_plan.monthly_payment, v_member.monthly_due, 0);
  v_monthly_comm    := COALESCE(v_plan.monthly_commission, 0);
  v_outright_comm   := COALESCE(v_plan.outright_commission, 0);

  --------------------------------------------------------------------
  -- 2. LOAD RECRUITER
  --------------------------------------------------------------------
  SELECT recruiter_id INTO v_recruiter_id
  FROM agents WHERE id = NEW.agent_id;

  --------------------------------------------------------------------
  -- 3. PERIOD
  --------------------------------------------------------------------
  v_date_earned := COALESCE(NEW.date_paid, CURRENT_DATE);
  v_py := EXTRACT(YEAR FROM v_date_earned);
  v_pm := EXTRACT(MONTH FROM v_date_earned);

  --------------------------------------------------------------------
  -- 4. MEMBERSHIP OUTRIGHT
  --------------------------------------------------------------------
  IF NEW.is_membership_fee OR LOWER(NEW.payment_for) = 'membership' THEN

    IF v_outright_comm > 0 THEN
      INSERT INTO commissions (
        agent_id, member_id, collection_id,
        commission_type, plan_type,
        basis_amount, amount, months_covered,
        outright_mode, eligible_outright,
        date_earned, status, maf_no,
        year, period_year, period_month,
        monthly_commission_given, travel_allowance_given,
        override_released, override_commission,
        is_receivable
      )
      VALUES (
        NEW.agent_id, NEW.member_id, NEW.id,
        'membership_outright', v_member.plan_type,
        v_outright_comm, v_outright_comm, 1,
        NEW.outright_mode, TRUE,
        v_date_earned,
        CASE WHEN NEW.deduct_now THEN 'paid'::commission_status_enum
             ELSE 'pending'::commission_status_enum END,
        NEW.maf_no,
        v_py, v_py, v_pm,
        FALSE, FALSE,
        FALSE, 0,
        CASE WHEN NEW.deduct_now THEN FALSE ELSE TRUE END
      );

      ----------------------------------------------------------------
      -- Recruiter Bonus (Always Receivable, Always Pending)
      ----------------------------------------------------------------
      IF v_recruiter_id IS NOT NULL THEN
        v_recruit_bonus := ROUND(v_outright_comm * 0.10, 2);

        INSERT INTO commissions (
          agent_id, member_id, collection_id, recruiter_id,
          commission_type, plan_type,
          basis_amount, percentage, amount,
          months_covered,
          date_earned, status, maf_no,
          year, period_year, period_month,
          is_receivable
        )
        VALUES (
          v_recruiter_id, NEW.member_id, NEW.id, NEW.agent_id,
          'recruiter_bonus', v_member.plan_type,
          v_outright_comm, 10, v_recruit_bonus,
          1,
          v_date_earned, 'pending'::commission_status_enum, NEW.maf_no,
          v_py, v_py, v_pm,
          TRUE
        );
      END IF;

    END IF;

    RETURN NEW;
  END IF;

  --------------------------------------------------------------------
  -- 5. REGULAR COLLECTION → Determine # of full months
  --------------------------------------------------------------------
  IF v_monthly_due <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(payment),0)
  INTO v_total_before
  FROM collections
  WHERE member_id = NEW.member_id
    AND is_membership_fee = FALSE
    AND id <> NEW.id;

  v_install_before := FLOOR(v_total_before / v_monthly_due);
  v_full_months    := FLOOR(NEW.payment / v_monthly_due);

  IF v_full_months < 1 THEN RETURN NEW; END IF;

  --------------------------------------------------------------------
  -- 6. travel + monthly loop for each month paid
  --------------------------------------------------------------------
  FOR i IN 1..v_full_months LOOP

    v_install_now := v_install_before + i;

    ----------------------------------------------------------------
    -- TRAVEL ALLOWANCE (Corrected to attribute to Collector)
    ----------------------------------------------------------------
    INSERT INTO commissions (
      agent_id, member_id, collection_id,
      commission_type, plan_type,
      basis_amount, amount, months_covered,
      date_earned, status, maf_no,
      year, period_year, period_month,
      travel_allowance_given,
      is_receivable
    )
    VALUES (
      COALESCE(NEW.collector_id, NEW.agent_id), -- <--- PATCHED HERE
      NEW.member_id, NEW.id,
      'travel_allowance', v_member.plan_type,
      v_monthly_due,
      CASE WHEN v_install_now >= 13 THEN 60 ELSE 30 END,
      1,
      v_date_earned,
      CASE WHEN NEW.got_travel_allowance 
           THEN 'paid'::commission_status_enum
           ELSE 'pending'::commission_status_enum END,
      NEW.maf_no,
      v_py, v_py, v_pm,
      NEW.got_travel_allowance,
      CASE WHEN NEW.got_travel_allowance THEN FALSE ELSE TRUE END
    );

    ----------------------------------------------------------------
    -- MONTHLY COMMISSION (<13)
    ----------------------------------------------------------------
    IF v_install_now < 13 AND v_monthly_comm > 0 THEN
      INSERT INTO commissions (
        agent_id, member_id, collection_id,
        commission_type, plan_type,
        basis_amount, amount, months_covered,
        date_earned, status, maf_no,
        year, period_year, period_month,
        monthly_commission_given,
        is_receivable
      )
      VALUES (
        NEW.agent_id, NEW.member_id, NEW.id,
        'plan_monthly', v_member.plan_type,
        v_monthly_due, v_monthly_comm, 1,
        v_date_earned,
        CASE WHEN NEW.got_monthly_commission 
             THEN 'paid'::commission_status_enum
             ELSE 'pending'::commission_status_enum END,
        NEW.maf_no,
        v_py, v_py, v_pm,
        NEW.got_monthly_commission,
        CASE WHEN NEW.got_monthly_commission THEN FALSE ELSE TRUE END
      );

      ----------------------------------------------------------------
      -- Recruiter bonus for monthly
      ----------------------------------------------------------------
      IF v_recruiter_id IS NOT NULL THEN
        v_recruit_bonus := ROUND(v_monthly_comm * 0.10, 2);

        INSERT INTO commissions (
          agent_id, member_id, collection_id, recruiter_id,
          commission_type, plan_type,
          basis_amount, percentage, amount,
          months_covered, date_earned, status, maf_no,
          year, period_year, period_month,
          is_receivable
        )
        VALUES (
          v_recruiter_id, NEW.member_id, NEW.id, NEW.agent_id,
          'recruiter_bonus', v_member.plan_type,
          v_monthly_comm, 10, v_recruit_bonus,
          1, v_date_earned, 'pending'::commission_status_enum, NEW.maf_no,
          v_py, v_py, v_pm,
          TRUE
        );
      END IF;

    END IF;

  END LOOP;

  --------------------------------------------------------------------
  -- 7. DETECT OVERRIDE LEVELS (AS, MS, MH)
  --------------------------------------------------------------------
  upline := NEW.agent_id;

  WHILE upline IS NOT NULL LOOP
    SELECT position INTO role_text
    FROM agents WHERE id = upline;

    IF role_text ILIKE 'Assistant Supervisor' AND as_id IS NULL THEN
      as_id := upline;
    ELSIF role_text ILIKE 'Marketing Supervisor' AND ms_id IS NULL THEN
      ms_id := upline;
    ELSIF role_text ILIKE 'Marketing Head' AND mh_id IS NULL THEN
      mh_id := upline;
    END IF;

    EXIT WHEN as_id IS NOT NULL AND ms_id IS NOT NULL AND mh_id IS NOT NULL;

    SELECT assigned_id INTO upline FROM agents WHERE id = upline;
  END LOOP;

  --------------------------------------------------------------------
  -- 8. OVERRIDES (ALWAYS RECEIVABLE, ALWAYS PENDING)
  --------------------------------------------------------------------
  IF as_id IS NOT NULL THEN
    INSERT INTO commissions (
      agent_id, member_id, collection_id,
      commission_type, plan_type,
      basis_amount, amount, months_covered,
      date_earned, status, maf_no,
      year, period_year, period_month,
      override_released, override_commission,
      is_receivable
    )
    VALUES (
      as_id, NEW.member_id, NEW.id,
      'override', v_member.plan_type,
      v_monthly_due, 16 * v_full_months, v_full_months,
      v_date_earned, 'pending'::commission_status_enum,
      NEW.maf_no,
      v_py, v_py, v_pm,
      FALSE, 16 * v_full_months,
      TRUE
    );
  END IF;

  IF ms_id IS NOT NULL THEN
    INSERT INTO commissions (
      agent_id, member_id, collection_id,
      commission_type, plan_type,
      basis_amount, amount, months_covered,
      date_earned, status, maf_no,
      year, period_year, period_month,
      override_released, override_commission,
      is_receivable
    )
    VALUES (
      ms_id, NEW.member_id, NEW.id,
      'override', v_member.plan_type,
      v_monthly_due, 12 * v_full_months, v_full_months,
      v_date_earned, 'pending'::commission_status_enum,
      NEW.maf_no,
      v_py, v_py, v_pm,
      FALSE, 12 * v_full_months,
      TRUE
    );
  END IF;

  IF mh_id IS NOT NULL THEN
    INSERT INTO commissions (
      agent_id, member_id, collection_id,
      commission_type, plan_type,
      basis_amount, amount, months_covered,
      date_earned, status, maf_no,
      year, period_year, period_month,
      override_released, override_commission,
      is_receivable
    )
    VALUES (
      mh_id, NEW.member_id, NEW.id,
      'override', v_member.plan_type,
      v_monthly_due, 8 * v_full_months, v_full_months,
      v_date_earned, 'pending'::commission_status_enum,
      NEW.maf_no,
      v_py, v_py, v_pm,
      FALSE, 8 * v_full_months,
      TRUE
    );
  END IF;

  RETURN NEW;
END;
$$;
