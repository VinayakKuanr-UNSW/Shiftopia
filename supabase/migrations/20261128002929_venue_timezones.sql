-- Venue time: every organization has a timezone, every shift takes its
-- organization's, and "today" is the venue's date (docs/architecture/
-- multi-organization.md §9, B5; global-expansion-scope.md §3.1).
--
-- Why: organizations had no timezone and shifts.timezone defaulted to
-- 'Australia/Sydney', so a BCEC (Brisbane, no daylight saving) shift would be an
-- hour wrong from October to April. Several functions also ignored the shift's
-- zone, and "today" was always Sydney's date.
--
-- Standard model, kept: instants in UTC (timestamptz); shifts authored as venue
-- wall clock (shift_date + start_time) plus the venue's IANA zone; start_at /
-- end_at derived by trg_recalc_shift_utc_timestamps (already DST-correct). A shift
-- belongs to the date it starts (day divide = start day). Cron schedules stay in
-- fixed UTC; only their date logic follows the venue.
--
-- Not here: the TOIL helpers (salaried staff only, all at ICC Sydney today), the
-- COALESCE(timezone, 'Australia/Sydney') fallbacks in ~20 functions (dead once
-- every shift carries its zone), and the client (follow-up). Also deferred, because
-- their Sydney date only errs safe (Sydney is never behind Brisbane, so they treat
-- Brisbane's last hour of the day as already past — never the reverse):
-- apply_template_to_date_range_v2 (its start_at is recomputed by the trigger
-- anyway), preview_template_application, add/delete/rename_roster_subgroup_*.

-- ── 1. organizations.timezone ────────────────────────────────────────────────
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS timezone text;
UPDATE public.organizations SET timezone = 'Australia/Brisbane' WHERE code = 'BCEC' AND timezone IS NULL;
UPDATE public.organizations SET timezone = 'Australia/Sydney'   WHERE timezone IS NULL;
ALTER TABLE public.organizations ALTER COLUMN timezone SET NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_organization_timezone_valid()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- An unknown zone fails here ("time zone ... not recognized"), not at the
    -- venue's first shift.
    PERFORM now() AT TIME ZONE NEW.timezone;
    RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_organizations_timezone_valid ON public.organizations;
CREATE TRIGGER trg_organizations_timezone_valid
    BEFORE INSERT OR UPDATE OF timezone ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.fn_organization_timezone_valid();

-- ── 2. Helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.organization_timezone(p_organization_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_zone text;
BEGIN
    -- Definer: triggers run as the caller and organizations are member-only;
    -- a zone is not sensitive. No fallback zone: a missing one is a bug.
    SELECT o.timezone INTO v_zone FROM public.organizations o WHERE o.id = p_organization_id;
    IF v_zone IS NULL THEN
        RAISE EXCEPTION 'No timezone for organization %', p_organization_id USING ERRCODE = '23502';
    END IF;
    RETURN v_zone;
END;
$function$;
REVOKE ALL ON FUNCTION public.organization_timezone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_timezone(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.organization_today(p_organization_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT (now() AT TIME ZONE public.organization_timezone(p_organization_id))::date;
$function$;
REVOKE ALL ON FUNCTION public.organization_today(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_today(uuid) TO authenticated, service_role;

-- ── 3. A shift's zone is its organization's ──────────────────────────────────
-- The column keeps its old default: it applies only where triggers are off
-- (test fixtures in replica mode); every real insert and update goes through the
-- trigger below.

CREATE OR REPLACE FUNCTION public.fn_shift_timezone_from_organization()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- Whatever the caller sent: the venue's wall clock needs the venue's zone.
    NEW.timezone := public.organization_timezone(NEW.organization_id);
    RETURN NEW;
END;
$function$;
-- Named to fire before every BEFORE trigger that reads timezone
-- (trg_recalc_shift_utc_timestamps, trg_shift_not_started, trg_shift_published_frozen).
DROP TRIGGER IF EXISTS trg_01_shift_timezone_from_organization ON public.shifts;
CREATE TRIGGER trg_01_shift_timezone_from_organization
    BEFORE INSERT OR UPDATE OF organization_id, timezone ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.fn_shift_timezone_from_organization();

-- ── 4. Functions that ignored the shift's zone, or used Sydney's date ────────
CREATE OR REPLACE FUNCTION public.fn_shift_not_started()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_start timestamptz;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.shift_date IS NOT DISTINCT FROM NEW.shift_date
     AND OLD.start_time IS NOT DISTINCT FROM NEW.start_time THEN
    RETURN NEW;
  END IF;

  v_start := (NEW.shift_date || ' ' || NEW.start_time)::timestamp AT TIME ZONE NEW.timezone;
  IF v_start <= now() THEN
    RAISE EXCEPTION 'A shift cannot start in the past: % at % (venue time) has already passed.',
      to_char(NEW.shift_date, 'Dy DD Mon'), to_char(NEW.start_time, 'HH24:MI')
      USING ERRCODE = 'check_violation', HINT = 'SHIFT_STARTED';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_prevent_locked_shift_modification()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift_start timestamptz;
BEGIN
  v_shift_start := (OLD.shift_date || ' ' || OLD.start_time)::timestamp AT TIME ZONE OLD.timezone;

  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.shift_purge', true) = 'user' THEN
      RETURN OLD;
    END IF;
    IF v_shift_start <= now() THEN
      RAISE EXCEPTION 'Shift % has already started (venue time) and cannot be deleted.', OLD.id
        USING HINT = 'SHIFT_STARTED';
    END IF;
    RETURN OLD;
  END IF;

  IF v_shift_start <= NOW() THEN
    IF (OLD.template_id IS NOT NULL AND NEW.template_id IS NULL) THEN
      RETURN NEW;
    END IF;
    IF (
      OLD.shift_date IS NOT DISTINCT FROM NEW.shift_date AND
      OLD.start_time IS NOT DISTINCT FROM NEW.start_time AND
      OLD.end_time IS NOT DISTINCT FROM NEW.end_time AND
      OLD.assigned_employee_id IS NOT DISTINCT FROM NEW.assigned_employee_id AND
      OLD.department_id IS NOT DISTINCT FROM NEW.department_id AND
      OLD.role_id IS NOT DISTINCT FROM NEW.role_id AND
      OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id AND
      OLD.assignment_status IS NOT DISTINCT FROM NEW.assignment_status
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Cannot modify a shift schedule that has already started (venue time). Shift ID: %', OLD.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public._shift_delete_refusal(p_shift shifts)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.timesheets t
      WHERE t.shift_id = p_shift.id AND t.clock_in IS NOT NULL
    )
      OR p_shift.lifecycle_status::text IN ('InProgress', 'Completed')
      THEN 'SHIFT_WORKED'
    WHEN (p_shift.shift_date || ' ' || p_shift.start_time)::timestamp AT TIME ZONE p_shift.timezone <= now()
      THEN 'SHIFT_STARTED'
    WHEN p_shift.lifecycle_status::text <> 'Draft'
      THEN 'SHIFT_PUBLISHED'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_first_aid_appointment_history_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_today date := public.organization_today(CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END);
BEGIN
  IF current_setting('app.first_aid_history_override', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.effective_from <= v_today THEN
      RAISE EXCEPTION 'This first-aid appointment has already started, so it cannot be deleted. End it instead.'
        USING ERRCODE = 'P0001',
              HINT = 'Set effective_to to the last day the appointment applies (yesterday at the earliest).';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.effective_from <= v_today THEN
    IF NEW.effective_from  IS DISTINCT FROM OLD.effective_from
       OR NEW.employee_id     IS DISTINCT FROM OLD.employee_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'The start date, employee and organisation of a first-aid appointment that has started are fixed.'
        USING ERRCODE = 'P0001';
    END IF;

    IF OLD.effective_to IS NOT NULL AND OLD.effective_to < v_today THEN
      IF NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'This first-aid appointment has already ended; its dates can no longer change.'
          USING ERRCODE = 'P0001',
                HINT = 'Create a new appointment if the person is appointed again.';
      END IF;
    ELSIF NEW.effective_to IS NOT NULL AND NEW.effective_to < v_today - 1 THEN
      RAISE EXCEPTION 'A first-aid appointment cannot be ended before yesterday (%): that would re-price shifts already worked.', v_today - 1
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION hr.contract_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
    v_today   date := public.organization_today(NEW.organization_id);
    v_outside int;
    v_first   date;
BEGIN
    -- Only the three statuses exist; an old value is refused, never reinterpreted
    -- (a silent mapping once turned 'Inactive' — meant as ended — back into Active).
    IF NEW.status IS NULL OR NEW.status NOT IN ('Upcoming', 'Active', 'Expired') THEN
        RAISE EXCEPTION 'A contract is Upcoming, Active or Expired, and its dates decide which. To end it, give it a last day (or set it to Expired).'
            USING ERRCODE = '23514';
    END IF;

    NEW.start_date := COALESCE(NEW.start_date, v_today);
    -- user_contracts_dates_in_order is the backstop; this says it in words.
    IF NEW.end_date IS NOT NULL AND NEW.end_date < NEW.start_date
       AND NOT (NEW.status = 'Expired' AND (NEW.end_date IS NULL OR NEW.end_date > v_today)) THEN
        RAISE EXCEPTION 'The last day (%) is before the start date (%).',
            to_char(NEW.end_date, 'FMDD Mon YYYY'), to_char(NEW.start_date, 'FMDD Mon YYYY')
            USING ERRCODE = '23514';
    END IF;

    -- Setting a contract to Expired ends it now. One already expired, being corrected,
    -- takes the status its dates give like any other: a later last day reopens it.
    IF NEW.status = 'Expired' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Expired') THEN
        -- Ended now: the last day is today, unless an earlier one is given.
        IF TG_OP = 'UPDATE' AND OLD.status = 'Upcoming' THEN
            RAISE EXCEPTION 'This contract hasn''t started yet, so there is nothing to end. Delete it instead.'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.end_date IS NULL OR NEW.end_date > v_today THEN
            NEW.end_date := v_today;
        END IF;
    ELSIF NEW.end_date IS NOT NULL AND NEW.end_date < v_today THEN
        NEW.status := 'Expired';
    ELSIF NEW.start_date > v_today THEN
        NEW.status := 'Upcoming';
    ELSE
        NEW.status := 'Active';
    END IF;

    -- Shifts assigned under this contract stay inside its dates: a worked or
    -- rostered shift is priced on the contract it is linked to.
    IF TG_OP = 'UPDATE'
       AND (NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date) THEN
        SELECT count(*), min(s.shift_date) INTO v_outside, v_first
          FROM public.shifts s
         WHERE s.user_contract_id = NEW.id
           AND NOT COALESCE(s.is_cancelled, false)
           AND (s.shift_date < NEW.start_date OR (NEW.end_date IS NOT NULL AND s.shift_date > NEW.end_date));
        IF v_outside > 0 THEN
            RAISE EXCEPTION '% assigned under this contract % outside these dates (the first on %). Reassign or unassign % first.',
                CASE WHEN v_outside = 1 THEN '1 shift' ELSE v_outside || ' shifts' END,
                CASE WHEN v_outside = 1 THEN 'falls' ELSE 'fall' END,
                to_char(v_first, 'FMDD Mon YYYY'),
                CASE WHEN v_outside = 1 THEN 'it' ELSE 'them' END
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION hr.record_contract_pay_terms()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'hr', 'public'
AS $function$
DECLARE
    v_effective date;
    v_reason    text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_effective := COALESCE(NEW.start_date, public.organization_today(NEW.organization_id));
        v_reason    := 'hire';
    ELSE
        v_effective := public.organization_today(NEW.organization_id);
        v_reason    := COALESCE(
            NULLIF(current_setting('hr.pay_change_reason', true), ''),
            CASE WHEN NEW.pay_basis = 'salary'
                  AND OLD.pay_basis = 'salary'
                 THEN 'salary_review'
                 ELSE 'reclassification' END);
    END IF;

    INSERT INTO hr.contract_pay_terms
        (contract_id, effective_from, pay_basis, remuneration_level,
         annual_salary, change_reason, recorded_by)
    VALUES
        (NEW.id, v_effective, NEW.pay_basis, NEW.remuneration_level,
         NEW.annual_salary, v_reason, auth.uid())
    ON CONFLICT (contract_id, effective_from) DO UPDATE
       SET pay_basis          = EXCLUDED.pay_basis,
           remuneration_level = EXCLUDED.remuneration_level,
           annual_salary      = EXCLUDED.annual_salary,
           change_reason      = EXCLUDED.change_reason,
           recorded_at        = now(),
           recorded_by        = EXCLUDED.recorded_by;

    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION hr.run_contract_lifecycle()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
    k       record;
    n       integer := 0;
BEGIN
    FOR k IN SELECT id, status FROM hr.user_contracts
              WHERE (status = 'Active' AND end_date < public.organization_today(organization_id))
                 OR (status = 'Upcoming' AND start_date <= public.organization_today(organization_id))
              ORDER BY id LOOP
        BEGIN
            -- status in the SET list, so the AFTER UPDATE OF status triggers (access
            -- mirror, leave balances) fire; hr.contract_lifecycle() decides the value.
            UPDATE hr.user_contracts
               SET status = CASE WHEN k.status = 'Active' THEN 'Expired' ELSE 'Active' END
             WHERE id = k.id;
            n := n + 1;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Contract % stays %: %', k.id, k.status, SQLERRM;
        END;
    END LOOP;
    RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_casual_fairness_nightly()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_today date := (now() AT TIME ZONE 'Australia/Sydney')::date;
    v_org   uuid;
    v_rows  integer := 0;
BEGIN
    FOR v_org IN SELECT id FROM public.organizations WHERE COALESCE(is_active, true) LOOP
        BEGIN
            PERFORM public.capture_fairness_opportunities(v_org, public.organization_today(v_org), public.organization_today(v_org) + 7);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'casual fairness capture failed for organization %: %', v_org, SQLERRM;
        END;
        BEGIN
            v_rows := v_rows + public.recompute_casual_fairness(v_org, public.organization_today(v_org));
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'casual fairness recompute failed for organization %: %', v_org, SQLERRM;
        END;
    END LOOP;

    DELETE FROM public.fairness_opportunities WHERE shift_date < v_today - 182;
    RETURN v_rows;
END $function$;
