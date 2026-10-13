-- Migration: 20260805090000_enforce_shift_employment_target_match.sql
-- Description: HARD server-side enforcement that an assigned employee's contract
--              matches the shift's employment target.
--
-- WHY THE DATABASE AND NOT JUST THE APP
-- -------------------------------------
-- Audit, 2026-08-05: of the 63 bid / swap / trade / assign RPCs in this database,
-- not ONE reads `target_employment_type` or `employment_status`. Bids and swaps
-- are employee-initiated and land through their own RPCs, so an app-layer rule
-- alone is advisory — it guards the manager's UI and nothing else. This trigger
-- is the backstop that every write path passes through, whatever called it:
-- sm_apply_shift_op (assign / select_winner / approve_trade), sm_bulk_assign,
-- sm_emergency_assign, the autoscheduler's writes, and any direct UPDATE.
--
-- The friendly, explanatory failure is the V8 rule (V8_EMPLOYMENT_TARGET) in the
-- app. This trigger is the guarantee, so its message is written to be readable if
-- a user ever does see it.
--
-- NOTE: this is the THIRD copy of the employment-type alias table
-- (model_builder.py `_EMPLOYMENT_TYPE_ALIASES`, employment.types.ts
-- `EMPLOYMENT_TYPE_ALIASES`, and here). They must stay in step; each exists
-- because its layer cannot reach the others.

CREATE OR REPLACE FUNCTION public.fn_normalize_employment_type(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
    -- Mirrors normalize_employment_type() in optimizer-service/model_builder.py.
    -- Unknown/empty -> 'Casual': casuals carry no FT/PT ordinary-hours contract
    -- floor, so it is the safest assumption when a status is unreadable.
    SELECT CASE lower(btrim(coalesce(p_value, '')))
        WHEN 'ft'                    THEN 'FT'
        WHEN 'full-time'             THEN 'FT'
        WHEN 'full_time'             THEN 'FT'
        WHEN 'fulltime'              THEN 'FT'
        WHEN 'full time'             THEN 'FT'
        WHEN 'full'                  THEN 'FT'
        WHEN 'pt'                    THEN 'PT'
        WHEN 'part-time'             THEN 'PT'
        WHEN 'part_time'             THEN 'PT'
        WHEN 'parttime'              THEN 'PT'
        WHEN 'part time'             THEN 'PT'
        WHEN 'part'                  THEN 'PT'
        WHEN 'flexible part-time'    THEN 'PT'
        WHEN 'flexible part_time'    THEN 'PT'
        WHEN 'flexible parttime'     THEN 'PT'
        WHEN 'flexible part time'    THEN 'PT'
        ELSE 'Casual'
    END;
$function$;

ALTER FUNCTION public.fn_normalize_employment_type(text) OWNER TO postgres;


CREATE OR REPLACE FUNCTION public.fn_enforce_shift_employment_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_status      text;
    v_normalized  text;
    v_is_flexible boolean;
BEGIN
    -- Nothing to check on an unassigned shift.
    IF NEW.assigned_employee_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Skip when neither the assignee nor the target moved: this trigger must not
    -- block unrelated edits (publishing, notes, break changes) on a shift whose
    -- assignment predates the rule.
    IF TG_OP = 'UPDATE'
       AND NEW.assigned_employee_id IS NOT DISTINCT FROM OLD.assigned_employee_id
       AND NEW.target_employment_type IS NOT DISTINCT FROM OLD.target_employment_type
       AND NEW.target_requires_flexible IS NOT DISTINCT FROM OLD.target_requires_flexible
    THEN
        RETURN NEW;
    END IF;

    -- Employment status is a property of the CONTRACT, not the person: the same
    -- profile can be Casual in one sub-department and Part-Time in another. Read
    -- the contract that applies to THIS shift's sub-department. A contract with a
    -- NULL sub_department_id is org/dept-wide and therefore in scope too — the
    -- same rule EligibilityService applies when building the assignment pool.
    SELECT uc.employment_status::text
      INTO v_status
      FROM hr.user_contracts uc
     WHERE uc.user_id = NEW.assigned_employee_id
       AND uc.status = 'Active'
       AND (NEW.sub_department_id IS NULL
            OR uc.sub_department_id = NEW.sub_department_id
            OR uc.sub_department_id IS NULL)
     -- Prefer the sub-department-specific contract over an org-wide one.
     ORDER BY (uc.sub_department_id = NEW.sub_department_id) DESC NULLS LAST
     LIMIT 1;

    IF v_status IS NULL THEN
        RAISE EXCEPTION
            'Cannot assign this employee: no active contract found for this '
            'sub-department, so their employment type cannot be confirmed against '
            'the shift target (%).', NEW.target_employment_type
            USING ERRCODE = '23514';
    END IF;

    v_normalized  := public.fn_normalize_employment_type(v_status);
    v_is_flexible := lower(btrim(v_status)) LIKE 'flexible%';

    IF v_normalized <> NEW.target_employment_type THEN
        RAISE EXCEPTION
            'Employment target mismatch: this shift is for % staff, but the '
            'selected employee is % on their contract for this sub-department.',
            NEW.target_employment_type, v_status
            USING ERRCODE = '23514';
    END IF;

    -- Second axis. 'Flexible Part-Time' normalizes to 'PT', so the token compare
    -- above passes for BOTH flexible and plain part-timers; only this separates
    -- them.
    IF NEW.target_requires_flexible AND NOT v_is_flexible THEN
        RAISE EXCEPTION
            'Employment target mismatch: this shift requires Flexible Part-Time '
            'staff, but the selected employee is % on their contract for this '
            'sub-department.', v_status
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_enforce_shift_employment_target() OWNER TO postgres;

-- BEFORE, so a violation aborts the write rather than being cleaned up after.
-- Fires on INSERT too: sm_create_shift supports assign-on-create.
--
-- The `_2_` prefix is load-bearing: Postgres fires BEFORE triggers in ALPHABETICAL
-- order, and this must run AFTER trg_shift_employment_target_1_resolve so that a
-- template-generated insert has had its target filled in before we compare
-- against it. Renaming either trigger without preserving that order silently
-- reintroduces a NULL comparison here.
DROP TRIGGER IF EXISTS trg_enforce_shift_employment_target ON public.shifts;
DROP TRIGGER IF EXISTS trg_shift_employment_target_2_enforce ON public.shifts;
CREATE TRIGGER trg_shift_employment_target_2_enforce
    BEFORE INSERT OR UPDATE OF assigned_employee_id, target_employment_type, target_requires_flexible
    ON public.shifts
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_enforce_shift_employment_target();
