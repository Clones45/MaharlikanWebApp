DROP FUNCTION IF EXISTS get_lapsed_members();

CREATE OR REPLACE FUNCTION get_lapsed_members()
RETURNS TABLE (
    id bigint,
    maf_no text,
    last_name text,
    first_name text,
    middle_name text,
    address text,
    contact_number text,
    religion text,
    birth_date date,
    age integer,
    monthly_due numeric,
    plan_type text,
    contracted_price numeric,
    date_joined date,
    balance numeric,
    gender text,
    civil_status text,
    zipcode text,
    birthplace text,
    nationality text,
    height text,
    weight text,
    casket_type text,
    membership text,
    occupation text,
    agent_id bigint,
    created_at timestamptz,
    plan_start_date date,
    phone_number text,
    months_paid numeric,
    months_since_start double precision,
    months_behind double precision
)
LANGUAGE sql
AS $$
  SELECT 
      m.id,
      m.maf_no,
      m.last_name,
      m.first_name,
      m.middle_name,
      m.address,
      m.contact_number,
      m.religion,
      m.birth_date,
      m.age,
      m.monthly_due,
      m.plan_type,
      m.contracted_price,
      m.date_joined,
      m.balance,
      m.gender,
      m.civil_status,
      m.zipcode,
      m.birthplace,
      m.nationality,
      m.height,
      m.weight,
      m.casket_type,
      m.membership,
      m.occupation,
      m.agent_id,
      m.created_at,
      m.plan_start_date,
      m.phone_number,

      -- months paid
      COALESCE(SUM(c.payment) FILTER (WHERE c.payment_for IN ('regular', 'membership')), 0) / NULLIF(m.monthly_due, 0) AS months_paid,

      -- months since start
      (
        DATE_PART('year', AGE(CURRENT_DATE, m.plan_start_date)) * 12 +
        DATE_PART('month', AGE(CURRENT_DATE, m.plan_start_date))
      ) AS months_since_start,

      -- 👇 THIS WAS MISSING — REQUIRED BY YOUR MOBILE CODE 👇
      (
        (
          DATE_PART('year', AGE(CURRENT_DATE, m.plan_start_date)) * 12 +
          DATE_PART('month', AGE(CURRENT_DATE, m.plan_start_date))
        ) - (COALESCE(SUM(c.payment) FILTER (WHERE c.payment_for IN ('regular', 'membership')), 0) / NULLIF(m.monthly_due, 0))
      ) AS months_behind

  FROM members m
  LEFT JOIN collections c ON c.member_id = m.id
  WHERE m.plan_type LIKE 'PACKAGE%'
  GROUP BY m.id

  -- LAPSED RULE: months_behind > 3
  HAVING 
      (
        (
          DATE_PART('year', AGE(CURRENT_DATE, m.plan_start_date)) * 12 +
          DATE_PART('month', AGE(CURRENT_DATE, m.plan_start_date))
        ) - (COALESCE(SUM(c.payment) FILTER (WHERE c.payment_for IN ('regular', 'membership')), 0) / NULLIF(m.monthly_due, 0))
      ) > 3
  ORDER BY m.last_name ASC, m.first_name ASC;
$$;
