-- ─────────────────────────────────────────────────────────────────────────────
-- Backfilled into version control 2026-08-02 from the PRODUCTION migration
-- ledger (supabase_migrations.schema_migrations @ version 20260727223312).
--
-- This migration was applied DIRECTLY to prod via the Supabase MCP during the
-- 2026-07-27/28 security & payroll audit and had no committed source file until
-- now. It is ALREADY APPLIED in prod — do not re-run against production.
-- Context: docs/investigations/2026-08-02_migration-reconciliation.md
-- ─────────────────────────────────────────────────────────────────────────────

-- P1 fix (payroll & compliance audit, findings H-10, H-11).
-- Cl 55 (Religious/Cultural/Ceremonial, incl. NAIDOC) and cl 58 (Gender
-- Affirmation) were entirely unimplemented: not in the leave-type enum, and
-- the DB CHECK constraint would actively reject an insert attempting either.
--
-- Both clauses grant "up to N days of accrued paid annual leave OR up to N
-- days unpaid leave per calendar year" (5 days / cl 55; 10 days / cl 58) —
-- a capped, non-cumulative, calendar-year entitlement, not a progressively
-- accruing balance. Modelled the same way FDV already is (balance granted
-- up front, tracked, capped) but reset on 1 January each year rather than
-- the contract anniversary FDV uses, since both clauses say "per calendar
-- year" specifically. Scope note: this models the PAID election (drawing
-- against this dedicated capped balance); an employee electing the UNPAID
-- alternative instead uses the existing general 'unpaid' leave type.

ALTER TABLE leave_balances DROP CONSTRAINT valid_leave_type;
ALTER TABLE leave_balances ADD CONSTRAINT valid_leave_type CHECK (
  leave_type IN (
    'annual', 'personal', 'carer', 'compassionate', 'parental',
    'long_service', 'jury_duty', 'fdv', 'supporting_carer',
    'community_service', 'unpaid', 'religious_cultural', 'gender_affirmation'
  )
);

-- Seed initial balances for existing non-casual profiles (cl 55/58 both
-- exclude casuals — "All Team Members (other than casual Team Members)").
INSERT INTO leave_balances (employee_id, leave_type, balance_hours, as_of_date)
SELECT id, 'religious_cultural', 38.0, CURRENT_DATE FROM profiles
WHERE employment_type IS NOT NULL AND LOWER(employment_type::text) NOT LIKE '%casual%'
ON CONFLICT DO NOTHING;

INSERT INTO leave_balances (employee_id, leave_type, balance_hours, as_of_date)
SELECT id, 'gender_affirmation', 76.0, CURRENT_DATE FROM profiles
WHERE employment_type IS NOT NULL AND LOWER(employment_type::text) NOT LIKE '%casual%'
ON CONFLICT DO NOTHING;

-- Extend the nightly accrual function with calendar-year resets for the two
-- new types, appended after the existing FDV block (full CREATE OR REPLACE
-- since Postgres functions can't be partially patched).
CREATE OR REPLACE FUNCTION public.accrue_leave_balances()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
BEGIN
  -- Accrual bases (non-casual only):
  --   * Standard permanents .... contracted_weekly_hours (default 38)
  --   * Flexible part-time ..... trailing 12-week average of actually-worked hours
  --   * Full-time Security ..... EBA Schedule 3 §8.2/8.3: 210h annual / 84h personal per year

  -- Annual leave accrual (standard permanents: not casual, not flex-PT, not FT Security)
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 4.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 4.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'annual'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%casual%'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%flex%'
    AND NOT (
      LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
      AND EXISTS (
        SELECT 1 FROM hr.roles r
        WHERE r.id = uc.role_id AND r.name ILIKE '%security%'
      )
    )
    AND lb.as_of_date < CURRENT_DATE;

  -- Personal/sick leave accrual (standard permanents)
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 2.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 2.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'personal'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%casual%'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%flex%'
    AND NOT (
      LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
      AND EXISTS (
        SELECT 1 FROM hr.roles r
        WHERE r.id = uc.role_id AND r.name ILIKE '%security%'
      )
    )
    AND lb.as_of_date < CURRENT_DATE;

  -- Flexible part-time annual + personal accrual (cl 12.4(b))
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((wk.weekly_hours * 4.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    accrued_hours = accrued_hours + ((wk.weekly_hours * 4.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN COUNT(s.id) > 0
               THEN SUM(COALESCE(s.net_length_minutes, s.scheduled_length_minutes, 0)) / 60.0 / 12.0
             ELSE COALESCE(uc.contracted_weekly_hours, 0.0)
           END AS weekly_hours
    FROM shifts s
    WHERE s.assigned_employee_id = uc.user_id
      AND s.shift_date >= CURRENT_DATE - 84
      AND s.shift_date < CURRENT_DATE
      AND s.lifecycle_status <> 'Cancelled'
      AND s.deleted_at IS NULL
  ) wk ON true
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'annual'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%flex%'
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((wk.weekly_hours * 2.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    accrued_hours = accrued_hours + ((wk.weekly_hours * 2.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN COUNT(s.id) > 0
               THEN SUM(COALESCE(s.net_length_minutes, s.scheduled_length_minutes, 0)) / 60.0 / 12.0
             ELSE COALESCE(uc.contracted_weekly_hours, 0.0)
           END AS weekly_hours
    FROM shifts s
    WHERE s.assigned_employee_id = uc.user_id
      AND s.shift_date >= CURRENT_DATE - 84
      AND s.shift_date < CURRENT_DATE
      AND s.lifecycle_status <> 'Cancelled'
      AND s.deleted_at IS NULL
  ) wk ON true
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'personal'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%flex%'
    AND lb.as_of_date < CURRENT_DATE;

  -- Full-time Security annual leave accrual (EBA Schedule 3 §8.2 — 5 weeks/yr)
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 5.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 5.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  JOIN hr.roles r ON r.id = uc.role_id
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'annual'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
    AND r.name ILIKE '%security%'
    AND lb.as_of_date < CURRENT_DATE;

  -- Full-time Security personal leave accrual (EBA Schedule 3 §8.3 — 84h/yr)
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 84.0 / 38.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 84.0 / 38.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  JOIN hr.roles r ON r.id = uc.role_id
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'personal'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
    AND r.name ILIKE '%security%'
    AND lb.as_of_date < CURRENT_DATE;

  -- FDV leave: resets to 76h on each contract start_date anniversary.
  -- Catch-up form: a cron miss on the exact day (or Feb-29 start dates) still
  -- resets on the next run.
  UPDATE leave_balances lb
  SET
    balance_hours = 76.0,
    accrued_hours = accrued_hours + GREATEST(0, 76.0 - balance_hours),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'fdv'
    AND uc.start_date <= CURRENT_DATE
    AND lb.as_of_date < (
      uc.start_date
      + (EXTRACT(year FROM age(CURRENT_DATE, uc.start_date))::int * interval '1 year')
    )::date;

  -- Religious/Cultural/Ceremonial leave (cl 55.1): resets to 38h (5 days) on
  -- 1 January each calendar year, non-cumulative, non-casual only.
  UPDATE leave_balances lb
  SET
    balance_hours = 38.0,
    accrued_hours = accrued_hours + GREATEST(0, 38.0 - balance_hours),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'religious_cultural'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%casual%'
    AND lb.as_of_date < date_trunc('year', CURRENT_DATE)::date;

  -- Gender Affirmation leave (cl 58.2): resets to 76h (10 days) on 1 January
  -- each calendar year, non-cumulative, non-casual only.
  UPDATE leave_balances lb
  SET
    balance_hours = 76.0,
    accrued_hours = accrued_hours + GREATEST(0, 76.0 - balance_hours),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'gender_affirmation'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%casual%'
    AND lb.as_of_date < date_trunc('year', CURRENT_DATE)::date;

END;
$function$;
