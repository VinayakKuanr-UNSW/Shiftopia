-- Contract dates drive the contract.
--
-- A contract runs from its start date to its end date, the last day worked (inclusive,
-- as the compliance engine already reads it: end_date >= shift_date). Its status follows
-- from those dates on the Sydney calendar, on every write and hourly:
--
--   Upcoming  the start date is still ahead: no access, no rostering yet
--   Active    in force
--   Expired   after the last day: final. Kept as the employment record (Fair Work
--             Act 2009 s 535(1): kept for 7 years) and never changed again; its
--             access is revoked and the audit log says so.
--
-- A start date may be in the past (a contract recorded late): access applies from now,
-- and pay already processed is not recalculated. Ending a contract sets its last day:
-- today or earlier ends it at once, a later day ends it automatically.
--
-- Guardrails, all in the database:
--   * end date on or after the start date; a start date always;
--   * an Expired contract can't be edited, reinstated or deleted;
--   * only an Upcoming contract — never in force — can be deleted;
--   * shifts assigned under a contract stay inside its dates, and a shift links to the
--     contract in force on its own date;
--   * the only Administrator contract can't be given an end date;
--   * the 38-hour and Full-Time rules compare contracts whose dates overlap, not just
--     the ones active today;
--   * a place with contracts recorded can't be deleted (retire it instead).

-- ── 1. Status from dates ─────────────────────────────────────────────────────
ALTER TABLE hr.user_contracts DROP CONSTRAINT user_contracts_status_check;

-- Contracts ended under the old vocabulary are Expired, with a last day.
UPDATE hr.user_contracts
   SET start_date = COALESCE(start_date, created_at::date, CURRENT_DATE)
 WHERE start_date IS NULL;
UPDATE hr.user_contracts
   SET status = 'Expired',
       end_date = GREATEST(start_date, COALESCE(end_date, updated_at::date, CURRENT_DATE))
 WHERE status IN ('Inactive', 'Terminated');

ALTER TABLE hr.user_contracts
    ALTER COLUMN start_date SET NOT NULL,
    ADD CONSTRAINT user_contracts_status_check CHECK (status IN ('Upcoming', 'Active', 'Expired')),
    ADD CONSTRAINT user_contracts_dates_in_order CHECK (end_date IS NULL OR end_date >= start_date),
    ADD CONSTRAINT user_contracts_expired_has_last_day CHECK (status <> 'Expired' OR end_date IS NOT NULL);

-- Access needs its place on an Upcoming contract too, not only an Active one.
ALTER TABLE hr.user_contracts DROP CONSTRAINT user_contracts_access_has_place;
ALTER TABLE hr.user_contracts ADD CONSTRAINT user_contracts_access_has_place CHECK (
    status = 'Expired' OR CASE access_level
        WHEN 'beta'    THEN sub_department_id IS NOT NULL
        WHEN 'gamma'   THEN sub_department_id IS NOT NULL
        WHEN 'delta'   THEN department_id IS NOT NULL
        WHEN 'epsilon' THEN organization_id IS NOT NULL
        ELSE true END);

COMMENT ON COLUMN hr.user_contracts.status IS
    'Upcoming / Active / Expired, set from start_date and end_date on the Sydney calendar by hr.contract_lifecycle() (on write) and hr.run_contract_lifecycle() (hourly). Expired is final.';
COMMENT ON COLUMN hr.user_contracts.end_date IS
    'The last day of the contract, inclusive. After it, the contract expires and its access is revoked.';

CREATE OR REPLACE FUNCTION hr.contract_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
    v_today   date := (now() AT TIME ZONE 'Australia/Sydney')::date;
    v_outside int;
    v_first   date;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status = 'Expired' THEN
        RAISE EXCEPTION 'This contract expired on % and is kept as a record, so it can''t be changed. Add a new contract instead.',
            to_char(OLD.end_date, 'FMDD Mon YYYY')
            USING ERRCODE = '23514';
    END IF;

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

    IF NEW.status = 'Expired' THEN
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
REVOKE ALL ON FUNCTION hr.contract_lifecycle() FROM PUBLIC, anon, authenticated;

-- Runs before every other BEFORE trigger on the table (they fire in name order), so
-- the guardrails see the status the dates give.
CREATE TRIGGER trg_a_contract_lifecycle
    BEFORE INSERT OR UPDATE ON hr.user_contracts
    FOR EACH ROW EXECUTE FUNCTION hr.contract_lifecycle();

-- The hourly sweep: Upcoming contracts whose start date has come, and Active ones past
-- their last day. A contract a guardrail refuses to move stays as it is, with a warning.
CREATE OR REPLACE FUNCTION hr.run_contract_lifecycle()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
    v_today date := (now() AT TIME ZONE 'Australia/Sydney')::date;
    k       record;
    n       integer := 0;
BEGIN
    FOR k IN SELECT id, status FROM hr.user_contracts
              WHERE (status = 'Active' AND end_date < v_today)
                 OR (status = 'Upcoming' AND start_date <= v_today)
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
REVOKE ALL ON FUNCTION hr.run_contract_lifecycle() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('contract_lifecycle_hourly', '7 * * * *', 'SELECT hr.run_contract_lifecycle()');

-- A change of dates moves the status, so it moves the access mirror too.
DROP TRIGGER trg_contract_access_sync ON hr.user_contracts;
CREATE TRIGGER trg_contract_access_sync
    AFTER INSERT OR UPDATE OF access_level, status, start_date, end_date, user_id, organization_id, department_id, sub_department_id
    ON hr.user_contracts
    FOR EACH ROW EXECUTE FUNCTION hr.contract_access_sync();

-- ── 2. Only a contract that never started can be deleted ─────────────────────
ALTER POLICY contracts_delete_manager ON hr.user_contracts
    USING (status = 'Upcoming' AND can_manage_contract(user_id, organization_id, department_id, sub_department_id));

-- ── 3. The rules across contracts compare overlapping dates ──────────────────
CREATE OR REPLACE FUNCTION hr.fn_check_user_contract_guardrails()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'hr', 'public'
AS $function$
DECLARE
    v_ft_positions  INT;
    v_pt_count      INT;
    v_pt_weekly_sum NUMERIC;
    v_new_weekly    NUMERIC;
    k_no_id CONSTANT uuid := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
    -- Ending a contract can only relieve these rules. Anything else — a contract in
    -- force, an upcoming one, or a past one being recorded — is checked against every
    -- other contract whose dates overlap it, not just the ones active today.
    IF TG_OP = 'UPDATE' AND NEW.status = 'Expired' THEN
        RETURN NEW;
    END IF;

    -- Serialise contract writes for this ONE employee. Replaces the
    -- concurrency guarantee of the dropped partial unique index.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));

    IF NEW.employment_status = 'Full-Time' THEN
        v_new_weekly := 38;
    ELSIF NEW.employment_status = 'Part-Time' THEN
        v_new_weekly := COALESCE(NEW.contracted_weekly_hours, 0);
    ELSIF NEW.employment_status = 'Flexible Part-Time' THEN
        IF COALESCE(NEW.contracted_weekly_hours, 0) > 0 THEN
            v_new_weekly := NEW.contracted_weekly_hours;
        ELSE
            v_new_weekly := COALESCE(NEW.annual_guaranteed_hours, 0) / 52.0;
        END IF;
    ELSE
        v_new_weekly := 0;
    END IF;

    -- 0. Contracted hours follow the employment type (EBA). The contract wizard
    --    applies the same rules (evaluateHoursRule); this is the backstop.
    IF NEW.employment_status = 'Full-Time' THEN
        NEW.contracted_weekly_hours := COALESCE(NEW.contracted_weekly_hours, 38);
        IF NEW.contracted_weekly_hours <> 38 THEN
            RAISE EXCEPTION 'Full-Time is 38 ordinary hours a week (EBA cl 12.2(b)).'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.employment_status = 'Part-Time' THEN
        IF NOT (COALESCE(NEW.contracted_weekly_hours, 0) > 0 AND NEW.contracted_weekly_hours < 38) THEN
            RAISE EXCEPTION 'Part-Time hours must be more than 0 and less than 38 a week (EBA cl 12.3(b)).'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.employment_status = 'Flexible Part-Time' THEN
        IF NEW.annual_guaranteed_hours IS NULL OR NEW.annual_guaranteed_hours NOT BETWEEN 624 AND 1976 THEN
            RAISE EXCEPTION 'Flexible Part-Time is engaged for 624 to 1,976 ordinary hours a year (EBA cl 12.4(a), 35.3(a)).'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.employment_status = 'Casual' THEN
        -- A casual is engaged by the hour with no firm commitment (cl 12.5(a)):
        -- contracted hours mean nothing, so none are kept.
        NEW.contracted_weekly_hours := 0;
        NEW.annual_guaranteed_hours := NULL;
        v_new_weekly := 0;
    END IF;

    -- 1. At most one active Full-Time POSITION (was: one row).
    IF NEW.employment_status = 'Full-Time' THEN
        SELECT COUNT(DISTINCT position_id) INTO v_ft_positions
        FROM hr.user_contracts
        WHERE user_id = NEW.user_id
          AND daterange(start_date, end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]')
          AND employment_status = 'Full-Time'
          AND position_id IS DISTINCT FROM NEW.position_id
          AND id <> COALESCE(NEW.id, k_no_id);

        IF v_ft_positions > 0 THEN
            RAISE EXCEPTION 'An employee cannot hold more than one active Full-Time position.'
                USING ERRCODE = '23505';
        END IF;
    END IF;

    -- 2. Full-Time and Part-Time cannot coexist. Existence tests, unchanged.
    IF NEW.employment_status = 'Full-Time' THEN
        SELECT COUNT(*) INTO v_pt_count
        FROM hr.user_contracts
        WHERE user_id = NEW.user_id
          AND daterange(start_date, end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]')
          AND employment_status IN ('Part-Time', 'Flexible Part-Time')
          AND id <> COALESCE(NEW.id, k_no_id);

        IF v_pt_count > 0 THEN
            RAISE EXCEPTION 'An employee holding a Part-Time contract cannot also hold a Full-Time contract.'
                USING ERRCODE = '23514';
        END IF;

    ELSIF NEW.employment_status IN ('Part-Time', 'Flexible Part-Time') THEN
        SELECT COUNT(*) INTO v_ft_positions
        FROM hr.user_contracts
        WHERE user_id = NEW.user_id
          AND daterange(start_date, end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]')
          AND employment_status = 'Full-Time'
          AND id <> COALESCE(NEW.id, k_no_id);

        IF v_ft_positions > 0 THEN
            RAISE EXCEPTION 'An employee holding a Full-Time contract cannot also hold a Part-Time contract.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- 3. 38h across all Part-Time POSITIONS, counting each position once.
    IF NEW.employment_status IN ('Part-Time', 'Flexible Part-Time') THEN
        WITH per_position AS (
            SELECT position_id,
                   MAX(CASE
                        WHEN employment_status = 'Part-Time'
                            THEN COALESCE(contracted_weekly_hours, 0)
                        WHEN employment_status = 'Flexible Part-Time'
                            THEN CASE WHEN COALESCE(contracted_weekly_hours, 0) > 0
                                      THEN contracted_weekly_hours
                                      ELSE COALESCE(annual_guaranteed_hours, 0) / 52.0 END
                        ELSE 0
                       END) AS weekly
              FROM hr.user_contracts
             WHERE user_id = NEW.user_id
               AND daterange(start_date, end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]')
               AND employment_status IN ('Part-Time', 'Flexible Part-Time')
               AND position_id IS DISTINCT FROM NEW.position_id
               AND id <> COALESCE(NEW.id, k_no_id)
             GROUP BY position_id
        )
        SELECT COALESCE(SUM(weekly), 0) INTO v_pt_weekly_sum FROM per_position;

        IF (v_pt_weekly_sum + v_new_weekly) > 38.001 THEN
            RAISE EXCEPTION 'Total contracted hours across all Part-Time contracts cannot exceed 38 hours per week (attempted total: %h/week).',
                ROUND(v_pt_weekly_sum + v_new_weekly, 1)
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- ── 4. The only Administrator contract keeps no end date ─────────────────────
CREATE OR REPLACE FUNCTION hr.contract_access_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
BEGIN
    IF (TG_OP = 'INSERT' AND NEW.access_level > 'alpha')
       OR (TG_OP = 'UPDATE' AND NEW.access_level IS DISTINCT FROM OLD.access_level) THEN
        IF auth.uid() IS NOT NULL AND NOT public.holds_action('access.manage') THEN
            RAISE EXCEPTION 'Only an Administrator can set the access on a contract.'
                USING ERRCODE = '42501';
        END IF;
    END IF;
    -- An end date on the only Administrator contract would expire it and leave nobody
    -- able to manage access.
    IF NEW.access_level = 'zeta' AND NEW.end_date IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.end_date IS DISTINCT FROM NEW.end_date OR OLD.access_level IS DISTINCT FROM NEW.access_level)
       AND NOT EXISTS (
            SELECT 1 FROM hr.user_contracts c
             WHERE c.id <> NEW.id AND c.access_level = 'zeta' AND c.status = 'Active'
               AND (c.end_date IS NULL OR c.end_date > NEW.end_date)) THEN
        RAISE EXCEPTION 'This contract carries the only Administrator access, so it can''t have an end date: it would expire and leave nobody to manage access. Give another contract Administrator access first.'
            USING ERRCODE = '23514';
    END IF;
    -- The place the access reaches must be on the row (user_contracts_access_has_place
    -- is the backstop; this says it in words).
    IF NEW.status <> 'Expired' AND (
           (NEW.access_level IN ('beta', 'gamma') AND NEW.sub_department_id IS NULL)
        OR (NEW.access_level = 'delta' AND NEW.department_id IS NULL)
        OR (NEW.access_level = 'epsilon' AND NEW.organization_id IS NULL)) THEN
        RAISE EXCEPTION '% access reaches the contract''s %, and this contract has none.',
            public.access_level_label(NEW.access_level),
            CASE NEW.access_level WHEN 'delta' THEN 'department' WHEN 'epsilon' THEN 'organization' ELSE 'sub-department' END
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

-- ── 5. A place with contracts recorded is retired, not deleted ───────────────
CREATE OR REPLACE FUNCTION public.place_keep_access_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_kind  text := CASE TG_TABLE_NAME WHEN 'organizations' THEN 'organization'
                                       WHEN 'departments'   THEN 'department'
                                       ELSE 'sub-department' END;
    v_verb  text := CASE TG_OP WHEN 'DELETE' THEN 'delete' ELSE 'retire' END;
    v_count int;
    v_who   text;
    v_recorded int;
BEGIN
    -- Only removing a place, or retiring it (active → inactive), can strand a grant.
    IF TG_OP = 'UPDATE' AND NOT (OLD.is_active AND NOT NEW.is_active) THEN
        RETURN NEW;
    END IF;

    SELECT count(*),
           string_agg(holder, ', ' ORDER BY rn) FILTER (WHERE rn <= 3)
      INTO v_count, v_who
      FROM (
        SELECT public.access_level_label(ac.access_level) || ' — '
               || COALESCE(NULLIF(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
                           p.email, ac.user_id::text) AS holder,
               row_number() OVER (ORDER BY ac.access_level DESC, ac.created_at) AS rn
          FROM public.app_access_certificates ac
          LEFT JOIN public.profiles p ON p.id = ac.user_id
         WHERE ac.is_active
           AND CASE TG_TABLE_NAME
                 WHEN 'organizations' THEN ac.organization_id = OLD.id
                 WHEN 'departments'   THEN ac.department_id = OLD.id
                 ELSE ac.sub_department_id = OLD.id
               END
      ) scoped;

    IF v_count > 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = CASE TG_OP WHEN 'DELETE' THEN '23503' ELSE '23514' END,
            MESSAGE = format('Cannot %s %s "%s": %s contract%s %s access there (%s%s). Change the access on %s contract%s on the Users page first.',
                             v_verb, v_kind, OLD.name, v_count,
                             CASE WHEN v_count = 1 THEN '' ELSE 's' END,
                             CASE WHEN v_count = 1 THEN 'carries' ELSE 'carry' END,
                             v_who,
                             CASE WHEN v_count > 3 THEN format(', and %s more', v_count - 3) ELSE '' END,
                             CASE WHEN v_count = 1 THEN 'that' ELSE 'those' END,
                             CASE WHEN v_count = 1 THEN '' ELSE 's' END),
            HINT = 'Ended contracts and revoked access do not block this.';
    END IF;

    -- Deleting the place would rewrite the contracts recorded there (their place
    -- becomes empty), and an expired contract is a record that never changes.
    IF TG_OP = 'DELETE' THEN
        SELECT count(*) INTO v_recorded
          FROM hr.user_contracts uc
         WHERE CASE TG_TABLE_NAME
                 WHEN 'organizations' THEN uc.organization_id = OLD.id
                 WHEN 'departments'   THEN uc.department_id = OLD.id
                 ELSE uc.sub_department_id = OLD.id
               END;
        IF v_recorded > 0 THEN
            RAISE EXCEPTION USING
                ERRCODE = '23503',
                MESSAGE = format('Cannot delete %s "%s": %s contract%s %s recorded there. Retire it instead, so the records keep their place.',
                                 v_kind, OLD.name, v_recorded,
                                 CASE WHEN v_recorded = 1 THEN '' ELSE 's' END,
                                 CASE WHEN v_recorded = 1 THEN 'is' ELSE 'are' END);
        END IF;
    END IF;

    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

-- ── 6. A shift links to the contract in force on its date ────────────────────
CREATE OR REPLACE FUNCTION public.auto_link_shift_to_contract()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
BEGIN
    -- Nobody assigned: nobody's contract.
    IF NEW.assigned_employee_id IS NULL THEN
        NEW.user_contract_id := NULL;
        RETURN NEW;
    END IF;

    -- Nothing that decides the contract changed.
    IF TG_OP = 'UPDATE'
       AND NEW.assigned_employee_id   IS NOT DISTINCT FROM OLD.assigned_employee_id
       AND NEW.role_id                IS NOT DISTINCT FROM OLD.role_id
       AND NEW.shift_date             IS NOT DISTINCT FROM OLD.shift_date
       AND NEW.sub_department_id      IS NOT DISTINCT FROM OLD.sub_department_id
       AND NEW.target_employment_type IS NOT DISTINCT FROM OLD.target_employment_type
       AND NEW.user_contract_id       IS NOT DISTINCT FROM OLD.user_contract_id
       AND NEW.user_contract_id       IS NOT NULL
    THEN
        RETURN NEW;
    END IF;

    -- A link the caller set explicitly is kept when it is the assignee's own.
    IF NEW.user_contract_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.user_contract_id IS DISTINCT FROM OLD.user_contract_id)
       AND EXISTS (SELECT 1 FROM hr.user_contracts uc
                    WHERE uc.id = NEW.user_contract_id
                      AND uc.user_id = NEW.assigned_employee_id)
    THEN
        RETURN NEW;
    END IF;

    -- Otherwise: the assignee's contract in force on the shift's date, on the
    -- shift's employment target — for this role, else in this sub-department —
    -- the same scopes fn_enforce_shift_employment_target accepts.
    NEW.user_contract_id := (
        SELECT uc.id
          FROM hr.user_contracts uc
         WHERE uc.user_id = NEW.assigned_employee_id
           AND uc.start_date <= NEW.shift_date
           AND (uc.end_date IS NULL OR uc.end_date >= NEW.shift_date)
           AND ( NEW.sub_department_id IS NULL
              OR uc.sub_department_id = NEW.sub_department_id
              OR uc.sub_department_id IS NULL )
         ORDER BY (public.fn_normalize_employment_type(uc.employment_status::text)
                       IS NOT DISTINCT FROM NEW.target_employment_type) DESC,
                  (uc.role_id IS NOT DISTINCT FROM NEW.role_id) DESC,
                  (uc.sub_department_id IS NOT DISTINCT FROM NEW.sub_department_id) DESC,
                  uc.remuneration_level DESC NULLS LAST,
                  uc.id
         LIMIT 1);
    RETURN NEW;
END;
$function$;

-- ── 7. Bring every contract to the status its dates give, now ────────────────
SELECT hr.run_contract_lifecycle();
