-- Roster Planner toolbar audit (2026-10-18), database half.
-- docs/investigations/2026-10-18_roster-toolbar-audit.md
--
-- Each function is rebuilt from its live definition (repo copy hash-checked
-- against pg_proc.prosrc before editing; the authz guards are kept) with one
-- targeted change:
--
--   F-08  sm_bulk_publish_shifts       lock the rows before deciding; read the
--                                      state from the locked row (TOCTOU).
--   F-09  trg_shift_notifications      a shift published straight to Confirmed
--                                      no longer tells the employee to "accept
--                                      or decline" an offer.
--   F-14  add_roster_subgroup_range    refuse a backwards range or one over
--                                      366 days; skip past days by the Sydney
--                                      date, not the UTC one.
--   S-02  apply_template_to_date_range_v2  record the caller, not a
--                                      client-supplied p_user_id, as the actor.
--
-- Grants are restated as they are live: CREATE OR REPLACE must not widen them.

-- ── F-08 ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_bulk_publish_shifts(p_shift_ids uuid[], p_actor_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_total_count int;
    v_success_count int;
    v_actor_name text;
    v_actor_role text;
BEGIN
    -- authz guard (2026-10-13): every shift must be publishable by the caller —
    -- the check sm_publish_shift makes via sm_require_shift_action. Without it
    -- any signed-in user could publish any shift in any organisation, and name
    -- any actor. System callers (cron, service role) pass, as there.
    IF NOT public.sm_request_is_system() THEN
        p_actor_id := auth.uid();
        PERFORM public.sm_require_shift_action(sid, 'shift.publish') FROM unnest(p_shift_ids) AS sid;
    END IF;

    v_total_count := array_length(p_shift_ids, 1);

    IF p_actor_id IS NOT NULL THEN
        SELECT
            COALESCE(first_name || ' ' || COALESCE(last_name, ''), email),
            left(lower(legacy_system_role::text), 50)
        INTO v_actor_name, v_actor_role
        FROM profiles
        WHERE id = p_actor_id;
    ELSE
        v_actor_name := 'System';
        v_actor_role := 'system_automation';
    END IF;

    -- Lock first, then decide (2026-10-18). The state used to be read by
    -- get_shift_state_id() into this CTE and the UPDATE below re-checked only
    -- the id, so a shift changed by another manager between the two (assigned,
    -- unassigned, published) was rewritten from the stale state: S5 bidding
    -- columns onto a just-assigned shift; offer timestamps reset on a shift
    -- already published. FOR UPDATE (in id order, so two bulk publishes never
    -- deadlock) makes a concurrent writer wait, and the state is read from the
    -- LOCKED row, which READ COMMITTED returns at its latest committed version.
    -- The S1/S2 test is get_shift_state_id(uuid)'s own, inlined.
    WITH locked AS MATERIALIZED (
        SELECT
            s.id,
            s.assigned_employee_id,
            s.shift_date,
            s.target_employment_type,
            s.lifecycle_status,
            s.assignment_status,
            s.scheduled_start,
            s.start_at
        FROM shifts s
        WHERE s.id = ANY(p_shift_ids)
          AND s.deleted_at IS NULL
        ORDER BY s.id
        FOR UPDATE
    ),
    shift_calculations AS (
        SELECT
            l.id,
            l.assigned_employee_id,
            l.shift_date,
            l.target_employment_type = 'FT' AS is_ft,
            CASE
                WHEN l.lifecycle_status::text = 'Draft' AND l.assignment_status::text = 'unassigned' THEN 'S1'
                WHEN l.lifecycle_status::text = 'Draft' AND l.assignment_status::text = 'assigned' THEN 'S2'
            END as current_state,
            COALESCE(l.scheduled_start, l.start_at) as shift_start_tz,
            get_time_category(COALESCE(l.scheduled_start, l.start_at)) as time_cat
        FROM locked l
    ),
    valid_transitions AS (
        SELECT
            id,
            current_state,
            time_cat,
            CASE
                WHEN is_ft AND current_state = 'S2' THEN 'S4'
                WHEN is_ft THEN NULL
                WHEN current_state = 'S1' AND time_cat IN ('URGENT','NORMAL') THEN 'S5'
                WHEN current_state = 'S2' AND time_cat = 'EMERGENCY' THEN 'S4'
                WHEN current_state = 'S2' THEN 'S3'
                ELSE NULL
            END as new_state_id,
            CASE
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 4 THEN NOW()
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 24 THEN LEAST(NOW() + INTERVAL '4 hours', shift_start_tz - INTERVAL '4 hours')
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 48 THEN NOW() + INTERVAL '8 hours'
                ELSE NOW() + INTERVAL '12 hours'
            END as offer_deadline
        FROM shift_calculations
        WHERE current_state IN ('S1', 'S2')
          AND time_cat != 'PAST'
          AND NOT (current_state = 'S1' AND time_cat = 'EMERGENCY')
          -- Approved leave: an assigned shift is never published onto it.
          AND NOT (assigned_employee_id IS NOT NULL
                   AND public.employee_on_approved_leave(assigned_employee_id, shift_date))
    ),
    updated_rows AS (
        UPDATE shifts s
        SET
            lifecycle_status = 'Published',
            published_at = NOW(),
            last_modified_by = p_actor_id,
            updated_at = NOW(),
            bidding_status = CASE WHEN vt.new_state_id = 'S5' THEN 'on_bidding' ELSE s.bidding_status END,
            is_on_bidding = CASE WHEN vt.new_state_id = 'S5' THEN TRUE ELSE s.is_on_bidding END,
            bidding_open_at = CASE WHEN vt.new_state_id = 'S5' THEN NOW() ELSE s.bidding_open_at END,
            fulfillment_status = CASE
                WHEN vt.new_state_id = 'S5' THEN 'bidding'::shift_fulfillment_status
                WHEN vt.new_state_id = 'S4' THEN 'scheduled'::shift_fulfillment_status
                WHEN vt.new_state_id = 'S3' THEN 'offered'::shift_fulfillment_status
                ELSE s.fulfillment_status
            END,
            assignment_outcome = CASE
                WHEN vt.new_state_id = 'S4' THEN 'confirmed'
                WHEN vt.new_state_id = 'S3' THEN NULL
                ELSE s.assignment_outcome
            END,
            confirmed_at = CASE WHEN vt.new_state_id = 'S4' THEN NOW() ELSE s.confirmed_at END,
            offer_sent_at = CASE WHEN vt.new_state_id = 'S3' THEN NOW() ELSE s.offer_sent_at END,
            offer_expires_at = CASE WHEN vt.new_state_id = 'S3' THEN vt.offer_deadline ELSE s.offer_expires_at END
        FROM valid_transitions vt
        WHERE s.id = vt.id AND vt.new_state_id IS NOT NULL
        RETURNING s.id, vt.current_state, vt.new_state_id, vt.offer_deadline
    ),
    offers_update AS (
        UPDATE public.shift_offers so
        SET offer_expires_at = ur.offer_deadline
        FROM updated_rows ur
        WHERE so.shift_id = ur.id
          AND ur.new_state_id = 'S3'
          AND so.status = 'Pending'
        RETURNING so.id
    )
    SELECT count(*) INTO v_success_count FROM updated_rows;

    RETURN jsonb_build_object(
        'success', true,
        'total_requested', v_total_count,
        'success_count', v_success_count,
        'failure_count', v_total_count - v_success_count,
        'message', format('Successfully published %s of %s shifts', v_success_count, v_total_count)
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error in sm_bulk_publish_shifts: %', SQLERRM;
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.sm_bulk_publish_shifts(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sm_bulk_publish_shifts(uuid[], uuid) TO authenticated, service_role;

-- ── F-09 ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."trg_shift_notifications"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_was_published      BOOLEAN;
  v_is_published       BOOLEAN;
  v_is_cancelled       BOOLEAN;
  v_assignment_changed BOOLEAN;
  v_meaningful_edit    BOOLEAN;
BEGIN
  v_was_published    := OLD.lifecycle_status::TEXT IN ('Published', 'InProgress');
  v_is_published     := NEW.lifecycle_status::TEXT IN ('Published', 'InProgress');
  v_is_cancelled     := NEW.lifecycle_status::TEXT = 'Cancelled';

  v_assignment_changed := COALESCE(OLD.assigned_employee_id::TEXT, '')
                       <> COALESCE(NEW.assigned_employee_id::TEXT, '');

  v_meaningful_edit := (OLD.start_time IS DISTINCT FROM NEW.start_time)
                    OR (OLD.end_time   IS DISTINCT FROM NEW.end_time)
                    OR (OLD.role_id    IS DISTINCT FROM NEW.role_id);

  -- ── PUBLISHED PATHS ────────────────────────────────────────────────────
  IF v_is_published AND NEW.assigned_employee_id IS NOT NULL THEN

    -- Path A: Draft → Published + Assigned = OFFER (S3), which the employee
    -- must accept/decline in the Offers inbox — or CONFIRMED (S4) directly
    IF NOT v_was_published AND OLD.lifecycle_status::TEXT = 'Draft' THEN
      -- Published straight to Confirmed (a full-time shift, or one inside the
      -- 4h emergency window): there is no offer to accept, so do not tell the
      -- employee to accept or decline one (2026-10-18).
      IF NEW.assignment_outcome::TEXT IN ('confirmed', 'emergency_assigned') THEN
        PERFORM notify_user(
          NEW.assigned_employee_id,
          'shift_assigned',
          'Shift confirmed',
          'You are rostered on ' || TO_CHAR(NEW.shift_date, 'Dy DD Mon')
            || ' at ' || TO_CHAR(NEW.start_time, 'HH12:MI AM')
            || ' — this shift is confirmed; there is nothing to accept',
          NEW.id, 'shift', '/my-roster',
          'SHIFT_ASSIGNED_' || NEW.id::TEXT
        );
      ELSE
      PERFORM notify_user(
        NEW.assigned_employee_id,
        'shift_assigned',
        'New shift offer',
        'You have a shift offer on ' || TO_CHAR(NEW.shift_date, 'Dy DD Mon')
          || ' at ' || TO_CHAR(NEW.start_time, 'HH12:MI AM')
          || ' — check your Offers inbox to accept or decline',
        NEW.id, 'shift', '/my-roster',
        'SHIFT_ASSIGNED_' || NEW.id::TEXT
      );
      END IF;

    -- Path B: Reassignment while Published (old employee out, new employee in)
    ELSIF v_assignment_changed THEN
      IF OLD.assigned_employee_id IS NOT NULL THEN
        PERFORM notify_user(
          OLD.assigned_employee_id,
          'shift_cancelled',
          'Shift reassigned',
          'Your shift on ' || TO_CHAR(NEW.shift_date, 'Dy DD Mon')
            || ' has been reassigned to another employee',
          NEW.id, 'shift', '/my-roster',
          'SHIFT_REASSIGNED_OLD_' || NEW.id::TEXT
        );
      END IF;
      PERFORM notify_user(
        NEW.assigned_employee_id,
        'shift_assigned',
        'New shift offer',
        'You have a shift offer on ' || TO_CHAR(NEW.shift_date, 'Dy DD Mon')
          || ' at ' || TO_CHAR(NEW.start_time, 'HH12:MI AM')
          || ' — check your Offers inbox',
        NEW.id, 'shift', '/my-roster',
        'SHIFT_ASSIGNED_' || NEW.id::TEXT || '_TO_' || NEW.assigned_employee_id::TEXT
      );

    -- Path C: New assignment on already-Published shift (bid winner, emergency offer)
    ELSIF NOT v_assignment_changed AND NOT v_was_published
          AND OLD.assigned_employee_id IS NULL THEN
      PERFORM notify_user(
        NEW.assigned_employee_id,
        'shift_assigned',
        'New shift assigned',
        'You have been assigned a shift on ' || TO_CHAR(NEW.shift_date, 'Dy DD Mon')
          || ' at ' || TO_CHAR(NEW.start_time, 'HH12:MI AM'),
        NEW.id, 'shift', '/my-roster',
        'SHIFT_ASSIGNED_' || NEW.id::TEXT
      );

    -- Path D: Meaningful time/role edit on same-assignment Published shift
    ELSIF NOT v_assignment_changed AND v_meaningful_edit THEN
      PERFORM notify_user(
        NEW.assigned_employee_id,
        'shift_updated',
        'Shift updated',
        'Your shift on ' || TO_CHAR(NEW.shift_date, 'Dy DD Mon')
          || ' has been updated — please check the new details',
        NEW.id, 'shift', '/my-roster',
        'SHIFT_UPDATED_' || NEW.id::TEXT || '_'
          || MD5(
               COALESCE(NEW.start_time::TEXT, '') || '|' ||
               COALESCE(NEW.end_time::TEXT,   '') || '|' ||
               COALESCE(NEW.role_id::TEXT,    '')
             )
      );
    END IF;
  END IF;

  -- ── CANCELLATION (was Published, now Cancelled, had assignment) ──────────
  IF v_is_cancelled AND v_was_published AND OLD.assigned_employee_id IS NOT NULL THEN
    PERFORM notify_user(
      OLD.assigned_employee_id,
      'shift_cancelled',
      'Shift cancelled',
      'Your shift on ' || TO_CHAR(NEW.shift_date, 'Dy DD Mon')
        || ' at ' || TO_CHAR(OLD.start_time, 'HH12:MI AM')
        || ' has been cancelled',
      NEW.id, 'shift', '/my-roster',
      'SHIFT_CANCELLED_' || NEW.id::TEXT
    );
  END IF;

  -- Draft, Completed → intentionally silent
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_shift_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trg_shift_notifications() TO authenticated, service_role;

-- ── F-14 ─────────────────────────────────────────────────────────────────────
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
    -- Roster days are Sydney calendar days; CURRENT_DATE is the session's (UTC)
    -- date, a day behind Sydney every morning until 10–11 am.
    v_today DATE := (now() AT TIME ZONE 'Australia/Sydney')::date;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_scope('roster.edit', p_org_id, p_dept_id, p_sub_dept_id);
    -- A day per date in the range is created: refuse a backwards or unbounded one.
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
        RAISE EXCEPTION 'The date range is empty or backwards (% to %).', p_start_date, p_end_date
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_end_date - p_start_date + 1 > 366 THEN
        RAISE EXCEPTION 'A sub-group can be added to at most 366 days at once (asked for %).', p_end_date - p_start_date + 1
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
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
        IF v_current_date < v_today THEN
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

REVOKE ALL ON FUNCTION public.add_roster_subgroup_range(uuid, uuid, uuid, text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_roster_subgroup_range(uuid, uuid, uuid, text, text, date, date) TO authenticated, service_role;

-- ── S-02 ─────────────────────────────────────────────────────────────────────
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

REVOKE ALL ON FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid, boolean) TO authenticated, service_role;
