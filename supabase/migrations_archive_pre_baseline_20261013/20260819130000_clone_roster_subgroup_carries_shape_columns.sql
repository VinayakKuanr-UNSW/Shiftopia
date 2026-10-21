-- Two server-side shift-writing paths, brought in line with the shape layer.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1 — clone_roster_subgroup_v2 was writing shifts it had stripped
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Production's live definition (read via pg_get_functiondef on 2026-08-19, NOT
-- from this repo — `20260805080000` is in the tree but absent from
-- supabase_migrations.schema_migrations, so the fix it carried never landed)
-- copies twenty columns from the source shift and drops four that decide
-- whether the copy is lawful:
--
--     unpaid_break_minutes    paid_break_minutes
--     is_training             target_employment_type / target_requires_flexible
--
-- All four default to 0 / false / NULL on `shifts`. The consequences compound:
--
--   1. `target_employment_type` is NOT NULL, and the clone sets no
--      `template_instance_id`, so `fn_shift_inherit_template_row` has nothing
--      to inherit from and RAISES 23502. **This function fails on every input
--      in production right now** — it is not merely a compliance gap.
--   2. Behind that, an eight-hour clone loses its thirty-minute meal break, so
--      the copy breaches cl 36.1 the instant it is written. Since 2026-08-18
--      `shifts_shape_meal_break` would reject it anyway, turning a silent
--      compliance defect into a visible abort of the whole date loop.
--   3. Losing `is_training` silently promotes a lawful two-hour training
--      engagement (cl 12.4(c)(b)/12.5(c)(b)) into a three-hour breach.
--
-- Note the direction of travel: every one of these was invisible while the
-- clone wrote whatever it liked, and became loud the moment the shape rules
-- were given somewhere to stand. That is the backstop working as intended.
--
-- The body below is production's live definition with the four columns added to
-- the INSERT list and the SELECT. Nothing else is changed.

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
                            -- ── the four the clone used to drop ──────────────
                            unpaid_break_minutes,
                            paid_break_minutes,
                            is_training,
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
                            unpaid_break_minutes,
                            paid_break_minutes,
                            is_training,
                            target_employment_type,
                            target_requires_flexible
                        FROM public.shifts
                        WHERE roster_id = v_roster_id
                          AND sub_group_name = p_source_name
                          -- A soft-deleted source is not part of the subgroup.
                          -- It was never excluded before, so a deleted shift
                          -- came back to life as a live clone.
                          AND deleted_at IS NULL
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

-- NO DAY-TYPED SKIP HERE, unlike the template apply below, and the asymmetry is
-- deliberate. A clone keeps `shift_date` — it duplicates a subgroup WITHIN each
-- day, it does not move work onto a new one — so it cannot turn a lawful shift
-- into an unlawful one the way stamping a template onto a calendar can. Once
-- the four columns above travel with the copy, a lawful source yields a lawful
-- clone by construction. If a source row is itself unlawful the trigger aborts
-- the clone, which is the correct outcome: there is no lawful way to duplicate
-- an unlawful shift, and silently skipping it would hide the original.

ALTER FUNCTION public.clone_roster_subgroup_v2(uuid, uuid, text, text, text, date, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.clone_roster_subgroup_v2(uuid, uuid, text, text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clone_roster_subgroup_v2(uuid, uuid, text, text, text, date, date) TO authenticated, service_role;
