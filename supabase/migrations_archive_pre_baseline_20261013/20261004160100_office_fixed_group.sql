-- Migration: 20261004160100_office_fixed_group.sql
-- Description: Office becomes the fifth fixed roster group, with a fixed
--              sub-group Administration, and the full-time shifts move into it.
--
-- Handover 2026-10-04, D2: full-time shifts live on the Rosters page in a group
-- of their own. Until now the Office page parked them in Convention Centre, in a
-- sub-group it created called "Administration", because a fifth group needed the
-- enum value added in 20261004160000 and every function below.
--
-- WHAT ENUMERATES THE GROUPS (verified against pg_proc / pg_trigger, 2026-10-04)
-- ------------------------------------------------------------------------------
--   live trigger  enforce_exactly_three_groups    BEFORE INSERT roster_groups — allow-list
--   live trigger  seed_standard_roster_groups     AFTER INSERT rosters
--   live trigger  fn_seed_fixed_template_groups   AFTER INSERT roster_templates
--   RPC           add_roster_subgroup_range (x2)  "Add sub-group" on the Rosters page
--   RPC           apply_template_to_date_range_v2 an unknown group RAISEs, by design
--   no trigger    protect_fixed_roster_groups, seed_fixed_template_groups
--                 — attached to nothing; kept in step so re-attaching either is safe.
--
-- Not changed, deliberately: apply_monthly_template (x3), apply_template_to_date_range
-- and seed_fixed_roster_groups have no caller in the app and already lack The
-- Cutaway; capture_roster_as_template names template groups by group_type, which
-- the apply CASE below maps back.
--
-- ALSO FIXED: seed_standard_roster_groups never seeded The Cutaway. Every roster
-- created since June got it only if a template apply happened to create it; 3 of
-- 405 never did, and a Cutaway shift on those days fails with a 23502 because
-- shifts.roster_subgroup_id is NOT NULL and there is no group to hang one off.
--
-- THE MOVE
-- --------
-- The 25 full-time shifts (all Draft, 2–29 Oct) are re-parented from
-- Convention Centre → Administration to Office → Administration on the same
-- roster. Only group_type and roster_subgroup_id change: the past-shift lock
-- (fn_prevent_locked_shift_modification) guards schedule fields, not placement,
-- and a placement change raises no notification and records no lifecycle event.
-- The Convention Centre "Administration" sub-groups are then removed where empty
-- — they existed only to hold these shifts.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The allow-list
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_exactly_three_groups()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF NEW.external_id NOT IN ('convention_centre', 'exhibition_centre', 'theatre', 'the_cutaway', 'office') OR NEW.external_id IS NULL THEN
        RAISE EXCEPTION 'Only standard ICC Sydney groups (Convention, Exhibition, Theatre, The Cutaway, Office) are allowed. Attempted to add: %', NEW.name;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_fixed_roster_groups()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF OLD.name IN ('Convention Centre', 'Exhibition Centre', 'Theatre', 'The Cutaway', 'Office') THEN
        IF TG_OP = 'UPDATE' AND NEW.name != OLD.name THEN
            RAISE EXCEPTION 'Renaming of fixed group "%" is not allowed.', OLD.name;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Seeding — new rosters and new templates
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_standard_roster_groups()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- The five fixed ICC Sydney groups, on every new roster row.
    INSERT INTO public.roster_groups (roster_id, name, external_id, sort_order)
    VALUES
        (NEW.id, 'Convention Centre', 'convention_centre', 0),
        (NEW.id, 'Exhibition Centre', 'exhibition_centre', 1),
        (NEW.id, 'Theatre',           'theatre',           2),
        (NEW.id, 'The Cutaway',       'the_cutaway',       3),
        (NEW.id, 'Office',            'office',            4)
    ON CONFLICT (roster_id, external_id) DO NOTHING;

    -- Office has one fixed sub-group: where full-time shifts live.
    INSERT INTO public.roster_subgroups (roster_group_id, name, sort_order)
    SELECT g.id, 'Administration', 0
    FROM public.roster_groups g
    WHERE g.roster_id = NEW.id
      AND g.external_id = 'office'
      AND NOT EXISTS (
          SELECT 1 FROM public.roster_subgroups s
          WHERE s.roster_group_id = g.id AND s.name = 'Administration'
      );

    RETURN NEW;
END;
$function$;

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
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seed_fixed_template_groups()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    INSERT INTO template_groups (template_id, name, color, icon, sort_order)
    VALUES
        (NEW.id, 'Convention Centre', '#3b82f6', 'building',    1),
        (NEW.id, 'Exhibition Centre', '#10b981', 'layout-grid', 2),
        (NEW.id, 'Theatre',           '#8b5cf6', 'theater',     3),
        (NEW.id, 'The Cutaway',       '#f59e0b', 'film',        4),
        (NEW.id, 'Office',            '#06b6d4', 'briefcase',   5);
    RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. "Add sub-group" — both overloads. Bodies are production's verbatim, plus
--    the office branch.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.add_roster_subgroup_range(p_org_id uuid, p_group_external_id text, p_name text, p_start_date date, p_end_date date)
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

        -- 1. Get Roster (Removed auto-creation)
        SELECT id INTO v_roster_id FROM public.rosters
        WHERE organization_id = p_org_id AND start_date = v_current_date
        LIMIT 1;

        IF v_roster_id IS NULL THEN
            RAISE EXCEPTION 'Roster not activated for date: %', v_current_date;
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

        -- 3. Ensure Subgroup Exists (Idempotent)
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_subgroups
            WHERE roster_group_id = v_roster_group_id AND name = p_name
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

        -- 3. Ensure Subgroup Exists (Idempotent)
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_subgroups
            WHERE roster_group_id = v_roster_group_id AND name = p_name
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Template apply. Production's body verbatim, plus the office branch.
--    (An Office template shift targeting FT still fails the baseline-only
--    trigger — that is Phase 3, not this migration.)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_template_to_date_range_v2(p_template_id uuid, p_start_date date, p_end_date date, p_user_id uuid, p_source text DEFAULT 'roster_modal'::text, p_target_department_id uuid DEFAULT NULL::uuid, p_target_sub_department_id uuid DEFAULT NULL::uuid, p_force_stack boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
          AND sub_department_id = v_sub_dept_id
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
                SELECT id INTO v_rsg_id
                FROM roster_subgroups
                WHERE roster_group_id = v_rg_id AND name = v_tsg.name;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Backfill every existing roster and template
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.roster_groups (roster_id, name, external_id, sort_order)
SELECT r.id, v.name, v.external_id, v.sort_order
FROM public.rosters r
CROSS JOIN (VALUES
    ('The Cutaway', 'the_cutaway', 3),
    ('Office',      'office',      4)
) AS v(name, external_id, sort_order)
ON CONFLICT (roster_id, external_id) DO NOTHING;

INSERT INTO public.roster_subgroups (roster_group_id, name, sort_order)
SELECT g.id, 'Administration', 0
FROM public.roster_groups g
WHERE g.external_id = 'office'
  AND NOT EXISTS (
      SELECT 1 FROM public.roster_subgroups s
      WHERE s.roster_group_id = g.id AND s.name = 'Administration'
  );

INSERT INTO public.template_groups (template_id, name, color, icon, sort_order)
SELECT t.id, 'Office', '#06b6d4', 'briefcase',
       COALESCE((SELECT max(g.sort_order) FROM public.template_groups g WHERE g.template_id = t.id), 0) + 1
FROM public.roster_templates t
WHERE NOT EXISTS (
    SELECT 1 FROM public.template_groups g WHERE g.template_id = t.id AND g.name = 'Office'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Move the full-time shifts: Convention Centre → Administration
--    becomes Office → Administration on the same roster.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.shifts s
SET group_type         = 'office'::public.template_group_type,
    roster_subgroup_id = dest.id
FROM public.roster_subgroups src
JOIN public.roster_groups    src_g  ON src_g.id = src.roster_group_id
                                   AND src_g.external_id = 'convention_centre'
JOIN public.roster_groups    dest_g ON dest_g.roster_id = src_g.roster_id
                                   AND dest_g.external_id = 'office'
JOIN public.roster_subgroups dest   ON dest.roster_group_id = dest_g.id
                                   AND dest.name = 'Administration'
WHERE s.roster_subgroup_id = src.id
  AND src.name = 'Administration'
  AND s.target_employment_type = 'FT';

DELETE FROM public.roster_subgroups src
USING public.roster_groups src_g
WHERE src_g.id = src.roster_group_id
  AND src_g.external_id = 'convention_centre'
  AND src.name = 'Administration'
  AND NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.roster_subgroup_id = src.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Grants — restate what production had (CREATE OR REPLACE keeps the ACL,
--    but the file is also the record).
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.add_roster_subgroup_range(uuid, text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_roster_subgroup_range(uuid, text, text, date, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_roster_subgroup_range(uuid, uuid, uuid, text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_roster_subgroup_range(uuid, uuid, uuid, text, text, date, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid, boolean) TO authenticated, service_role;
