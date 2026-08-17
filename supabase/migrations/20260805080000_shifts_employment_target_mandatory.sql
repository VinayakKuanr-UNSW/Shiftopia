-- Migration: 20260805080000_shifts_employment_target_mandatory.sql
-- Description: Makes `shifts.target_employment_type` MANDATORY. Every shift must
--              declare which employment type it is for; "Any" is no longer a
--              legal state.
--
-- THE PROBLEM THIS HAS TO SOLVE
-- ----------------------------
-- Eleven functions INSERT INTO shifts, and only `sm_create_shift` sets the target
-- (as of 20260805060000). A bare `SET NOT NULL` would immediately break template
-- application, sub-group cloning and roster publishing.
--
-- Of those eleven, only TWO are reachable from the app:
--     apply_template_to_date_range_v2   (useRosterMutations.ts:399)
--     clone_roster_subgroup_v2          (useRosterMutations.ts:600)
-- The other eight (apply_monthly_template x3, apply_template_to_date_range v1,
-- clone_roster_subgroup v1, publish_roster_shift, create_test_shift,
-- create_test_shift_v3) have ZERO call sites in the codebase.
--
-- So rather than rewrite all eleven, this migration:
--   1. teaches `clone_roster_subgroup_v2` to carry the source shift's target;
--   2. adds a BEFORE INSERT trigger that RESOLVES a missing target from the
--      originating template row — which covers apply_template_to_date_range_v2
--      without touching its 10KB body — and otherwise RAISES;
--   3. sets NOT NULL.
--
-- The trigger is deliberately a resolver-then-raise rather than a silent DEFAULT:
-- under the new HARD match the target decides who may be assigned, so guessing a
-- value would silently strand staff. An unhandled path fails loudly instead.

-- ── 1. Clone carries the source shift's target ───────────────────────────────
-- Body is prod's live definition with `target_employment_type` /
-- `target_requires_flexible` added to the INSERT column list and the SELECT.
-- Nothing else is changed.
CREATE OR REPLACE FUNCTION public.clone_roster_subgroup_v2(
    p_org_id uuid, p_dept_id uuid, p_group_external_id text,
    p_source_name text, p_new_name text, p_start_date date, p_end_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_current_date DATE;
    v_roster_id UUID;
    v_rg_id UUID;
    v_source_subgroup_id UUID;
    v_new_subgroup_id UUID;
BEGIN
    v_current_date := p_start_date;
    WHILE v_current_date <= p_end_date LOOP
        SELECT r.id INTO v_roster_id
        FROM rosters r
        WHERE r.start_date = v_current_date
          AND r.department_id = p_dept_id
          AND r.organization_id = p_org_id
        LIMIT 1;

        IF v_roster_id IS NOT NULL THEN
            SELECT rg.id INTO v_rg_id
            FROM roster_groups rg
            WHERE rg.roster_id = v_roster_id
              AND rg.external_id = p_group_external_id
            LIMIT 1;

            IF v_rg_id IS NOT NULL THEN
                SELECT rs.id INTO v_source_subgroup_id
                FROM roster_subgroups rs
                WHERE rs.roster_group_id = v_rg_id
                  AND rs.name = p_source_name
                LIMIT 1;

                IF v_source_subgroup_id IS NOT NULL THEN
                    SELECT rs.id INTO v_new_subgroup_id
                    FROM roster_subgroups rs
                    WHERE rs.roster_group_id = v_rg_id
                      AND rs.name = p_new_name
                    LIMIT 1;

                    IF v_new_subgroup_id IS NULL THEN
                        INSERT INTO public.roster_subgroups (roster_group_id, name, sort_order)
                        VALUES (v_rg_id, p_new_name, 999)
                        RETURNING id INTO v_new_subgroup_id;
                    END IF;

                    -- Clone Shifts + AUDIT: emit create events
                    WITH inserted AS (
                        INSERT INTO public.shifts (
                            roster_id,
                            roster_subgroup_id,
                            sub_group_name,
                            group_type,
                            shift_date,
                            start_time,
                            end_time,
                            role_id,
                            required_skills,
                            required_licenses,
                            event_tags,
                            notes,
                            lifecycle_status,
                            is_locked,
                            organization_id,
                            department_id,
                            sub_department_id,
                            timezone,
                            creation_source,
                            target_employment_type,
                            target_requires_flexible
                        )
                        SELECT
                            roster_id,
                            v_new_subgroup_id,
                            p_new_name,
                            group_type,
                            shift_date,
                            start_time,
                            end_time,
                            role_id,
                            required_skills,
                            required_licenses,
                            event_tags,
                            notes,
                            'Draft',
                            false,
                            organization_id,
                            department_id,
                            sub_department_id,
                            timezone,
                            'sub-group cloning',
                            target_employment_type,
                            target_requires_flexible
                        FROM public.shifts
                        WHERE roster_id = v_roster_id
                          AND sub_group_name = p_source_name
                        RETURNING id
                    )
                    INSERT INTO public.shift_events (
                        shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
                    )
                    SELECT
                        i.id,
                        NULL,
                        auth.uid(),
                        'OP_APPLIED'::public.shift_event_type,
                        jsonb_build_object(
                            'op', 'create',
                            'domain', 'lifecycle',
                            'from_state', NULL,
                            'to_state', 'S1',
                            'source', 'clone_roster_subgroup_v2',
                            'creation_source', 'sub-group cloning',
                            'cloned_from_subgroup', p_source_name
                        ),
                        CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'manager' END,
                        'lifecycle'
                    FROM inserted i;
                END IF;
            END IF;
        END IF;

        v_current_date := v_current_date + 1;
    END LOOP;
END;
$function$;

ALTER FUNCTION public.clone_roster_subgroup_v2(uuid, uuid, text, text, text, date, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.clone_roster_subgroup_v2(uuid, uuid, text, text, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clone_roster_subgroup_v2(uuid, uuid, text, text, text, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.clone_roster_subgroup_v2(uuid, uuid, text, text, text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clone_roster_subgroup_v2(uuid, uuid, text, text, text, date, date) TO service_role;

-- ── 2. Resolve a missing target from the originating template row ────────────
CREATE OR REPLACE FUNCTION public.fn_resolve_shift_employment_target()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF NEW.target_employment_type IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Template-generated shifts carry `template_instance_id` = the
    -- template_shifts row they came from. This is what lets
    -- apply_template_to_date_range_v2 keep working untouched.
    IF NEW.template_instance_id IS NOT NULL THEN
        SELECT ts.target_employment_type, ts.target_requires_flexible
          INTO NEW.target_employment_type, NEW.target_requires_flexible
          FROM public.template_shifts ts
         WHERE ts.id = NEW.template_instance_id;
    END IF;

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

ALTER FUNCTION public.fn_resolve_shift_employment_target() OWNER TO postgres;

-- NAME MATTERS. Postgres fires BEFORE triggers in ALPHABETICAL order, and the
-- enforcement trigger added by 20260805090000 must see the RESOLVED target, not
-- the NULL a template insert arrives with. The `_1_` / `_2_` prefixes pin that
-- order explicitly instead of relying on the names happening to sort correctly.
DROP TRIGGER IF EXISTS trg_resolve_shift_employment_target ON public.shifts;
DROP TRIGGER IF EXISTS trg_shift_employment_target_1_resolve ON public.shifts;
CREATE TRIGGER trg_shift_employment_target_1_resolve
    BEFORE INSERT ON public.shifts
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_resolve_shift_employment_target();

-- ── 3. Mandatory ────────────────────────────────────────────────────────────
-- No backfill clause: `shifts` is empty (verified 2026-08-05). If this migration
-- is ever replayed against a populated database, the UPDATE below gives the same
-- deliberate 'Casual' fallback documented in 20260805070000 rather than failing.
UPDATE public.shifts
   SET target_employment_type = 'Casual'
 WHERE target_employment_type IS NULL;

ALTER TABLE public.shifts
    ALTER COLUMN target_employment_type SET NOT NULL;

COMMENT ON COLUMN public.shifts.target_employment_type IS
    'MANDATORY. Which employment type this shift is for. Enforced as a HARD match '
    'at assignment time by trg_enforce_shift_employment_target, by the V8 rule '
    'V8_EMPLOYMENT_TARGET, and as a hard solver constraint (SC-1).';
