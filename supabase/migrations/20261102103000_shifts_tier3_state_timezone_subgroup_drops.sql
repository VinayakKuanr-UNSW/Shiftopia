-- =============================================================================
-- Migration: Tier 3 - State Booleans, Timezone & Subgroup Drops
-- Dropping from public.shifts:
--   1. is_draft (redundant generated column)
--   2. is_published (redundant generated column)
--   3. tz_identifier (redundant copy of timezone)
--   4. group_type (denormalized copy of roster_groups.external_id)
--   5. sub_group_name (denormalized copy of roster_subgroups.name)
-- =============================================================================

-- 1. Drop trigger dependencies & indexes on the columns being dropped
DROP TRIGGER IF EXISTS trg_shift_placement ON public.shifts;
DROP TRIGGER IF EXISTS trg_shift_z_office_is_ft_only ON public.shifts;
DROP INDEX IF EXISTS public.idx_shifts_is_published;
DROP INDEX IF EXISTS public.idx_shifts_group_type;
DROP INDEX IF EXISTS public.idx_shifts_summary_covering;

-- 2. Drop the 5 columns from public.shifts
ALTER TABLE public.shifts
  DROP COLUMN IF EXISTS is_draft,
  DROP COLUMN IF EXISTS is_published,
  DROP COLUMN IF EXISTS tz_identifier,
  DROP COLUMN IF EXISTS group_type,
  DROP COLUMN IF EXISTS sub_group_name;

-- 3. Recreate covering summary index using roster_subgroup_id
CREATE INDEX idx_shifts_summary_covering ON public.shifts USING btree (organization_id, shift_date, roster_subgroup_id)
INCLUDE (assigned_employee_id, lifecycle_status, is_cancelled, net_length_minutes);

-- 4. Replace stored procedures and triggers
-- Procedure: fn_shift_placement
CREATE OR REPLACE FUNCTION public.fn_shift_placement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_roster   public.rosters%ROWTYPE;
    v_sub      record;
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.shift_date         IS NOT DISTINCT FROM NEW.shift_date
       AND OLD.roster_id          IS NOT DISTINCT FROM NEW.roster_id
       AND OLD.roster_subgroup_id IS NOT DISTINCT FROM NEW.roster_subgroup_id
       AND OLD.organization_id    IS NOT DISTINCT FROM NEW.organization_id
       AND OLD.department_id      IS NOT DISTINCT FROM NEW.department_id
       AND OLD.sub_department_id  IS NOT DISTINCT FROM NEW.sub_department_id THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_roster FROM public.rosters WHERE id = NEW.roster_id;
    IF NOT FOUND
       OR NEW.shift_date NOT BETWEEN v_roster.start_date AND v_roster.end_date
       OR v_roster.department_id IS DISTINCT FROM NEW.department_id
       OR v_roster.sub_department_id IS DISTINCT FROM NEW.sub_department_id THEN
        SELECT * INTO v_roster FROM public.rosters r
         WHERE r.department_id = NEW.department_id
           AND r.sub_department_id IS NOT DISTINCT FROM NEW.sub_department_id
           AND NEW.shift_date BETWEEN r.start_date AND r.end_date
         ORDER BY r.start_date DESC
         LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'There is no roster on % for this team, so the shift cannot be placed there. Create the roster for that day first.',
                to_char(NEW.shift_date, 'Dy FMDD Mon YYYY')
                USING ERRCODE = 'check_violation', HINT = 'NO_ROSTER_FOR_DATE';
        END IF;
        NEW.roster_id := v_roster.id;
    END IF;

    IF NEW.organization_id IS NULL THEN
        NEW.organization_id := v_roster.organization_id;
    ELSIF NEW.organization_id IS DISTINCT FROM v_roster.organization_id THEN
        RAISE EXCEPTION 'The shift''s organisation does not match its roster''s.'
            USING ERRCODE = 'check_violation', HINT = 'ROSTER_SCOPE_MISMATCH';
    END IF;

    SELECT rs.id, rs.name, rg.id AS group_id, rg.external_id, rg.roster_id
      INTO v_sub
      FROM public.roster_subgroups rs
      JOIN public.roster_groups rg ON rg.id = rs.roster_group_id
     WHERE rs.id = NEW.roster_subgroup_id;

    IF NOT FOUND OR v_sub.roster_id IS DISTINCT FROM NEW.roster_id THEN
        RAISE EXCEPTION 'A shift needs a valid roster_subgroup_id for its roster.'
            USING ERRCODE = 'check_violation', HINT = 'NO_SUBGROUP';
    END IF;

    NEW.shift_group_id := v_sub.group_id;

    RETURN NEW;
END;
$function$;

-- Procedure: fn_shift_office_is_ft_only
CREATE OR REPLACE FUNCTION public.fn_shift_office_is_ft_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_group_external_id text;
BEGIN
    SELECT rg.external_id INTO v_group_external_id
      FROM public.roster_subgroups rs
      JOIN public.roster_groups rg ON rg.id = rs.roster_group_id
     WHERE rs.id = NEW.roster_subgroup_id;

    IF v_group_external_id = 'office'
       AND NEW.target_employment_type IS DISTINCT FROM 'FT' THEN
        RAISE EXCEPTION
            'The Office group holds full-time shifts only (target_employment_type = %).',
            COALESCE(NEW.target_employment_type, 'NULL')
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.target_employment_type = 'FT'
       AND v_group_external_id IS DISTINCT FROM 'office' THEN
        RAISE EXCEPTION
            'Full-time shifts belong in the Office group only (group = %).',
            COALESCE(v_group_external_id, 'NULL')
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$function$;

-- Procedure: apply_template_to_date_range_v2
CREATE OR REPLACE FUNCTION public.apply_template_to_date_range_v2(p_template_id uuid, p_start_date date, p_end_date date, p_user_id uuid, p_source text DEFAULT 'roster_modal'::text, p_target_department_id uuid DEFAULT NULL::uuid, p_target_sub_department_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- Templates always add on top of what is there, and every shift they stamp
-- is unassigned: a template shift has no employee. An instance that has already
-- started is skipped and counted in shifts_skipped; trg_shift_not_started
-- refuses it anyway.
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
    v_breach_window text;
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
  -- Audit attribution is the CALLER, never a client-supplied id (2026-10-18;
  -- the rule sm_bulk_publish_shifts got on 2026-10-13). p_user_id fed
  -- roster_template_batches.applied_by, rosters.created_by,
  -- shifts.created_by_user_id and the shift_events actor. System callers
  -- (cron, service role) keep the id they pass.
  IF NOT public.sm_request_is_system() THEN
    p_user_id := auth.uid();
  END IF;
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

        -- One apply at a time per roster day, so the "already stamped?" check
        -- below sees what a concurrent apply committed. Dates run ascending in
        -- every apply, so overlapping ranges take these locks in the same order.
        PERFORM pg_advisory_xact_lock(hashtextextended(
            'template_apply:' || v_curr_date::text || ':' || v_dept_id::text || ':' || COALESCE(v_sub_dept_id::text, ''), 0));

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
                        ) THEN
                            v_shift_start_timestamp := (v_curr_date || ' ' || v_ts.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                            v_shift_end_timestamp := (v_curr_date || ' ' || v_ts.end_time)::timestamp AT TIME ZONE 'Australia/Sydney';

                            IF v_ts.end_time < v_ts.start_time THEN
                                v_shift_end_timestamp := v_shift_end_timestamp + interval '1 day';
                            END IF;

                            IF v_shift_start_timestamp <= now() THEN
                                v_shifts_skipped := v_shifts_skipped + 1;
                                CONTINUE;
                            END IF;

                            -- DAY-TYPED COMPLIANCE: soft-skip an instance this
                            -- template cannot lawfully produce on THIS date.
                            -- Same predicate trg_shift_shape_3_day_typed
                            -- enforces, so skip and enforce cannot drift.
                            v_breach_window := public.shift_break_window_breach(
                                v_ts.start_time, v_ts.end_time, COALESCE(v_ts.unpaid_break_minutes, 0),
                                v_ts.break_start, v_ts.break_end);
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
                            v_breach := COALESCE(v_breach_window, v_breach);
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
                                start_at, end_at,
                                paid_break_minutes, unpaid_break_minutes, break_start, break_end,
                                template_id, template_instance_id, is_from_template,
                                template_batch_id,
                                roster_subgroup_id,
                                lifecycle_status, notes,
                                created_by_user_id,
                                required_skills,
                                required_licenses,
                                event_ids
                            )
                            VALUES (
                                v_roster_id, v_template.organization_id, v_dept_id, v_sub_dept_id,
                                v_ts.role_id, v_curr_date, v_ts.start_time, v_ts.end_time,
                                v_shift_start_timestamp, v_shift_end_timestamp,
                                COALESCE(v_ts.paid_break_minutes, 0), COALESCE(v_ts.unpaid_break_minutes, 0), v_ts.break_start, v_ts.break_end,
                                p_template_id, v_ts.id, true,
                                v_batch_id,
                                v_rsg_id,
                                'Draft', v_ts.notes,
                                p_user_id,
                                to_jsonb(v_ts.required_skills),
                                to_jsonb(v_ts.required_licenses),
                                '[]'::jsonb
                            )
                            RETURNING id INTO v_new_shift_id;

                            INSERT INTO public.shift_events (
                                shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
                            ) VALUES (
                                v_new_shift_id,
                                NULL,
                                p_user_id,
                                'OP_APPLIED'::public.shift_event_type,
                                jsonb_build_object(
                                    'op', 'create',
                                    'domain', 'lifecycle',
                                    'from_state', NULL,
                                    'to_state', 'S1',
                                    'source', 'apply_template_to_date_range_v2',
                                    'creation_source', 'template'
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

-- Procedure: preview_template_application
CREATE OR REPLACE FUNCTION public.preview_template_application(p_template_id uuid, p_start_date date, p_end_date date, p_target_department_id uuid DEFAULT NULL::uuid, p_target_sub_department_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
                     JOIN public.roster_subgroups rs ON rs.id = s.roster_subgroup_id
                     JOIN public.roster_groups rg    ON rg.id = rs.roster_group_id
                     WHERE s.department_id = v_dept
                       AND s.sub_department_id IS NOT DISTINCT FROM v_sub
                       AND s.shift_date = i.day
                       AND NOT COALESCE(s.is_cancelled, false)
                       AND rg.external_id = i.group_type
                       AND lower(rs.name) = lower(btrim(i.sub_name))
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

-- Procedure: delete_roster_subgroup_v2
CREATE OR REPLACE FUNCTION public.delete_roster_subgroup_v2(p_org_id uuid, p_dept_id uuid, p_sub_dept_id uuid, p_group_external_id text, p_name text, p_start_date date, p_end_date date, p_dry_run boolean DEFAULT false)
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
               count(*) FILTER (WHERE public._shift_delete_refusal(s) IS NULL AND s.lifecycle_status = 'Published'),
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

-- Procedure: rename_roster_subgroup_v2
CREATE OR REPLACE FUNCTION public.rename_roster_subgroup_v2(p_org_id uuid, p_dept_id uuid, p_sub_dept_id uuid, p_group_external_id text, p_old_name text, p_new_name text, p_start_date date, p_end_date date, p_dry_run boolean DEFAULT false)
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

        UPDATE public.roster_subgroups SET name = v_new, updated_at = now() WHERE id = ANY (v_ids);
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

-- Procedure: undo_template_batch
CREATE OR REPLACE FUNCTION public.undo_template_batch(p_batch_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_dry_run boolean DEFAULT false)
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
           count(*) FILTER (WHERE public._shift_delete_refusal(s) IS NULL AND s.lifecycle_status = 'Published'),
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

-- Procedure: get_insights_summary
CREATE OR REPLACE FUNCTION public.get_insights_summary(p_start_date date, p_end_date date, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
    v_total       int; v_published   int; v_assigned    int;
    v_cancelled   int; v_completed   int; v_no_show     int;
    v_emergency   int; v_sched_hrs   numeric;
    v_comp_over   int;
BEGIN
    SELECT
        COUNT(*)                                                             ,
        COUNT(*) FILTER (WHERE s.lifecycle_status IN ('Published', 'InProgress', 'Completed'))                       ,
        COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)           ,
        COUNT(*) FILTER (WHERE s.is_cancelled = true)                       ,
        COUNT(*) FILTER (WHERE s.lifecycle_status = 'Completed')            ,
        COUNT(*) FILTER (WHERE s.attendance_status = 'no_show'
                            OR s.assignment_outcome = 'no_show')            ,
        COUNT(*) FILTER (WHERE s.assignment_outcome = 'emergency_assigned')          ,
        COALESCE(SUM(COALESCE(s.net_length_minutes,0)::numeric / 60)
            FILTER (WHERE s.assigned_employee_id IS NOT NULL), 0)           
    INTO
        v_total, v_published, v_assigned, v_cancelled,
        v_completed, v_no_show, v_emergency, v_sched_hrs
    FROM shifts s
    WHERE s.shift_date BETWEEN p_start_date AND p_end_date
      AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
      AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
      AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids));

    SELECT COUNT(*) INTO v_comp_over FROM shifts s JOIN shift_compliance_snapshots scs ON scs.shift_id = s.id WHERE scs.is_overridden = true AND s.shift_date BETWEEN p_start_date AND p_end_date
      AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
      AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
      AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids));

    RETURN json_build_object(
        'shifts_total',          COALESCE(v_total, 0),
        'shifts_published',      COALESCE(v_published, 0),
        'shifts_assigned',       COALESCE(v_assigned, 0),
        'shifts_unassigned',     GREATEST(0, COALESCE(v_total,0) - COALESCE(v_assigned,0) - COALESCE(v_cancelled,0)),
        'shifts_cancelled',      COALESCE(v_cancelled, 0),
        'shifts_completed',      COALESCE(v_completed, 0),
        'shifts_no_show',        COALESCE(v_no_show, 0),
        'shifts_emergency',      COALESCE(v_emergency, 0),
        'scheduled_hours',       COALESCE(v_sched_hrs, 0),
        'shift_fill_rate',       CASE WHEN COALESCE(v_total,0) = 0 THEN 0
                                      ELSE ROUND(v_assigned::numeric / v_total * 100, 1) END,
        'compliance_overrides',  COALESCE(v_comp_over, 0),
        'no_show_rate',          CASE WHEN COALESCE(v_assigned,0) = 0 THEN 0
                                      ELSE ROUND(v_no_show::numeric / v_assigned * 100, 1) END
    );
END;
$function$;

-- Procedure: get_roster_summary
CREATE OR REPLACE FUNCTION public.get_roster_summary(p_organization_id uuid, p_start_date date, p_end_date date, p_department_ids uuid[] DEFAULT NULL::uuid[], p_sub_department_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(shift_date date, group_type text, sub_group_name text, total_shifts integer, assigned_shifts integer, open_shifts integer, published_shifts integer, draft_shifts integer, cancelled_shifts integer, total_net_minutes bigint, unique_employees integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
  SELECT
    s.shift_date,
    rg.external_id::text                                            AS group_type,
    rs.name::text                                                   AS sub_group_name,
    COUNT(*)::int                                                   AS total_shifts,
    COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)::int   AS assigned_shifts,
    COUNT(*) FILTER (WHERE s.assigned_employee_id IS NULL)::int       AS open_shifts,
    COUNT(*) FILTER (WHERE s.lifecycle_status IN ('Published', 'InProgress', 'Completed'))::int  AS published_shifts,
    COUNT(*) FILTER (WHERE s.lifecycle_status = 'Draft')::int         AS draft_shifts,
    COUNT(*) FILTER (WHERE s.is_cancelled)::int                       AS cancelled_shifts,
    COALESCE(SUM(s.net_length_minutes), 0)::bigint                  AS total_net_minutes,
    COUNT(DISTINCT s.assigned_employee_id)::int                     AS unique_employees
  FROM shifts s
  JOIN public.roster_subgroups rs ON rs.id = s.roster_subgroup_id
  JOIN public.roster_groups rg    ON rg.id = rs.roster_group_id
  WHERE s.organization_id = p_organization_id
    AND s.shift_date BETWEEN p_start_date AND p_end_date
    AND (p_department_ids IS NULL OR s.department_id = ANY(p_department_ids))
    AND (p_sub_department_ids IS NULL OR s.sub_department_id = ANY(p_sub_department_ids))
  GROUP BY s.shift_date, rg.external_id, rs.name
  ORDER BY s.shift_date, rg.external_id, rs.name;
$function$;

-- Procedure: sm_apply_shift_op
CREATE OR REPLACE FUNCTION public.sm_apply_shift_op(p_shift_id uuid, p_expected_version integer, p_op text, p_payload jsonb DEFAULT '{}'::jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller     uuid := auth.uid();
  v_pre        RECORD;
  v_cur        RECORD;
  v_state      text;
  v_to_state   text;
  v_write      jsonb;
  v_event      public.shift_event_type;
  v_actor_role text;
  v_domain     text;
  v_changes    jsonb := '{}'::jsonb;
BEGIN
  IF v_caller IS NOT NULL AND NOT (
       EXISTS (
            SELECT 1 FROM public.app_access_certificates c
            WHERE c.user_id = v_caller
              AND c.is_active = true
              AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
          )
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_pre
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'GONE');
  END IF;

  -- scope guard (20261011 access matrix): the caller must hold this op's
  -- action over THIS shift's place, not merely a manager level somewhere.
  IF v_caller IS NOT NULL AND NOT public.user_has_action_in_scope(
       CASE p_op
         WHEN 'publish'       THEN 'shift.publish'
         WHEN 'unpublish'     THEN 'shift.publish'
         WHEN 'delete'        THEN 'shift.delete'
         WHEN 'assign'        THEN 'shift.assign'
         WHEN 'unassign'      THEN 'shift.assign'
         WHEN 'select_winner' THEN 'bid.assign'
         WHEN 'approve_trade' THEN 'swap.approve'
         WHEN 'reject_trade'  THEN 'swap.approve'
         WHEN 'create'        THEN 'shift.create'
         ELSE 'shift.edit'
       END,
       v_pre.organization_id, v_pre.department_id, v_pre.sub_department_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.shift_events e
       WHERE e.shift_id = p_shift_id
         AND e.metadata->>'idem' = p_idempotency_key::text
     ) THEN
    RETURN jsonb_build_object(
      'ok', true, 'code', 'IDEMPOTENT_REPLAY', 'version', v_pre.version
    );
  END IF;

  IF v_pre.version <> p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'VERSION_CONFLICT',
      'current_version', v_pre.version,
      'current_state', public.get_shift_fsm_state(
        v_pre.lifecycle_status, v_pre.assignment_status, v_pre.assignment_outcome,
        v_pre.trading_status, v_pre.is_cancelled, v_pre.bidding_status),
      'last_modified_by', v_pre.last_modified_by,
      'updated_at', v_pre.updated_at,
      'server_row', to_jsonb(v_pre)
    );
  END IF;

  v_state := public.get_shift_fsm_state(
    v_pre.lifecycle_status, v_pre.assignment_status, v_pre.assignment_outcome,
    v_pre.trading_status, v_pre.is_cancelled, v_pre.bidding_status);

  IF NOT public.fsm_op_is_legal(v_state, p_op) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'ILLEGAL_TRANSITION',
      'current_state', v_state,
      'attempted', p_op
    );
  END IF;

  PERFORM set_config('app.audit.via_gateway', '1', true);
  v_write := public._apply_shift_op_write(p_shift_id, p_op, p_payload, v_caller);
  PERFORM set_config('app.audit.via_gateway', '0', true);

  SELECT * INTO v_cur FROM public.shifts WHERE id = p_shift_id;

  -- scope guard, destination (20261011 access matrix): an edit that moves the
  -- shift to another place needs the same authority there. Raising undoes the
  -- write.
  IF v_caller IS NOT NULL
     AND (v_cur.organization_id, v_cur.department_id, v_cur.sub_department_id)
         IS DISTINCT FROM (v_pre.organization_id, v_pre.department_id, v_pre.sub_department_id)
     AND NOT public.user_has_action_in_scope('shift.edit', v_cur.organization_id, v_cur.department_id, v_cur.sub_department_id) THEN
    RAISE EXCEPTION 'Not authorised: shift.edit is not granted to you where this shift is moving'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE((v_write->>'applied')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'WRITE_REJECTED',
      'note', v_write->>'note',
      'rule_id', v_write->>'rule_id',
      'details', v_write->>'details',
      'version', v_cur.version,
      'state', public.get_shift_fsm_state(
        v_cur.lifecycle_status, v_cur.assignment_status, v_cur.assignment_outcome,
        v_cur.trading_status, v_cur.is_cancelled, v_cur.bidding_status)
    );
  END IF;

  v_to_state := public.get_shift_fsm_state(
    v_cur.lifecycle_status, v_cur.assignment_status, v_cur.assignment_outcome,
    v_cur.trading_status, v_cur.is_cancelled, v_cur.bidding_status);

  IF p_op IN ('edit', 'move') THEN
    IF v_pre.start_time IS DISTINCT FROM v_cur.start_time THEN
      v_changes := v_changes || jsonb_build_object('start_time',
        jsonb_build_object('old', to_jsonb(v_pre.start_time), 'new', to_jsonb(v_cur.start_time)));
    END IF;
    IF v_pre.end_time IS DISTINCT FROM v_cur.end_time THEN
      v_changes := v_changes || jsonb_build_object('end_time',
        jsonb_build_object('old', to_jsonb(v_pre.end_time), 'new', to_jsonb(v_cur.end_time)));
    END IF;
    IF v_pre.shift_date IS DISTINCT FROM v_cur.shift_date THEN
      v_changes := v_changes || jsonb_build_object('shift_date',
        jsonb_build_object('old', to_jsonb(v_pre.shift_date), 'new', to_jsonb(v_cur.shift_date)));
    END IF;
    IF v_pre.paid_break_minutes IS DISTINCT FROM v_cur.paid_break_minutes THEN
      v_changes := v_changes || jsonb_build_object('paid_break_minutes',
        jsonb_build_object('old', to_jsonb(v_pre.paid_break_minutes), 'new', to_jsonb(v_cur.paid_break_minutes)));
    END IF;
    IF v_pre.unpaid_break_minutes IS DISTINCT FROM v_cur.unpaid_break_minutes THEN
      v_changes := v_changes || jsonb_build_object('unpaid_break_minutes',
        jsonb_build_object('old', to_jsonb(v_pre.unpaid_break_minutes), 'new', to_jsonb(v_cur.unpaid_break_minutes)));
    END IF;
    IF v_pre.break_start IS DISTINCT FROM v_cur.break_start THEN
      v_changes := v_changes || jsonb_build_object('break_start',
        jsonb_build_object('old', to_jsonb(v_pre.break_start), 'new', to_jsonb(v_cur.break_start)));
    END IF;
    IF v_pre.break_end IS DISTINCT FROM v_cur.break_end THEN
      v_changes := v_changes || jsonb_build_object('break_end',
        jsonb_build_object('old', to_jsonb(v_pre.break_end), 'new', to_jsonb(v_cur.break_end)));
    END IF;
    IF v_pre.notes IS DISTINCT FROM v_cur.notes THEN
      v_changes := v_changes || jsonb_build_object('notes',
        jsonb_build_object('old', to_jsonb(v_pre.notes), 'new', to_jsonb(v_cur.notes)));
    END IF;
    IF v_pre.role_id IS DISTINCT FROM v_cur.role_id THEN
      v_changes := v_changes || jsonb_build_object('role_id',
        jsonb_build_object('old', to_jsonb(v_pre.role_id), 'new', to_jsonb(v_cur.role_id)));
    END IF;
    IF v_pre.sub_department_id IS DISTINCT FROM v_cur.sub_department_id THEN
      v_changes := v_changes || jsonb_build_object('sub_department_id',
        jsonb_build_object('old', to_jsonb(v_pre.sub_department_id), 'new', to_jsonb(v_cur.sub_department_id)));
    END IF;
    IF v_pre.remuneration_level IS DISTINCT FROM v_cur.remuneration_level THEN
      v_changes := v_changes || jsonb_build_object('remuneration_level',
        jsonb_build_object('old', to_jsonb(v_pre.remuneration_level), 'new', to_jsonb(v_cur.remuneration_level)));
    END IF;

    IF v_pre.display_order IS DISTINCT FROM v_cur.display_order THEN
      v_changes := v_changes || jsonb_build_object('display_order',
        jsonb_build_object('old', to_jsonb(v_pre.display_order), 'new', to_jsonb(v_cur.display_order)));
    END IF;
    IF v_pre.shift_group_id IS DISTINCT FROM v_cur.shift_group_id THEN
      v_changes := v_changes || jsonb_build_object('shift_group_id',
        jsonb_build_object('old', to_jsonb(v_pre.shift_group_id), 'new', to_jsonb(v_cur.shift_group_id)));
    END IF;
    IF v_pre.roster_subgroup_id IS DISTINCT FROM v_cur.roster_subgroup_id THEN
      v_changes := v_changes || jsonb_build_object('roster_subgroup_id',
        jsonb_build_object('old', to_jsonb(v_pre.roster_subgroup_id), 'new', to_jsonb(v_cur.roster_subgroup_id)));
    END IF;
    IF v_pre.timezone IS DISTINCT FROM v_cur.timezone THEN
      v_changes := v_changes || jsonb_build_object('timezone',
        jsonb_build_object('old', to_jsonb(v_pre.timezone), 'new', to_jsonb(v_cur.timezone)));
    END IF;
    IF v_pre.is_training IS DISTINCT FROM v_cur.is_training THEN
      v_changes := v_changes || jsonb_build_object('is_training',
        jsonb_build_object('old', to_jsonb(v_pre.is_training), 'new', to_jsonb(v_cur.is_training)));
    END IF;
    IF v_pre.required_skills IS DISTINCT FROM v_cur.required_skills THEN
      v_changes := v_changes || jsonb_build_object('required_skills',
        jsonb_build_object('old', to_jsonb(v_pre.required_skills), 'new', to_jsonb(v_cur.required_skills)));
    END IF;
    IF v_pre.required_licenses IS DISTINCT FROM v_cur.required_licenses THEN
      v_changes := v_changes || jsonb_build_object('required_licenses',
        jsonb_build_object('old', to_jsonb(v_pre.required_licenses), 'new', to_jsonb(v_cur.required_licenses)));
    END IF;
    IF v_pre.event_ids IS DISTINCT FROM v_cur.event_ids THEN
      v_changes := v_changes || jsonb_build_object('event_ids',
        jsonb_build_object('old', to_jsonb(v_pre.event_ids), 'new', to_jsonb(v_cur.event_ids)));
    END IF;
    IF v_pre.assigned_employee_id IS DISTINCT FROM v_cur.assigned_employee_id THEN
      v_changes := v_changes || jsonb_build_object('assignment',
        jsonb_build_object('old', to_jsonb(v_pre.assigned_employee_id), 'new', to_jsonb(v_cur.assigned_employee_id)));
    END IF;
  END IF;

  IF v_caller IS NULL THEN
    v_actor_role := 'system';
  ELSIF EXISTS (
          SELECT 1 FROM public.app_access_certificates c
          WHERE c.user_id = v_caller
            AND c.is_active = true
            AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        ) THEN
    v_actor_role := 'manager';
  ELSE
    v_actor_role := 'employee';
  END IF;

  v_domain := CASE p_op
                WHEN 'create'        THEN 'lifecycle'
                WHEN 'publish'        THEN 'lifecycle'
                WHEN 'unpublish'      THEN 'lifecycle'
                WHEN 'delete'         THEN 'lifecycle'
                WHEN 'assign'         THEN 'assignment'
                WHEN 'unassign'       THEN 'assignment'
                WHEN 'select_winner'  THEN 'marketplace'
                WHEN 'edit'           THEN 'schedule'
                WHEN 'move'           THEN 'schedule'
                WHEN 'approve_trade'  THEN 'trade'
                WHEN 'reject_trade'   THEN 'trade'
                ELSE 'lifecycle'
              END;

  v_event := CASE
               WHEN p_op = 'assign'        THEN 'ASSIGNED'
               WHEN p_op = 'select_winner' THEN 'ASSIGNED'
               WHEN p_op = 'unpublish'     THEN 'UNASSIGNED'
               WHEN p_op = 'delete' AND v_cur.assigned_employee_id IS NOT NULL
                                           THEN 'CANCELLED'
               ELSE 'OP_APPLIED'
             END::public.shift_event_type;

  INSERT INTO public.shift_events (
    shift_id, employee_id, actor_id, event_type, metadata,
    actor_role, domain, shift_version, idempotency_key
  )
  VALUES (
    p_shift_id,
    v_cur.assigned_employee_id,
    v_caller,
    v_event,
    jsonb_build_object(
      'op',                p_op,
      'reason',            p_payload->>'reason',
      'from_state',        v_state,
      'to_state',          v_to_state,
      'from_version',      p_expected_version,
      'to_version',        v_cur.version,
      'idem',              p_idempotency_key,
      'source',            'sm_apply_shift_op',
      'assignment_source', p_payload->>'assignment_source',
      'payload',           p_payload,
      'write',             v_write
    )
    || CASE WHEN p_op IN ('edit', 'move')
            THEN jsonb_build_object('changes', v_changes)
            ELSE '{}'::jsonb
       END,
    v_actor_role,
    v_domain,
    v_cur.version,
    p_idempotency_key
  );

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'APPLIED',
    'version', v_cur.version,
    'state', v_to_state
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error in sm_apply_shift_op (shift=%, op=%): %', p_shift_id, p_op, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$function$;

-- Procedure: _apply_shift_op_write
CREATE OR REPLACE FUNCTION public._apply_shift_op_write(p_shift_id uuid, p_op text, p_payload jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cur            RECORD;
  v_winner         uuid;
  v_emp            uuid;
  v_swap           public.shift_swaps%ROWTYPE;
  v_edit_state     text;
  v_new_emp        uuid;
  v_do_assign      boolean := false;
  v_do_unassign    boolean := false;
  v_assign_src     text;
  v_breach_rule    text;
  v_breach_details text;
BEGIN
  SELECT * INTO v_cur FROM public.shifts WHERE id = p_shift_id;

  IF p_op = 'assign' THEN
    v_emp := NULLIF(p_payload->>'employee_id', '')::uuid;
    IF v_emp IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'MISSING_EMPLOYEE_ID');
    END IF;

    -- Concurrency Contract: Lock employee identity before running checks
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_emp::text));

    -- Full EBA compliance check (blocking tier)
    SELECT rule_id, details INTO v_breach_rule, v_breach_details
      FROM internal.eba_check_assignment(p_shift_id, v_emp) WITH ORDINALITY AS c(is_compliant, rule_id, rule_name, tier, summary, details, payload, eba_ord)
     WHERE tier = 'BLOCKING'
     ORDER BY c.eba_ord
     LIMIT 1;

    IF v_breach_rule IS NOT NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
    END IF;

    UPDATE public.shifts SET
      assigned_employee_id = v_emp,
      assigned_at          = NOW(),
      assignment_status    = 'assigned'::public.shift_assignment_status,
      assignment_outcome   = CASE WHEN lifecycle_status = 'Published'
                                  THEN 'confirmed'::public.shift_assignment_outcome
                                  ELSE assignment_outcome END,
      bidding_status       = CASE WHEN lifecycle_status = 'Published'
                                  THEN 'not_on_bidding'::public.shift_bidding_status
                                  ELSE bidding_status END,
      is_on_bidding        = CASE WHEN lifecycle_status = 'Published'
                                  THEN FALSE ELSE is_on_bidding END,
      last_modified_by     = p_actor,
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'unassign' THEN
    IF v_cur.assigned_employee_id IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'ALREADY_UNASSIGNED');
    END IF;

    UPDATE public.shifts SET
      assigned_employee_id = NULL,
      assigned_at          = NULL,
      assignment_status    = 'unassigned'::public.shift_assignment_status,
      assignment_outcome   = NULL,
      fulfillment_status   = 'none'::public.shift_fulfillment_status,
      last_modified_by     = p_actor,
      last_modified_reason = COALESCE(p_payload->>'reason', 'Unassigned via shift gateway'),
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'publish' THEN
    IF v_cur.assigned_employee_id IS NOT NULL THEN
      -- Concurrency Contract: Lock employee identity before running checks
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_cur.assigned_employee_id::text));

      -- Full EBA compliance validation before publishing assigned shift
      SELECT rule_id, details INTO v_breach_rule, v_breach_details
        FROM internal.eba_check_assignment(p_shift_id, v_cur.assigned_employee_id) WITH ORDINALITY AS c(is_compliant, rule_id, rule_name, tier, summary, details, payload, eba_ord)
       WHERE tier = 'BLOCKING'
       ORDER BY c.eba_ord
       LIMIT 1;

      IF v_breach_rule IS NOT NULL THEN
        RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
      END IF;

      IF ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
            AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours' <= NOW() THEN
        -- Emergency window: confirm directly
        UPDATE public.shifts SET
          lifecycle_status       = 'Published'::public.shift_lifecycle,
          fulfillment_status     = 'scheduled'::public.shift_fulfillment_status,
          assignment_outcome     = 'confirmed'::public.shift_assignment_outcome,
          bidding_status         = 'not_on_bidding'::public.shift_bidding_status,
          is_on_bidding          = FALSE,
          published_at           = NOW(),
          last_modified_by       = p_actor,
          updated_at             = NOW()
        WHERE id = p_shift_id;
      ELSE
        INSERT INTO public.shift_offers (shift_id, employee_id, status)
        VALUES (p_shift_id, v_cur.assigned_employee_id, 'Pending')
        ON CONFLICT (shift_id, employee_id) DO NOTHING;

        UPDATE public.shifts SET
          lifecycle_status     = 'Published'::public.shift_lifecycle,
          fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
          published_at         = NOW(),
          last_modified_by     = p_actor,
          updated_at           = NOW()
        WHERE id = p_shift_id;
      END IF;
    ELSE
      IF ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
            AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours' <= NOW() THEN
        RETURN jsonb_build_object('applied', false, 'note', 'PUBLISH_TOO_LATE');
      END IF;

      UPDATE public.shifts SET
        lifecycle_status     = 'Published'::public.shift_lifecycle,
        fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
        bidding_status       = 'on_bidding'::public.shift_bidding_status,
        published_at         = NOW(),
        is_on_bidding        = TRUE,
        bidding_open_at      = NOW(),
        bidding_close_at     = ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
                                  AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours',
        last_modified_by     = p_actor,
        updated_at           = NOW()
      WHERE id = p_shift_id;
    END IF;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'unpublish' THEN
    IF v_cur.trading_status IN ('TradeRequested', 'TradeAccepted') THEN
      UPDATE public.shift_swaps SET
        status = 'CANCELLED',
        updated_at = NOW()
      WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
        AND status IN ('OPEN', 'MANAGER_PENDING', 'OFFER_SELECTED');

      UPDATE public.shifts SET
        trading_status = 'NoTrade'::public.shift_trading,
        trade_requested_at = NULL,
        last_modified_by = p_actor,
        updated_at = NOW()
      WHERE id IN (
        SELECT CASE WHEN requester_shift_id = p_shift_id THEN target_shift_id ELSE requester_shift_id END
        FROM public.shift_swaps
        WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
      ) AND id <> p_shift_id;

      UPDATE public.swap_requests SET
        status = 'cancelled',
        updated_at = NOW()
      WHERE (original_shift_id = p_shift_id OR offered_shift_id = p_shift_id)
        AND status IN ('pending_employee', 'pending_manager');

      UPDATE public.shifts SET
        trading_status = 'NoTrade'::public.shift_trading,
        trade_requested_at = NULL,
        last_modified_by = p_actor,
        updated_at = NOW()
      WHERE id IN (
        SELECT CASE WHEN original_shift_id = p_shift_id THEN offered_shift_id ELSE original_shift_id END
        FROM public.swap_requests
        WHERE (original_shift_id = p_shift_id OR offered_shift_id = p_shift_id)
      ) AND id <> p_shift_id;

      UPDATE public.shifts SET
        trading_status = 'NoTrade'::public.shift_trading,
        trade_requested_at = NULL
      WHERE id = p_shift_id;
    END IF;

    IF v_cur.assigned_employee_id IS NOT NULL THEN
      UPDATE public.shifts SET
        lifecycle_status   = 'Draft'::public.shift_lifecycle,
        assignment_outcome = NULL,
        bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
        is_on_bidding      = FALSE,
        fulfillment_status = 'none'::public.shift_fulfillment_status,
        last_modified_by   = p_actor,
        updated_at         = NOW()
      WHERE id = p_shift_id;
    ELSE
      UPDATE public.shifts SET
        lifecycle_status   = 'Draft'::public.shift_lifecycle,
        bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
        is_on_bidding      = FALSE,
        fulfillment_status = 'none'::public.shift_fulfillment_status,
        last_modified_by   = p_actor,
        updated_at         = NOW()
      WHERE id = p_shift_id;
    END IF;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'select_winner' THEN
    v_winner := COALESCE(NULLIF(p_payload->>'winner_id', ''), NULLIF(p_payload->>'employee_id', ''))::uuid;
    IF v_winner IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'MISSING_WINNER_ID');
    END IF;

    -- Concurrency Contract: Lock employee identity before running checks
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_winner::text));

    -- Full EBA compliance validation
    SELECT rule_id, details INTO v_breach_rule, v_breach_details
      FROM internal.eba_check_assignment(p_shift_id, v_winner) WITH ORDINALITY AS c(is_compliant, rule_id, rule_name, tier, summary, details, payload, eba_ord)
     WHERE tier = 'BLOCKING'
     ORDER BY c.eba_ord
     LIMIT 1;

    IF v_breach_rule IS NOT NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
    END IF;

    UPDATE public.shift_bids SET status = 'accepted', updated_at = NOW()
    WHERE shift_id = p_shift_id AND employee_id = v_winner;

    UPDATE public.shift_bids SET status = 'rejected', updated_at = NOW()
    WHERE shift_id = p_shift_id AND employee_id <> v_winner
      AND status = 'pending';

    UPDATE public.shifts SET
      assigned_employee_id = v_winner,
      assigned_at          = NOW(),
      assignment_status    = 'assigned'::public.shift_assignment_status,
      assignment_outcome   = 'confirmed'::public.shift_assignment_outcome,
      bidding_status       = 'not_on_bidding'::public.shift_bidding_status,
      is_on_bidding        = FALSE,
      fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
      last_modified_by     = p_actor,
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'edit' THEN
    IF NOT (p_payload ?| ARRAY[
      'start_time','end_time','shift_date','paid_break_minutes',
      'unpaid_break_minutes','break_start','break_end','notes','role_id','sub_department_id',
      'remuneration_level','display_order',
      'shift_group_id','shift_subgroup_id','timezone','is_training',
      'assigned_employee_id','required_skills','required_licenses','event_ids'
    ]) THEN
      RETURN jsonb_build_object('applied', false, 'note', 'NO_EDITABLE_FIELDS');
    END IF;

    IF p_payload ? 'assigned_employee_id' THEN
      v_edit_state := public.get_shift_fsm_state(
        v_cur.lifecycle_status, v_cur.assignment_status, v_cur.assignment_outcome,
        v_cur.trading_status, v_cur.is_cancelled, v_cur.bidding_status);
      v_new_emp := NULLIF(p_payload->>'assigned_employee_id', '')::uuid;

      IF v_new_emp IS NOT NULL
         AND v_new_emp IS DISTINCT FROM v_cur.assigned_employee_id
         AND public.fsm_op_is_legal(v_edit_state, 'assign') THEN
        v_do_assign  := true;
        v_assign_src := COALESCE(NULLIF(p_payload->>'assignment_source', ''), 'manual');
      ELSIF v_new_emp IS NULL
         AND v_cur.assigned_employee_id IS NOT NULL
         AND public.fsm_op_is_legal(v_edit_state, 'unassign') THEN
        v_do_unassign := true;
      END IF;
    END IF;

    -- Concurrency Contract & Compliance checks on edit:
    IF v_do_assign THEN
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_new_emp::text));

      SELECT rule_id, details INTO v_breach_rule, v_breach_details
        FROM internal.eba_check_assignment(
          p_shift_id,
          v_new_emp,
          COALESCE(NULLIF(p_payload->>'shift_date','')::date, v_cur.shift_date),
          COALESCE(NULLIF(p_payload->>'start_time','')::time, v_cur.start_time),
          COALESCE(NULLIF(p_payload->>'end_time','')::time, v_cur.end_time),
          COALESCE((p_payload->>'unpaid_break_minutes')::int, v_cur.unpaid_break_minutes),
          COALESCE(NULLIF(p_payload->>'role_id','')::uuid, v_cur.role_id)
        ) WITH ORDINALITY AS c(is_compliant, rule_id, rule_name, tier, summary, details, payload, eba_ord)
       WHERE tier = 'BLOCKING'
       ORDER BY c.eba_ord
       LIMIT 1;

      IF v_breach_rule IS NOT NULL THEN
        RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
      END IF;
    ELSIF v_cur.assigned_employee_id IS NOT NULL AND NOT v_do_unassign AND (
      p_payload ? 'start_time' OR p_payload ? 'end_time' OR p_payload ? 'shift_date' OR
      p_payload ? 'role_id' OR p_payload ? 'unpaid_break_minutes' OR
      p_payload ? 'break_start' OR p_payload ? 'break_end'
    ) THEN
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_cur.assigned_employee_id::text));

      SELECT rule_id, details INTO v_breach_rule, v_breach_details
        FROM internal.eba_check_assignment(
          p_shift_id,
          v_cur.assigned_employee_id,
          COALESCE(NULLIF(p_payload->>'shift_date','')::date, v_cur.shift_date),
          COALESCE(NULLIF(p_payload->>'start_time','')::time, v_cur.start_time),
          COALESCE(NULLIF(p_payload->>'end_time','')::time, v_cur.end_time),
          COALESCE((p_payload->>'unpaid_break_minutes')::int, v_cur.unpaid_break_minutes),
          COALESCE(NULLIF(p_payload->>'role_id','')::uuid, v_cur.role_id)
        ) WITH ORDINALITY AS c(is_compliant, rule_id, rule_name, tier, summary, details, payload, eba_ord)
       WHERE tier = 'BLOCKING'
       ORDER BY c.eba_ord
       LIMIT 1;

      IF v_breach_rule IS NOT NULL THEN
        RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
      END IF;
    END IF;

    UPDATE public.shifts SET
      start_time            = COALESCE(NULLIF(p_payload->>'start_time','')::time, start_time),
      end_time              = COALESCE(NULLIF(p_payload->>'end_time','')::time, end_time),
      shift_date            = COALESCE(NULLIF(p_payload->>'shift_date','')::date, shift_date),
      paid_break_minutes    = COALESCE((p_payload->>'paid_break_minutes')::int, paid_break_minutes),
      unpaid_break_minutes  = COALESCE((p_payload->>'unpaid_break_minutes')::int, unpaid_break_minutes),
      break_start           = CASE WHEN p_payload ? 'break_start' THEN NULLIF(p_payload->>'break_start', '')::time ELSE break_start END,
      break_end             = CASE WHEN p_payload ? 'break_end' THEN NULLIF(p_payload->>'break_end', '')::time ELSE break_end END,
      notes                 = CASE WHEN p_payload ? 'notes' THEN p_payload->>'notes' ELSE notes END,
      role_id               = COALESCE(NULLIF(p_payload->>'role_id','')::uuid, role_id),
      sub_department_id     = COALESCE(NULLIF(p_payload->>'sub_department_id','')::uuid, sub_department_id),
      remuneration_level    = COALESCE(NULLIF(p_payload->>'remuneration_level','')::smallint, remuneration_level),
      shift_group_id        = COALESCE(NULLIF(p_payload->>'shift_group_id','')::uuid, shift_group_id),
      roster_subgroup_id    = COALESCE(NULLIF(p_payload->>'shift_subgroup_id','')::uuid, roster_subgroup_id),
      display_order         = COALESCE((p_payload->>'display_order')::int, display_order),
      timezone              = COALESCE(NULLIF(p_payload->>'timezone',''), timezone),
      is_training            = COALESCE((p_payload->>'is_training')::boolean, is_training),
      required_skills       = CASE WHEN p_payload ? 'required_skills' THEN COALESCE(p_payload->'required_skills', '[]'::jsonb) ELSE required_skills END,
      required_licenses     = CASE WHEN p_payload ? 'required_licenses' THEN COALESCE(p_payload->'required_licenses', '[]'::jsonb) ELSE required_licenses END,
      event_ids             = CASE WHEN p_payload ? 'event_ids' THEN COALESCE(p_payload->'event_ids', '[]'::jsonb) ELSE event_ids END,
      assigned_employee_id  = CASE WHEN v_do_assign   THEN v_new_emp
                                   WHEN v_do_unassign THEN NULL
                                   ELSE assigned_employee_id END,
      assigned_at           = CASE WHEN v_do_assign   THEN NOW()
                                   WHEN v_do_unassign THEN NULL
                                   ELSE assigned_at END,
      assignment_status     = CASE WHEN v_do_assign   THEN 'assigned'::public.shift_assignment_status
                                   WHEN v_do_unassign THEN 'unassigned'::public.shift_assignment_status
                                   ELSE assignment_status END,
      assignment_outcome    = CASE WHEN v_do_unassign THEN NULL ELSE assignment_outcome END,
      fulfillment_status    = CASE WHEN v_do_unassign THEN 'none'::public.shift_fulfillment_status
                                   ELSE fulfillment_status END,
      last_modified_by      = p_actor,
      last_modified_reason  = COALESCE(p_payload->>'reason', last_modified_reason),
      updated_at            = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'delete' THEN
    RETURN jsonb_build_object('applied', false, 'note', 'USE_SM_DELETE_SHIFT');

  ELSIF p_op = 'approve_trade' THEN
    IF COALESCE((p_payload->>'compliance_ok')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object('applied', false, 'note', 'COMPLIANCE_NOT_CONFIRMED');
    END IF;

    SELECT * INTO v_swap
    FROM public.shift_swaps
    WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
      AND status = 'MANAGER_PENDING'
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('applied', false, 'note', 'NO_MANAGER_PENDING_SWAP');
    END IF;

    IF v_swap.target_id IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'UNRESOLVED_SWAP_TARGET');
    END IF;

    -- Concurrency Contract: Multi-Employee Lock Ordering (Deadlock Prevention)
    -- Advisory locks MUST be acquired in ascending lexicographical UUID order: LEAST then GREATEST
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || LEAST(v_swap.requester_id, v_swap.target_id)::text));
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || GREATEST(v_swap.requester_id, v_swap.target_id)::text));

    PERFORM public.sm_approve_peer_swap(
      v_swap.requester_shift_id, v_swap.target_shift_id,
      v_swap.requester_id, v_swap.target_id);

    UPDATE public.shift_swaps SET
      status            = 'APPROVED'::public.swap_request_status,
      manager_approved  = TRUE,
      approved_by       = p_actor,
      approved_at       = NOW(),
      status_changed_at = NOW(),
      updated_at        = NOW()
    WHERE id = v_swap.id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'reject_trade' THEN
    SELECT * INTO v_swap
    FROM public.shift_swaps
    WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
      AND status = 'MANAGER_PENDING'
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('applied', false, 'note', 'NO_MANAGER_PENDING_SWAP');
    END IF;

    UPDATE public.shift_swaps SET
      status            = 'REJECTED'::public.swap_request_status,
      reason            = COALESCE(NULLIF(p_payload->>'reason',''), 'Rejected by manager'),
      rejection_reason  = COALESCE(NULLIF(p_payload->>'reason',''), 'Rejected by manager'),
      status_changed_at = NOW(),
      updated_at        = NOW()
    WHERE id = v_swap.id AND status = 'MANAGER_PENDING';

    UPDATE public.shifts SET
      trading_status     = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL,
      last_modified_by   = p_actor,
      updated_at         = NOW()
    WHERE id IN (
      SELECT CASE WHEN requester_shift_id = p_shift_id THEN target_shift_id ELSE requester_shift_id END
      FROM public.shift_swaps
      WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
    ) AND id <> p_shift_id;

    UPDATE public.shifts SET
      trading_status = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);
  ELSE
    RETURN jsonb_build_object('applied', false, 'note', 'UNSUPPORTED_OP');
  END IF;
END;
$function$;

-- Procedure: sm_create_shift
CREATE OR REPLACE FUNCTION public.sm_create_shift(p_shift_data jsonb, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift_id uuid;
    v_roster_id uuid;
    v_roster_subgroup_id uuid;
    v_shift_group_id uuid;
    v_sub_group_name text;
    v_creation_source text;
    v_assignment_source text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_shift_data_action(p_shift_data, 'shift.create');
  -- Audit attribution is the CALLER, never a client-supplied id (the rule
  -- apply_template_to_date_range_v2 got on 2026-10-18). System callers
  -- (cron, service role) keep the id they pass.
  IF NOT public.sm_request_is_system() THEN
    p_user_id := auth.uid();
  END IF;
    v_roster_id          := (p_shift_data->>'roster_id')::uuid;
    v_roster_subgroup_id := (p_shift_data->>'roster_subgroup_id')::uuid;
    v_shift_group_id     := (p_shift_data->>'shift_group_id')::uuid;
    v_sub_group_name     := p_shift_data->>'sub_group_name';

    v_creation_source := COALESCE(
        p_shift_data->>'creation_source',
        CASE WHEN COALESCE((p_shift_data->>'is_from_template')::boolean, false) THEN 'template' ELSE 'manual' END
    );

    v_assignment_source := CASE
        WHEN (p_shift_data->>'assigned_employee_id') IS NOT NULL
        THEN COALESCE(p_shift_data->>'assignment_source', 'direct')
        ELSE NULL
    END;

    IF v_roster_id IS NULL THEN
        RAISE EXCEPTION 'Roster ID is required';
    END IF;

    IF v_roster_subgroup_id IS NULL AND v_shift_group_id IS NOT NULL AND v_sub_group_name IS NOT NULL THEN
        SELECT id INTO v_roster_subgroup_id
        FROM roster_subgroups
        WHERE roster_group_id = v_shift_group_id
          AND (LOWER(name) = LOWER(v_sub_group_name)
               OR LOWER(name) = LOWER(REPLACE(v_sub_group_name, '_', ' ')))
        LIMIT 1;

        IF v_roster_subgroup_id IS NULL THEN
            INSERT INTO public.roster_subgroups (
                roster_group_id,
                name,
                sort_order
            ) VALUES (
                v_shift_group_id,
                v_sub_group_name,
                999
            )
            RETURNING id INTO v_roster_subgroup_id;
        END IF;
    END IF;

    PERFORM set_config('app.audit.via_gateway', '1', true);

    INSERT INTO shifts (
        roster_id, department_id, shift_date, start_time, end_time,
        organization_id, sub_department_id, display_order,
        shift_group_id, roster_subgroup_id, role_id, remuneration_level,
        paid_break_minutes, unpaid_break_minutes, break_start, break_end, timezone,
        assigned_employee_id, required_skills, required_licenses, event_ids, tags, notes,
        template_id, is_from_template, template_instance_id,
        lifecycle_status, created_by_user_id, creation_source,
        target_employment_type, target_requires_flexible, is_training,
        created_at, updated_at
    ) VALUES (
        v_roster_id,
        (p_shift_data->>'department_id')::uuid,
        (p_shift_data->>'shift_date')::date,
        (p_shift_data->>'start_time')::time,
        (p_shift_data->>'end_time')::time,
        (p_shift_data->>'organization_id')::uuid,
        (p_shift_data->>'sub_department_id')::uuid,
        COALESCE((p_shift_data->>'display_order')::integer, 0),
        v_shift_group_id,
        v_roster_subgroup_id,
        (p_shift_data->>'role_id')::uuid,
        (p_shift_data->>'remuneration_level')::smallint,
        COALESCE((p_shift_data->>'paid_break_minutes')::integer, 0),
        COALESCE((p_shift_data->>'unpaid_break_minutes')::integer, 0),
        NULLIF(p_shift_data->>'break_start', '')::time,
        NULLIF(p_shift_data->>'break_end', '')::time,
        COALESCE(p_shift_data->>'timezone', 'Australia/Sydney'),
        (p_shift_data->>'assigned_employee_id')::uuid,
        COALESCE(p_shift_data->'required_skills', '[]'::jsonb),
        COALESCE(p_shift_data->'required_licenses', '[]'::jsonb),
        COALESCE(p_shift_data->'event_ids', '[]'::jsonb),
        COALESCE(p_shift_data->'tags', '[]'::jsonb),
        p_shift_data->>'notes',
        (p_shift_data->>'template_id')::uuid,
        COALESCE((p_shift_data->>'is_from_template')::boolean, false),
        (p_shift_data->>'template_instance_id')::uuid,
        'Draft'::shift_lifecycle,
        p_user_id,
        v_creation_source,
        NULLIF(p_shift_data->>'target_employment_type', ''),
        COALESCE((p_shift_data->>'target_requires_flexible')::boolean, false),
        COALESCE((p_shift_data->>'is_training')::boolean, false),
        NOW(), NOW()
    )
    RETURNING id INTO v_shift_id;

    PERFORM set_config('app.audit.via_gateway', '0', true);

    INSERT INTO public.shift_events (
        shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
    ) VALUES (
        v_shift_id,
        (p_shift_data->>'assigned_employee_id')::uuid,
        p_user_id,
        'OP_APPLIED'::public.shift_event_type,
        jsonb_build_object(
            'op', 'create',
            'domain', 'lifecycle',
            'from_state', NULL,
            'to_state', CASE WHEN (p_shift_data->>'assigned_employee_id') IS NOT NULL THEN 'S2' ELSE 'S1' END,
            'source', 'sm_create_shift',
            'creation_source', v_creation_source,
            'assigned_employee_id', (p_shift_data->>'assigned_employee_id')::uuid,
            'assignment_source', v_assignment_source
        ),
        CASE WHEN p_user_id IS NULL THEN 'system' ELSE 'manager' END,
        'lifecycle'
    );

    RETURN v_shift_id;
END;
$function$;

-- Procedure: sm_move_shift
CREATE OR REPLACE FUNCTION public.sm_move_shift(p_shift_id uuid, p_group_type text DEFAULT NULL::text, p_sub_group_name text DEFAULT NULL::text, p_shift_group_id uuid DEFAULT NULL::uuid, p_roster_subgroup_id uuid DEFAULT NULL::uuid, p_shift_date date DEFAULT NULL::date, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_found BOOLEAN;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_shift_action(p_shift_id, 'shift.edit');
    UPDATE shifts SET
        shift_group_id     = p_shift_group_id,
        roster_subgroup_id = p_roster_subgroup_id,
        shift_date         = COALESCE(p_shift_date, shift_date),
        updated_at         = NOW(),
        last_modified_by   = p_user_id
    WHERE id = p_shift_id
;

    v_found := FOUND;

    IF NOT v_found THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found or already deleted');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- 5. Recreate triggers

CREATE TRIGGER trg_shift_placement
    BEFORE INSERT OR UPDATE OF shift_date, roster_id, roster_subgroup_id, organization_id, department_id, sub_department_id
    ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.fn_shift_placement();

CREATE TRIGGER trg_shift_z_office_is_ft_only
    BEFORE INSERT OR UPDATE OF roster_subgroup_id, target_employment_type
    ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.fn_shift_office_is_ft_only();
