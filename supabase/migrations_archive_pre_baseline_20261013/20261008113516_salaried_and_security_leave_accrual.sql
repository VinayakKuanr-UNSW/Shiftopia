-- Gating Schedule 3 leave entitlements (210h annual, 84h personal) to eba_security_annualised.
-- Salaried employees outside the EBA (pay_basis = 'salary') receive standard NES leave:
-- 4 weeks (152h) annual leave and 10 days (76h) personal leave.

CREATE OR REPLACE FUNCTION public.seed_leave_balances_for_new_contract()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'hr'
AS $function$
DECLARE
  v_is_casual boolean;
  v_is_ft_security boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'Active' THEN
    RETURN NEW;
  END IF;

  v_is_casual := LOWER(COALESCE(NEW.employment_status::text, '')) LIKE '%casual%';
  v_is_ft_security := LOWER(COALESCE(NEW.employment_status::text, '')) LIKE '%full%'
    AND (
      NEW.pay_basis = 'eba_security_annualised'
      OR (NEW.pay_basis IS NULL AND EXISTS (
        SELECT 1 FROM hr.roles r WHERE r.id = NEW.role_id AND r.name ILIKE '%security%'
      ))
    );

  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'fdv', 76.0, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  IF v_is_casual THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'annual', CASE WHEN v_is_ft_security THEN 210.0 ELSE 152.0 END, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'personal', CASE WHEN v_is_ft_security THEN 84.0 ELSE 76.0 END, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'seed_leave_balances_for_new_contract swallowed (contract=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.accrue_leave_balances()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
BEGIN
  -- Standard Permanent (non-casual, non-flex, non-Sch3 FT Security): 4 weeks (152h/yr pro rata)
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
      AND (
        uc.pay_basis = 'eba_security_annualised'
        OR (uc.pay_basis IS NULL AND EXISTS (
          SELECT 1 FROM hr.roles r WHERE r.id = uc.role_id AND r.name ILIKE '%security%'
        ))
      )
    )
    AND lb.as_of_date < CURRENT_DATE;

  -- Standard Personal/Carer's (non-casual, non-flex, non-Sch3 FT Security): 10 days (76h/yr pro rata)
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
      AND (
        uc.pay_basis = 'eba_security_annualised'
        OR (uc.pay_basis IS NULL AND EXISTS (
          SELECT 1 FROM hr.roles r WHERE r.id = uc.role_id AND r.name ILIKE '%security%'
        ))
      )
    )
    AND lb.as_of_date < CURRENT_DATE;

  -- Flexible Part-Time: Annual leave (4 weeks over rolling 12-week average)
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

  -- Flexible Part-Time: Personal leave (2 weeks over rolling 12-week average)
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

  -- Full-time Security: flat 210h annual a year (Sch 3 §8.2) — eba_security_annualised only.
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
    AND (
      uc.pay_basis = 'eba_security_annualised'
      OR (uc.pay_basis IS NULL AND r.name ILIKE '%security%')
    )
    AND lb.as_of_date < CURRENT_DATE;

  -- Full-time Security: flat 84h personal/carer's a year (Sch 3 §8.3) — eba_security_annualised only.
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
    AND (
      uc.pay_basis = 'eba_security_annualised'
      OR (uc.pay_basis IS NULL AND r.name ILIKE '%security%')
    )
    AND lb.as_of_date < CURRENT_DATE;

  -- FDV leave: 10 days (76h) per year
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
    AND COALESCE(p.continuous_service_start, uc.start_date) <= CURRENT_DATE
    AND lb.as_of_date < (
      COALESCE(p.continuous_service_start, uc.start_date)
      + (EXTRACT(year FROM age(CURRENT_DATE, COALESCE(p.continuous_service_start, uc.start_date)))::int * interval '1 year')
    )::date;

END;
$function$;

REVOKE ALL ON FUNCTION public.seed_leave_balances_for_new_contract() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_leave_balances_for_new_contract() TO service_role;

REVOKE ALL ON FUNCTION public.accrue_leave_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accrue_leave_balances() TO service_role;
