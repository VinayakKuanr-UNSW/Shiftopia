-- Templates → rosters: a sub-group is identified by its NAME inside its group.
--
-- A template sub-group reaches a roster only by name: apply_template_to_date_range_v2
-- reuses the roster sub-group with the same name in the same group, or creates one.
-- Every operation on roster sub-groups (rename, clone, delete) also addressed them
-- by name. This migration makes the name a real key and makes every operation
-- respect the group and sub-department it was asked about (audit 2026-10-17).
--
--  1. The name is a key: trimmed, and unique case-insensitively within its group, on
--     rosters and on templates. Apply and add-range now match case-insensitively,
--     like fn_shift_placement and sm_create_shift already did.
--  2. Office has exactly one sub-group, Administration, on rosters AND templates.
--     New templates are seeded with it, existing ones are backfilled, and triggers
--     refuse any other name and any direct delete.
--  3. delete / rename / clone of a roster sub-group:
--       - scoped to the sub-department (was: any roster of the department on that day)
--       - scoped to the group (was: any shift on the roster with that sub-group name,
--         so deleting "AM Base" in Theatre also deleted Convention's "AM Base")
--       - leave days before today alone (was: one started shift aborted the whole
--         range, future days included)
--       - delete only what the shift-delete rules allow (_shift_delete_refusal, the
--         predicate sm_delete_shift uses), and need shift.delete as well as roster.edit
--       - clone needs roster.edit + shift.create (it had NO caller check at all)
--       - p_dry_run returns the same counts without changing anything, so the
--         confirmation dialog shows exactly what the action will do.
--  4. Templates stack (a second template adds on top). preview_template_application
--     reports what is already on those days and what the apply would add, for the
--     confirmation. undo_template_batch removes only shifts that have not started,
--     reports what it kept, takes the sub-groups it emptied with it, and has a dry run.
--  5. capture_roster_as_template could not have worked since 2026-08-06: its insert
--     omitted template_shifts.target_employment_type (NOT NULL, no default). It also
--     made a second "convention_centre" group beside the seeded "Convention Centre",
--     and one template sub-group per roster DAY (keyed on roster_subgroups.id), so a
--     week's capture held seven "AM Base"s. It now reuses the seeded groups, makes
--     one sub-group per name, and leaves out full-time shifts (templates cannot hold
--     them: enforce_no_ft_template_shifts).
--  6. Client EXECUTE revoked from unguarded writers nothing calls:
--     clone_roster_subgroup(uuid, text) and the three apply_monthly_template overloads.
--
-- Function bodies are edited from pg_get_functiondef on 2026-10-17, so the injected
-- "-- authz guard (20261005 rpc guards)" lines survive.

-- ── 0. Preconditions ───────────────────────────────────────────────────────────

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.roster_subgroups rs
        JOIN public.roster_groups rg ON rg.id = rs.roster_group_id
        WHERE rg.external_id = 'office' AND lower(btrim(rs.name)) <> 'administration'
    ) THEN
        RAISE EXCEPTION 'A roster Office group has a sub-group other than Administration; move its shifts first';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.template_subgroups ts
        JOIN public.template_groups tg ON tg.id = ts.group_id
        WHERE lower(replace(btrim(tg.name), ' ', '_')) = 'office'
          AND lower(btrim(ts.name)) <> 'administration'
    ) THEN
        RAISE EXCEPTION 'A template Office group has a sub-group other than Administration; move its shifts first';
    END IF;
END $$;

-- ── 1. The name is a key ───────────────────────────────────────────────────────

UPDATE public.roster_subgroups   SET name = btrim(name) WHERE name <> btrim(name);
UPDATE public.template_subgroups SET name = btrim(name) WHERE name <> btrim(name);

CREATE UNIQUE INDEX roster_subgroups_group_name_ci_key
    ON public.roster_subgroups (roster_group_id, lower(name));
CREATE UNIQUE INDEX template_subgroups_group_name_ci_key
    ON public.template_subgroups (group_id, lower(name));

-- ── 2. Office has one sub-group, Administration ────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_roster_subgroup_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_group text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- When a roster is deleted its groups go first (cascade), so the group is
        -- no longer found here. Only a direct delete of Administration finds it.
        SELECT external_id INTO v_group FROM public.roster_groups WHERE id = OLD.roster_group_id;
        IF v_group = 'office' THEN
            RAISE EXCEPTION 'Office''s Administration sub-group is fixed and cannot be deleted.'
                USING ERRCODE = 'check_violation', HINT = 'OFFICE_SUBGROUP_FIXED';
        END IF;
        RETURN OLD;
    END IF;

    NEW.name := btrim(NEW.name);
    IF NEW.name = '' THEN
        RAISE EXCEPTION 'A sub-group needs a name.'
            USING ERRCODE = 'check_violation', HINT = 'SUBGROUP_NAME_REQUIRED';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.roster_group_id IS DISTINCT FROM NEW.roster_group_id THEN
        SELECT external_id INTO v_group FROM public.roster_groups WHERE id = OLD.roster_group_id;
        IF v_group = 'office' THEN
            RAISE EXCEPTION 'Office''s Administration sub-group cannot be moved to another group.'
                USING ERRCODE = 'check_violation', HINT = 'OFFICE_SUBGROUP_FIXED';
        END IF;
    END IF;

    SELECT external_id INTO v_group FROM public.roster_groups WHERE id = NEW.roster_group_id;
    IF v_group = 'office' THEN
        IF lower(NEW.name) <> 'administration' THEN
            RAISE EXCEPTION 'Office has one sub-group, Administration, so "%" cannot be added to it.', NEW.name
                USING ERRCODE = 'check_violation', HINT = 'OFFICE_SUBGROUP_FIXED';
        END IF;
        NEW.name := 'Administration';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_roster_subgroup_rules() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_roster_subgroup_rules
    BEFORE INSERT OR UPDATE OR DELETE ON public.roster_subgroups
    FOR EACH ROW EXECUTE FUNCTION public.fn_roster_subgroup_rules();

CREATE OR REPLACE FUNCTION public.fn_template_subgroup_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_office boolean;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT lower(replace(btrim(name), ' ', '_')) = 'office' INTO v_office
          FROM public.template_groups WHERE id = OLD.group_id;
        IF v_office THEN
            -- save_template_full deletes every sub-group the editor did not send
            -- back, so an editor opened before Administration existed would
            -- remove it on save. Keep it and let the save succeed. Deleting a
            -- template removes its groups first, so this never blocks that.
            RETURN NULL;
        END IF;
        RETURN OLD;
    END IF;

    NEW.name := btrim(NEW.name);
    IF NEW.name = '' THEN
        RAISE EXCEPTION 'A sub-group needs a name.'
            USING ERRCODE = 'check_violation', HINT = 'SUBGROUP_NAME_REQUIRED';
    END IF;

    SELECT lower(replace(btrim(name), ' ', '_')) = 'office' INTO v_office
      FROM public.template_groups WHERE id = NEW.group_id;
    IF v_office THEN
        IF lower(NEW.name) <> 'administration' THEN
            RAISE EXCEPTION 'Office has one sub-group, Administration, so "%" cannot be added to it.', NEW.name
                USING ERRCODE = 'check_violation', HINT = 'OFFICE_SUBGROUP_FIXED';
        END IF;
        NEW.name := 'Administration';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_template_subgroup_rules() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_template_subgroup_rules
    BEFORE INSERT OR UPDATE OR DELETE ON public.template_subgroups
    FOR EACH ROW EXECUTE FUNCTION public.fn_template_subgroup_rules();

-- New templates get Office's sub-group, as new rosters do (seed_standard_roster_groups).
CREATE OR REPLACE FUNCTION public.fn_seed_fixed_template_groups()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
BEGIN
    INSERT INTO public.template_groups (template_id, name, color, icon, sort_order)
    VALUES
        (NEW.id, 'Convention Centre', '#3b82f6', 'building',     1),
        (NEW.id, 'Exhibition Centre', '#22c55e', 'layout-grid',  2),
        (NEW.id, 'Theatre',           '#ef4444', 'theater',      3),
        (NEW.id, 'The Cutaway',       '#f59e0b', 'film',         4),
        (NEW.id, 'Office',            '#06b6d4', 'briefcase',    5);

    -- Office has one fixed sub-group, as on the roster.
    INSERT INTO public.template_subgroups (group_id, name, sort_order)
    SELECT id, 'Administration', 0
      FROM public.template_groups
     WHERE template_id = NEW.id AND name = 'Office';

    RETURN NEW;
END;
$function$;

INSERT INTO public.template_subgroups (group_id, name, sort_order)
SELECT tg.id, 'Administration', 0
  FROM public.template_groups tg
 WHERE lower(replace(btrim(tg.name), ' ', '_')) = 'office'
   AND NOT EXISTS (SELECT 1 FROM public.template_subgroups ts WHERE ts.group_id = tg.id);

INSERT INTO public.roster_subgroups (roster_group_id, name, sort_order)
SELECT rg.id, 'Administration', 0
  FROM public.roster_groups rg
 WHERE rg.external_id = 'office'
   AND NOT EXISTS (SELECT 1 FROM public.roster_subgroups rs WHERE rs.roster_group_id = rg.id);

-- ── 3a. Apply: match sub-groups case-insensitively; find the roster null-safely ─

CREATE OR REPLACE FUNCTION public.apply_template_to_date_range_v2(p_template_id uuid, p_start_date date, p_end_date date, p_user_id uuid, p_source text DEFAULT 'roster_modal'::text, p_target_department_id uuid DEFAULT NULL::uuid, p_target_sub_department_id uuid DEFAULT NULL::uuid, p_force_stack boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- p_force_stack does not control stacking: templates always add on top of what is
-- there. It only lets shifts that have already started be created (default false).
-- The name is kept because renaming a parameter means dropping the function.
DECLARE
    v_template record;
    v_curr_date date;
    v_roster_id uuid;
    v_batch_id uuid;
    v_total_shifts integer := 0;
    v_shifts_skipped integer := 0;
    v_tg record;
    v_tsg record;
    v_ts record;
    v_rg_id uuid;
    v_rsg_id uuid;
    v_external_id text;
    v_shift_start_timestamp timestamptz;
    v_shift_end_timestamp timestamptz;
    v_dept_id uuid;
    v_sub_dept_id uuid;
    v_dow integer;
    v_new_shift_id uuid;
    v_breach text;
    v_shifts_skipped_unlawful integer := 0;
    v_unlawful jsonb := '[]'::jsonb;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_template_apply(p_template_id, p_target_department_id, p_target_sub_department_id);
    SELECT * INTO v_template FROM roster_templates WHERE id = p_template_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;

    v_dept_id := COALESCE(p_target_department_id, v_template.department_id);
    v_sub_dept_id := COALESCE(p_target_sub_department_id, v_template.sub_department_id);

    INSERT INTO roster_template_batches (
        template_id, applied_at, applied_by, start_date, end_date, source
    )
    VALUES (
        p_template_id, now(), p_user_id, p_start_date, p_end_date, p_source
    )
    RETURNING id INTO v_batch_id;

    PERFORM set_config('app.audit.via_gateway', '1', true);

    FOR v_curr_date IN (SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date) LOOP

        v_dow := (EXTRACT(DOW FROM v_curr_date))::integer;

        SELECT id INTO v_roster_id
        FROM rosters
        WHERE start_date = v_curr_date
          AND department_id = v_dept_id
          AND sub_department_id IS NOT DISTINCT FROM v_sub_dept_id
        LIMIT 1;

        IF v_roster_id IS NULL THEN
            INSERT INTO rosters (
                start_date, end_date, template_id, organization_id,
                department_id, sub_department_id,
                description, status, is_locked, created_by
            )
            VALUES (
                v_curr_date, v_curr_date, p_template_id, v_template.organization_id,
                v_dept_id, v_sub_dept_id,
                v_template.description, 'draft', false, p_user_id
            )
            RETURNING id INTO v_roster_id;
        END IF;

        FOR v_tg IN (SELECT * FROM template_groups WHERE template_id = p_template_id) LOOP
            v_external_id := CASE LOWER(REPLACE(v_tg.name, ' ', '_'))
                WHEN 'convention_centre' THEN 'convention_centre'
                WHEN 'exhibition_centre' THEN 'exhibition_centre'
                WHEN 'theatre' THEN 'theatre'
                WHEN 'the_cutaway' THEN 'the_cutaway'
                WHEN 'office' THEN 'office'
                ELSE NULL
            END;

            IF v_external_id IS NULL THEN
                RAISE EXCEPTION 'apply_template: unknown template group "%" — cannot map to a roster group type', v_tg.name;
            END IF;

            SELECT id INTO v_rg_id FROM roster_groups WHERE roster_id = v_roster_id AND (external_id = v_external_id OR name = v_tg.name) LIMIT 1;

            IF v_rg_id IS NULL THEN
                INSERT INTO roster_groups (roster_id, name, external_id, sort_order)
                VALUES (v_roster_id, v_tg.name, v_external_id, v_tg.sort_order)
                RETURNING id INTO v_rg_id;
            END IF;

            FOR v_tsg IN (SELECT * FROM template_subgroups WHERE group_id = v_tg.id) LOOP
                -- Same name in the same group = the same sub-group, whatever the case.
                SELECT id INTO v_rsg_id
                FROM roster_subgroups
                WHERE roster_group_id = v_rg_id AND lower(name) = lower(btrim(v_tsg.name));

                IF v_rsg_id IS NULL THEN
                    INSERT INTO roster_subgroups (roster_group_id, name, sort_order)
                    VALUES (v_rg_id, v_tsg.name, v_tsg.sort_order)
                    RETURNING id INTO v_rsg_id;
                END IF;

                FOR v_ts IN (SELECT * FROM template_shifts WHERE subgroup_id = v_tsg.id) LOOP
                    IF v_ts.day_of_week IS NULL OR v_ts.day_of_week = v_dow THEN

                        IF NOT EXISTS (
                            SELECT 1 FROM shifts
                            WHERE roster_id = v_roster_id
                              AND template_instance_id = v_ts.id
                              AND deleted_at IS NULL
                        ) THEN
                            v_shift_start_timestamp := (v_curr_date || ' ' || v_ts.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                            v_shift_end_timestamp := (v_curr_date || ' ' || v_ts.end_time)::timestamp AT TIME ZONE 'Australia/Sydney';

                            IF v_ts.end_time < v_ts.start_time THEN
                                v_shift_end_timestamp := v_shift_end_timestamp + interval '1 day';
                            END IF;

                            IF NOT p_force_stack AND v_shift_start_timestamp <= now() THEN
                                v_shifts_skipped := v_shifts_skipped + 1;
                                CONTINUE;
                            END IF;

                            -- DAY-TYPED COMPLIANCE: soft-skip an instance this
                            -- template cannot lawfully produce on THIS date.
                            -- Same predicate trg_shift_shape_3_day_typed
                            -- enforces, so skip and enforce cannot drift.
                            v_breach := public.shift_day_typed_shortfall(
                                v_curr_date,
                                v_ts.start_time,
                                v_ts.end_time,
                                COALESCE(v_ts.unpaid_break_minutes, 0),
                                v_ts.target_employment_type,
                                v_ts.target_requires_flexible,
                                false,
                                v_ts.role_id
                            );
                            IF v_breach IS NOT NULL THEN
                                v_shifts_skipped_unlawful := v_shifts_skipped_unlawful + 1;
                                v_unlawful := v_unlawful || jsonb_build_object(
                                    'date',              v_curr_date,
                                    'template_shift_id', v_ts.id,
                                    'group',             v_tg.name,
                                    'sub_group',         v_tsg.name,
                                    'role_id',           v_ts.role_id,
                                    'start_time',        v_ts.start_time,
                                    'end_time',          v_ts.end_time,
                                    'breach',            v_breach
                                );
                                CONTINUE;
                            END IF;

                            INSERT INTO shifts (
                                roster_id, organization_id, department_id, sub_department_id,
                                role_id, shift_date, start_time, end_time,
                                start_at, end_at, tz_identifier,
                                paid_break_minutes, unpaid_break_minutes,
                                template_id, template_instance_id, is_from_template,
                                template_batch_id,
                                roster_subgroup_id,
                                group_type,
                                sub_group_name,
                                template_group,
                                template_sub_group,
                                lifecycle_status, notes, assigned_employee_id,
                                created_by_user_id,
                                required_skills,
                                required_licenses,
                                event_tags,
                                event_ids
                            )
                            VALUES (
                                v_roster_id, v_template.organization_id, v_dept_id, v_sub_dept_id,
                                v_ts.role_id, v_curr_date, v_ts.start_time, v_ts.end_time,
                                v_shift_start_timestamp, v_shift_end_timestamp, 'Australia/Sydney',
                                COALESCE(v_ts.paid_break_minutes, 0), COALESCE(v_ts.unpaid_break_minutes, 0),
                                p_template_id, v_ts.id, true,
                                v_batch_id,
                                v_rsg_id,
                                v_external_id::template_group_type,
                                v_tsg.name,
                                v_external_id::template_group_type,
                                v_tsg.name,
                                'Draft', v_ts.notes, v_ts.assigned_employee_id,
                                p_user_id,
                                to_jsonb(v_ts.required_skills),
                                to_jsonb(v_ts.required_licenses),
                                to_jsonb(v_ts.event_tags),
                                '[]'::jsonb
                            )
                            RETURNING id INTO v_new_shift_id;

                            INSERT INTO public.shift_events (
                                shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
                            ) VALUES (
                                v_new_shift_id,
                                v_ts.assigned_employee_id,
                                p_user_id,
                                'OP_APPLIED'::public.shift_event_type,
                                jsonb_build_object(
                                    'op', 'create',
                                    'domain', 'lifecycle',
                                    'from_state', NULL,
                                    'to_state', CASE WHEN v_ts.assigned_employee_id IS NOT NULL THEN 'S2' ELSE 'S1' END,
                                    'source', 'apply_template_to_date_range_v2',
                                    'creation_source', 'template',
                                    'assigned_employee_id', v_ts.assigned_employee_id
                                ),
                                CASE WHEN p_user_id IS NULL THEN 'system' ELSE 'manager' END,
                                'lifecycle'
                            );

                            v_total_shifts := v_total_shifts + 1;
                        END IF;
                    END IF;
                END LOOP;
            END LOOP;
        END LOOP;
    END LOOP;

    PERFORM set_config('app.audit.via_gateway', '0', true);

    UPDATE roster_templates
    SET
        status = 'published',
        updated_at = NOW(),
        last_used_at = NOW(),
        is_active = true
    WHERE id = p_template_id;

    RETURN jsonb_build_object(
        'success', true,
        'shifts_created', v_total_shifts,
        'shifts_skipped', v_shifts_skipped,
        'shifts_skipped_unlawful', v_shifts_skipped_unlawful,
        'unlawful_instances', v_unlawful,
        'batch_id', v_batch_id,
        'roster_id', v_roster_id
    );
END;
$function$;

-- ── 3b. Add a sub-group across a range: same-name check is case-insensitive ────

CREATE OR REPLACE FUNCTION public.add_roster_subgroup_range(p_org_id uuid, p_dept_id uuid, p_sub_dept_id uuid, p_group_external_id text, p_name text, p_start_date date, p_end_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_current_date DATE;
    v_roster_id UUID;
    v_roster_group_id UUID;
    v_group_name TEXT;
    v_sort_order INT;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_scope('roster.edit', p_org_id, p_dept_id, p_sub_dept_id);
    -- Determine group name and sort order based on external_id
    CASE p_group_external_id
        WHEN 'convention_centre' THEN
            v_group_name := 'Convention Centre';
            v_sort_order := 0;
        WHEN 'exhibition_centre' THEN
            v_group_name := 'Exhibition Centre';
            v_sort_order := 1;
        WHEN 'theatre' THEN
            v_group_name := 'Theatre';
            v_sort_order := 2;
        WHEN 'the_cutaway' THEN
            v_group_name := 'The Cutaway';
            v_sort_order := 3;
        WHEN 'office' THEN
            v_group_name := 'Office';
            v_sort_order := 4;
        ELSE
            RAISE EXCEPTION 'Invalid group external_id: %', p_group_external_id;
    END CASE;

    -- Iterate through dates
    v_current_date := p_start_date;
    WHILE v_current_date <= p_end_date LOOP
        
        -- STRICT LOCK: Skip past dates
        IF v_current_date < CURRENT_DATE THEN
            v_current_date := v_current_date + 1;
            CONTINUE;
        END IF;

        -- 1. Ensure Roster Exists (Idempotent & Scoped)
        IF p_sub_dept_id IS NULL THEN
            SELECT id INTO v_roster_id FROM public.rosters 
            WHERE organization_id = p_org_id 
              AND department_id = p_dept_id
              AND sub_department_id IS NULL
              AND start_date = v_current_date
            LIMIT 1;
        ELSE
            SELECT id INTO v_roster_id FROM public.rosters 
            WHERE organization_id = p_org_id 
              AND department_id = p_dept_id
              AND sub_department_id = p_sub_dept_id
              AND start_date = v_current_date
            LIMIT 1;
        END IF;

        IF v_roster_id IS NULL THEN
            INSERT INTO public.rosters (
                organization_id,
                department_id,
                sub_department_id,
                start_date,
                end_date,
                status,
                is_locked
            ) VALUES (
                p_org_id,
                p_dept_id,
                p_sub_dept_id,
                v_current_date,
                v_current_date,
                'draft',
                false
            )
            RETURNING id INTO v_roster_id;
        END IF;

        -- 2. Ensure Group Exists (Idempotent)
        SELECT id INTO v_roster_group_id 
        FROM public.roster_groups
        WHERE roster_id = v_roster_id AND (external_id = p_group_external_id OR name = v_group_name);

        IF v_roster_group_id IS NULL THEN
            INSERT INTO public.roster_groups (
                roster_id,
                name,
                external_id,
                sort_order
            ) VALUES (
                v_roster_id,
                v_group_name,
                p_group_external_id,
                v_sort_order
            )
            RETURNING id INTO v_roster_group_id;
        END IF;

        -- 3. Ensure Subgroup Exists (Idempotent; the name is case-insensitive)
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_subgroups 
            WHERE roster_group_id = v_roster_group_id AND lower(name) = lower(btrim(p_name))
        ) THEN
            INSERT INTO public.roster_subgroups (
                roster_group_id,
                name,
                sort_order
            ) VALUES (
                v_roster_group_id,
                p_name,
                999 -- Default sort order for ad-hoc subgroups
            );
        END IF;

        v_current_date := v_current_date + 1;
    END LOOP;
END;
$function$;

-- ── 3c. Delete a roster sub-group ──────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.delete_roster_subgroup_v2(uuid, uuid, text, text, date, date);

CREATE FUNCTION public.delete_roster_subgroup_v2(
    p_org_id uuid,
    p_dept_id uuid,
    p_sub_dept_id uuid,
    p_group_external_id text,
    p_name text,
    p_start_date date,
    p_end_date date,
    p_dry_run boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_today          date := (now() AT TIME ZONE 'Australia/Sydney')::date;
    v_from           date;
    v_day            record;
    v_n_delete       integer;
    v_n_assigned     integer;
    v_n_published    integer;
    v_n_keep         integer;
    v_days           integer := 0;
    v_days_kept      integer := 0;
    v_shifts_deleted integer := 0;
    v_assigned       integer := 0;
    v_published      integer := 0;
    v_shifts_kept    integer := 0;
    v_past_days      integer := 0;
    v_past_shifts    integer := 0;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_scope('roster.edit', p_org_id, p_dept_id, p_sub_dept_id);
  PERFORM public.sm_require_scope('shift.delete', p_org_id, p_dept_id, p_sub_dept_id);

    IF p_sub_dept_id IS NULL THEN
        RAISE EXCEPTION 'Choose one sub-department: a sub-group belongs to one team''s roster.'
            USING ERRCODE = 'invalid_parameter_value', HINT = 'SUB_DEPARTMENT_REQUIRED';
    END IF;
    IF p_group_external_id = 'office' THEN
        RAISE EXCEPTION 'Office has one fixed sub-group, Administration, and it cannot be deleted.'
            USING ERRCODE = 'check_violation', HINT = 'OFFICE_SUBGROUP_FIXED';
    END IF;
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
        RAISE EXCEPTION 'The date range is empty.' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Days before today are history: their shifts and their sub-group stay.
    v_from := GREATEST(p_start_date, v_today);

    SELECT count(DISTINCT rs.id), count(s.id)
      INTO v_past_days, v_past_shifts
      FROM public.rosters r
      JOIN public.roster_groups rg     ON rg.roster_id = r.id AND rg.external_id = p_group_external_id
      JOIN public.roster_subgroups rs  ON rs.roster_group_id = rg.id AND lower(rs.name) = lower(btrim(p_name))
      LEFT JOIN public.shifts s        ON s.roster_subgroup_id = rs.id
     WHERE r.organization_id = p_org_id
       AND r.department_id = p_dept_id
       AND r.sub_department_id = p_sub_dept_id
       AND r.start_date >= p_start_date
       AND r.start_date < v_from;

    FOR v_day IN
        SELECT rs.id AS subgroup_id
          FROM public.rosters r
          JOIN public.roster_groups rg    ON rg.roster_id = r.id AND rg.external_id = p_group_external_id
          JOIN public.roster_subgroups rs ON rs.roster_group_id = rg.id AND lower(rs.name) = lower(btrim(p_name))
         WHERE r.organization_id = p_org_id
           AND r.department_id = p_dept_id
           AND r.sub_department_id = p_sub_dept_id
           AND r.start_date BETWEEN v_from AND p_end_date
         ORDER BY r.start_date
    LOOP
        -- _shift_delete_refusal is sm_delete_shift's rule: worked or started shifts stay.
        SELECT count(*) FILTER (WHERE public._shift_delete_refusal(s) IS NULL),
               count(*) FILTER (WHERE public._shift_delete_refusal(s) IS NULL AND s.assigned_employee_id IS NOT NULL),
               count(*) FILTER (WHERE public._shift_delete_refusal(s) IS NULL AND s.is_published),
               count(*) FILTER (WHERE public._shift_delete_refusal(s) IS NOT NULL)
          INTO v_n_delete, v_n_assigned, v_n_published, v_n_keep
          FROM public.shifts s
         WHERE s.roster_subgroup_id = v_day.subgroup_id;

        v_days           := v_days + 1;
        v_shifts_deleted := v_shifts_deleted + v_n_delete;
        v_assigned       := v_assigned + v_n_assigned;
        v_published      := v_published + v_n_published;
        v_shifts_kept    := v_shifts_kept + v_n_keep;
        IF v_n_keep > 0 THEN
            v_days_kept := v_days_kept + 1;
        END IF;

        IF NOT p_dry_run THEN
            DELETE FROM public.shifts s
             WHERE s.roster_subgroup_id = v_day.subgroup_id
               AND public._shift_delete_refusal(s) IS NULL;

            -- A day that keeps a started shift keeps its sub-group.
            DELETE FROM public.roster_subgroups rs
             WHERE rs.id = v_day.subgroup_id
               AND NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.roster_subgroup_id = rs.id);
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success',        true,
        'dry_run',        p_dry_run,
        'from_date',      v_from,
        'to_date',        p_end_date,
        'days',           v_days,
        'shifts_deleted', v_shifts_deleted,
        'assigned',       v_assigned,
        'published',      v_published,
        'shifts_kept',    v_shifts_kept,
        'days_kept',      v_days_kept,
        'past_days',      v_past_days,
        'past_shifts',    v_past_shifts
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_roster_subgroup_v2(uuid, uuid, uuid, text, text, date, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_roster_subgroup_v2(uuid, uuid, uuid, text, text, date, date, boolean) TO authenticated, service_role;

-- ── 3d. Rename a roster sub-group ──────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.rename_roster_subgroup_v2(uuid, uuid, text, text, text, date, date);

CREATE FUNCTION public.rename_roster_subgroup_v2(
    p_org_id uuid,
    p_dept_id uuid,
    p_sub_dept_id uuid,
    p_group_external_id text,
    p_old_name text,
    p_new_name text,
    p_start_date date,
    p_end_date date,
    p_dry_run boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_today     date := (now() AT TIME ZONE 'Australia/Sydney')::date;
    v_from      date;
    v_new       text := btrim(p_new_name);
    v_ids       uuid[];
    v_conflicts date[];
    v_shifts    integer;
    v_past_days integer;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_scope('roster.edit', p_org_id, p_dept_id, p_sub_dept_id);

    IF p_sub_dept_id IS NULL THEN
        RAISE EXCEPTION 'Choose one sub-department: a sub-group belongs to one team''s roster.'
            USING ERRCODE = 'invalid_parameter_value', HINT = 'SUB_DEPARTMENT_REQUIRED';
    END IF;
    IF p_group_external_id = 'office' THEN
        RAISE EXCEPTION 'Office has one fixed sub-group, Administration, and it cannot be renamed.'
            USING ERRCODE = 'check_violation', HINT = 'OFFICE_SUBGROUP_FIXED';
    END IF;
    IF v_new IS NULL OR v_new = '' THEN
        RAISE EXCEPTION 'A sub-group needs a name.'
            USING ERRCODE = 'invalid_parameter_value', HINT = 'SUBGROUP_NAME_REQUIRED';
    END IF;
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
        RAISE EXCEPTION 'The date range is empty.' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Days before today keep the name they were worked under.
    v_from := GREATEST(p_start_date, v_today);

    SELECT array_agg(rs.id ORDER BY r.start_date)
      INTO v_ids
      FROM public.rosters r
      JOIN public.roster_groups rg    ON rg.roster_id = r.id AND rg.external_id = p_group_external_id
      JOIN public.roster_subgroups rs ON rs.roster_group_id = rg.id AND lower(rs.name) = lower(btrim(p_old_name))
     WHERE r.organization_id = p_org_id
       AND r.department_id = p_dept_id
       AND r.sub_department_id = p_sub_dept_id
       AND r.start_date BETWEEN v_from AND p_end_date;
    v_ids := COALESCE(v_ids, '{}');

    -- Days where another sub-group in the same group already has the new name.
    -- (A change of case only is not a clash with itself.)
    SELECT array_agg(DISTINCT r.start_date ORDER BY r.start_date)
      INTO v_conflicts
      FROM public.roster_subgroups mine
      JOIN public.roster_subgroups other ON other.roster_group_id = mine.roster_group_id
                                        AND other.id <> mine.id
                                        AND lower(other.name) = lower(v_new)
      JOIN public.roster_groups rg ON rg.id = mine.roster_group_id
      JOIN public.rosters r        ON r.id = rg.roster_id
     WHERE mine.id = ANY (v_ids);
    v_conflicts := COALESCE(v_conflicts, '{}');

    SELECT count(*) INTO v_shifts FROM public.shifts WHERE roster_subgroup_id = ANY (v_ids);

    SELECT count(DISTINCT rs.id)
      INTO v_past_days
      FROM public.rosters r
      JOIN public.roster_groups rg    ON rg.roster_id = r.id AND rg.external_id = p_group_external_id
      JOIN public.roster_subgroups rs ON rs.roster_group_id = rg.id AND lower(rs.name) = lower(btrim(p_old_name))
     WHERE r.organization_id = p_org_id
       AND r.department_id = p_dept_id
       AND r.sub_department_id = p_sub_dept_id
       AND r.start_date >= p_start_date
       AND r.start_date < v_from;

    IF NOT p_dry_run THEN
        IF cardinality(v_conflicts) > 0 THEN
            RAISE EXCEPTION 'This group already has a sub-group called "%" on %. Pick another name.',
                v_new, to_char(v_conflicts[1], 'Dy FMDD Mon')
                USING ERRCODE = 'unique_violation', HINT = 'SUBGROUP_NAME_TAKEN';
        END IF;

        -- The sub-group first: fn_shift_placement then accepts the shifts' new name.
        UPDATE public.roster_subgroups SET name = v_new, updated_at = now() WHERE id = ANY (v_ids);
        UPDATE public.shifts SET sub_group_name = v_new
         WHERE roster_subgroup_id = ANY (v_ids) AND sub_group_name IS DISTINCT FROM v_new;
    END IF;

    RETURN jsonb_build_object(
        'success',   true,
        'dry_run',   p_dry_run,
        'from_date', v_from,
        'to_date',   p_end_date,
        'days',      cardinality(v_ids),
        'shifts',    v_shifts,
        'past_days', v_past_days,
        'conflicts', to_jsonb(v_conflicts)
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.rename_roster_subgroup_v2(uuid, uuid, uuid, text, text, text, date, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_roster_subgroup_v2(uuid, uuid, uuid, text, text, text, date, date, boolean) TO authenticated, service_role;

-- ── 3e. Clone a roster sub-group ───────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.clone_roster_subgroup_v2(uuid, uuid, text, text, text, date, date);

CREATE FUNCTION public.clone_roster_subgroup_v2(
    p_org_id uuid,
    p_dept_id uuid,
    p_sub_dept_id uuid,
    p_group_external_id text,
    p_source_name text,
    p_new_name text,
    p_start_date date,
    p_end_date date,
    p_dry_run boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_today     date := (now() AT TIME ZONE 'Australia/Sydney')::date;
    v_from      date;
    v_new       text := btrim(p_new_name);
    v_src       record;
    v_new_id    uuid;
    v_ids       uuid[];
    v_conflicts date[];
    v_n_copy    integer;
    v_n_skip    integer;
    v_days      integer := 0;
    v_copied    integer := 0;
    v_skipped   integer := 0;
    v_past_days integer;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_scope('roster.edit', p_org_id, p_dept_id, p_sub_dept_id);
  PERFORM public.sm_require_scope('shift.create', p_org_id, p_dept_id, p_sub_dept_id);

    IF p_sub_dept_id IS NULL THEN
        RAISE EXCEPTION 'Choose one sub-department: a sub-group belongs to one team''s roster.'
            USING ERRCODE = 'invalid_parameter_value', HINT = 'SUB_DEPARTMENT_REQUIRED';
    END IF;
    IF p_group_external_id = 'office' THEN
        RAISE EXCEPTION 'Office has one fixed sub-group, Administration, so it cannot be cloned.'
            USING ERRCODE = 'check_violation', HINT = 'OFFICE_SUBGROUP_FIXED';
    END IF;
    IF v_new IS NULL OR v_new = '' THEN
        RAISE EXCEPTION 'A sub-group needs a name.'
            USING ERRCODE = 'invalid_parameter_value', HINT = 'SUBGROUP_NAME_REQUIRED';
    END IF;
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
        RAISE EXCEPTION 'The date range is empty.' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Shifts are never created in the past, so neither are copies of them.
    v_from := GREATEST(p_start_date, v_today);

    SELECT array_agg(rs.id)
      INTO v_ids
      FROM public.rosters r
      JOIN public.roster_groups rg    ON rg.roster_id = r.id AND rg.external_id = p_group_external_id
      JOIN public.roster_subgroups rs ON rs.roster_group_id = rg.id AND lower(rs.name) = lower(btrim(p_source_name))
     WHERE r.organization_id = p_org_id
       AND r.department_id = p_dept_id
       AND r.sub_department_id = p_sub_dept_id
       AND r.start_date BETWEEN v_from AND p_end_date;
    v_ids := COALESCE(v_ids, '{}');

    SELECT array_agg(DISTINCT r.start_date ORDER BY r.start_date)
      INTO v_conflicts
      FROM public.roster_subgroups mine
      JOIN public.roster_subgroups other ON other.roster_group_id = mine.roster_group_id
                                        AND lower(other.name) = lower(v_new)
      JOIN public.roster_groups rg ON rg.id = mine.roster_group_id
      JOIN public.rosters r        ON r.id = rg.roster_id
     WHERE mine.id = ANY (v_ids);
    v_conflicts := COALESCE(v_conflicts, '{}');

    SELECT count(DISTINCT rs.id)
      INTO v_past_days
      FROM public.rosters r
      JOIN public.roster_groups rg    ON rg.roster_id = r.id AND rg.external_id = p_group_external_id
      JOIN public.roster_subgroups rs ON rs.roster_group_id = rg.id AND lower(rs.name) = lower(btrim(p_source_name))
     WHERE r.organization_id = p_org_id
       AND r.department_id = p_dept_id
       AND r.sub_department_id = p_sub_dept_id
       AND r.start_date >= p_start_date
       AND r.start_date < v_from;

    IF NOT p_dry_run AND cardinality(v_conflicts) > 0 THEN
        RAISE EXCEPTION 'This group already has a sub-group called "%" on %. Pick another name.',
            v_new, to_char(v_conflicts[1], 'Dy FMDD Mon')
            USING ERRCODE = 'unique_violation', HINT = 'SUBGROUP_NAME_TAKEN';
    END IF;

    FOR v_src IN
        SELECT rs.id, rs.roster_group_id, rs.sort_order, rs.required_headcount, rs.min_headcount
          FROM public.roster_subgroups rs
          JOIN public.roster_groups rg ON rg.id = rs.roster_group_id
          JOIN public.rosters r        ON r.id = rg.roster_id
         WHERE rs.id = ANY (v_ids)
         ORDER BY r.start_date
    LOOP
        -- A shift that has started is not copied (that would create a shift in the
        -- past); a cancelled one is not copied at all.
        SELECT count(*) FILTER (WHERE public._shift_delete_refusal(s) IS NULL AND NOT COALESCE(s.is_cancelled, false)),
               count(*) FILTER (WHERE public._shift_delete_refusal(s) IS NOT NULL AND NOT COALESCE(s.is_cancelled, false))
          INTO v_n_copy, v_n_skip
          FROM public.shifts s
         WHERE s.roster_subgroup_id = v_src.id;

        v_days    := v_days + 1;
        v_copied  := v_copied + v_n_copy;
        v_skipped := v_skipped + v_n_skip;

        IF NOT p_dry_run THEN
            INSERT INTO public.roster_subgroups (roster_group_id, name, sort_order, required_headcount, min_headcount)
            VALUES (v_src.roster_group_id, v_new, COALESCE(v_src.sort_order, 0) + 1,
                    v_src.required_headcount, v_src.min_headcount)
            RETURNING id INTO v_new_id;

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
                    unpaid_break_minutes,
                    paid_break_minutes,
                    is_training,
                    target_employment_type,
                    target_requires_flexible
                )
                SELECT
                    s.roster_id,
                    v_new_id,
                    v_new,
                    s.group_type,
                    s.shift_date,
                    s.start_time,
                    s.end_time,
                    s.role_id,
                    s.required_skills,
                    s.required_licenses,
                    s.event_tags,
                    s.notes,
                    'Draft',
                    false,
                    s.organization_id,
                    s.department_id,
                    s.sub_department_id,
                    s.timezone,
                    'sub-group cloning',
                    s.unpaid_break_minutes,
                    s.paid_break_minutes,
                    s.is_training,
                    s.target_employment_type,
                    s.target_requires_flexible
                FROM public.shifts s
                WHERE s.roster_subgroup_id = v_src.id
                  AND public._shift_delete_refusal(s) IS NULL
                  AND NOT COALESCE(s.is_cancelled, false)
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
    END LOOP;

    RETURN jsonb_build_object(
        'success',        true,
        'dry_run',        p_dry_run,
        'from_date',      v_from,
        'to_date',        p_end_date,
        'days',           v_days,
        'shifts_copied',  v_copied,
        'shifts_skipped', v_skipped,
        'past_days',      v_past_days,
        'conflicts',      to_jsonb(v_conflicts)
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.clone_roster_subgroup_v2(uuid, uuid, uuid, text, text, text, date, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clone_roster_subgroup_v2(uuid, uuid, uuid, text, text, text, date, date, boolean) TO authenticated, service_role;

-- ── 4a. What applying a template on top of a range would do ────────────────────

CREATE FUNCTION public.preview_template_application(
    p_template_id uuid,
    p_start_date date,
    p_end_date date,
    p_target_department_id uuid DEFAULT NULL,
    p_target_sub_department_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- Read-only. Mirrors apply_template_to_date_range_v2's matching (target scope,
-- day_of_week NULL = every day, one instance per template shift per day) so the
-- confirmation shows what the apply will meet. It does not predict the shifts the
-- apply will hold back as starting in the past or as breaching a day-typed rule;
-- the apply reports those itself.
DECLARE
    v_today    date := (now() AT TIME ZONE 'Australia/Sydney')::date;
    v_template record;
    v_dept     uuid;
    v_sub      uuid;
    v_from     date;
    v_existing jsonb;
    v_manual   integer;
    v_would    integer;
    v_already  integer;
    v_dupes    integer;
BEGIN
  -- authz guard: the same check the apply itself makes
  PERFORM public.sm_require_template_apply(p_template_id, p_target_department_id, p_target_sub_department_id);

    SELECT * INTO v_template FROM public.roster_templates WHERE id = p_template_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
        RAISE EXCEPTION 'The date range is empty.' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_dept := COALESCE(p_target_department_id, v_template.department_id);
    v_sub  := COALESCE(p_target_sub_department_id, v_template.sub_department_id);
    v_from := GREATEST(p_start_date, v_today);

    -- What is already on those days, by the template it came from.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'template_id',      e.template_id,
               'name',             COALESCE(rt.name, 'A deleted template'),
               'shifts',           e.n,
               'first_date',       e.first_date,
               'last_date',        e.last_date,
               'is_this_template', e.template_id = p_template_id
           ) ORDER BY e.first_date, rt.name), '[]'::jsonb)
      INTO v_existing
      FROM (SELECT s.template_id, count(*) AS n, min(s.shift_date) AS first_date, max(s.shift_date) AS last_date
              FROM public.shifts s
             WHERE s.department_id = v_dept
               AND s.sub_department_id IS NOT DISTINCT FROM v_sub
               AND s.shift_date BETWEEN v_from AND p_end_date
               AND NOT COALESCE(s.is_cancelled, false)
               AND s.template_id IS NOT NULL
             GROUP BY s.template_id) e
      LEFT JOIN public.roster_templates rt ON rt.id = e.template_id;

    SELECT count(*) INTO v_manual
      FROM public.shifts s
     WHERE s.department_id = v_dept
       AND s.sub_department_id IS NOT DISTINCT FROM v_sub
       AND s.shift_date BETWEEN v_from AND p_end_date
       AND NOT COALESCE(s.is_cancelled, false)
       AND s.template_id IS NULL;

    -- What this template would add.
    WITH days AS (
        SELECT d::date AS day FROM generate_series(v_from, p_end_date, interval '1 day') d
    ),
    inst AS (
        SELECT dd.day, ts.id AS ts_id, ts.start_time, ts.end_time, ts.role_id,
               lower(replace(btrim(tg.name), ' ', '_')) AS group_type,
               tsg.name AS sub_name
          FROM public.template_groups tg
          JOIN public.template_subgroups tsg ON tsg.group_id = tg.id
          JOIN public.template_shifts ts     ON ts.subgroup_id = tsg.id
          CROSS JOIN days dd
         WHERE tg.template_id = p_template_id
           AND (ts.day_of_week IS NULL OR ts.day_of_week = EXTRACT(DOW FROM dd.day)::integer)
    ),
    judged AS (
        SELECT
            -- the apply skips an instance already on that day's roster
            EXISTS (SELECT 1 FROM public.shifts s
                     WHERE s.template_instance_id = i.ts_id
                       AND s.shift_date = i.day
                       AND s.department_id = v_dept
                       AND s.sub_department_id IS NOT DISTINCT FROM v_sub) AS already,
            -- an identical shift from somewhere else: same sub-group, times and role
            EXISTS (SELECT 1 FROM public.shifts s
                     WHERE s.department_id = v_dept
                       AND s.sub_department_id IS NOT DISTINCT FROM v_sub
                       AND s.shift_date = i.day
                       AND NOT COALESCE(s.is_cancelled, false)
                       AND s.group_type::text = i.group_type
                       AND lower(s.sub_group_name) = lower(btrim(i.sub_name))
                       AND s.start_time = i.start_time
                       AND s.end_time = i.end_time
                       AND s.role_id IS NOT DISTINCT FROM i.role_id
                       AND s.template_instance_id IS DISTINCT FROM i.ts_id) AS duplicate
          FROM inst i
    )
    SELECT count(*) FILTER (WHERE NOT already),
           count(*) FILTER (WHERE already),
           count(*) FILTER (WHERE NOT already AND duplicate)
      INTO v_would, v_already, v_dupes
      FROM judged;

    RETURN jsonb_build_object(
        'success',            true,
        'from_date',          v_from,
        'to_date',            p_end_date,
        'existing_templates', v_existing,
        'manual_shifts',      v_manual,
        'would_create',       v_would,
        'already_applied',    v_already,
        'duplicates',         v_dupes
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_template_application(uuid, date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_template_application(uuid, date, date, uuid, uuid) TO authenticated, service_role;

-- ── 4b. Undo one template application ──────────────────────────────────────────

DROP FUNCTION IF EXISTS public.undo_template_batch(uuid, uuid);

CREATE FUNCTION public.undo_template_batch(
    p_batch_id uuid,
    p_user_id uuid DEFAULT NULL,
    p_dry_run boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_batch     record;
    v_scope     record;
    v_delete    integer;
    v_assigned  integer;
    v_published integer;
    v_kept      integer;
    v_touched   uuid[];
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_template_edit((SELECT b.template_id FROM public.roster_template_batches b WHERE b.id = p_batch_id));

    SELECT * INTO v_batch FROM public.roster_template_batches WHERE id = p_batch_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'This application no longer exists.');
    END IF;

    -- Taking shifts off a roster needs the right to delete shifts there.
    FOR v_scope IN
        SELECT DISTINCT organization_id, department_id, sub_department_id
          FROM public.shifts WHERE template_batch_id = p_batch_id
    LOOP
        PERFORM public.sm_require_scope('shift.delete', v_scope.organization_id, v_scope.department_id, v_scope.sub_department_id);
    END LOOP;

    SELECT count(*) FILTER (WHERE public._shift_delete_refusal(s) IS NULL),
           count(*) FILTER (WHERE public._shift_delete_refusal(s) IS NULL AND s.assigned_employee_id IS NOT NULL),
           count(*) FILTER (WHERE public._shift_delete_refusal(s) IS NULL AND s.is_published),
           count(*) FILTER (WHERE public._shift_delete_refusal(s) IS NOT NULL)
      INTO v_delete, v_assigned, v_published, v_kept
      FROM public.shifts s
     WHERE s.template_batch_id = p_batch_id;

    IF NOT p_dry_run THEN
        WITH removed AS (
            DELETE FROM public.shifts s
             WHERE s.template_batch_id = p_batch_id
               AND public._shift_delete_refusal(s) IS NULL
            RETURNING s.roster_subgroup_id
        )
        SELECT array_agg(DISTINCT roster_subgroup_id) INTO v_touched FROM removed;

        -- Sub-groups this undo emptied go too, so the roster does not keep empty
        -- rows from a template that is no longer there. Office's Administration
        -- is fixed and stays.
        DELETE FROM public.roster_subgroups rs
         USING public.roster_groups rg
         WHERE rs.id = ANY (COALESCE(v_touched, '{}'))
           AND rg.id = rs.roster_group_id
           AND rg.external_id IS DISTINCT FROM 'office'
           AND NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.roster_subgroup_id = rs.id);

        -- An application with started shifts left stays in the history.
        IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE template_batch_id = p_batch_id) THEN
            DELETE FROM public.roster_template_batches WHERE id = p_batch_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success',        true,
        'dry_run',        p_dry_run,
        'batch_id',       p_batch_id,
        'template_id',    v_batch.template_id,
        'start_date',     v_batch.start_date,
        'end_date',       v_batch.end_date,
        'shifts_deleted', v_delete,
        'assigned',       v_assigned,
        'published',      v_published,
        'shifts_kept',    v_kept
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.undo_template_batch(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_template_batch(uuid, uuid, boolean) TO authenticated, service_role;

-- ── 5. Capture a roster as a template ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.capture_roster_as_template(p_start_date date, p_end_date date, p_sub_department_id uuid, p_template_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        uuid;
  v_name_len       int;
  v_dupe_count     int;
  v_shift_count    int := 0;
  v_ft_skipped     int := 0;
  v_org_id         uuid;
  v_dept_id        uuid;
  v_template_id    uuid;
  v_group_type     text;
  v_group_id       uuid;
  v_subgroup_id    uuid;
  v_subgroup_name  text;
  v_group_types    text[];
  v_group_idx      int := 0;
  v_subgroup_idx   int;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_template_create_in(p_sub_department_id);
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app_access_certificates aac
    JOIN sub_departments sd ON sd.id = p_sub_department_id
    JOIN departments     d  ON d.id  = sd.department_id
    WHERE aac.user_id         = v_user_id
      AND aac.is_active       = true
      AND (aac.organization_id = d.organization_id OR aac.organization_id IS NULL)
      AND (
        aac.sub_department_id = p_sub_department_id
        OR (aac.sub_department_id IS NULL AND aac.department_id = sd.department_id)
        OR (aac.sub_department_id IS NULL AND aac.department_id IS NULL)
      )
  ) THEN
    DECLARE
      v_diag_org_id uuid;
      v_diag_dept_id uuid;
      v_cert_count int;
    BEGIN
      SELECT organization_id, id INTO v_diag_org_id, v_diag_dept_id
      FROM departments
      WHERE id = (SELECT department_id FROM sub_departments WHERE id = p_sub_department_id);
      SELECT COUNT(*) INTO v_cert_count FROM app_access_certificates WHERE user_id = v_user_id AND is_active = true;
      RAISE EXCEPTION 'UNAUTHORIZED: User % lacks required cert. sd: %, d_org: %, certs_found: %',
        v_user_id, p_sub_department_id, v_diag_org_id, v_cert_count;
    END;
  END IF;

  IF p_end_date < p_start_date THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
  IF (p_end_date - p_start_date) > 35 THEN RAISE EXCEPTION 'DATE_RANGE_TOO_LARGE'; END IF;

  v_name_len := char_length(trim(p_template_name));
  IF v_name_len < 3 OR v_name_len > 100 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;

  SELECT COUNT(*) INTO v_dupe_count
  FROM roster_templates
  WHERE sub_department_id = p_sub_department_id
    AND name = trim(p_template_name)
    AND status != 'archived'
    AND (is_active IS NULL OR is_active = true);
  IF v_dupe_count > 0 THEN RAISE EXCEPTION 'DUPLICATE_TEMPLATE_NAME'; END IF;

  -- Templates cannot hold full-time shifts (enforce_no_ft_template_shifts), so
  -- those are left out and counted rather than failing the whole capture.
  SELECT COUNT(*) INTO v_ft_skipped
  FROM shifts s
  WHERE s.sub_department_id = p_sub_department_id
    AND s.shift_date BETWEEN p_start_date AND p_end_date
    AND s.deleted_at IS NULL
    AND (s.lifecycle_status IS NULL OR s.lifecycle_status != 'Cancelled')
    AND s.target_employment_type = 'FT';

  DROP TABLE IF EXISTS _capture_shifts;
  CREATE TEMP TABLE _capture_shifts ON COMMIT DROP AS
  SELECT
    s.id, s.organization_id, s.department_id, s.sub_department_id,
    s.shift_date, s.start_time, s.end_time,
    s.role_id, r.name AS role_name,
    s.paid_break_minutes, s.unpaid_break_minutes,
    s.net_length_minutes,
    s.assigned_employee_id,
    s.lifecycle_status,
    s.required_skills, s.required_licenses, s.tags, s.event_tags, s.notes,
    s.target_employment_type, s.target_requires_flexible,
    s.group_type::text AS group_type,
    COALESCE(NULLIF(btrim(rs.name), ''), 'Default') AS sub_name
  FROM shifts s
  LEFT JOIN hr.roles r ON r.id = s.role_id
  LEFT JOIN roster_subgroups rs ON rs.id = s.roster_subgroup_id
  WHERE s.sub_department_id = p_sub_department_id
    AND s.shift_date BETWEEN p_start_date AND p_end_date
    AND s.deleted_at IS NULL
    AND (s.lifecycle_status IS NULL OR s.lifecycle_status != 'Cancelled')
    AND s.target_employment_type IS DISTINCT FROM 'FT'
  ORDER BY s.shift_date, s.start_time;

  SELECT COUNT(*) INTO v_shift_count FROM _capture_shifts;
  IF v_shift_count = 0 THEN
    IF v_ft_skipped > 0 THEN RAISE EXCEPTION 'ONLY_FULL_TIME_IN_RANGE'; END IF;
    RAISE EXCEPTION 'NO_SHIFTS_IN_RANGE';
  END IF;

  SELECT organization_id, department_id INTO v_org_id, v_dept_id FROM _capture_shifts LIMIT 1;
  IF v_org_id IS NULL OR v_dept_id IS NULL THEN
    RAISE EXCEPTION 'ORG_DEPT_MISSING_IN_SHIFTS: Shift % has org: %, dept: %',
      (SELECT id FROM _capture_shifts LIMIT 1), v_org_id, v_dept_id;
  END IF;

  INSERT INTO roster_templates (
    name, status, organization_id, department_id, sub_department_id,
    start_date, end_date, created_by, last_edited_by, created_from,
    version, applied_count, is_active, is_base_template
  ) VALUES (
    trim(p_template_name), 'draft', v_org_id, v_dept_id, p_sub_department_id,
    p_start_date, p_end_date, v_user_id, v_user_id, 'capture',
    1, 0, true, false
  )
  RETURNING id INTO v_template_id;

  SELECT ARRAY_AGG(DISTINCT COALESCE(group_type, 'default') ORDER BY COALESCE(group_type, 'default'))
  INTO v_group_types FROM _capture_shifts;

  v_group_idx := 0;
  FOREACH v_group_type IN ARRAY v_group_types LOOP
    -- The new template already holds the five fixed groups
    -- (fn_seed_fixed_template_groups). Use them rather than adding a second
    -- "convention_centre" beside "Convention Centre".
    v_group_id := NULL;
    SELECT id INTO v_group_id
      FROM template_groups
     WHERE template_id = v_template_id
       AND lower(replace(btrim(name), ' ', '_')) = v_group_type
     LIMIT 1;
    IF v_group_id IS NULL THEN
      INSERT INTO template_groups (template_id, name, color, sort_order)
      VALUES (v_template_id, v_group_type, '#64748b', 100 + v_group_idx)
      RETURNING id INTO v_group_id;
    END IF;
    v_group_idx := v_group_idx + 1;

    -- One template sub-group per sub-group NAME. Each roster day has its own
    -- roster_subgroups row, so keying on that row made a week's capture hold seven
    -- copies of every sub-group.
    v_subgroup_idx := 0;
    FOR v_subgroup_name IN
      SELECT min(cs.sub_name)
        FROM _capture_shifts cs
       WHERE COALESCE(cs.group_type, 'default') = v_group_type
       GROUP BY lower(cs.sub_name)
       ORDER BY lower(cs.sub_name)
    LOOP
      v_subgroup_id := NULL;
      SELECT id INTO v_subgroup_id
        FROM template_subgroups
       WHERE group_id = v_group_id AND lower(name) = lower(v_subgroup_name);
      IF v_subgroup_id IS NULL THEN
        INSERT INTO template_subgroups (group_id, name, sort_order)
        VALUES (v_group_id, v_subgroup_name, v_subgroup_idx)
        RETURNING id INTO v_subgroup_id;
      END IF;
      v_subgroup_idx := v_subgroup_idx + 1;

      INSERT INTO template_shifts (
        subgroup_id, name, role_id, role_name, start_time, end_time,
        paid_break_minutes, unpaid_break_minutes, net_length_hours,
        required_skills, required_licenses, site_tags, event_tags,
        notes, day_of_week, assigned_employee_id, assigned_employee_name, sort_order,
        target_employment_type, target_requires_flexible
      )
      SELECT
        v_subgroup_id, NULL, cs.role_id, cs.role_name, cs.start_time, cs.end_time,
        COALESCE(cs.paid_break_minutes, 0), COALESCE(cs.unpaid_break_minutes, 0),
        ROUND(COALESCE(cs.net_length_minutes, 0)::numeric / 60.0, 2),
        (SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(cs.required_skills, '[]'::jsonb)))),
        (SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(cs.required_licenses, '[]'::jsonb)))),
        (SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(cs.tags, '[]'::jsonb)))),
        (SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(cs.event_tags, '[]'::jsonb)))),
        cs.notes, EXTRACT(DOW FROM cs.shift_date)::int, NULL, NULL,
        ROW_NUMBER() OVER (ORDER BY cs.shift_date, cs.start_time) - 1,
        cs.target_employment_type, COALESCE(cs.target_requires_flexible, false)
      FROM _capture_shifts cs
      WHERE COALESCE(cs.group_type, 'default') = v_group_type
        AND lower(cs.sub_name) = lower(v_subgroup_name);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'template_id', v_template_id,
    'shifts_captured', v_shift_count,
    'shifts_skipped_full_time', v_ft_skipped
  );
END;
$function$;

-- ── 6. Unguarded writers nothing calls ─────────────────────────────────────────

REVOKE ALL ON FUNCTION public.clone_roster_subgroup(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_monthly_template(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_monthly_template(uuid, character varying, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_monthly_template(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_roster_subgroup(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_monthly_template(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_monthly_template(uuid, character varying, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_monthly_template(uuid, uuid, text) TO service_role;
