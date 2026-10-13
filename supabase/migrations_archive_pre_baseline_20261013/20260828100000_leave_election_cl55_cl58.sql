-- Religious/cultural (cl 55.1) and gender-affirmation (cl 58.2) leave are an
-- ELECTION, not a separate paid entitlement.
--
-- THE DIVERGENCE. Both clauses read the same way:
--
--   cl 55.1  "...entitled to make an application to the Employer to use up to
--             five (5) days of accrued paid ANNUAL LEAVE per calendar year; OR
--             to be absent for up to five (5) days UNPAID leave per calendar
--             year non-cumulative..."
--   cl 58.2  the same construction, at ten (10) days.
--
-- Neither creates a dedicated paid balance. The Team Member ELECTS between two
-- existing things: drawing down accrued annual leave, or taking unpaid leave.
--
-- What this database does instead: `seed_leave_balances_for_new_contract`
-- seeds a dedicated 38h religious_cultural balance and a 76h
-- gender_affirmation balance, and `accrue_leave_balances` resets both every
-- 1 January. That is more generous than the Agreement AND double-counts — an
-- employee could draw the dedicated balance and still retain the annual leave
-- the clause says it comes out of.
--
-- BLAST RADIUS, measured before writing this. 21 rows of each type exist in
-- `leave_balances`, every one with accrued_hours = 0.00 and used_hours = 0.00,
-- and `leave_requests` is empty — so nobody has ever accrued or consumed
-- against these balances. There is nothing to reconcile, only something to
-- stop doing.
--
-- WHAT REPLACES IT. `leave_requests.election_mode` records which of the two
-- the Team Member chose. It is NULLABLE: an unrecorded election is a real
-- state (every historical request would have one), and the Baseline FT
-- calculator already reports BOTH readings rather than guessing. Requiring the
-- election belongs at the point of request, not as a retrospective backfill.
--
-- The function bodies below are reproduced from `pg_get_functiondef()` in
-- PRODUCTION, not from a repo file — 82 of 124 migration files are absent from
-- prod history, so the repo is not a reliable picture of what is running.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Record the election
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.leave_requests
    add column if not exists election_mode text;

alter table public.leave_requests
    drop constraint if exists leave_requests_election_mode_valid;

-- NULL is permitted for every type, including the two that need an election —
-- that is "not yet recorded", which the application resolves at request time
-- and which Baseline reports as an unresolved ambiguity. What is forbidden is
-- an election on a type that has no election to make.
alter table public.leave_requests
    add constraint leave_requests_election_mode_valid check (
        election_mode is null
        or (leave_type in ('religious_cultural', 'gender_affirmation')
            and election_mode in ('annual', 'unpaid'))
    );

comment on column public.leave_requests.election_mode is
    'cl 55.1 / cl 58.2: whether this absence draws on accrued ANNUAL leave or is UNPAID. NULL = not yet recorded.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Stop seeding dedicated balances
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Reproduced from prod verbatim, minus the two INSERTs. FDV keeps its balance:
-- cl 46 / NES Div 11 genuinely IS a standalone paid entitlement, granted up
-- front and paid even to casuals — it is not an election and must not be
-- swept up in this correction.
create or replace function public.seed_leave_balances_for_new_contract()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'hr'
as $function$
DECLARE
  v_is_casual boolean;
  v_is_ft_security boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'Active' THEN
    RETURN NEW;
  END IF;

  v_is_casual := LOWER(COALESCE(NEW.employment_status::text, '')) LIKE '%casual%';
  v_is_ft_security := LOWER(COALESCE(NEW.employment_status::text, '')) LIKE '%full%'
    AND EXISTS (SELECT 1 FROM hr.roles r WHERE r.id = NEW.role_id AND r.name ILIKE '%security%');

  -- FDV (cl 46 / NES Div 11) is paid for ALL employment types, including casuals.
  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'fdv', 76.0, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  IF v_is_casual THEN
    RETURN NEW; -- casuals accrue no annual/personal balance.
  END IF;

  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'annual', CASE WHEN v_is_ft_security THEN 210.0 ELSE 152.0 END, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'personal', CASE WHEN v_is_ft_security THEN 84.0 ELSE 76.0 END, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  -- religious_cultural and gender_affirmation are NOT seeded. cl 55.1 and
  -- cl 58.2 grant an election between accrued annual leave and unpaid leave,
  -- not a dedicated balance. See leave_requests.election_mode.

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'seed_leave_balances_for_new_contract swallowed (contract=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Stop the 1-January resets
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Reproduced from prod verbatim, minus the two trailing reset blocks. Every
-- other accrual — standard permanents, flexible part-time, full-time Security
-- under Sch 3 §8.2/8.3, and the FDV anniversary reset — is untouched.
create or replace function public.accrue_leave_balances()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'hr'
as $function$
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

  -- The religious_cultural and gender_affirmation 1-January resets are GONE.
  -- cl 55.1 and cl 58.2 grant an election between accrued annual leave and
  -- unpaid leave; there is no dedicated balance to reset.

END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Route an elected absence to the balance it actually draws on
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Extends the redirection this function already performs for carer's leave
-- (cl 45 draws it from the personal balance). An election of 'annual' deducts
-- from annual leave; an election of 'unpaid' deducts from nothing; an election
-- not yet recorded also deducts nothing, because guessing would move real
-- hours out of someone's annual leave on an assumption.
create or replace function public.deduct_leave_balance_on_approval()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
DECLARE
  target_type text;
  old_status  text;
BEGIN
  target_type := CASE
    -- cl 45 — carer's leave is drawn from the personal balance.
    WHEN NEW.leave_type = 'carer' THEN 'personal'
    -- cl 55.1 / cl 58.2 — the election decides which balance, if any.
    WHEN NEW.leave_type IN ('religious_cultural', 'gender_affirmation') THEN
      CASE WHEN NEW.election_mode = 'annual' THEN 'annual' ELSE NULL END
    ELSE NEW.leave_type
  END;

  -- No balance to move: unpaid leave, an unrecorded election, or a per-occasion
  -- type that was never balance-tracked.
  IF target_type IS NULL THEN
    RETURN NEW;
  END IF;

  -- F2: TG_OP-aware — on INSERT there is no OLD row.
  old_status := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END;

  IF NEW.status = 'approved' AND (old_status IS DISTINCT FROM 'approved') THEN
    UPDATE leave_balances
    SET
      balance_hours = GREATEST(0, balance_hours - COALESCE(NEW.requested_hours, 0)),
      used_hours = used_hours + COALESCE(NEW.requested_hours, 0),
      updated_at = now()
    WHERE employee_id = NEW.employee_id
      AND leave_type = target_type;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.status != 'approved' THEN
    UPDATE leave_balances
    SET
      balance_hours = balance_hours + COALESCE(OLD.requested_hours, 0),
      used_hours = GREATEST(0, used_hours - COALESCE(OLD.requested_hours, 0)),
      updated_at = now()
    WHERE employee_id = OLD.employee_id
      AND leave_type = target_type;
  END IF;

  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Remove the balances that should never have existed
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Guarded on accrued_hours = 0 AND used_hours = 0. Every one of the 42 rows
-- satisfies that today; the guard means that if any of them has been touched
-- between writing this and applying it, the row SURVIVES and the discrepancy
-- surfaces as a leftover row rather than as silently destroyed history.
delete from public.leave_balances
where leave_type in ('religious_cultural', 'gender_affirmation')
  and coalesce(accrued_hours, 0) = 0
  and coalesce(used_hours, 0) = 0;

commit;
