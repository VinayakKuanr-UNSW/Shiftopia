-- Contracts are added, edited and deleted (2026-10-16).
--
-- The Users page manages contracts directly, as one table: any contract can be edited,
-- an expired one included, and any contract with no shift rostered under it can be
-- deleted. Its status still follows its dates (hr.contract_lifecycle(), hourly sweep).
--
--   * Expired is no longer final: an expired contract can be corrected, and moving its
--     last day forward (or clearing it) puts it back in force, with its access.
--   * Delete: any status, as long as no shift is rostered under the contract (shifts are
--     priced on their contract). It was: only a contract that never started.
--   * One role in one place at a time: the unique key on (person, place, role) ignored
--     the dates, so a role someone had held could never be added again while the old
--     contract existed. It becomes an exclusion over the contract's dates.

-- ── 1. Expired is no longer final ────────────────────────────────────────────
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

-- ── 2. Delete any contract with no shift rostered under it ───────────────────
ALTER POLICY contracts_delete_manager ON hr.user_contracts
    USING (can_manage_contract(user_id, organization_id, department_id, sub_department_id));

CREATE FUNCTION hr.contract_delete_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
    v_shifts int;
BEGIN
    -- Counted as the owner, so row-level security can't hide a shift from the check.
    SELECT count(*) INTO v_shifts
      FROM public.shifts s
     WHERE s.user_contract_id = OLD.id
       AND s.deleted_at IS NULL;
    IF v_shifts > 0 THEN
        RAISE EXCEPTION '% rostered under this contract. Reassign or unassign % before deleting the contract.',
            CASE WHEN v_shifts = 1 THEN '1 shift is' ELSE v_shifts || ' shifts are' END,
            CASE WHEN v_shifts = 1 THEN 'it' ELSE 'them' END
            USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION hr.contract_delete_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_b_contract_delete_guard
    BEFORE DELETE ON hr.user_contracts
    FOR EACH ROW EXECUTE FUNCTION hr.contract_delete_guard();

-- ── 3. One role in one place at a time ───────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
ALTER TABLE hr.user_contracts DROP CONSTRAINT user_contracts_user_id_organization_id_department_id_sub_de_key;
DROP INDEX hr.user_contracts_user_id_organization_id_coalesce_coalesce1_r_idx;
ALTER TABLE hr.user_contracts ADD CONSTRAINT user_contracts_one_role_one_place_at_a_time
    EXCLUDE USING gist (
        user_id WITH =,
        organization_id WITH =,
        (COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
        (COALESCE(sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
        role_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&);

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
    v_held_start    DATE;
    v_held_end      DATE;
    k_no_id CONSTANT uuid := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
    -- Ending a contract can only relieve these rules. Anything else — a contract in
    -- force, an upcoming one, a past one being recorded or corrected — is checked
    -- against every other contract whose dates overlap it, not just the ones active today.
    IF TG_OP = 'UPDATE' AND NEW.status = 'Expired' AND OLD.status IS DISTINCT FROM 'Expired' THEN
        RETURN NEW;
    END IF;

    -- Serialise contract writes for this ONE employee. Replaces the
    -- concurrency guarantee of the dropped partial unique index.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));

    -- One role in one place at a time (user_contracts_one_role_one_place_at_a_time
    -- is the backstop; this says it in words).
    SELECT o.start_date, o.end_date INTO v_held_start, v_held_end
      FROM hr.user_contracts o
     WHERE o.user_id = NEW.user_id
       AND o.id <> COALESCE(NEW.id, k_no_id)
       AND o.organization_id = NEW.organization_id
       AND o.department_id IS NOT DISTINCT FROM NEW.department_id
       AND o.sub_department_id IS NOT DISTINCT FROM NEW.sub_department_id
       AND o.role_id = NEW.role_id
       AND daterange(o.start_date, o.end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]')
     ORDER BY o.start_date
     LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'They already hold this role here from % (%). One contract is one role in one place at a time: end that one first, or start this one after it.',
            to_char(v_held_start, 'FMDD Mon YYYY'),
            CASE WHEN v_held_end IS NULL THEN 'ongoing' ELSE 'to ' || to_char(v_held_end, 'FMDD Mon YYYY') END
            USING ERRCODE = '23505';
    END IF;

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
