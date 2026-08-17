-- Migration: 20260806120100_shift_inherits_template_row.sql
-- Description: Makes a template-generated shift an EXACT copy of the template row
--              it came from, and makes `shifts.target_employment_type` mandatory.
--
-- WHAT WAS ACTUALLY BROKEN (measured against prod, 2026-08-06, by applying the
-- real "Setups Base" template to an empty date and diffing the result):
--
--   template_shifts.remuneration_level  2 / 5   ->  shifts.remuneration_level  NULL
--   template_shifts.sort_order          0..5    ->  shifts.display_order       0 (all)
--   template_shifts.target_*            (absent)->  shifts.target_*            NULL
--
-- `apply_template_to_date_range_v2` copies role_id, times, breaks, notes, skills,
-- licences and event tags correctly — but its INSERT column list simply omits
-- remuneration_level and display_order. The dropped level is why pricing fell
-- through to `extractLevel(role_name)` string-matching: "Team Member" matches no
-- Schedule 1 keyword, so every one of those shifts was priced at the default
-- (Level 1 casual) rate instead of its actual Level 2.
--
-- WHY A TRIGGER RATHER THAN REWRITING apply_template_to_date_range_v2
-- ------------------------------------------------------------------
-- Every template-generated shift already carries `template_instance_id` = the
-- template_shifts row it came from. A BEFORE INSERT trigger keyed on that column
-- fixes the copy for EVERY creation path at once (apply_template, sm_create_shift,
-- clone_roster_subgroup_v2, and any future one) instead of patching a 200-line
-- function per path and leaving the others silently divergent. It is also the
-- design the unapplied 20260805080000 already chose for the target field; this
-- widens it to the other two columns rather than adding a second mechanism.
--
-- Ordering: the `_1_` prefix pins this BEFORE the `_2_` enforcement trigger that
-- 20260805090000 adds (Postgres fires BEFORE triggers alphabetically), so that
-- trigger sees the RESOLVED target, not the NULL a template insert arrives with.

CREATE OR REPLACE FUNCTION public.fn_shift_inherit_template_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_ts public.template_shifts%ROWTYPE;
BEGIN
    IF NEW.template_instance_id IS NOT NULL THEN
        SELECT * INTO v_ts
          FROM public.template_shifts
         WHERE id = NEW.template_instance_id;

        IF FOUND THEN
            -- Employment target: the template row is authoritative. COALESCE so an
            -- explicit per-shift override (sm_create_shift passing its own target)
            -- still wins over the template's.
            NEW.target_employment_type   := COALESCE(NEW.target_employment_type,
                                                     v_ts.target_employment_type);
            NEW.target_requires_flexible := COALESCE(NEW.target_requires_flexible,
                                                     v_ts.target_requires_flexible,
                                                     false);

            -- Classification. This is the one that silently changed pay.
            NEW.remuneration_level := COALESCE(NEW.remuneration_level,
                                               v_ts.remuneration_level);

            -- Ordering within the cell. `display_order` DEFAULTs to 0, not NULL,
            -- so COALESCE cannot tell "not supplied" from a deliberate 0. For a
            -- template-generated row the template's sort_order IS the order, and
            -- no creation path sets display_order alongside template_instance_id,
            -- so taking it unconditionally is safe and restores the template's
            -- intended sequence.
            NEW.display_order := COALESCE(v_ts.sort_order, NEW.display_order, 0);
        END IF;
    END IF;

    -- No target by now means nobody ever decided one. Refuse the write rather
    -- than let the cost engine fall back to its 'Casual' assumption.
    IF NEW.target_employment_type IS NULL THEN
        RAISE EXCEPTION
            'target_employment_type is required (shift on %, sub-department %). '
            'Every shift must declare the employment type it is for; there is no '
            '"Any". Set it on the shift, or on the template row it derives from.',
            NEW.shift_date, NEW.sub_department_id
            USING ERRCODE = '23502';
    END IF;

    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_shift_inherit_template_row() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_resolve_shift_employment_target   ON public.shifts;
DROP TRIGGER IF EXISTS trg_shift_employment_target_1_resolve ON public.shifts;
DROP TRIGGER IF EXISTS trg_shift_inherit_template_row        ON public.shifts;
CREATE TRIGGER trg_shift_employment_target_1_resolve
    BEFORE INSERT ON public.shifts
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_shift_inherit_template_row();

COMMENT ON FUNCTION public.fn_shift_inherit_template_row() IS
    'BEFORE INSERT on shifts. For template-generated rows, inherits '
    'target_employment_type, target_requires_flexible, remuneration_level and '
    'display_order from the originating template_shifts row. Raises 23502 if the '
    'shift still has no employment target — pay must never be priced on a guess.';

-- ── Mandatory ───────────────────────────────────────────────────────────────
-- NO BACKFILL. The unapplied 20260805080000 carried
--     UPDATE shifts SET target_employment_type='Casual' WHERE ... IS NULL;
-- under the comment "shifts is empty (verified 2026-08-05)". That premise was
-- false by 2026-08-06 (156 rows, all NULL), so applying it would have silently
-- labelled every existing shift Casual — the exact assumption being removed.
-- Those 156 draft shifts were deleted and regenerated from the template instead.
-- This guard makes the failure mode loud if the situation ever recurs.
DO $$
DECLARE v_null_count bigint;
BEGIN
    SELECT count(*) INTO v_null_count
      FROM public.shifts
     WHERE target_employment_type IS NULL;

    IF v_null_count > 0 THEN
        RAISE EXCEPTION
            '% shift(s) have no target_employment_type. Decide a target for each '
            '(or delete and regenerate them from a template that has one) before '
            'running this migration. It will NOT backfill a default.', v_null_count;
    END IF;
END $$;

ALTER TABLE public.shifts
    ALTER COLUMN target_employment_type SET NOT NULL;

COMMENT ON COLUMN public.shifts.target_employment_type IS
    'MANDATORY. Which employment type this shift is for. Drives pricing when the '
    'shift is unassigned — the cost engine must never fall back to a guess.';
