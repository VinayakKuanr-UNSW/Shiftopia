-- ============================================================================
-- Migration: 20261103213000_multi_unpaid_breaks_and_punch_concurrency.sql
-- Purpose:
--   1. Multi-unpaid break schedules (`unpaid_breaks` jsonb) on `public.shifts`
--      and `public.template_shifts`, bidirectionally synced with `break_start` /
--      `break_end`, with overnight-aware EBA window + 15m-increment validation.
--   2. Actual break punching (`public.timesheet_breaks`) with SQL-level
--      anti-double-punching (`idx_unique_open_break` WHERE `break_end IS NULL`),
--      geofencing OFF on break punches (`start_break_shift`, `end_break_shift`),
--      clock-out gate blocking open breaks while preserving NULL actuals when
--      unpunched, and atomic concurrency hardening across ALL punch operations.
--   3. Zero-fallback rule on `public.billables`: `unpaid_break_minutes` is
--      nullable, derived strictly from completed `timesheet_breaks` or NULL
--      when unpunched (NEVER falling back to scheduled `shifts`), with explicit
--      manager override support (`unpaid_break_is_manual`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema: `unpaid_breaks` on `shifts` & `template_shifts`
-- ----------------------------------------------------------------------------
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS unpaid_breaks jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.template_shifts
  ADD COLUMN IF NOT EXISTS unpaid_breaks jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill existing template_shifts that already carry a single break window
UPDATE public.template_shifts
   SET unpaid_breaks = jsonb_build_array(
         jsonb_build_object(
           'sno', 1,
           'start', to_char(break_start, 'HH24:MI'),
           'end', to_char(break_end, 'HH24:MI'),
           'duration', public.shift_minutes_after_start(break_start, break_end)
         )
       )
 WHERE break_start IS NOT NULL
   AND break_end IS NOT NULL
   AND (unpaid_breaks IS NULL OR unpaid_breaks = '[]'::jsonb);

-- Helper: sum total scheduled meal-break window minutes across `unpaid_breaks`
-- (overnight-safe via `shift_minutes_after_start`), falling back to
-- `break_start..break_end` or `p_fallback`.
CREATE OR REPLACE FUNCTION public.shift_breaks_total_minutes(
  p_unpaid_breaks jsonb,
  p_break_start time without time zone,
  p_break_end time without time zone,
  p_fallback integer DEFAULT 0
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_elem  jsonb;
  v_s     time;
  v_e     time;
  v_total integer := 0;
BEGIN
  IF p_unpaid_breaks IS NOT NULL
     AND jsonb_typeof(p_unpaid_breaks) = 'array'
     AND jsonb_array_length(p_unpaid_breaks) > 0 THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_unpaid_breaks)
    LOOP
      BEGIN
        v_s := NULLIF(btrim(COALESCE(v_elem->>'start', '')), '')::time;
        v_e := NULLIF(btrim(COALESCE(v_elem->>'end', '')), '')::time;
      EXCEPTION WHEN OTHERS THEN
        v_s := NULL;
        v_e := NULL;
      END;
      IF v_s IS NOT NULL AND v_e IS NOT NULL THEN
        v_total := v_total + public.shift_minutes_after_start(v_s, v_e);
      END IF;
    END LOOP;
    RETURN v_total;
  END IF;

  IF p_break_start IS NOT NULL AND p_break_end IS NOT NULL THEN
    RETURN public.shift_minutes_after_start(p_break_start, p_break_end);
  END IF;

  RETURN COALESCE(p_fallback, 0);
END;
$function$;

-- Helper: canonicalize `unpaid_breaks` JSONB array (`sno`, `start`, `end`, `duration`)
CREATE OR REPLACE FUNCTION public.fn_canonicalize_unpaid_breaks(p_breaks jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_elem   jsonb;
  v_idx    integer := 0;
  v_s_txt  text;
  v_e_txt  text;
  v_s_time time;
  v_e_time time;
  v_dur    integer;
  v_out    jsonb := '[]'::jsonb;
BEGIN
  IF p_breaks IS NULL OR jsonb_typeof(p_breaks) <> 'array' THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_breaks)
  LOOP
    v_idx   := v_idx + 1;
    v_s_txt := btrim(COALESCE(v_elem->>'start', ''));
    v_e_txt := btrim(COALESCE(v_elem->>'end', ''));

    IF v_s_txt = '' AND v_e_txt = '' THEN
      CONTINUE;
    END IF;

    v_dur := NULL;
    BEGIN
      IF v_s_txt <> '' THEN
        v_s_time := v_s_txt::time;
        v_s_txt  := to_char(v_s_time, 'HH24:MI');
      ELSE
        v_s_time := NULL;
      END IF;
      IF v_e_txt <> '' THEN
        v_e_time := v_e_txt::time;
        v_e_txt  := to_char(v_e_time, 'HH24:MI');
      ELSE
        v_e_time := NULL;
      END IF;
      IF v_s_time IS NOT NULL AND v_e_time IS NOT NULL THEN
        v_dur := public.shift_minutes_after_start(v_s_time, v_e_time);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_dur := NULL;
    END;

    v_out := v_out || jsonb_build_array(
      jsonb_build_object(
        'sno',      v_idx,
        'start',    v_s_txt,
        'end',      v_e_txt,
        'duration', COALESCE(v_dur, 0)
      )
    );
  END LOOP;

  RETURN v_out;
END;
$function$;

-- Bidirectional BEFORE trigger keeping `unpaid_breaks` and `break_start`/`break_end` synced
CREATE OR REPLACE FUNCTION public.fn_sync_shift_unpaid_breaks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_norm  jsonb;
  v_first jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.unpaid_breaks IS NOT NULL
       AND jsonb_typeof(NEW.unpaid_breaks) = 'array'
       AND jsonb_array_length(NEW.unpaid_breaks) > 0 THEN
      v_norm := public.fn_canonicalize_unpaid_breaks(NEW.unpaid_breaks);
      NEW.unpaid_breaks := v_norm;
      IF jsonb_array_length(v_norm) > 0 THEN
        v_first := v_norm->0;
        BEGIN
          NEW.break_start := NULLIF(v_first->>'start', '')::time;
        EXCEPTION WHEN OTHERS THEN
          NEW.break_start := NULL;
        END;
        BEGIN
          NEW.break_end := NULLIF(v_first->>'end', '')::time;
        EXCEPTION WHEN OTHERS THEN
          NEW.break_end := NULL;
        END;
      ELSE
        NEW.break_start := NULL;
        NEW.break_end   := NULL;
      END IF;
    ELSIF NEW.break_start IS NOT NULL AND NEW.break_end IS NOT NULL THEN
      NEW.unpaid_breaks := jsonb_build_array(
        jsonb_build_object(
          'sno',      1,
          'start',    to_char(NEW.break_start, 'HH24:MI'),
          'end',      to_char(NEW.break_end, 'HH24:MI'),
          'duration', public.shift_minutes_after_start(NEW.break_start, NEW.break_end)
        )
      );
    ELSE
      NEW.unpaid_breaks := '[]'::jsonb;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.unpaid_breaks IS DISTINCT FROM OLD.unpaid_breaks THEN
      v_norm := public.fn_canonicalize_unpaid_breaks(NEW.unpaid_breaks);
      NEW.unpaid_breaks := v_norm;
      IF jsonb_array_length(v_norm) > 0 THEN
        v_first := v_norm->0;
        BEGIN
          NEW.break_start := NULLIF(v_first->>'start', '')::time;
        EXCEPTION WHEN OTHERS THEN
          NEW.break_start := NULL;
        END;
        BEGIN
          NEW.break_end := NULLIF(v_first->>'end', '')::time;
        EXCEPTION WHEN OTHERS THEN
          NEW.break_end := NULL;
        END;
      ELSE
        NEW.break_start := NULL;
        NEW.break_end   := NULL;
      END IF;
    ELSIF NEW.break_start IS DISTINCT FROM OLD.break_start
       OR NEW.break_end   IS DISTINCT FROM OLD.break_end THEN
      IF NEW.break_start IS NOT NULL AND NEW.break_end IS NOT NULL THEN
        NEW.unpaid_breaks := jsonb_build_array(
          jsonb_build_object(
            'sno',      1,
            'start',    to_char(NEW.break_start, 'HH24:MI'),
            'end',      to_char(NEW.break_end, 'HH24:MI'),
            'duration', public.shift_minutes_after_start(NEW.break_start, NEW.break_end)
          )
        );
      ELSE
        NEW.unpaid_breaks := '[]'::jsonb;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_00_sync_unpaid_breaks ON public.shifts;
CREATE TRIGGER trg_00_sync_unpaid_breaks
  BEFORE INSERT OR UPDATE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_shift_unpaid_breaks();

DROP TRIGGER IF EXISTS trg_00_sync_unpaid_breaks ON public.template_shifts;
CREATE TRIGGER trg_00_sync_unpaid_breaks
  BEFORE INSERT OR UPDATE ON public.template_shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_shift_unpaid_breaks();

-- ----------------------------------------------------------------------------
-- 2. Overnight-Aware Multi-Break Shape Backstop (`shift_break_window_breach`)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shift_break_window_breach(
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_unpaid_break integer,
  p_break_start time without time zone,
  p_break_end time without time zone,
  p_unpaid_breaks jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_gross     integer;
  v_breaks    jsonb;
  v_elem      jsonb;
  v_s_txt     text;
  v_e_txt     text;
  v_b_start   time;
  v_b_end     time;
  v_dur       integer;
  v_from      integer;
  v_to        integer;
  v_prev_to   integer := 0;
  v_total_dur integer := 0;
BEGIN
  IF p_start_time IS NULL OR p_end_time IS NULL THEN
    RETURN NULL;
  END IF;

  v_gross := public.shift_net_minutes(p_start_time, p_end_time, 0);

  IF p_unpaid_breaks IS NOT NULL
     AND jsonb_typeof(p_unpaid_breaks) = 'array'
     AND jsonb_array_length(p_unpaid_breaks) > 0 THEN
    v_breaks := p_unpaid_breaks;
  ELSIF (p_break_start IS NULL) <> (p_break_end IS NULL) THEN
    RETURN 'A meal break needs both a start and an end time.';
  ELSIF p_break_start IS NOT NULL AND p_break_end IS NOT NULL THEN
    v_breaks := jsonb_build_array(
      jsonb_build_object(
        'start', to_char(p_break_start, 'HH24:MI'),
        'end',   to_char(p_break_end, 'HH24:MI')
      )
    );
  ELSE
    v_breaks := '[]'::jsonb;
  END IF;

  IF jsonb_array_length(v_breaks) = 0 THEN
    IF COALESCE(p_unpaid_break, 0) > 0 THEN
      RETURN 'An unpaid break needs its start and end time — pay depends on when it is taken.';
    END IF;
    IF v_gross > 300 THEN
      RETURN 'A shift longer than 5 hours needs a meal break of 30 to 60 minutes, with its start and end time (EBA cl 36.1).';
    END IF;
    RETURN NULL;
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_breaks)
  LOOP
    v_s_txt := NULLIF(btrim(COALESCE(v_elem->>'start', '')), '');
    v_e_txt := NULLIF(btrim(COALESCE(v_elem->>'end', '')), '');
    IF v_s_txt IS NULL OR v_e_txt IS NULL THEN
      RETURN 'A meal break needs both a start and an end time.';
    END IF;

    BEGIN
      v_b_start := v_s_txt::time;
      v_b_end   := v_e_txt::time;
    EXCEPTION WHEN OTHERS THEN
      RETURN 'Invalid break time format.';
    END;

    -- Overnight-aware span and shift-relative offsets:
    -- e.g. Shift 22:00..06:00 (gross=480), Break 23:45..00:15:
    --   v_dur = 30, v_from = 105, v_to = 135, v_from + v_dur = 135 < 480.
    v_dur  := public.shift_minutes_after_start(v_b_start, v_b_end);
    v_from := public.shift_minutes_after_start(p_start_time, v_b_start);
    v_to   := public.shift_minutes_after_start(p_start_time, v_b_end);

    IF v_dur <= 0 OR v_from <= 0 OR (v_from + v_dur) <> v_to OR v_to >= v_gross THEN
      RETURN 'The meal break must start after the shift starts and end before it finishes.';
    END IF;

    IF v_from <= v_prev_to THEN
      RETURN 'Multiple unpaid breaks must be in chronological order and cannot overlap or touch.';
    END IF;

    IF v_dur NOT BETWEEN 30 AND 60 THEN
      RETURN 'A meal break must be 30 to 60 minutes long (EBA cl 36.1).';
    END IF;

    IF (v_dur % 15) <> 0 THEN
      RETURN 'Unpaid break duration must be in 15-minute increments.';
    END IF;

    v_prev_to   := v_to;
    v_total_dur := v_total_dur + v_dur;
  END LOOP;

  IF COALESCE(p_unpaid_break, 0) NOT IN (0, v_total_dur) THEN
    RETURN 'The unpaid break must equal the meal-break window total, or be 0 where the meal break is paid.';
  END IF;

  RETURN NULL;
END;
$function$;

-- Keep 5-arg overload delegating to 6-arg for any external SQL callers
CREATE OR REPLACE FUNCTION public.shift_break_window_breach(
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_unpaid_break integer,
  p_break_start time without time zone,
  p_break_end time without time zone
)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.shift_break_window_breach(
    p_start_time,
    p_end_time,
    p_unpaid_break,
    p_break_start,
    p_break_end,
    NULL::jsonb
  );
$function$;

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_shape_break_window;
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_shape_break_window CHECK (
    public.shift_break_window_breach(
      start_time,
      end_time,
      unpaid_break_minutes,
      break_start,
      break_end,
      unpaid_breaks
    ) IS NULL
  );

ALTER TABLE public.template_shifts DROP CONSTRAINT IF EXISTS template_shifts_break_window;
ALTER TABLE public.template_shifts
  ADD CONSTRAINT template_shifts_break_window CHECK (
    public.shift_break_window_breach(
      start_time,
      end_time,
      unpaid_break_minutes,
      break_start,
      break_end,
      unpaid_breaks
    ) IS NULL
  );

-- ----------------------------------------------------------------------------
-- 3. Update Shift Planning Gateways, Compliance Triggers & Templates
-- ----------------------------------------------------------------------------
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
    v_unpaid_breaks jsonb;
BEGIN
  PERFORM public.sm_require_shift_data_action(p_shift_data, 'shift.create');
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

    v_unpaid_breaks := CASE
        WHEN p_shift_data ? 'unpaid_breaks' AND jsonb_typeof(p_shift_data->'unpaid_breaks') = 'array'
        THEN p_shift_data->'unpaid_breaks'
        ELSE '[]'::jsonb
    END;

    PERFORM set_config('app.audit.via_gateway', '1', true);

    INSERT INTO shifts (
        roster_id, department_id, shift_date, start_time, end_time,
        organization_id, sub_department_id, display_order,
        shift_group_id, roster_subgroup_id, role_id,
        paid_break_minutes, unpaid_break_minutes, break_start, break_end, unpaid_breaks, timezone,
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
        COALESCE((p_shift_data->>'paid_break_minutes')::integer, 0),
        COALESCE((p_shift_data->>'unpaid_break_minutes')::integer, 0),
        NULLIF(p_shift_data->>'break_start', '')::time,
        NULLIF(p_shift_data->>'break_end', '')::time,
        v_unpaid_breaks,
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

    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_emp::text));

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
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_cur.assigned_employee_id::text));

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
        UPDATE public.shifts SET
          lifecycle_status       = 'Published'::public.shift_lifecycle,
          fulfillment_status     = 'scheduled'::public.shift_fulfillment_status,
          assignment_outcome     = 'confirmed'::public.shift_assignment_outcome,
          bidding_status         = 'not_on_bidding'::public.shift_bidding_status,
          published_at           = NOW(),
          last_modified_by       = p_actor,
          updated_at             = NOW()
        WHERE id = p_shift_id;
      ELSE
        INSERT INTO public.shift_offers (shift_id, employee_id, status)
        VALUES (p_shift_id, v_cur.assigned_employee_id, 'pending')
        ON CONFLICT DO NOTHING;

        UPDATE public.shifts SET
          lifecycle_status       = 'Published'::public.shift_lifecycle,
          fulfillment_status     = 'scheduled'::public.shift_fulfillment_status,
          assignment_outcome     = NULL,
          offer_sent_at          = NOW(),
          offer_expires_at       = NOW() + INTERVAL '48 hours',
          bidding_status         = 'not_on_bidding'::public.shift_bidding_status,
          published_at           = NOW(),
          last_modified_by       = p_actor,
          updated_at             = NOW()
        WHERE id = p_shift_id;
      END IF;
    ELSE
      UPDATE public.shifts SET
        lifecycle_status     = 'Published'::public.shift_lifecycle,
        fulfillment_status   = 'unfilled'::public.shift_fulfillment_status,
        bidding_status       = 'open'::public.shift_bidding_status,
        published_at         = NOW(),
        last_modified_by     = p_actor,
        updated_at           = NOW()
      WHERE id = p_shift_id;
    END IF;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'unpublish' THEN
    UPDATE public.shift_offers SET status = 'cancelled', updated_at = NOW()
    WHERE shift_id = p_shift_id AND status = 'pending';

    UPDATE public.shifts SET
      lifecycle_status     = 'Draft'::public.shift_lifecycle,
      fulfillment_status   = 'none'::public.shift_fulfillment_status,
      assignment_outcome   = NULL,
      bidding_status       = 'not_on_bidding'::public.shift_bidding_status,
      offer_sent_at        = NULL,
      offer_expires_at     = NULL,
      published_at         = NULL,
      last_modified_by     = p_actor,
      last_modified_reason = COALESCE(p_payload->>'reason', 'Unpublished via shift gateway'),
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'accept_offer' THEN
    UPDATE public.shift_offers SET status = 'accepted', responded_at = NOW(), updated_at = NOW()
    WHERE shift_id = p_shift_id AND employee_id = v_cur.assigned_employee_id AND status = 'pending';

    UPDATE public.shifts SET
      assignment_outcome = 'confirmed'::public.shift_assignment_outcome,
      confirmed_at       = NOW(),
      last_modified_by   = p_actor,
      updated_at         = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'reject_offer' THEN
    UPDATE public.shift_offers SET
      status = 'rejected', responded_at = NOW(),
      response_notes = p_payload->>'reason', updated_at = NOW()
    WHERE shift_id = p_shift_id AND employee_id = v_cur.assigned_employee_id AND status = 'pending';

    UPDATE public.shifts SET
      assigned_employee_id = NULL,
      assigned_at          = NULL,
      assignment_status    = 'unassigned'::public.shift_assignment_status,
      assignment_outcome   = NULL,
      fulfillment_status   = 'unfilled'::public.shift_fulfillment_status,
      last_rejected_by     = v_cur.assigned_employee_id,
      bidding_status       = 'open'::public.shift_bidding_status,
      last_modified_by     = p_actor,
      last_modified_reason = COALESCE(p_payload->>'reason', 'Offer rejected by employee'),
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'expire_offer' THEN
    UPDATE public.shift_offers SET status = 'expired', updated_at = NOW()
    WHERE shift_id = p_shift_id AND status = 'pending';

    UPDATE public.shifts SET
      assigned_employee_id = NULL,
      assigned_at          = NULL,
      assignment_status    = 'unassigned'::public.shift_assignment_status,
      assignment_outcome   = NULL,
      fulfillment_status   = 'unfilled'::public.shift_fulfillment_status,
      last_dropped_by      = v_cur.assigned_employee_id,
      bidding_status       = 'open'::public.shift_bidding_status,
      last_modified_by     = p_actor,
      last_modified_reason = 'Offer expired',
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'request_trade' THEN
    UPDATE public.shifts SET
      trading_status     = 'TradeRequested'::public.shift_trading,
      trade_requested_at = NOW(),
      last_modified_by   = p_actor,
      updated_at         = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'cancel_trade' THEN
    UPDATE public.shift_swaps SET
      status = 'CANCELLED'::public.swap_request_status,
      reason = COALESCE(p_payload->>'reason', 'Trade request cancelled'),
      status_changed_at = NOW(),
      updated_at = NOW()
    WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
      AND status IN ('PENDING', 'MANAGER_PENDING');

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
      trading_status     = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL,
      last_modified_by   = p_actor,
      updated_at         = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'drop_shift' THEN
    IF ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
          AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours' <= NOW() THEN
      UPDATE public.shifts SET
        assigned_employee_id = NULL,
        assigned_at          = NULL,
        assignment_status    = 'unassigned'::public.shift_assignment_status,
        assignment_outcome   = NULL,
        fulfillment_status   = 'unfilled'::public.shift_fulfillment_status,
        last_dropped_by      = v_cur.assigned_employee_id,
        bidding_status       = 'open'::public.shift_bidding_status,
        last_modified_by     = p_actor,
        last_modified_reason = COALESCE(p_payload->>'reason', 'Late drop - opened for emergency bidding'),
        updated_at           = NOW()
      WHERE id = p_shift_id;
    ELSE
      UPDATE public.shifts SET
        assigned_employee_id = NULL,
        assigned_at          = NULL,
        assignment_status    = 'unassigned'::public.shift_assignment_status,
        assignment_outcome   = NULL,
        fulfillment_status   = 'unfilled'::public.shift_fulfillment_status,
        last_dropped_by      = v_cur.assigned_employee_id,
        bidding_status       = 'open'::public.shift_bidding_status,
        last_modified_by     = p_actor,
        last_modified_reason = COALESCE(p_payload->>'reason', 'Dropped by employee'),
        updated_at           = NOW()
      WHERE id = p_shift_id;
    END IF;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'select_winner' THEN
    v_winner := COALESCE(NULLIF(p_payload->>'winner_id', ''), NULLIF(p_payload->>'employee_id', ''))::uuid;
    IF v_winner IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'MISSING_WINNER_ID');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_winner::text));

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
      fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
      last_modified_by     = p_actor,
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'edit' THEN
    IF NOT (p_payload ?| ARRAY[
      'start_time','end_time','shift_date','paid_break_minutes',
      'unpaid_break_minutes','break_start','break_end','unpaid_breaks',
      'notes','role_id','sub_department_id',
      'display_order',
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
      p_payload ? 'break_start' OR p_payload ? 'break_end' OR p_payload ? 'unpaid_breaks'
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
      unpaid_breaks         = CASE
                                WHEN p_payload ? 'unpaid_breaks' THEN
                                  CASE WHEN jsonb_typeof(p_payload->'unpaid_breaks') = 'array'
                                       THEN p_payload->'unpaid_breaks'
                                       ELSE '[]'::jsonb
                                  END
                                ELSE unpaid_breaks
                              END,
      notes                 = CASE WHEN p_payload ? 'notes' THEN p_payload->>'notes' ELSE notes END,
      role_id               = COALESCE(NULLIF(p_payload->>'role_id','')::uuid, role_id),
      sub_department_id     = COALESCE(NULLIF(p_payload->>'sub_department_id','')::uuid, sub_department_id),
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

CREATE OR REPLACE FUNCTION internal.trg_shift_eba_compliance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_cur  public.shifts%ROWTYPE;
    v_key  text;
    v_done text;
    v_hit  record;
    v_name text;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.assigned_employee_id     IS NOT DISTINCT FROM OLD.assigned_employee_id
       AND NEW.shift_date               IS NOT DISTINCT FROM OLD.shift_date
       AND NEW.start_time               IS NOT DISTINCT FROM OLD.start_time
       AND NEW.end_time                 IS NOT DISTINCT FROM OLD.end_time
       AND NEW.break_start              IS NOT DISTINCT FROM OLD.break_start
       AND NEW.break_end                IS NOT DISTINCT FROM OLD.break_end
       AND NEW.unpaid_breaks            IS NOT DISTINCT FROM OLD.unpaid_breaks
       AND NEW.unpaid_break_minutes     IS NOT DISTINCT FROM OLD.unpaid_break_minutes
       AND NEW.paid_break_minutes       IS NOT DISTINCT FROM OLD.paid_break_minutes
       AND NEW.role_id                  IS NOT DISTINCT FROM OLD.role_id
       AND NEW.sub_department_id        IS NOT DISTINCT FROM OLD.sub_department_id
       AND NEW.target_employment_type   IS NOT DISTINCT FROM OLD.target_employment_type
       AND NEW.target_requires_flexible IS NOT DISTINCT FROM OLD.target_requires_flexible
       AND NEW.is_training              IS NOT DISTINCT FROM OLD.is_training
       AND NEW.user_contract_id         IS NOT DISTINCT FROM OLD.user_contract_id
       AND NEW.required_skills          IS NOT DISTINCT FROM OLD.required_skills
       AND NEW.required_licenses        IS NOT DISTINCT FROM OLD.required_licenses
       AND NOT (NEW.lifecycle_status = 'Published' AND OLD.lifecycle_status IS DISTINCT FROM 'Published')
       AND NOT (COALESCE(OLD.is_cancelled, false) AND NOT COALESCE(NEW.is_cancelled, false))
    THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_cur FROM public.shifts s WHERE s.id = NEW.id;
    IF NOT FOUND
       OR v_cur.assigned_employee_id IS NULL
       OR COALESCE(v_cur.is_cancelled, false)
       OR v_cur.lifecycle_status = 'Cancelled' THEN
        RETURN NULL;
    END IF;

    v_key  := v_cur.id::text || ':' || v_cur.version::text;
    v_done := COALESCE(current_setting('eba.checked', true), '');
    IF strpos(v_done, v_key) > 0 THEN
        RETURN NULL;
    END IF;
    PERFORM set_config('eba.checked', v_done || ',' || v_key, true);

    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_cur.assigned_employee_id::text));

    SELECT r.rule_id, r.details INTO v_hit
      FROM internal.eba_check_assignment(v_cur.id, v_cur.assigned_employee_id) WITH ORDINALITY AS r(is_compliant, rule_id, rule_name, tier, summary, details, payload, eba_ord)
     WHERE r.tier = 'BLOCKING'
     ORDER BY r.eba_ord
     LIMIT 1;

    IF FOUND THEN
        SELECT NULLIF(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '')
          INTO v_name FROM public.profiles p WHERE p.id = v_cur.assigned_employee_id;
        RAISE EXCEPTION '% cannot work the shift on % (%–%): %',
            COALESCE(v_name, 'This employee'),
            to_char(v_cur.shift_date, 'Dy FMDD Mon'),
            to_char(v_cur.start_time, 'HH24:MI'),
            to_char(v_cur.end_time, 'HH24:MI'),
            v_hit.details
            USING ERRCODE = 'check_violation', HINT = 'EBA_COMPLIANCE:' || v_hit.rule_id;
    END IF;

    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION internal.eba_check_assignment(
  p_shift_id uuid,
  p_employee_id uuid,
  p_shift_date date DEFAULT NULL::date,
  p_start_time time without time zone DEFAULT NULL::time without time zone,
  p_end_time time without time zone DEFAULT NULL::time without time zone,
  p_unpaid_break_mins integer DEFAULT NULL::integer,
  p_role_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(is_compliant boolean, rule_id text, rule_name text, tier text, summary text, details text, payload jsonb)
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift        public.shifts%ROWTYPE;
    v_contract     hr.user_contracts%ROWTYPE;
    v_date         date;
    v_start        time;
    v_end          time;
    v_unpaid       integer;
    v_role         uuid;
    v_status       text;
    v_type         text;
    v_security     boolean;
    v_all_salaried boolean;
    v_facts        jsonb;
    v_shifts       jsonb;
    v_rows         integer := 0;
    v_n            integer;
    v_other        record;
    v_role_status  text;
    v_target_ok    boolean;
    v_held         text;
BEGIN
    IF p_employee_id IS NULL THEN
        RETURN QUERY SELECT true, NULL::text, NULL::text, NULL::text, 'No employee assigned'::text, 'Shift has no assigned employee.'::text, '{}'::jsonb;
        RETURN;
    END IF;

    IF p_shift_id IS NOT NULL THEN
        SELECT * INTO v_shift FROM public.shifts s WHERE s.id = p_shift_id;
    END IF;

    v_date   := COALESCE(p_shift_date, v_shift.shift_date);
    v_start  := COALESCE(p_start_time, v_shift.start_time);
    v_end    := COALESCE(p_end_time, v_shift.end_time);
    v_unpaid := COALESCE(p_unpaid_break_mins, v_shift.unpaid_break_minutes, 0);
    v_role   := COALESCE(p_role_id, v_shift.role_id);

    IF v_date IS NULL OR v_start IS NULL OR v_end IS NULL THEN
        RETURN QUERY SELECT true, NULL::text, NULL::text, NULL::text, 'Incomplete shift details'::text, 'Shift missing date or start/end time.'::text, '{}'::jsonb;
        RETURN;
    END IF;

    SELECT uc.* INTO v_contract
      FROM hr.user_contracts uc
     WHERE uc.user_id = p_employee_id
       AND (uc.id = v_shift.user_contract_id
            OR (uc.start_date <= v_date
                AND (uc.end_date IS NULL OR uc.end_date >= v_date)
                AND (v_shift.sub_department_id IS NULL
                     OR uc.sub_department_id = v_shift.sub_department_id
                     OR uc.sub_department_id IS NULL)))
     ORDER BY (uc.id = v_shift.user_contract_id) IS TRUE DESC,
              (public.fn_normalize_employment_type(uc.employment_status::text)
                   IS NOT DISTINCT FROM v_shift.target_employment_type) DESC,
              (uc.role_id IS NOT DISTINCT FROM v_role) DESC,
              (uc.sub_department_id IS NOT DISTINCT FROM v_shift.sub_department_id) DESC,
              uc.remuneration_level DESC NULLS LAST,
              uc.id
     LIMIT 1;

    v_status := COALESCE(v_contract.employment_status::text,
                         (SELECT p.employment_type::text FROM public.profiles p WHERE p.id = p_employee_id));
    v_type := CASE WHEN lower(COALESCE(v_status, '')) LIKE 'flexible%' THEN 'FLEXI_PART_TIME'
                   WHEN lower(COALESCE(v_status, '')) LIKE 'full%'     THEN 'FULL_TIME'
                   WHEN lower(COALESCE(v_status, '')) LIKE 'part%'     THEN 'PART_TIME'
                   ELSE 'CASUAL' END;

    v_security := EXISTS (SELECT 1 FROM public.roles r WHERE r.id = v_role AND r.name ILIKE '%security%')
               OR EXISTS (SELECT 1 FROM hr.user_contracts uc JOIN public.roles r ON r.id = uc.role_id
                           WHERE uc.user_id = p_employee_id AND uc.status = 'Active' AND r.name ILIKE '%security%');

    SELECT COUNT(*) > 0 AND bool_and(COALESCE(uc.pay_basis = 'salary', false)) INTO v_all_salaried
      FROM hr.user_contracts uc WHERE uc.user_id = p_employee_id AND uc.status = 'Active';
    v_all_salaried := COALESCE(v_all_salaried, false);

    v_facts := jsonb_build_object(
        'contract_type', v_type,
        'is_security',   v_security,
        'rest_gap_8h',   COALESCE((SELECT p.rest_gap_agreement_8h FROM public.profiles p WHERE p.id = p_employee_id), false),
        'student_visa',  EXISTS (SELECT 1 FROM public.employee_licenses el
                                  WHERE el.employee_id = p_employee_id
                                    AND el.license_type = 'WorkRights'
                                    AND el.has_restricted_work_limit
                                    AND (el.expiration_date IS NULL OR el.expiration_date >= v_date)),
        'cycle_weeks',   v_contract.ordinary_hours_cycle_weeks,
        'cycle_anchor',  v_contract.ordinary_hours_cycle_anchor);

    SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_shifts FROM (
        SELECT s.id, s.shift_date, s.start_time, s.end_time,
               s.unpaid_break_minutes, s.paid_break_minutes,
               public.shift_breaks_total_minutes(s.unpaid_breaks, s.break_start, s.break_end, s.unpaid_break_minutes) AS meal_break_minutes,
               COALESCE(s.is_training, false) AS is_training,
               COALESCE(uc.engagement_kind = 'multi_hire', false) AS is_multi_hire,
               COALESCE(uc.pay_basis = 'salary', v_all_salaried) AS is_salaried,
               false AS is_candidate
          FROM public.shifts s
          LEFT JOIN hr.user_contracts uc ON uc.id = s.user_contract_id AND uc.user_id = p_employee_id
         WHERE s.assigned_employee_id = p_employee_id
           AND s.id IS DISTINCT FROM p_shift_id
           AND NOT COALESCE(s.is_cancelled, false)
           AND s.lifecycle_status <> 'Cancelled'
           AND s.shift_date BETWEEN v_date - 56 AND v_date + 56
        UNION ALL
        SELECT p_shift_id, v_date, v_start, v_end, v_unpaid, COALESCE(v_shift.paid_break_minutes, 0),
               CASE
                 WHEN p_unpaid_break_mins IS NOT NULL AND p_unpaid_break_mins > 0 THEN p_unpaid_break_mins
                 ELSE public.shift_breaks_total_minutes(v_shift.unpaid_breaks, v_shift.break_start, v_shift.break_end, v_unpaid)
               END,
               COALESCE(v_shift.is_training, false),
               COALESCE(v_contract.engagement_kind = 'multi_hire', false),
               COALESCE(v_contract.pay_basis = 'salary', v_all_salaried),
               true
    ) x;

    RETURN QUERY
    SELECT false, 'V8_LEAVE_CONFLICT'::text, 'Approved Leave'::text, 'BLOCKING'::text,
           'Employee is on approved leave'::text,
           format('This shift falls on %s, a day the employee has approved %s leave. Approved leave is a hard unavailability — unassign the leave or pick another employee.',
                  to_char(v_date, 'YYYY-MM-DD'), replace(lr.leave_type, '_', ' ')),
           jsonb_build_object('leave_type', lr.leave_type, 'date', v_date)
      FROM public.leave_requests lr
     WHERE lr.employee_id = p_employee_id
       AND lr.status = 'approved'
       AND v_date BETWEEN (lr.start_date AT TIME ZONE 'UTC')::date AND (lr.end_date AT TIME ZONE 'UTC')::date;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rows := v_rows + v_n;

    IF p_shift_id IS NOT NULL THEN
        FOR v_other IN
            WITH req AS (
                SELECT ss.skill_id FROM public.shift_skills ss WHERE ss.shift_id = p_shift_id
                UNION
                SELECT (jsonb_array_elements_text(v_shift.required_skills))::uuid
                 WHERE jsonb_typeof(v_shift.required_skills) = 'array'
            )
            SELECT req.skill_id, sk.name AS skill_name,
                   EXISTS (SELECT 1 FROM public.employee_skills es WHERE es.employee_id = p_employee_id AND es.skill_id = req.skill_id) AS is_held,
                   (SELECT MAX(es.expiration_date) FROM public.employee_skills es WHERE es.employee_id = p_employee_id AND es.skill_id = req.skill_id) AS expires
              FROM req JOIN public.skills sk ON sk.id = req.skill_id
        LOOP
            IF NOT v_other.is_held THEN
                v_rows := v_rows + 1;
                RETURN QUERY SELECT false, 'V8_QUALIFICATIONS'::text, 'Qualifications'::text, 'BLOCKING'::text,
                    'Missing required skill'::text,
                    format('Required skill "%s" not held by employee.', v_other.skill_name),
                    jsonb_build_object('skill_id', v_other.skill_id, 'skill_name', v_other.skill_name);
            ELSIF v_other.expires IS NOT NULL AND v_other.expires < v_date THEN
                v_rows := v_rows + 1;
                RETURN QUERY SELECT false, 'V8_QUALIFICATION_EXPIRED'::text, 'Expired Qualification'::text, 'BLOCKING'::text,
                    'Required skill expired before shift date'::text,
                    format('Skill "%s" expired on %s before shift date %s.', v_other.skill_name, to_char(v_other.expires, 'YYYY-MM-DD'), to_char(v_date, 'YYYY-MM-DD')),
                    jsonb_build_object('skill_id', v_other.skill_id, 'skill_name', v_other.skill_name, 'expiration_date', v_other.expires);
            END IF;
        END LOOP;

        FOR v_other IN
            WITH req AS (
                SELECT sl.license_id FROM public.shift_licenses sl WHERE sl.shift_id = p_shift_id AND COALESCE(sl.is_required, true)
                UNION
                SELECT (jsonb_array_elements_text(v_shift.required_licenses))::uuid
                 WHERE jsonb_typeof(v_shift.required_licenses) = 'array'
            )
            SELECT req.license_id, l.name AS license_name,
                   EXISTS (SELECT 1 FROM public.employee_licenses el WHERE el.employee_id = p_employee_id AND el.license_id = req.license_id) AS is_held,
                   (SELECT MAX(el.expiration_date) FROM public.employee_licenses el WHERE el.employee_id = p_employee_id AND el.license_id = req.license_id) AS expires
              FROM req JOIN public.licenses l ON l.id = req.license_id
        LOOP
            IF NOT v_other.is_held THEN
                v_rows := v_rows + 1;
                RETURN QUERY SELECT false, 'V8_QUALIFICATIONS'::text, 'Qualifications'::text, 'BLOCKING'::text,
                    'Missing required license'::text,
                    format('Required license "%s" not held by employee.', v_other.license_name),
                    jsonb_build_object('license_id', v_other.license_id, 'license_name', v_other.license_name);
            ELSIF v_other.expires IS NOT NULL AND v_other.expires < v_date THEN
                v_rows := v_rows + 1;
                RETURN QUERY SELECT false, 'V8_QUALIFICATION_EXPIRED'::text, 'Expired Qualification'::text, 'BLOCKING'::text,
                    'Required license expired before shift date'::text,
                    format('License "%s" expired on %s before shift date %s.', v_other.license_name, to_char(v_other.expires, 'YYYY-MM-DD'), to_char(v_date, 'YYYY-MM-DD')),
                    jsonb_build_object('license_id', v_other.license_id, 'license_name', v_other.license_name, 'expiration_date', v_other.expires);
            END IF;
        END LOOP;
    END IF;

    IF NULLIF(v_shift.target_employment_type, '') IS NOT NULL THEN
        SELECT uc.employment_status::text INTO v_role_status
          FROM hr.user_contracts uc
         WHERE uc.user_id = p_employee_id
           AND uc.status = 'Active'
           AND uc.role_id = v_role
           AND (v_shift.sub_department_id IS NULL OR uc.sub_department_id = v_shift.sub_department_id OR uc.sub_department_id IS NULL)
         ORDER BY (uc.sub_department_id IS NOT DISTINCT FROM v_shift.sub_department_id) DESC,
                  (uc.sub_department_id IS NOT NULL) DESC,
                  uc.id
         LIMIT 1;

        IF v_role_status IS NOT NULL THEN
            v_held := v_role_status;
            v_target_ok := public.fn_normalize_employment_type(v_role_status) = v_shift.target_employment_type
                       AND (NOT COALESCE(v_shift.target_requires_flexible, false) OR lower(btrim(v_role_status)) LIKE 'flexible%');
        ELSE
            SELECT string_agg(DISTINCT uc.employment_status::text, ', '),
                   COALESCE(bool_or(public.fn_normalize_employment_type(uc.employment_status::text) = v_shift.target_employment_type
                                    AND (NOT COALESCE(v_shift.target_requires_flexible, false)
                                         OR lower(btrim(uc.employment_status::text)) LIKE 'flexible%')), false)
              INTO v_held, v_target_ok
              FROM hr.user_contracts uc
             WHERE uc.user_id = p_employee_id
               AND uc.status = 'Active'
               AND (v_shift.sub_department_id IS NULL OR uc.sub_department_id = v_shift.sub_department_id OR uc.sub_department_id IS NULL);
        END IF;

        IF NOT v_target_ok THEN
            v_rows := v_rows + 1;
            RETURN QUERY SELECT false, 'V8_EMPLOYMENT_TARGET'::text, 'Employment Target'::text, 'BLOCKING'::text,
                CASE WHEN COALESCE(v_shift.target_requires_flexible, false) THEN 'Requires Flexible Part-Time' ELSE 'Employment target mismatch' END,
                format('This shift is for %s staff, but the employee holds %s for this %s.',
                       CASE WHEN COALESCE(v_shift.target_requires_flexible, false) THEN 'Flexible Part-Time' ELSE v_shift.target_employment_type END,
                       COALESCE(v_held, 'no active contract'),
                       CASE WHEN v_role_status IS NOT NULL THEN 'role' ELSE 'sub-department' END),
                jsonb_build_object('target_employment_type', v_shift.target_employment_type, 'employee_status', v_held);
        END IF;
    END IF;

    RETURN QUERY SELECT * FROM internal.eba_evaluate(v_facts, v_shifts);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rows := v_rows + v_n;

    IF v_rows = 0 THEN
        RETURN QUERY SELECT true, NULL::text, NULL::text, NULL::text, 'Passed'::text, 'All EBA compliance checks passed.'::text, '{}'::jsonb;
    END IF;
END;
$function$;

-- Templates: view + save + apply
CREATE OR REPLACE VIEW public.v_template_full AS
 SELECT id,
    name,
    description,
    status,
    organization_id,
    published_month,
    published_at,
    published_by,
    start_date,
    end_date,
    created_by,
    last_edited_by,
    version,
    created_at,
    updated_at,
    is_base_template,
    department_id,
    sub_department_id,
    ( SELECT count(*) AS count
           FROM roster_template_batches rtb
          WHERE rtb.template_id = t.id) AS applied_count,
    COALESCE(( SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name, 'description', tg.description, 'color', tg.color, 'icon', tg.icon, 'sortOrder', tg.sort_order, 'subGroups', ( SELECT COALESCE(json_agg(json_build_object('id', tsg.id, 'name', tsg.name, 'description', tsg.description, 'sortOrder', tsg.sort_order, 'shifts', ( SELECT COALESCE(json_agg(json_build_object('id', s.id, 'name', COALESCE(s.name, s.role_name), 'roleId', s.role_id, 'roleName', s.role_name, 'remunerationLevelId', NULL::uuid, 'remunerationLevel', s.remuneration_level, 'remunerationLevelName', s.remuneration_level_name, 'startTime', to_char(s.start_time::interval, 'HH24:MI'::text), 'endTime', to_char(s.end_time::interval, 'HH24:MI'::text), 'paidBreakDuration', COALESCE(s.paid_break_minutes, 0), 'unpaidBreakDuration', COALESCE(s.unpaid_break_minutes, 0), 'breakStart', to_char(s.break_start::interval, 'HH24:MI'::text), 'breakEnd', to_char(s.break_end::interval, 'HH24:MI'::text), 'unpaidBreaks', COALESCE(s.unpaid_breaks, '[]'::jsonb), 'skills', COALESCE(s.required_skills, ARRAY[]::text[]), 'licenses', COALESCE(s.required_licenses, ARRAY[]::text[]), 'siteTags', COALESCE(s.site_tags, ARRAY[]::text[]), 'eventTags', COALESCE(s.event_tags, ARRAY[]::text[]), 'notes', s.notes, 'netLength', s.net_length_hours, 'sortOrder', s.sort_order, 'dayOfWeek', s.day_of_week, 'targetEmploymentType', s.target_employment_type, 'targetRequiresFlexible', s.target_requires_flexible) ORDER BY s.sort_order, s.start_time), '[]'::json) AS "coalesce"
                           FROM template_shifts s
                          WHERE s.subgroup_id = tsg.id)) ORDER BY tsg.sort_order), '[]'::json) AS "coalesce"
                   FROM template_subgroups tsg
                  WHERE tsg.group_id = tg.id)) ORDER BY tg.sort_order) AS json_agg
           FROM template_groups tg
          WHERE tg.template_id = t.id), '[]'::json) AS groups
   FROM roster_templates t;

CREATE OR REPLACE FUNCTION public.save_template_full(
  p_template_id uuid,
  p_expected_version integer,
  p_name text,
  p_description text,
  p_groups jsonb,
  p_user_id uuid
)
RETURNS TABLE(success boolean, new_version integer, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_current_version integer;
    v_new_version integer;
    v_group jsonb;
    v_subgroup jsonb;
    v_shift jsonb;
    v_group_id uuid;
    v_subgroup_id uuid;
    v_shift_id uuid;
    v_existing_group_ids uuid[] := '{}';
    v_existing_subgroup_ids uuid[] := '{}';
    v_existing_shift_ids uuid[] := '{}';
BEGIN
  PERFORM public.sm_require_template_edit(p_template_id);
    SELECT version INTO v_current_version
    FROM roster_templates
    WHERE id = p_template_id;

    IF v_current_version IS NULL THEN
        RETURN QUERY SELECT false, NULL::integer, 'Template not found'::text;
        RETURN;
    END IF;

    IF v_current_version != p_expected_version THEN
        RETURN QUERY SELECT false, v_current_version, 'Version mismatch - template has been modified'::text;
        RETURN;
    END IF;

    v_new_version := v_current_version + 1;
    UPDATE roster_templates
    SET
        name = p_name,
        description = NULLIF(p_description, ''),
        version = v_new_version,
        updated_at = now(),
        last_edited_by = p_user_id
    WHERE id = p_template_id;

    FOR v_group IN SELECT * FROM jsonb_array_elements(p_groups)
    LOOP
        v_group_id := NULL;
        IF (v_group->>'id') IS NOT NULL AND (v_group->>'id') NOT LIKE 'temp-%' THEN
            BEGIN
                v_group_id := (v_group->>'id')::uuid;
            EXCEPTION WHEN OTHERS THEN
                v_group_id := NULL;
            END;
        END IF;

        IF v_group_id IS NOT NULL THEN
            UPDATE template_groups
            SET
                name = v_group->>'name',
                description = v_group->>'description',
                color = COALESCE(v_group->>'color', '#3b82f6'),
                icon = v_group->>'icon',
                sort_order = COALESCE((v_group->>'sortOrder')::integer, 0)
            WHERE id = v_group_id;

            v_existing_group_ids := array_append(v_existing_group_ids, v_group_id);
        ELSE
            INSERT INTO template_groups (template_id, name, description, color, icon, sort_order)
            VALUES (
                p_template_id,
                v_group->>'name',
                v_group->>'description',
                COALESCE(v_group->>'color', '#3b82f6'),
                v_group->>'icon',
                COALESCE((v_group->>'sortOrder')::integer, 0)
            )
            RETURNING id INTO v_group_id;

            v_existing_group_ids := array_append(v_existing_group_ids, v_group_id);
        END IF;

        IF (v_group->'subGroups') IS NOT NULL THEN
            FOR v_subgroup IN SELECT * FROM jsonb_array_elements(v_group->'subGroups')
            LOOP
                v_subgroup_id := NULL;
                IF (v_subgroup->>'id') IS NOT NULL AND (v_subgroup->>'id') NOT LIKE 'temp-%' THEN
                    BEGIN
                        v_subgroup_id := (v_subgroup->>'id')::uuid;
                    EXCEPTION WHEN OTHERS THEN
                        v_subgroup_id := NULL;
                    END;
                END IF;

                IF v_subgroup_id IS NOT NULL THEN
                    UPDATE template_subgroups
                    SET
                        name = v_subgroup->>'name',
                        description = v_subgroup->>'description',
                        sort_order = COALESCE((v_subgroup->>'sortOrder')::integer, 0)
                    WHERE id = v_subgroup_id;

                    v_existing_subgroup_ids := array_append(v_existing_subgroup_ids, v_subgroup_id);
                ELSE
                    INSERT INTO template_subgroups (group_id, name, description, sort_order)
                    VALUES (
                        v_group_id,
                        v_subgroup->>'name',
                        v_subgroup->>'description',
                        COALESCE((v_subgroup->>'sortOrder')::integer, 0)
                    )
                    RETURNING id INTO v_subgroup_id;

                    v_existing_subgroup_ids := array_append(v_existing_subgroup_ids, v_subgroup_id);
                END IF;

                IF (v_subgroup->'shifts') IS NOT NULL THEN
                    FOR v_shift IN SELECT * FROM jsonb_array_elements(v_subgroup->'shifts')
                    LOOP
                        v_shift_id := NULL;
                        IF (v_shift->>'id') IS NOT NULL AND (v_shift->>'id') NOT LIKE 'temp-%' THEN
                            BEGIN
                                v_shift_id := (v_shift->>'id')::uuid;
                            EXCEPTION WHEN OTHERS THEN
                                v_shift_id := NULL;
                            END;
                        END IF;

                        IF v_shift_id IS NOT NULL THEN
                            UPDATE template_shifts
                            SET
                                name = v_shift->>'name',
                                role_id = NULLIF(v_shift->>'roleId', '')::uuid,
                                role_name = v_shift->>'roleName',
                                remuneration_level = NULLIF(v_shift->>'remunerationLevel', '')::smallint,
                                remuneration_level_name = v_shift->>'remunerationLevelName',
                                start_time = (v_shift->>'startTime')::time,
                                end_time = (v_shift->>'endTime')::time,
                                paid_break_minutes = COALESCE((v_shift->>'paidBreakDuration')::integer, 0),
                                unpaid_break_minutes = COALESCE((v_shift->>'unpaidBreakDuration')::integer, 0),
                                break_start = NULLIF(v_shift->>'breakStart', '')::time,
                                break_end = NULLIF(v_shift->>'breakEnd', '')::time,
                                unpaid_breaks = CASE
                                    WHEN v_shift ? 'unpaidBreaks' AND jsonb_typeof(v_shift->'unpaidBreaks') = 'array'
                                    THEN v_shift->'unpaidBreaks'
                                    ELSE template_shifts.unpaid_breaks
                                END,
                                required_skills = COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'skills') t(x)),
                                    '{}'
                                ),
                                required_licenses = COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'licenses') t(x)),
                                    '{}'
                                ),
                                site_tags = COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'siteTags') t(x)),
                                    '{}'
                                ),
                                event_tags = COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'eventTags') t(x)),
                                    '{}'
                                ),
                                notes = v_shift->>'notes',
                                sort_order = COALESCE((v_shift->>'sortOrder')::integer, 0),
                                day_of_week = (v_shift->>'dayOfWeek')::integer,
                                target_employment_type = COALESCE(
                                    NULLIF(v_shift->>'targetEmploymentType', ''),
                                    template_shifts.target_employment_type
                                ),
                                target_requires_flexible = COALESCE(
                                    (v_shift->>'targetRequiresFlexible')::boolean,
                                    template_shifts.target_requires_flexible
                                )
                            WHERE id = v_shift_id;

                            v_existing_shift_ids := array_append(v_existing_shift_ids, v_shift_id);
                        ELSE
                            INSERT INTO template_shifts (
                                subgroup_id,
                                name,
                                role_id,
                                role_name,
                                remuneration_level,
                                remuneration_level_name,
                                start_time,
                                end_time,
                                paid_break_minutes,
                                unpaid_break_minutes,
                                break_start,
                                break_end,
                                unpaid_breaks,
                                required_skills,
                                required_licenses,
                                site_tags,
                                event_tags,
                                notes,
                                sort_order,
                                day_of_week,
                                target_employment_type,
                                target_requires_flexible
                            )
                            VALUES (
                                v_subgroup_id,
                                v_shift->>'name',
                                NULLIF(v_shift->>'roleId', '')::uuid,
                                v_shift->>'roleName',
                                NULLIF(v_shift->>'remunerationLevel', '')::smallint,
                                v_shift->>'remunerationLevelName',
                                (v_shift->>'startTime')::time,
                                (v_shift->>'endTime')::time,
                                COALESCE((v_shift->>'paidBreakDuration')::integer, 0),
                                COALESCE((v_shift->>'unpaidBreakDuration')::integer, 0),
                                NULLIF(v_shift->>'breakStart', '')::time,
                                NULLIF(v_shift->>'breakEnd', '')::time,
                                CASE
                                    WHEN v_shift ? 'unpaidBreaks' AND jsonb_typeof(v_shift->'unpaidBreaks') = 'array'
                                    THEN v_shift->'unpaidBreaks'
                                    ELSE '[]'::jsonb
                                END,
                                COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'skills') t(x)),
                                    '{}'
                                ),
                                COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'licenses') t(x)),
                                    '{}'
                                ),
                                COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'siteTags') t(x)),
                                    '{}'
                                ),
                                COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'eventTags') t(x)),
                                    '{}'
                                ),
                                v_shift->>'notes',
                                COALESCE((v_shift->>'sortOrder')::integer, 0),
                                (v_shift->>'dayOfWeek')::integer,
                                NULLIF(v_shift->>'targetEmploymentType', ''),
                                COALESCE((v_shift->>'targetRequiresFlexible')::boolean, false)
                            )
                            RETURNING id INTO v_shift_id;

                            v_existing_shift_ids := array_append(v_existing_shift_ids, v_shift_id);
                        END IF;
                    END LOOP;
                END IF;

                DELETE FROM template_shifts
                WHERE subgroup_id = v_subgroup_id
                AND id != ALL(v_existing_shift_ids);
            END LOOP;
        END IF;

        DELETE FROM template_subgroups
        WHERE group_id = v_group_id
        AND id != ALL(v_existing_subgroup_ids);
    END LOOP;

    DELETE FROM template_groups
    WHERE template_id = p_template_id
    AND id != ALL(v_existing_group_ids);

    RETURN QUERY SELECT true, v_new_version, NULL::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_template_to_date_range_v2(
  p_template_id uuid,
  p_start_date date,
  p_end_date date,
  p_user_id uuid,
  p_source text DEFAULT 'roster_modal'::text,
  p_target_department_id uuid DEFAULT NULL::uuid,
  p_target_sub_department_id uuid DEFAULT NULL::uuid
)
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
  PERFORM public.sm_require_template_apply(p_template_id, p_target_department_id, p_target_sub_department_id);
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
                INSERT INTO roster_groups (roster_id, name, external_id)
                VALUES (v_roster_id, v_tg.name, v_external_id)
                RETURNING id INTO v_rg_id;
            END IF;

            FOR v_tsg IN (SELECT * FROM template_subgroups WHERE group_id = v_tg.id) LOOP
                SELECT id INTO v_rsg_id FROM roster_subgroups
                WHERE roster_group_id = v_rg_id AND name = v_tsg.name LIMIT 1;

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

                            v_breach_window := public.shift_break_window_breach(
                                v_ts.start_time, v_ts.end_time, COALESCE(v_ts.unpaid_break_minutes, 0),
                                v_ts.break_start, v_ts.break_end, v_ts.unpaid_breaks);
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
                                paid_break_minutes, unpaid_break_minutes, break_start, break_end, unpaid_breaks,
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
                                COALESCE(v_ts.paid_break_minutes, 0), COALESCE(v_ts.unpaid_break_minutes, 0),
                                v_ts.break_start, v_ts.break_end, COALESCE(v_ts.unpaid_breaks, '[]'::jsonb),
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

-- ----------------------------------------------------------------------------
-- 4. Actual Break Punches: `public.timesheet_breaks` + Anti-Double-Punch Index
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timesheet_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id uuid NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  break_seq integer NOT NULL CHECK (break_seq >= 1),
  break_start timestamptz NOT NULL,
  break_end timestamptz NULL,
  duration_minutes integer GENERATED ALWAYS AS (
    CASE
      WHEN break_end IS NOT NULL THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (break_end - break_start)) / 60.0)::integer)
      ELSE NULL
    END
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timesheet_breaks_end_after_start CHECK (break_end IS NULL OR break_end >= break_start),
  CONSTRAINT timesheet_breaks_seq_unique UNIQUE (timesheet_id, break_seq)
);

-- SQL-level guarantee against concurrent rapid double-taps opening 2 breaks
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_break
  ON public.timesheet_breaks (timesheet_id)
  WHERE break_end IS NULL;

CREATE INDEX IF NOT EXISTS idx_timesheet_breaks_shift_id
  ON public.timesheet_breaks (shift_id);

ALTER TABLE public.timesheet_breaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_breaks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS timesheet_breaks_self_select ON public.timesheet_breaks;
CREATE POLICY timesheet_breaks_self_select
  ON public.timesheet_breaks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.timesheets t
      WHERE t.id = timesheet_breaks.timesheet_id
        AND t.employee_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS timesheet_breaks_manager_select ON public.timesheet_breaks;
CREATE POLICY timesheet_breaks_manager_select
  ON public.timesheet_breaks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.timesheets t
      WHERE t.id = timesheet_breaks.timesheet_id
        AND (
          public.can_act_on_timesheet('timesheet.view', t.shift_id, t.employee_id)
          OR public.can_act_on_shift('payroll.view', t.shift_id)
        )
    )
  );

DROP POLICY IF EXISTS timesheet_breaks_manager_write ON public.timesheet_breaks;
CREATE POLICY timesheet_breaks_manager_write
  ON public.timesheet_breaks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.timesheets t
      WHERE t.id = timesheet_breaks.timesheet_id
        AND public.can_act_on_timesheet('timesheet.approve', t.shift_id, t.employee_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.timesheets t
      WHERE t.id = timesheet_breaks.timesheet_id
        AND public.can_act_on_timesheet('timesheet.approve', t.shift_id, t.employee_id)
    )
  );

DROP POLICY IF EXISTS timesheet_breaks_service_role_all ON public.timesheet_breaks;
CREATE POLICY timesheet_breaks_service_role_all
  ON public.timesheet_breaks
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.timesheet_breaks TO authenticated, service_role;

-- Realtime publication (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'timesheet_breaks'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.timesheet_breaks;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'timesheets'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.timesheets;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'billables'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.billables;
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Concurrency-Hardened Punch RPCs (Clock-In, Break Start/End, Clock-Out)
-- ----------------------------------------------------------------------------

-- 5a. Start Unpaid Break (Geofencing OFF, Double-Punch Protected)
CREATE OR REPLACE FUNCTION public.start_break_shift(
  p_shift_id uuid,
  p_lat double precision DEFAULT NULL,
  p_lon double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift    public.shifts%ROWTYPE;
  v_ts       public.timesheets%ROWTYPE;
  v_now      timestamptz := clock_timestamp();
  v_next_seq integer;
  v_break_id uuid;
BEGIN
  PERFORM public.sm_require_assignee_or(p_shift_id, NULL, 'shift.edit');

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  IF v_shift.assigned_employee_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift has no assigned employee');
  END IF;

  SELECT * INTO v_ts FROM public.timesheets WHERE shift_id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR v_ts.clock_in IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Must clock in before starting an unpaid break');
  END IF;

  IF v_ts.clock_out IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot start an unpaid break after clocking out');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.timesheet_breaks tb
    WHERE tb.timesheet_id = v_ts.id
      AND tb.break_end IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'An unpaid break is already active for this shift');
  END IF;

  SELECT COALESCE(MAX(tb.break_seq), 0) + 1
    INTO v_next_seq
    FROM public.timesheet_breaks tb
   WHERE tb.timesheet_id = v_ts.id;

  BEGIN
    INSERT INTO public.timesheet_breaks (
      timesheet_id,
      shift_id,
      break_seq,
      break_start,
      created_at,
      updated_at
    ) VALUES (
      v_ts.id,
      p_shift_id,
      v_next_seq,
      v_now,
      v_now,
      v_now
    )
    RETURNING id INTO v_break_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'An unpaid break is already active for this shift');
  END;

  INSERT INTO public.shift_events (
    shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain
  ) VALUES (
    p_shift_id,
    v_shift.assigned_employee_id,
    COALESCE(auth.uid(), v_shift.assigned_employee_id),
    'OP_APPLIED'::public.shift_event_type,
    v_now,
    jsonb_build_object(
      'op', 'break_start',
      'domain', 'attendance',
      'break_id', v_break_id,
      'break_seq', v_next_seq,
      'source', 'start_break_shift'
    ),
    'employee',
    'attendance'
  )
  ON CONFLICT (shift_id, employee_id, event_type, event_time) DO NOTHING;

  RETURN jsonb_build_object(
    'success',     true,
    'break_id',    v_break_id,
    'break_seq',   v_next_seq,
    'break_start', v_now
  );
END;
$function$;

-- 5b. End Unpaid Break (Geofencing OFF, Atomic Close)
CREATE OR REPLACE FUNCTION public.end_break_shift(
  p_shift_id uuid,
  p_lat double precision DEFAULT NULL,
  p_lon double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_ts    public.timesheets%ROWTYPE;
  v_now   timestamptz := clock_timestamp();
  v_open  RECORD;
BEGIN
  PERFORM public.sm_require_assignee_or(p_shift_id, NULL, 'shift.edit');

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  SELECT * INTO v_ts FROM public.timesheets WHERE shift_id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR v_ts.clock_in IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Must clock in before ending an unpaid break');
  END IF;

  IF v_ts.clock_out IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift is already clocked out');
  END IF;

  UPDATE public.timesheet_breaks
     SET break_end  = GREATEST(v_now, break_start),
         updated_at = v_now
   WHERE timesheet_id = v_ts.id
     AND break_end IS NULL
  RETURNING id, break_seq, break_start, break_end, duration_minutes
    INTO v_open;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active unpaid break to end');
  END IF;

  INSERT INTO public.shift_events (
    shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain
  ) VALUES (
    p_shift_id,
    v_shift.assigned_employee_id,
    COALESCE(auth.uid(), v_shift.assigned_employee_id),
    'OP_APPLIED'::public.shift_event_type,
    v_now,
    jsonb_build_object(
      'op', 'break_end',
      'domain', 'attendance',
      'break_id', v_open.id,
      'break_seq', v_open.break_seq,
      'duration_minutes', v_open.duration_minutes,
      'source', 'end_break_shift'
    ),
    'employee',
    'attendance'
  )
  ON CONFLICT (shift_id, employee_id, event_type, event_time) DO NOTHING;

  RETURN jsonb_build_object(
    'success',          true,
    'break_id',         v_open.id,
    'break_seq',        v_open.break_seq,
    'break_start',      v_open.break_start,
    'break_end',        v_open.break_end,
    'duration_minutes', v_open.duration_minutes
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.start_break_shift(uuid, double precision, double precision) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_break_shift(uuid, double precision, double precision) TO authenticated, service_role;

-- 5c. Clock-In (Atomic `WHERE clock_in IS NULL` Double-Punch Guard)
CREATE OR REPLACE FUNCTION public.check_in_shift(
  p_shift_id uuid,
  p_lat double precision,
  p_lon double precision
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift           public.shifts%ROWTYPE;
  v_ts_id           uuid;
  v_now             timestamptz := clock_timestamp();
  v_effective_start timestamptz;
  v_distance_m      double precision := 0;
  v_min_distance_m  double precision;
  v_arrival_track   public.attendance_arrival_track;
  v_legacy_status   text;
  v_loc             RECORD;
  v_any_location    boolean := false;
  v_inside          boolean := false;
  v_earth_radius    CONSTANT double precision := 6371000;
  v_lat1_rad        double precision;
  v_lat2_rad        double precision;
  v_dlat            double precision;
  v_dlon            double precision;
  v_a               double precision;
  v_dist            double precision;
  v_org             public.organizations%ROWTYPE;
  v_from_state      text;
  v_to_state        text;
BEGIN
  PERFORM public.sm_require_assignee_or(p_shift_id, NULL, 'shift.edit');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  IF v_shift.assigned_employee_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift has no assigned employee');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.timesheets t
    WHERE t.shift_id = p_shift_id AND t.clock_in IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked in for this shift');
  END IF;

  IF v_shift.start_at IS NOT NULL THEN
    v_effective_start := v_shift.start_at;
  ELSE
    v_effective_start := (
      v_shift.shift_date::text || ' ' || v_shift.start_time::text || ' ' || COALESCE(v_shift.timezone, 'Australia/Sydney')
    )::timestamptz;
  END IF;

  IF v_now < v_effective_start - INTERVAL '1 hour' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Clock-in window not open yet');
  END IF;

  IF v_now > v_effective_start + INTERVAL '750 minutes' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Clock-in window has closed (more than 12.5 hours after shift start)'
    );
  END IF;

  IF p_lat IS NULL OR p_lon IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'GPS location is required to clock in');
  END IF;

  v_min_distance_m := NULL;
  v_inside := false;
  FOR v_loc IN
    SELECT lat, lng, radius_m
    FROM public.allowed_locations
    WHERE org_id = v_shift.organization_id AND is_active = true
  LOOP
    v_any_location := true;
    v_lat1_rad := radians(v_loc.lat);
    v_lat2_rad := radians(p_lat);
    v_dlat     := radians(p_lat - v_loc.lat);
    v_dlon     := radians(p_lon - v_loc.lng);
    v_a        := sin(v_dlat / 2)^2 + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
    v_dist     := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));

    IF v_min_distance_m IS NULL OR v_dist < v_min_distance_m THEN
      v_min_distance_m := v_dist;
    END IF;
    IF v_dist <= v_loc.radius_m THEN
      v_inside     := true;
      v_distance_m := v_dist;
    END IF;
  END LOOP;

  IF v_any_location AND NOT v_inside THEN
    RETURN jsonb_build_object(
      'success',    false,
      'error',      'You are too far from any allowed location to clock in',
      'distance_m', round(COALESCE(v_min_distance_m, 0)::numeric, 1)
    );
  END IF;

  IF NOT v_any_location THEN
    SELECT * INTO v_org FROM public.organizations WHERE id = v_shift.organization_id;
    IF v_org.venue_lat IS NOT NULL AND v_org.venue_lon IS NOT NULL THEN
      v_lat1_rad := radians(v_org.venue_lat);
      v_lat2_rad := radians(p_lat);
      v_dlat     := radians(p_lat - v_org.venue_lat);
      v_dlon     := radians(p_lon - v_org.venue_lon);
      v_a        := sin(v_dlat / 2)^2 + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
      v_distance_m := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));
      IF v_distance_m > 100 THEN
        RETURN jsonb_build_object(
          'success',    false,
          'error',      'You are too far from the venue to clock in',
          'distance_m', round(v_distance_m::numeric, 1)
        );
      END IF;
    END IF;
  END IF;

  IF v_now < v_effective_start - INTERVAL '7 minutes 30 seconds' THEN
    v_arrival_track := 'early_in';
  ELSIF v_now <= v_effective_start + INTERVAL '7 minutes 30 seconds' THEN
    v_arrival_track := 'on_time';
  ELSE
    v_arrival_track := 'late_in';
  END IF;

  v_legacy_status := CASE WHEN v_arrival_track = 'late_in' THEN 'late' ELSE 'checked_in' END;

  v_from_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  INSERT INTO public.timesheets (
    shift_id,
    employee_id,
    organization_id,
    clock_in,
    arrival_track,
    source
  ) VALUES (
    p_shift_id,
    v_shift.assigned_employee_id,
    v_shift.organization_id,
    v_now,
    v_arrival_track,
    'mobile_gps'
  )
  ON CONFLICT (shift_id) DO UPDATE SET
    employee_id     = EXCLUDED.employee_id,
    organization_id = EXCLUDED.organization_id,
    clock_in        = EXCLUDED.clock_in,
    arrival_track   = EXCLUDED.arrival_track,
    source          = EXCLUDED.source,
    updated_at      = v_now
  WHERE public.timesheets.clock_in IS NULL
  RETURNING id INTO v_ts_id;

  IF v_ts_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked in for this shift');
  END IF;

  UPDATE public.shifts SET
    lifecycle_status = CASE
      WHEN lifecycle_status = 'Published'::public.shift_lifecycle THEN 'InProgress'::public.shift_lifecycle
      ELSE lifecycle_status
    END,
    trading_status = 'NoTrade'::public.shift_trading,
    updated_at = v_now
  WHERE id = p_shift_id;

  v_to_state := public.get_shift_fsm_state(
    CASE WHEN v_shift.lifecycle_status = 'Published'::public.shift_lifecycle THEN 'InProgress'::public.shift_lifecycle ELSE v_shift.lifecycle_status END,
    v_shift.assignment_status,
    v_shift.assignment_outcome,
    'NoTrade'::public.shift_trading,
    v_shift.is_cancelled,
    v_shift.bidding_status
  );

  INSERT INTO public.shift_events (
    shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain
  ) VALUES (
    p_shift_id,
    v_shift.assigned_employee_id,
    auth.uid(),
    CASE WHEN v_arrival_track = 'late_in' THEN 'LATE_IN' ELSE 'CHECKED_IN' END::public.shift_event_type,
    v_now,
    jsonb_build_object(
      'from_state', v_from_state,
      'to_state', v_to_state,
      'arrival_track', v_arrival_track::text,
      'source', 'check_in_shift'
    ),
    'employee',
    'attendance'
  )
  ON CONFLICT (shift_id, employee_id, event_type, event_time) DO NOTHING;

  RETURN jsonb_build_object(
    'success',           true,
    'arrival_track',     v_arrival_track::text,
    'attendance_status', v_legacy_status,
    'clock_in',          v_now,
    'actual_start',      v_now,
    'distance_m',        round(v_distance_m::numeric, 1)
  );
END;
$function$;

-- 5d. Clock-Out (Open-Break Gate, NULL Actuals When Unpunched, Atomic Close)
CREATE OR REPLACE FUNCTION public.sm_clock_out_shift(
  p_shift_id uuid,
  p_user_id uuid,
  p_lat double precision DEFAULT NULL::double precision,
  p_lon double precision DEFAULT NULL::double precision
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
  v_shift           public.shifts%ROWTYPE;
  v_ts              public.timesheets%ROWTYPE;
  v_org             public.organizations%ROWTYPE;
  v_now             timestamptz := clock_timestamp();
  v_effective_end   timestamptz;
  v_departure_track public.attendance_departure_track;
  v_distance_m      double precision := 0;
  v_min_distance_m  double precision;
  v_loc             RECORD;
  v_any_location    boolean := false;
  v_inside          boolean := false;
  v_gross_minutes   numeric;
  v_break_minutes   integer;
  v_meal_is_paid    boolean := false;
  v_net_minutes     numeric;
  v_early_out       boolean;
  v_earth_radius    CONSTANT double precision := 6371000;
  v_lat1_rad        double precision;
  v_lat2_rad        double precision;
  v_dlat            double precision;
  v_dlon            double precision;
  v_a               double precision;
  v_dist            double precision;
  v_from_state      text;
  v_to_state        text;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT public.can_act_on_shift('timesheet.approve', p_shift_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to clock out on behalf of this employee');
  END IF;
  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift is not assigned to this employee');
  END IF;

  SELECT * INTO v_ts FROM public.timesheets WHERE shift_id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR v_ts.clock_in IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Must clock in before clocking out');
  END IF;

  IF v_ts.clock_out IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked out');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.timesheet_breaks tb
    WHERE tb.timesheet_id = v_ts.id
      AND tb.break_end IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'You must end your active unpaid break before clocking out'
    );
  END IF;

  IF p_lat IS NULL OR p_lon IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Location required to clock out');
  END IF;

  v_min_distance_m := NULL;
  v_inside := false;
  FOR v_loc IN
    SELECT lat, lng, radius_m
    FROM public.allowed_locations
    WHERE org_id = v_shift.organization_id AND is_active = true
  LOOP
    v_any_location := true;
    v_lat1_rad := radians(v_loc.lat);
    v_lat2_rad := radians(p_lat);
    v_dlat     := radians(p_lat - v_loc.lat);
    v_dlon     := radians(p_lon - v_loc.lng);
    v_a        := sin(v_dlat / 2)^2 + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
    v_dist     := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));

    IF v_min_distance_m IS NULL OR v_dist < v_min_distance_m THEN
      v_min_distance_m := v_dist;
    END IF;
    IF v_dist <= v_loc.radius_m THEN
      v_inside     := true;
      v_distance_m := v_dist;
    END IF;
  END LOOP;

  IF v_any_location AND NOT v_inside THEN
    RETURN jsonb_build_object(
      'success',    false,
      'error',      'You are too far from any allowed location to clock out',
      'distance_m', round(COALESCE(v_min_distance_m, 0)::numeric, 1)
    );
  END IF;

  IF NOT v_any_location THEN
    SELECT * INTO v_org FROM public.organizations WHERE id = v_shift.organization_id;
    IF FOUND AND v_org.venue_lat IS NOT NULL AND v_org.venue_lon IS NOT NULL THEN
      v_lat1_rad := radians(v_org.venue_lat);
      v_lat2_rad := radians(p_lat);
      v_dlat     := radians(p_lat - v_org.venue_lat);
      v_dlon     := radians(p_lon - v_org.venue_lon);
      v_a        := sin(v_dlat / 2)^2 + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
      v_distance_m := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));
      IF v_distance_m > 100 THEN
        RETURN jsonb_build_object(
          'success',    false,
          'error',      'You are too far from the venue to clock out',
          'distance_m', round(v_distance_m::numeric, 1)
        );
      END IF;
    END IF;
  END IF;

  IF v_shift.end_at IS NOT NULL THEN
    v_effective_end := v_shift.end_at;
  ELSE
    v_effective_end := (
      (v_shift.shift_date + v_shift.end_time)
      + CASE WHEN v_shift.end_time <= v_shift.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END
    ) AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney');
  END IF;

  IF v_now < v_effective_end - INTERVAL '7 minutes 30 seconds' THEN
    v_departure_track := 'early_out';
  ELSIF v_now <= v_effective_end + INTERVAL '7 minutes 30 seconds' THEN
    v_departure_track := 'on_time';
  ELSE
    v_departure_track := 'late_out';
  END IF;

  v_early_out := (v_departure_track = 'early_out');

  SELECT SUM(tb.duration_minutes)::integer
    INTO v_break_minutes
    FROM public.timesheet_breaks tb
   WHERE tb.timesheet_id = v_ts.id
     AND tb.break_end IS NOT NULL;

  v_meal_is_paid := EXISTS (
    SELECT 1 FROM hr.roles r
    WHERE r.id = v_shift.role_id
      AND r.name ILIKE '%security%'
  );

  v_gross_minutes := EXTRACT(EPOCH FROM (v_now - v_ts.clock_in)) / 60.0;
  v_net_minutes   := GREATEST(
    0,
    v_gross_minutes - CASE WHEN v_meal_is_paid THEN 0 ELSE COALESCE(v_break_minutes, 0) END
  );

  UPDATE public.timesheets SET
    clock_out       = v_now,
    departure_track = v_departure_track,
    updated_at      = v_now
  WHERE id = v_ts.id
    AND clock_out IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked out');
  END IF;

  v_from_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  UPDATE public.shifts SET
    lifecycle_status = 'Completed'::public.shift_lifecycle,
    updated_at       = v_now
  WHERE id = p_shift_id;

  UPDATE public.billables SET
    timesheet_id = v_ts.id,
    updated_at   = v_now
  WHERE shift_id = p_shift_id
    AND payroll_exported = false;

  v_to_state := public.get_shift_fsm_state(
    'Completed'::public.shift_lifecycle, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  INSERT INTO public.shift_events (
    shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain
  ) VALUES (
    p_shift_id,
    v_shift.assigned_employee_id,
    p_user_id,
    CASE WHEN v_early_out THEN 'EARLY_OUT' ELSE 'OP_APPLIED' END::public.shift_event_type,
    v_now,
    jsonb_build_object(
      'op', 'clock_out',
      'domain', 'attendance',
      'departure', CASE
                     WHEN v_departure_track = 'early_out' THEN 'early'
                     WHEN v_departure_track = 'late_out' THEN 'late'
                     ELSE 'on_time'
                   END,
      'departure_track', v_departure_track::text,
      'net_minutes', round(v_net_minutes::numeric, 0),
      'actual_unpaid_break_minutes', v_break_minutes,
      'from_state', v_from_state,
      'to_state',   v_to_state,
      'source', 'sm_clock_out_shift'
    ),
    'employee',
    'attendance'
  )
  ON CONFLICT (shift_id, employee_id, event_type, event_time) DO NOTHING;

  RETURN jsonb_build_object(
    'success',                     true,
    'departure_track',             v_departure_track::text,
    'clock_out',                   v_now,
    'actual_end',                  v_now,
    'actual_net_minutes',          round(v_net_minutes::numeric, 0),
    'actual_unpaid_break_minutes', v_break_minutes,
    'early_out',                   v_early_out,
    'distance_m',                  round(v_distance_m::numeric, 1)
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 6. `public.billables`: Zero-Fallback Actuals + Manager Override Support
-- ----------------------------------------------------------------------------
ALTER TABLE public.billables
  ALTER COLUMN unpaid_break_minutes DROP NOT NULL,
  ALTER COLUMN unpaid_break_minutes DROP DEFAULT;

ALTER TABLE public.billables
  ADD COLUMN IF NOT EXISTS unpaid_break_is_manual boolean NOT NULL DEFAULT false;

-- Relax single-window check on billables so manager overrides or actual break
-- windows of any positive span inside 24h (including overnight) are accepted.
ALTER TABLE public.billables DROP CONSTRAINT IF EXISTS billables_break_window;
ALTER TABLE public.billables
  ADD CONSTRAINT billables_break_window CHECK (
    (break_start IS NULL AND break_end IS NULL)
    OR (
      break_start IS NOT NULL
      AND break_end IS NOT NULL
      AND public.shift_minutes_after_start(break_start, break_end) > 0
      AND public.shift_minutes_after_start(break_start, break_end) < 1440
    )
  );

-- Reset any pre-existing non-manual 0-default rows without punched breaks to NULL
UPDATE public.billables b
   SET unpaid_break_minutes = NULL
 WHERE b.unpaid_break_minutes = 0
   AND b.unpaid_break_is_manual = false
   AND b.break_start IS NULL
   AND b.break_end IS NULL
   AND b.payroll_exported = false
   AND NOT EXISTS (
     SELECT 1
       FROM public.timesheet_breaks tb
       JOIN public.timesheets t ON t.id = tb.timesheet_id
      WHERE t.shift_id = b.shift_id
        AND tb.break_end IS NOT NULL
   );

CREATE OR REPLACE FUNCTION public.fn_billable_defaults_and_lengths()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'hr', 'internal'
AS $function$
DECLARE
  v_shift            public.shifts%ROWTYPE;
  v_ts_id            uuid;
  v_clock_in         timestamptz;
  v_clock_out        timestamptz;
  v_meal_is_paid     boolean := false;
  v_completed_breaks integer := 0;
  v_actual_break_sum integer := NULL;
  v_gross            integer;
  v_net              integer;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = NEW.shift_id;
  IF FOUND THEN
    NEW.organization_id := COALESCE(NEW.organization_id, v_shift.organization_id);
    NEW.employee_id     := COALESCE(NEW.employee_id, v_shift.assigned_employee_id);
    IF TG_OP = 'INSERT' THEN
      NEW.paid_break_minutes := COALESCE(NEW.paid_break_minutes, v_shift.paid_break_minutes, 0);
    END IF;
    v_meal_is_paid := EXISTS (
      SELECT 1 FROM hr.roles r
      WHERE r.id = v_shift.role_id
        AND r.name ILIKE '%security%'
    );
  END IF;

  SELECT t.id, t.clock_in, t.clock_out
    INTO v_ts_id, v_clock_in, v_clock_out
    FROM public.timesheets t
   WHERE t.shift_id = NEW.shift_id;

  IF NEW.timesheet_id IS NULL AND v_ts_id IS NOT NULL THEN
    NEW.timesheet_id := v_ts_id;
  END IF;

  IF v_ts_id IS NOT NULL THEN
    SELECT COUNT(*)::integer, SUM(tb.duration_minutes)::integer
      INTO v_completed_breaks, v_actual_break_sum
      FROM public.timesheet_breaks tb
     WHERE tb.timesheet_id = v_ts_id
       AND tb.break_end IS NOT NULL;
  END IF;

  IF NEW.break_start IS NOT NULL AND NEW.break_end IS NOT NULL THEN
    NEW.unpaid_break_is_manual := true;
    NEW.unpaid_break_minutes := CASE
      WHEN v_meal_is_paid THEN 0
      ELSE public.shift_minutes_after_start(NEW.break_start, NEW.break_end)
    END;

    IF NEW.billable_start IS NOT NULL AND NEW.billable_end IS NOT NULL THEN
      IF public.shift_minutes_after_start(NEW.billable_start, NEW.break_start)
           + public.shift_minutes_after_start(NEW.break_start, NEW.break_end)
           <> public.shift_minutes_after_start(NEW.billable_start, NEW.break_end)
         OR public.shift_minutes_after_start(NEW.billable_start, NEW.break_end)
           > public.shift_net_minutes(NEW.billable_start, NEW.billable_end, 0) THEN
        RAISE EXCEPTION 'Meal break must fall within the billable window (% to %)', NEW.billable_start, NEW.billable_end
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF TG_OP = 'INSERT' AND NEW.unpaid_break_minutes IS NOT NULL THEN
    NEW.unpaid_break_is_manual := true;
  ELSIF TG_OP = 'UPDATE'
        AND NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes
        AND NEW.unpaid_break_minutes IS NOT NULL
        AND NOT (OLD.unpaid_break_is_manual = true AND NEW.unpaid_break_is_manual = false) THEN
    NEW.unpaid_break_is_manual := true;
  ELSIF NOT COALESCE(NEW.unpaid_break_is_manual, false) THEN
    IF v_completed_breaks > 0 THEN
      NEW.unpaid_break_minutes := CASE WHEN v_meal_is_paid THEN 0 ELSE v_actual_break_sum END;
    ELSE
      NEW.unpaid_break_minutes := NULL;
    END IF;
  END IF;

  IF NEW.status = 'no_show'::public.timesheet_status
     AND NEW.billable_start IS NULL
     AND NEW.billable_end IS NULL THEN
    NEW.gross_length_minutes := 0;
    NEW.net_length_minutes   := 0;
    NEW.hours_source         := 'no_show';
  ELSIF v_shift.id IS NOT NULL THEN
    v_gross := internal.toil_billable_net_minutes(
      NEW.billable_start, NEW.billable_end,
      v_clock_in, v_clock_out,
      v_shift.shift_date, v_shift.start_time, v_shift.end_time,
      0, 0
    );
    v_net := internal.toil_billable_net_minutes(
      NEW.billable_start, NEW.billable_end,
      v_clock_in, v_clock_out,
      v_shift.shift_date, v_shift.start_time, v_shift.end_time,
      COALESCE(NEW.unpaid_break_minutes, 0), 0
    );
    NEW.gross_length_minutes := v_gross;
    NEW.net_length_minutes   := v_net;
    IF v_net IS NOT NULL THEN
      NEW.hours_source := CASE
        WHEN NEW.billable_start IS NOT NULL OR NEW.billable_end IS NOT NULL THEN 'adjusted'
        ELSE 'actual'
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- TOIL eligible work also honors the zero-fallback rule on `billables.unpaid_break_minutes`
CREATE OR REPLACE FUNCTION internal.toil_eligible_work(p_employee uuid, p_from date, p_to date)
RETURNS TABLE(shift_id uuid, timesheet_id uuid, user_contract_id uuid, shift_date date, net_minutes integer)
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public', 'internal'
AS $function$
    SELECT s.id, b.id, s.user_contract_id, s.shift_date,
           internal.toil_billable_net_minutes(
               b.billable_start, b.billable_end, t.clock_in, t.clock_out,
               s.shift_date, s.start_time, s.end_time,
               COALESCE(b.unpaid_break_minutes, 0), 0)
      FROM public.shifts s
      JOIN public.billables b ON b.shift_id = s.id
      LEFT JOIN public.timesheets t ON t.shift_id = s.id
     WHERE s.assigned_employee_id = p_employee
       AND s.shift_date BETWEEN p_from AND p_to
       AND NOT s.is_cancelled
       AND b.status = 'approved'
       AND s.user_contract_id IS NOT NULL
       AND internal.toil_contract_eligible(s.user_contract_id, s.shift_date);
$function$;

-- Auto-sync non-manual `billables` whenever `timesheet_breaks` rows change
CREATE OR REPLACE FUNCTION public.fn_sync_billables_on_timesheet_breaks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift_id uuid := COALESCE(NEW.shift_id, OLD.shift_id);
BEGIN
  IF v_shift_id IS NOT NULL THEN
    UPDATE public.billables
       SET updated_at = clock_timestamp()
     WHERE shift_id = v_shift_id
       AND payroll_exported = false
       AND unpaid_break_is_manual = false;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_billables_on_timesheet_breaks ON public.timesheet_breaks;
CREATE TRIGGER trg_sync_billables_on_timesheet_breaks
  AFTER INSERT OR UPDATE OR DELETE ON public.timesheet_breaks
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_billables_on_timesheet_breaks();

