-- Migration: 20261004170000_ft_shifts_created_on_rosters.sql
-- Description: Full-time shifts can be created from the Rosters page. The
--              "baseline only" label check goes; the rule it stood in for —
--              one full-time shift per person per day (cl 39.1) — is enforced
--              in the database for the first time.
--
-- Handover 2026-10-04, Phase 3 / landmine 1.
--
-- WHAT THE OLD TRIGGER ACTUALLY CHECKED
-- -------------------------------------
-- enforce_ft_shifts_are_baseline_only refused any FT row whose creation_source
-- was not exactly 'baseline_ft', on the premise that "full-time hours are
-- reconciled against the employee's contracted cycle before any shift is
-- proposed, so they cannot be added one at a time". That premise ended when the
-- pattern table and Apply were removed (2026-09-30): the Office page now adds FT
-- shifts one at a time through the same Add Shift modal the Rosters page uses,
-- and passes creation_source='baseline_ft' only to satisfy this trigger. So the
-- trigger checked WHICH PAGE wrote the row — a label any caller can set — and
-- nothing about the shift. With full-time shifts moving to the Rosters page (D2)
-- it only blocks the intended path.
--
-- Cycle compliance is unchanged: the modal's V8 ordinary-hours rule runs for an
-- FT target on either page. Templates still cannot hold FT shifts
-- (trg_no_ft_template_shifts) — a template stamps one shape on everyone and
-- cannot reconcile a person's cycle, which remains true.
--
-- WHAT IS ENFORCED INSTEAD
-- ------------------------
-- The Office grid refused a second shift on a day an FT employee already works
-- (cl 39.1 — split shifts are for part-time and flexible part-time), with the
-- comment "the guard the database does not give us". Here it is in the
-- database, so it holds on every path: Rosters, Office, Copy, template apply,
-- a direct write.
--
-- Semantics are the Office grid's, exactly: an ASSIGNED full-time shift is
-- refused when that person already holds ANY other live shift that date. It is
-- judged only when the (employee, date, target) pairing is new — re-saving an
-- existing shift is never re-judged. A non-FT shift added to a day the person
-- already works full-time is not refused here (the Office grid did not refuse
-- it either; multi-contract staff are the only case).
--
-- Named trg_shift_ft_one_per_day so it fires AFTER
-- trg_shift_employment_target_1_resolve (BEFORE triggers fire in name order):
-- a template-applied row only learns it is FT from that resolver.

DROP TRIGGER IF EXISTS trg_ft_shifts_are_baseline_only ON public.shifts;
DROP FUNCTION IF EXISTS public.enforce_ft_shifts_are_baseline_only();

CREATE OR REPLACE FUNCTION public.fn_shift_ft_one_per_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_other_start time;
    v_other_end   time;
BEGIN
    IF NEW.target_employment_type IS DISTINCT FROM 'FT'
       OR NEW.assigned_employee_id IS NULL
       OR COALESCE(NEW.is_cancelled, false) THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.assigned_employee_id   IS NOT DISTINCT FROM NEW.assigned_employee_id
       AND OLD.shift_date             IS NOT DISTINCT FROM NEW.shift_date
       AND OLD.target_employment_type IS NOT DISTINCT FROM NEW.target_employment_type THEN
        RETURN NEW;
    END IF;

    -- Two concurrent writes for the same person and day must not both pass.
    PERFORM pg_advisory_xact_lock(
        hashtextextended('ft_one_per_day:' || NEW.assigned_employee_id::text || ':' || NEW.shift_date::text, 0));

    SELECT s.start_time, s.end_time
      INTO v_other_start, v_other_end
      FROM public.shifts s
     WHERE s.assigned_employee_id = NEW.assigned_employee_id
       AND s.shift_date = NEW.shift_date
       AND s.id <> NEW.id
       AND s.deleted_at IS NULL
       AND NOT COALESCE(s.is_cancelled, false)
     ORDER BY s.start_time
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Already rostered on %: % – %. A full-time employee works one shift a day; a split shift is not permitted (ICC EBA cl 39.1). Edit that shift instead.',
            to_char(NEW.shift_date, 'Dy DD Mon'),
            to_char(v_other_start, 'HH24:MI'),
            to_char(v_other_end, 'HH24:MI')
            USING ERRCODE = 'check_violation', HINT = 'FT_ONE_SHIFT_PER_DAY';
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_shift_ft_one_per_day ON public.shifts;
CREATE TRIGGER trg_shift_ft_one_per_day
    BEFORE INSERT OR UPDATE OF assigned_employee_id, shift_date, target_employment_type
    ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.fn_shift_ft_one_per_day();

-- An index for the lookup above (there is none on the pair today).
CREATE INDEX IF NOT EXISTS idx_shifts_employee_date
    ON public.shifts (assigned_employee_id, shift_date)
    WHERE assigned_employee_id IS NOT NULL;
