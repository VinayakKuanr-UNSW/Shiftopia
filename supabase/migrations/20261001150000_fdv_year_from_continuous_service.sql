-- FDV year runs from the recorded continuous service start (cl 46.2).
-- Follow-up to 20261001140000, 2026-10-01.
--
-- The FDV reset in `accrue_leave_balances()` keyed off hr.user_contracts
-- .start_date — 2026-08-24 for every active contract (a bulk recreate), so
-- everyone's FDV year reset each 24 August. It now uses
-- profiles.continuous_service_start when recorded, and the contract start only
-- when it is not, so nothing changes for anyone until HR fills the column.
--
-- The body below is the LIVE function (normalised md5 a match for migration
-- 20261001130000, verified before writing) with only the FDV block changed.

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
  LEFT JOIN public.profiles p ON p.id = uc.user_id
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'fdv'
    -- cl 46.2: 10 days per 12 months OF EMPLOYMENT. The year runs from the
    -- recorded continuous service start; until HR records it, from the
    -- contract start as before, so nobody's FDV stops resetting meanwhile.
    AND COALESCE(p.continuous_service_start, uc.start_date) <= CURRENT_DATE
    AND lb.as_of_date < (
      COALESCE(p.continuous_service_start, uc.start_date)
      + (EXTRACT(year FROM age(CURRENT_DATE, COALESCE(p.continuous_service_start, uc.start_date)))::int * interval '1 year')
    )::date;

  -- The religious_cultural and gender_affirmation 1-January resets are GONE.
  -- cl 55.1 and cl 58.2 grant an election between accrued annual leave and
  -- unpaid leave; there is no dedicated balance to reset.

END;
$function$;

REVOKE EXECUTE ON FUNCTION public.accrue_leave_balances() FROM PUBLIC, anon, authenticated;
