CREATE OR REPLACE FUNCTION public.handle_collection_commissions()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_member                RECORD;
  v_plan                  RECORD;
  v_monthly_due           NUMERIC := 0;
  v_monthly_comm          NUMERIC := 0;
  v_outright_comm         NUMERIC := 0;

  v_total_regular_before  NUMERIC := 0;
  v_full_months_this      INTEGER := 0;
  v_install_before        INTEGER := 0;
  v_current_install       INTEGER := 0;

  v_i                     INTEGER;

  v_date_earned           DATE;
  v_period_year           INTEGER;
  v_period_month          INTEGER;

  v_recruiter_id          BIGINT;
  v_recruiter_bonus       NUMERIC := 0;
  v_basis_amount          NUMERIC;

  -- OVERRIDE VARIABLES
  v_upline_id             BIGINT;
  v_upline_position       TEXT;
  v_override_amount       NUMERIC;

BEGIN
  IF NEW.agent_id IS NULL OR NEW.member_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_member
  FROM public.members
  WHERE id = NEW.member_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_member.plan_type IS NOT NULL THEN
    SELECT * INTO v_plan
    FROM public.plan_commission_map
    WHERE UPPER(plan_type) = UPPER(v_member.plan_type)
    LIMIT 1;
  END IF;

  v_monthly_due   := COALESCE(v_plan.monthly_payment, v_member.monthly_due, 0);
  v_monthly_comm  := COALESCE(v_plan.monthly_commission, 0);
  v_outright_comm := COALESCE(v_plan.outright_commission, 0);

  SELECT recruiter_id INTO v_recruiter_id
  FROM public.agents
  WHERE id = NEW.agent_id;

  v_date_earned  := COALESCE(NEW.date_paid, CURRENT_DATE)::date;
  v_period_year  := EXTRACT(YEAR FROM v_date_earned)::INT;
  v_period_month := EXTRACT(MONTH FROM v_date_earned)::INT;

  ------------------------------------------------------------------
  -- MEMBERSHIP OUTRIGHT COMMISSION
  ------------------------------------------------------------------
  IF COALESCE(NEW.is_membership_fee, FALSE)
     OR LOWER(COALESCE(NEW.payment_for, '')) = 'membership' THEN

    IF v_outright_comm > 0 THEN
      
      INSERT INTO public.commissions (
        agent_id, member_id, collection_id, commission_type, plan_type,
        basis_amount, amount, months_covered, outright_mode, eligible_outright,
        date_earned, status, maf_no,
        year, period_year, period_month,
        monthly_commission_given, travel_allowance_given,
        override_released, override_commission
      )
      VALUES (
        NEW.agent_id, NEW.member_id, NEW.id, 'membership_outright', v_member.plan_type,
        v_outright_comm, v_outright_comm, 1, NEW.outright_mode, TRUE,
        v_date_earned,
        CASE WHEN NEW.deduct_now THEN 'paid'::commission_status_enum
             ELSE 'pending'::commission_status_enum END,
        NEW.maf_no,
        v_period_year, v_period_year, v_period_month,
        FALSE, FALSE,
        FALSE, 0
      );

      -- Recruiter bonus
      IF v_recruiter_id IS NOT NULL THEN
        v_basis_amount := v_outright_comm;
        v_recruiter_bonus := ROUND(v_basis_amount * 0.10, 2);

        INSERT INTO public.commissions (
          agent_id, member_id, collection_id, recruiter_id,
          commission_type, plan_type, basis_amount, percentage, amount,
          months_covered, date_earned, status, maf_no,
          year, period_year, period_month
        )
        VALUES (
          v_recruiter_id, NEW.member_id, NEW.id, NEW.agent_id,
          'recruiter_bonus', v_member.plan_type,
          v_basis_amount, 10, v_recruiter_bonus,
          1, v_date_earned,
          'pending'::commission_status_enum,
          NEW.maf_no,
          v_period_year, v_period_year, v_period_month
        );
      END IF;

    END IF;

    RETURN NEW;
  END IF;

  ------------------------------------------------------------------
  -- REGULAR PAYMENT
  ------------------------------------------------------------------
  IF v_monthly_due <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(payment), 0)
  INTO v_total_regular_before
  FROM public.collections
  WHERE member_id = NEW.member_id
    AND COALESCE(is_membership_fee, FALSE) = FALSE
    AND id <> NEW.id;

  v_full_months_this := FLOOR(COALESCE(NEW.payment, 0) / v_monthly_due)::INT;

  IF v_full_months_this <= 0 THEN
    RETURN NEW;
  END IF;

  v_install_before := FLOOR(v_total_regular_before / v_monthly_due)::INT;

  FOR v_i IN 1..v_full_months_this LOOP

    v_current_install := v_install_before + v_i;

    --------------------------------------------------------------
    -- TRAVEL ALLOWANCE
    --------------------------------------------------------------
    INSERT INTO public.commissions (
      agent_id, member_id, collection_id, commission_type, plan_type,
      basis_amount, amount, months_covered,
      date_earned, status, maf_no,
      year, period_year, period_month,
      travel_allowance_given, monthly_commission_given,
      override_released, override_commission
    )
    VALUES (
      NEW.agent_id, NEW.member_id, NEW.id, 'travel_allowance', v_member.plan_type,
      v_monthly_due,
      CASE WHEN v_current_install >= 13 THEN 60 ELSE 30 END,
      1,
      v_date_earned,
      CASE WHEN NEW.got_travel_allowance THEN 'paid'::commission_status_enum
           ELSE 'pending'::commission_status_enum END,
      NEW.maf_no,
      v_period_year, v_period_year, v_period_month,
      NEW.got_travel_allowance, FALSE,
      FALSE, 0
    );

    --------------------------------------------------------------
    -- MONTHLY COMMISSION
    --------------------------------------------------------------
    IF v_current_install < 13 AND v_monthly_comm > 0 THEN

      INSERT INTO public.commissions (
        agent_id, member_id, collection_id, commission_type, plan_type,
        basis_amount, amount, months_covered,
        date_earned, status, maf_no,
        year, period_year, period_month,
        monthly_commission_given, travel_allowance_given,
        override_released, override_commission
      )
      VALUES (
        NEW.agent_id, NEW.member_id, NEW.id, 'plan_monthly', v_member.plan_type,
        v_monthly_due, v_monthly_comm, 1,
        v_date_earned,
        CASE WHEN NEW.got_monthly_commission THEN 'paid'::commission_status_enum
             ELSE 'pending'::commission_status_enum END,
        NEW.maf_no,
        v_period_year, v_period_year, v_period_month,
        NEW.got_monthly_commission, FALSE,
        FALSE, 0
      );

    END IF;

    --------------------------------------------------------------
    -- SELF OVERRIDE FOR AS / MS / MH (MOVED OUTSIDE)
    --------------------------------------------------------------
    SELECT position INTO v_upline_position
    FROM agents
    WHERE id = NEW.agent_id;

    v_override_amount := 0;

    IF v_upline_position ILIKE 'Assistant Supervisor' THEN
      v_override_amount := 16;
    ELSIF v_upline_position ILIKE 'Marketing Supervisor' THEN
      v_override_amount := 12;
    ELSIF v_upline_position ILIKE 'Marketing Head' THEN
      v_override_amount := 8;
    END IF;

    IF v_override_amount > 0 THEN
      INSERT INTO commissions (
        agent_id, member_id, collection_id, commission_type, plan_type,
        basis_amount, amount, months_covered,
        date_earned, status, maf_no,
        year, period_year, period_month,
        override_released, override_commission
      )
      VALUES (
        NEW.agent_id, NEW.member_id, NEW.id, 'override', v_member.plan_type,
        v_monthly_due, v_override_amount, 1,
        v_date_earned, 'pending'::commission_status_enum, NEW.maf_no,
        v_period_year, v_period_year, v_period_month,
        FALSE, v_override_amount
      );
    END IF;

    --------------------------------------------------------------
    -- UPLINE OVERRIDES (MOVED OUTSIDE)
    --------------------------------------------------------------
    SELECT assigned_id INTO v_upline_id
    FROM agents
    WHERE id = NEW.agent_id;

    WHILE v_upline_id IS NOT NULL LOOP

      SELECT position INTO v_upline_position
      FROM agents
      WHERE id = v_upline_id;

      v_override_amount := 0;

      IF v_upline_position ILIKE 'Assistant Supervisor' THEN
        v_override_amount := 16;
      ELSIF v_upline_position ILIKE 'Marketing Supervisor' THEN
        v_override_amount := 12;
      ELSIF v_upline_position ILIKE 'Marketing Head' THEN
        v_override_amount := 8;
      END IF;

      IF v_override_amount > 0 THEN
        INSERT INTO commissions (
          agent_id, member_id, collection_id, commission_type, plan_type,
          basis_amount, amount, months_covered,
          date_earned, status, maf_no,
          year, period_year, period_month,
          override_released, override_commission
        )
        VALUES (
          v_upline_id, NEW.member_id, NEW.id, 'override', v_member.plan_type,
          v_monthly_due, v_override_amount, 1,
          v_date_earned, 'pending'::commission_status_enum, NEW.maf_no,
          v_period_year, v_period_year, v_period_month,
          FALSE, v_override_amount
        );
      END IF;

      SELECT assigned_id INTO v_upline_id
      FROM agents
      WHERE id = v_upline_id;

    END LOOP;

  END LOOP;

  RETURN NEW;
END;
$function$;
