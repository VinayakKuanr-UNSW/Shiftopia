-- ============================================================================
-- Migration: reconcile_live_function_drift
-- Purpose:
--   Two live functions were overwritten outside any migration during the
--   2026-11-02 shifts column drops (applied ad hoc, never recorded), and both
--   lost behaviour the repo carries:
--
--   1. public.preview_template_application lost its authorization guard
--      (PERFORM public.sm_require_template_apply(...), added 20261017111129).
--      It is SECURITY DEFINER and EXECUTE-able by every authenticated user, so
--      any employee could preview any department's templates and roster.
--      Also restores the empty-range check and the Sydney "today".
--   2. public.sm_apply_shift_op lost half of its audit diff (shift_date, paid /
--      unpaid break, break window, sub_department_id, display_order). The
--      repo copy (20261102103000) still diffed remuneration_level, which
--      20261102120000 drops, so it would fail at runtime on a rebuild. This is
--      that copy without the remuneration_level block.
--
--   Both bodies are otherwise the repo's latest definitions, verbatim.
-- ============================================================================

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
