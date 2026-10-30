-- Nightly leave accrual: pause during unpaid leave (cl 57.3), and fix the
-- full-time Security rates (Sch 3 §8.2 / §8.3). Audit M2 + L2, 2026-10-01.
--
-- The body below is the LIVE `accrue_leave_balances()` (pg_get_functiondef,
-- 2026-10-01) with exactly two kinds of change. Nothing else moves.
--
-- 1. M2 — cl 57.3: "During a period of authorised unpaid leave, the Team
--    Member will not accrue entitlements to annual leave, personal/carer's leave
--    or long service leave." Every `(CURRENT_DATE - lb.as_of_date)` — the days
--    being accrued — becomes `leave_accrual_days(employee, as_of_date)`: those
--    same calendar days MINUS the days covered by APPROVED unpaid leave. Unpaid
--    here means type `unpaid` (cl 57) and cl 55.1 / 58.2 leave elected unpaid.
--    Community service leave is NOT excluded: under the NES it counts as service.
--    LIMIT: accrual runs nightly, so unpaid leave approved AFTER its days have
--    already accrued is not clawed back; it is paused from approval onward.
--
-- 2. L2 — full-time Security. The two formulas could not both be right:
--    annual used weekly × 5 / 365 (210h only if 42h is recorded) and personal
--    used weekly × 84 / 38 / 365 (84h only if 38h is recorded). Sch 3 §8.2 and
--    §8.3 state flat figures for FULL-TIME Security — 210h annual, 84h personal
--    a year — so both are now those figures. (No FT Security contract is active
--    today; this was latent.)
--
-- The FDV anniversary reset is untouched.

CREATE OR REPLACE FUNCTION public.leave_accrual_days(p_employee uuid, p_from date)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT GREATEST(0, (CURRENT_DATE - p_from) - COALESCE((
    SELECT count(DISTINCT d::date)::int
    FROM public.leave_requests r,
         generate_series(
           GREATEST(r.start_date::date, p_from),
           LEAST(r.end_date::date, CURRENT_DATE - 1),
           interval '1 day') AS d
    WHERE r.employee_id = p_employee
      AND r.status = 'approved'
      AND (r.leave_type = 'unpaid'
           OR (r.leave_type IN ('religious_cultural', 'gender_affirmation') AND r.election_mode = 'unpaid'))
      AND r.start_date::date < CURRENT_DATE
      AND r.end_date::date >= p_from
  ), 0));
$function$;

CREATE OR REPLACE FUNCTION public.accrue_leave_balances()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
BEGIN
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 4.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 4.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
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

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 2.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 2.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
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

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((wk.weekly_hours * 4.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((wk.weekly_hours * 4.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
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
    balance_hours = balance_hours + ((wk.weekly_hours * 2.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((wk.weekly_hours * 2.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
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

  -- Full-time Security: flat 210h annual a year (Sch 3 §8.2).
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((210.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((210.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
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

  -- Full-time Security: flat 84h personal/carer's a year (Sch 3 §8.3).
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((84.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((84.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
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

  -- The religious_cultural and gender_affirmation 1-January resets are GONE.
  -- cl 55.1 and cl 58.2 grant an election between accrued annual leave and
  -- unpaid leave; there is no dedicated balance to reset.

END;
$function$;

-- Both are called by the cron job (as postgres) only. Revoked last: CREATE OR
-- REPLACE can re-grant.
REVOKE EXECUTE ON FUNCTION public.leave_accrual_days(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.accrue_leave_balances() FROM PUBLIC, anon, authenticated;
