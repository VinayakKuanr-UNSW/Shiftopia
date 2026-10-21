-- ============================================================================
-- Timesheet / Live Rules consistency remediation (audit 2026-07-06)
--
--  1. sm_run_state_processor (re-synced with the live prod definition, which
--     had already dropped Pass 5 and added the Pass 0b clocked-in guard):
--     • Pass 5 stays removed (repo copy still had it; prod is the baseline).
--     • Pass 6 rewritten — fires at GREATEST(actual clock-in, scheduled start)
--       + 12.5h (was COALESCE, which fired up to 1h early on early clock-ins),
--       selects by attendance status instead of lifecycle = InProgress only,
--       and no longer fabricates actual_end (raw actuals stay NULL when the
--       employee never clocked out).
--  1b. sm_handle_auto_clock_out (prod-only fn, 5-min cron): same rewrite —
--     GREATEST anchor, no fabricated actual_end/actual_net_minutes.
--  2. check_in_shift: 5-minute grace before marking 'late' (matches the Live
--     Rules badge definition).
--  3. enforce_timesheet_review_gate: billable-time INSERTs are now gated too
--     (first-ever manager edit creates the row via INSERT).
--  4. v_shift_assignment_episodes + sm_refresh_shift_snapshots: manager-
--     adjusted billable times override raw clocks in the attendance metrics
--     (per-side), so a `*` override affects performance metrics.
--  5. Backfill: reclassify historical Pass-5 fabrications as true auto
--     clock-outs (actual_end back to NULL), refresh affected snapshots,
--     recompute quarter scorecards.
-- ============================================================================

-- ── 1. State processor ─────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE public.sm_run_state_processor()
  LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public'
AS $procedure$
BEGIN

  -- ── Pass 0a: Published + assigned → InProgress when shift starts ───────────
  BEGIN
    UPDATE shifts SET lifecycle_status = 'InProgress', updated_at = now()
    WHERE lifecycle_status = 'Published'
      AND assignment_status = 'assigned'
      AND (
        (start_at IS NOT NULL
          AND start_at <= now()
          AND start_at > now() - INTERVAL '12 hours')
        OR
        (start_at IS NULL
          AND (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now()
          AND (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ > now() - INTERVAL '12 hours')
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 0a failed: %', SQLERRM;
  END;

  -- ── Pass 0b: InProgress → Completed when shift ends (scheduled end) ────────
  BEGIN
    UPDATE shifts SET lifecycle_status = 'Completed', updated_at = now()
    WHERE lifecycle_status = 'InProgress'
      AND (
        (end_at IS NOT NULL AND end_at <= now())
        OR
        (end_at IS NULL
          AND (shift_date::text || ' ' || end_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now())
      )
      -- Exclude currently clocked-in employees (they must clock out or hit
      -- the 12.5h auto clock-out) — preserves the prod guard so Working
      -- Overtime keeps lifecycle = InProgress.
      AND NOT (attendance_status IN ('checked_in', 'late') AND actual_end IS NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 0b failed: %', SQLERRM;
  END;

  -- ── Pass 1 (REMOVED): urgency escalation at TTS ≤ 24h ─────────────────────
  --    Previously: UPDATE shifts SET bidding_status='on_bidding_urgent'
  --    WHERE bidding_status='on_bidding_normal' AND TTS<=24h.
  --    S6/urgency is now derived from TTS at read time, so this pass is dead.

  -- ── Pass 2: Offer expiry S3 → S2 at TTS ≤ 4h ──────────────────────────────
  --    Now keeps assignment (transitions to S2 instead of S1)
  BEGIN
    UPDATE shifts SET
      lifecycle_status      = 'Draft',
      assignment_outcome    = NULL,
      bidding_status        = 'not_on_bidding',
      updated_at            = now()
    WHERE lifecycle_status = 'Published'
      AND assignment_outcome = 'offered'
      AND (
        (start_at IS NOT NULL AND start_at <= now() + INTERVAL '4 hours')
        OR
        (start_at IS NULL
          AND (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now() + INTERVAL '4 hours')
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 2 failed: %', SQLERRM;
  END;

  -- ── Pass 3: Bidding expiry S5/S6 → S1 at TTS ≤ 4h ─────────────────────────
  -- (FIXED) include the unified 'on_bidding' value, plus the start_at NULL fallback.
  BEGIN
    UPDATE shifts SET
      lifecycle_status  = 'Draft',
      bidding_status    = 'not_on_bidding',
      is_on_bidding     = false,
      assignment_status = 'unassigned',
      updated_at        = now()
    WHERE lifecycle_status = 'Published'
      AND bidding_status IN ('on_bidding', 'on_bidding_normal', 'on_bidding_urgent')
      AND (
        (start_at IS NOT NULL AND start_at <= now() + INTERVAL '4 hours')
        OR
        (start_at IS NULL
          AND (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now() + INTERVAL '4 hours')
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 3 failed: %', SQLERRM;
  END;

  -- ── Pass 4: Auto no-show — shift has ENDED with no clock-in ────────────────
  BEGIN
    UPDATE shifts SET attendance_status = 'no_show', updated_at = now()
    WHERE lifecycle_status IN ('InProgress', 'Completed')
      AND attendance_status = 'unknown'
      AND (
        (end_at IS NOT NULL AND end_at <= now())
        OR
        (end_at IS NULL
          AND (shift_date::text || ' ' || end_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now())
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 4 failed: %', SQLERRM;
  END;

  -- ── Pass 5 (REMOVED): auto clock-out at scheduled end + break ──────────────
  --    It fabricated actual_end (= scheduled end) ~30 min after the shift end,
  --    recording a fake "On Time Out", masking Working Overtime, and defeating
  --    the 12.5h rule. Automatic closure is owned by sm_handle_auto_clock_out
  --    (5-min cron); Pass 6 below is the same rule as a safety net.

  -- ── Pass 6: Auto clock-out — 12.5h after the LATER of clock-in and start ───
  --    Spec: trigger at GREATEST(actual clock-in, scheduled start) + 12.5h.
  --    Does NOT fabricate actual_end: no clock-out happened, so the raw actual
  --    stays NULL ("if actual data doesn't exist, keep NULL"). The terminal
  --    signal is attendance_status = 'auto_clock_out', which unlocks manager
  --    review; billable times then come from manager-adjusted values.
  --    Not gated on lifecycle = InProgress: Pass 0b completes shifts at their
  --    scheduled end, so an InProgress-only guard would never fire for
  --    ordinary shifts (the pre-fix bug that made Pass 6 dead code).
  BEGIN
    UPDATE shifts SET
      lifecycle_status   = 'Completed',
      attendance_status  = 'auto_clock_out',
      attendance_note    = 'Auto-completed by system (12.5hr limit)',
      updated_at         = now()
    WHERE attendance_status IN ('checked_in', 'late')
      AND actual_end IS NULL
      AND lifecycle_status IN ('InProgress', 'Completed')
      AND GREATEST(
            COALESCE(actual_start, start_at,
              (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ),
            COALESCE(start_at,
              (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ)
          ) + INTERVAL '12.5 hours' <= now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 6 failed: %', SQLERRM;
  END;

END;
$procedure$;

-- ── 1b. sm_handle_auto_clock_out (5-min cron 'shift-auto-clockout') ─────────
-- Primary auto clock-out. Same rule as Pass 6:
--   • anchor = GREATEST(actual clock-in, scheduled start) + 12.5h
--     (was COALESCE — an early clock-in fired the auto-out up to 1h early)
--   • no fabricated actual_end / actual_net_minutes — the raw actual stays
--     NULL when the employee never clocked out; attendance_status =
--     'auto_clock_out' is the terminal signal
--   • selected by attendance status, not lifecycle = InProgress only, so a
--     shift auto-completed at scheduled end is still swept
CREATE OR REPLACE FUNCTION public.sm_handle_auto_clock_out()
RETURNS TABLE(affected_shift_id uuid, previous_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH resolved AS (
    SELECT
      id,
      lifecycle_status::text AS prev_status,
      GREATEST(
        COALESCE(actual_start, start_at,
          (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ),
        COALESCE(start_at,
          (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ)
      ) AS anchor
    FROM shifts
    WHERE attendance_status IN ('checked_in', 'late')
      AND actual_end IS NULL
      AND lifecycle_status IN ('InProgress', 'Completed')
      AND deleted_at IS NULL
  ),
  eligible AS (
    SELECT r.id, r.prev_status
    FROM resolved r
    WHERE r.anchor + INTERVAL '12.5 hours' <= now()
  ),
  updated AS (
    UPDATE shifts s SET
      lifecycle_status   = 'Completed',
      attendance_status  = 'auto_clock_out',
      attendance_note    = 'Auto-completed by system (12.5hr limit)',
      updated_at         = now()
    FROM eligible e
    WHERE s.id = e.id
    RETURNING s.id, e.prev_status
  )
  SELECT u.id, u.prev_status FROM updated u;
END;
$function$;

-- ── 2. check_in_shift: 5-minute late grace ─────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."check_in_shift"("p_shift_id" "uuid", "p_lat" double precision, "p_lon" double precision) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_shift           shifts%ROWTYPE;
  v_now             TIMESTAMPTZ := now();
  v_effective_start TIMESTAMPTZ;
  v_distance_m      DOUBLE PRECISION := 0;
  v_min_distance_m  DOUBLE PRECISION;
  v_new_status      shift_attendance_status;
  v_loc             RECORD;
  v_any_location    BOOLEAN := false;
  v_inside          BOOLEAN := false;
  v_earth_radius    CONSTANT DOUBLE PRECISION := 6371000;
  v_lat1_rad        DOUBLE PRECISION;
  v_lat2_rad        DOUBLE PRECISION;
  v_dlat            DOUBLE PRECISION;
  v_dlon            DOUBLE PRECISION;
  v_a               DOUBLE PRECISION;
  v_dist            DOUBLE PRECISION;
  v_org             organizations%ROWTYPE;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  IF v_shift.assigned_employee_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift has no assigned employee');
  END IF;

  IF v_shift.attendance_status != 'unknown' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked in for this shift');
  END IF;

  -- Effective start: use start_at if set, else derive from shift_date + start_time (Sydney TZ)
  IF v_shift.start_at IS NOT NULL THEN
    v_effective_start := v_shift.start_at;
  ELSE
    v_effective_start := (v_shift.shift_date::text || ' ' || v_shift.start_time::text || ' Australia/Sydney')::TIMESTAMPTZ;
  END IF;

  -- Clock-in window: [start - 1 h,  start + 12.5 h (750 min)]
  IF v_now < v_effective_start - INTERVAL '1 hour' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Clock-in window not open yet');
  END IF;

  IF v_now > v_effective_start + INTERVAL '750 minutes' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Clock-in window has closed (more than 12.5 hours after shift start)'
    );
  END IF;

  -- Geolocation required
  IF p_lat IS NULL OR p_lon IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'GPS location is required to clock in');
  END IF;

  -- Multi-geofence check against allowed_locations
  v_min_distance_m := NULL;
  v_inside := false;
  FOR v_loc IN
    SELECT lat, lng, radius_m
    FROM allowed_locations
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
      'distance_m', round(COALESCE(v_min_distance_m, 0)::NUMERIC, 1)
    );
  END IF;

  -- Fallback: no allowed_locations → check org.venue_lat/venue_lon
  IF NOT v_any_location THEN
    SELECT * INTO v_org FROM organizations WHERE id = v_shift.organization_id;
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
          'distance_m', round(v_distance_m::NUMERIC, 1)
        );
      END IF;
    END IF;
    -- No geofence configured → allow clock-in
  END IF;

  -- Status: within the 5-minute grace window → checked_in, later → late.
  -- Matches the Live Rules definition (Late In = clock-in > start + 5m) so the
  -- DB status and the badge an employee sees can never disagree.
  IF v_now <= v_effective_start + INTERVAL '5 minutes' THEN
    v_new_status := 'checked_in';
  ELSE
    v_new_status := 'late';
  END IF;

  UPDATE shifts SET
    attendance_status = v_new_status,
    actual_start      = v_now,
    updated_at        = v_now
  WHERE id = p_shift_id;

  RETURN jsonb_build_object(
    'success',           true,
    'attendance_status', v_new_status::text,
    'actual_start',      v_now,
    'distance_m',        round(v_distance_m::NUMERIC, 1)
  );
END;
$$;

-- ── 3. Review gate: billable INSERTs gated ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_timesheet_review_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_is_decision      boolean;
  v_is_billable_edit boolean;
  v_reviewable       boolean;
BEGIN
  -- (a) approve / reject decision being applied (on insert, or status change)
  v_is_decision := NEW.status IN ('approved', 'rejected')
                   AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status);

  -- (b) manager edit of billable times — gated on UPDATE, and ALSO on INSERT
  -- when the fresh row already carries billable times: the first-ever manager
  -- edit of a shift with no timesheet row is an INSERT, and without this a
  -- direct API call could set billable times on a non-terminal shift. Clock
  -- sync / no-show / decision inserts never set start_time / end_time.
  v_is_billable_edit := (TG_OP = 'UPDATE'
                         AND (NEW.start_time IS DISTINCT FROM OLD.start_time
                              OR NEW.end_time IS DISTINCT FROM OLD.end_time))
                     OR (TG_OP = 'INSERT'
                         AND (NEW.start_time IS NOT NULL OR NEW.end_time IS NOT NULL));

  -- Not a gated manager action (clock sync, submit, auto-create, no-show metrics
  -- write, etc.) → allow through untouched.
  IF NOT (v_is_decision OR v_is_billable_edit) THEN
    RETURN NEW;
  END IF;

  -- This timesheet's own recorded clock-out is itself a terminal signal, even if
  -- the shift row hasn't been synced yet.
  v_reviewable := (NEW.clock_out IS NOT NULL)
                  OR public.is_shift_timesheet_reviewable(NEW.shift_id);

  IF NOT v_reviewable THEN
    RAISE EXCEPTION
      'Timesheet review blocked: shift % has not reached a final attendance state.', NEW.shift_id
      USING ERRCODE = 'check_violation',
            HINT = 'Approve, reject, or edit billable times only after the employee clocks out, is auto-clocked-out, or is a no-show.';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4a. Episode view: manual billable overrides win ────────────────────────
CREATE OR REPLACE VIEW public.v_shift_assignment_episodes AS
WITH
late_cancel_threshold AS (
    SELECT interval '4 hours' AS val
),
ordered_events AS (
    SELECT
        se.id           AS event_id,
        se.shift_id,
        se.employee_id,
        se.event_type,
        se.event_time,
        se.metadata,
        ROW_NUMBER() OVER (PARTITION BY se.shift_id ORDER BY se.event_time, se.id) AS rn
    FROM public.shift_events se
    WHERE se.employee_id IS NOT NULL
),
classified AS (
    SELECT
        oe.*,
        (oe.event_type IN ('ASSIGNED','OFFERED','EMERGENCY_ASSIGNED','SWAPPED_IN')) AS is_opening_type,
        (oe.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                           'SWAPPED_OUT','NO_SHOW','UNASSIGNED'))                    AS is_closing_type
    FROM ordered_events oe
),
boundary_events AS (
    SELECT
        c.shift_id,
        c.event_id,
        c.event_time,
        c.employee_id,
        c.is_opening_type,
        LAG(c.is_closing_type) OVER w AS prev_boundary_was_closing,
        LAG(c.employee_id)     OVER w AS prev_boundary_employee
    FROM classified c
    WHERE c.is_opening_type OR c.is_closing_type
    WINDOW w AS (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id)
),
boundary_starts AS (
    SELECT
        be.shift_id,
        be.event_id,
        CASE
            WHEN be.is_opening_type AND (
                     be.prev_boundary_employee IS NULL
                  OR be.prev_boundary_was_closing
                  OR be.employee_id IS DISTINCT FROM be.prev_boundary_employee
                 )
            THEN 1 ELSE 0
        END AS starts_new_episode
    FROM boundary_events be
),
episode_assigned AS (
    SELECT
        c.*,
        SUM(COALESCE(bs.starts_new_episode, 0))
            OVER (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS episode_seq
    FROM classified c
    LEFT JOIN boundary_starts bs
           ON bs.shift_id = c.shift_id AND bs.event_id = c.event_id
),
episode_agg AS (
    SELECT
        ea.shift_id,
        ea.episode_seq,
        (ARRAY_AGG(ea.employee_id ORDER BY ea.event_time, ea.event_id))[1] AS employee_id,
        MIN(ea.event_time) AS opened_at,
        MIN(ea.event_time) FILTER (
            WHERE ea.event_type IN ('ACCEPTED','EMERGENCY_ASSIGNED','SWAPPED_IN')
        ) AS became_active_at,
        BOOL_OR(ea.event_type = 'OFFERED')              AS had_offer,
        BOOL_OR(ea.event_type = 'ACCEPTED')             AS had_accept,
        BOOL_OR(ea.event_type = 'ASSIGNED')             AS had_assign,
        BOOL_OR(ea.event_type = 'EMERGENCY_ASSIGNED')    AS had_emergency,
        BOOL_OR(ea.event_type = 'SWAPPED_IN')            AS had_swap_in,
        BOOL_OR(ea.event_type = 'CHECKED_IN')            AS had_checked_in,
        BOOL_OR(ea.event_type = 'LATE_IN')               AS had_late_in_event,
        BOOL_OR(ea.event_type = 'EARLY_OUT')             AS had_early_out_event,
        (ARRAY_AGG(ea.event_type ORDER BY ea.event_time DESC, ea.event_id DESC)
            FILTER (WHERE ea.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                             'SWAPPED_OUT','NO_SHOW','UNASSIGNED')))[1]
            AS closing_event_type,
        (ARRAY_AGG(ea.event_time ORDER BY ea.event_time DESC, ea.event_id DESC)
            FILTER (WHERE ea.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                             'SWAPPED_OUT','NO_SHOW','UNASSIGNED')))[1]
            AS closing_event_time
    FROM episode_assigned ea
    WHERE ea.episode_seq > 0
    GROUP BY ea.shift_id, ea.episode_seq
),
episode_with_shift AS (
    SELECT
        ep.*,
        MAX(ep.episode_seq) OVER (PARTITION BY ep.shift_id) AS max_episode_seq,
        s.shift_date,
        s.organization_id,
        s.department_id,
        s.sub_department_id,
        s.lifecycle_status,
        s.deleted_at,
        s.scheduled_start,
        s.scheduled_end,
        s.attendance_status,
        lct.val AS late_cancel_threshold
    FROM episode_agg ep
    JOIN public.shifts s ON s.id = ep.shift_id
    CROSS JOIN late_cancel_threshold lct
),
episode_final AS (
    SELECT
        ews.shift_id,
        ews.episode_seq,
        ews.employee_id,
        ews.opened_at,
        ews.became_active_at,
        ews.closing_event_time AS closed_at,
        CASE
            WHEN ews.had_emergency   THEN 'EMERGENCY_ASSIGNED'::text
            WHEN ews.had_swap_in     THEN 'SWAPPED_IN'::text
            WHEN ews.had_assign      THEN 'ASSIGNED'::text
            WHEN ews.had_offer       THEN 'OFFERED'::text
            ELSE 'ASSIGNED'::text
        END AS opening_event,
        CASE
            WHEN ews.deleted_at IS NOT NULL THEN 'shift_deleted'
            WHEN ews.closing_event_type = 'REJECTED'       THEN 'rejected'
            WHEN ews.closing_event_type = 'IGNORED'        THEN 'ignored'
            WHEN ews.closing_event_type = 'SWAPPED_OUT'    THEN 'swapped_out'
            WHEN ews.closing_event_type = 'NO_SHOW'        THEN 'no_show'
            WHEN ews.closing_event_type = 'UNASSIGNED'     THEN 'unassigned'
            WHEN ews.closing_event_type IN ('CANCELLED', 'LATE_CANCELLED') THEN
                CASE
                    WHEN ews.scheduled_start IS NOT NULL
                         AND ews.closing_event_time IS NOT NULL
                         AND (ews.scheduled_start - ews.closing_event_time) <= ews.late_cancel_threshold
                    THEN 'cancelled_late'
                    ELSE 'cancelled_standard'
                END
            WHEN ews.closing_event_type IS NULL
                 AND ews.lifecycle_status = 'Completed'
                 AND ews.episode_seq = ews.max_episode_seq THEN 'fulfilled'
            ELSE 'open'
        END AS terminal_outcome,
        ews.had_offer,
        ews.had_accept,
        ews.had_assign,
        ews.had_emergency,
        ews.had_swap_in,
        COALESCE(ews.had_checked_in, FALSE) AS attended_from_events,
        COALESCE(ews.had_late_in_event, FALSE) AS late_in_from_events,
        COALESCE(ews.had_early_out_event, FALSE) AS early_out_from_events,
        ews.shift_date,
        ews.organization_id,
        ews.department_id,
        ews.sub_department_id,
        ews.scheduled_start,
        ews.scheduled_end,
        ews.lifecycle_status,
        ews.attendance_status
    FROM episode_with_shift ews
),
ts_agg AS (
    SELECT
        ts.shift_id,
        ts.employee_id,
        MIN(ts.clock_in)  AS clock_in,
        MAX(ts.clock_out) AS clock_out,
        MIN(
            -- Manager-adjusted billable start (timesheets.start_time is only
            -- ever persisted on a manual edit) OVERRIDES the raw clock-in —
            -- the `*` on the Live Rules badge flows into the metrics.
            COALESCE(
                (ts.work_date + ts.start_time) AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney'),
                ts.clock_in
            )
        ) AS effective_clock_in,
        MAX(
            -- Manager-adjusted billable end overrides the raw clock-out.
            COALESCE(
                (CASE WHEN ts.end_time < ts.start_time THEN ts.work_date + interval '1 day' + ts.end_time ELSE ts.work_date + ts.end_time END) AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney'),
                ts.clock_out
            )
        ) AS effective_clock_out
    FROM public.timesheets ts
    JOIN public.shifts s ON s.id = ts.shift_id
    GROUP BY ts.shift_id, ts.employee_id
)
SELECT
    ef.shift_id,
    ef.episode_seq,
    ef.employee_id,
    ef.opened_at,
    ef.closed_at,
    ef.opening_event,
    ef.terminal_outcome,
    ef.had_offer,
    ef.had_accept,
    ef.had_assign,
    ef.had_emergency,
    ef.had_swap_in,
    -- Attendance: OR event-based flags with timesheet-derived flags
    (ef.attended_from_events OR t.clock_in IS NOT NULL) AS attended,
    (ef.late_in_from_events
        OR (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
            AND t.effective_clock_in > ef.scheduled_start + interval '7.5 minutes')
    ) AS late_in,
    (ef.early_out_from_events
        OR (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
            AND t.effective_clock_out < ef.scheduled_end - interval '7.5 minutes')
    ) AS early_out,
    ef.shift_date,
    ef.organization_id,
    ef.department_id,
    ef.sub_department_id,
    ef.became_active_at,
    ef.scheduled_start,
    -- Attendance additions
    (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
     AND t.effective_clock_in < ef.scheduled_start - interval '7.5 minutes'
    ) AS early_in,
    (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
     AND t.effective_clock_out > ef.scheduled_end + interval '7.5 minutes'
    ) AS late_out,
    (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
     AND t.effective_clock_in >= ef.scheduled_start - interval '7.5 minutes'
     AND t.effective_clock_in <= ef.scheduled_start + interval '7.5 minutes'
    ) AS on_time_in,
    (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
     AND t.effective_clock_out >= ef.scheduled_end - interval '7.5 minutes'
     AND t.effective_clock_out <= ef.scheduled_end + interval '7.5 minutes'
    ) AS on_time_out,
    (ef.attendance_status = 'auto_clock_out') AS auto_clock_out
FROM episode_final ef
LEFT JOIN ts_agg t
    ON t.shift_id = ef.shift_id
    AND t.employee_id = ef.employee_id
    AND t.effective_clock_in >= ef.opened_at
    AND (ef.closed_at IS NULL OR t.effective_clock_in <= ef.closed_at);




-- ── 4b. Snapshot refresh fn: manual billable overrides win ─────────────────
CREATE OR REPLACE FUNCTION public.sm_refresh_shift_snapshots(p_shift_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 AS $function$
BEGIN
    IF p_shift_id IS NULL THEN
        RETURN;
    END IF;

    DELETE FROM public.assignment_snapshots WHERE shift_id = p_shift_id;

    INSERT INTO public.assignment_snapshots (
        shift_id, episode_seq, employee_id, source,
        became_active_at, ended_at, end_reason,
        attended, late_in, early_out, is_current,
        organization_id, department_id, sub_department_id,
        shift_date, scheduled_start, refreshed_at,
        early_in, late_out, on_time_in, on_time_out, auto_clock_out
    )
    WITH
    late_cancel_threshold AS (
        SELECT interval '4 hours' AS val
    ),
    ordered_events AS (
        SELECT
            se.id           AS event_id,
            se.shift_id,
            se.employee_id,
            se.event_type,
            se.event_time,
            se.metadata
        FROM public.shift_events se
        WHERE se.shift_id = p_shift_id          -- ← pushed to the lowest scan
          AND se.employee_id IS NOT NULL
    ),
    classified AS (
        SELECT
            oe.*,
            (oe.event_type IN ('ASSIGNED','OFFERED','EMERGENCY_ASSIGNED','SWAPPED_IN')) AS is_opening_type,
            (oe.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                               'SWAPPED_OUT','NO_SHOW','UNASSIGNED'))                    AS is_closing_type
        FROM ordered_events oe
    ),
    boundary_events AS (
        SELECT
            c.shift_id,
            c.event_id,
            c.event_time,
            c.employee_id,
            c.is_opening_type,
            LAG(c.is_closing_type) OVER w AS prev_boundary_was_closing,
            LAG(c.employee_id)     OVER w AS prev_boundary_employee
        FROM classified c
        WHERE c.is_opening_type OR c.is_closing_type
        WINDOW w AS (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id)
    ),
    boundary_starts AS (
        SELECT
            be.shift_id,
            be.event_id,
            CASE
                WHEN be.is_opening_type AND (
                         be.prev_boundary_employee IS NULL
                      OR be.prev_boundary_was_closing
                      OR be.employee_id IS DISTINCT FROM be.prev_boundary_employee
                     )
                THEN 1 ELSE 0
            END AS starts_new_episode
        FROM boundary_events be
    ),
    episode_assigned AS (
        SELECT
            c.*,
            SUM(COALESCE(bs.starts_new_episode, 0))
                OVER (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS episode_seq
        FROM classified c
        LEFT JOIN boundary_starts bs
               ON bs.shift_id = c.shift_id AND bs.event_id = c.event_id
    ),
    episode_agg AS (
        SELECT
            ea.shift_id,
            ea.episode_seq,
            (ARRAY_AGG(ea.employee_id ORDER BY ea.event_time, ea.event_id))[1] AS employee_id,
            MIN(ea.event_time) AS opened_at,
            MIN(ea.event_time) FILTER (
                WHERE ea.event_type IN ('ACCEPTED','EMERGENCY_ASSIGNED','SWAPPED_IN')
            ) AS became_active_at,
            BOOL_OR(ea.event_type = 'OFFERED')              AS had_offer,
            BOOL_OR(ea.event_type = 'ACCEPTED')             AS had_accept,
            BOOL_OR(ea.event_type = 'ASSIGNED')             AS had_assign,
            BOOL_OR(ea.event_type = 'EMERGENCY_ASSIGNED')    AS had_emergency,
            BOOL_OR(ea.event_type = 'SWAPPED_IN')            AS had_swap_in,
            BOOL_OR(ea.event_type = 'CHECKED_IN')            AS had_checked_in,
            BOOL_OR(ea.event_type = 'LATE_IN')               AS had_late_in_event,
            BOOL_OR(ea.event_type = 'EARLY_OUT')             AS had_early_out_event,
            (ARRAY_AGG(ea.event_type ORDER BY ea.event_time DESC, ea.event_id DESC)
                FILTER (WHERE ea.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                                 'SWAPPED_OUT','NO_SHOW','UNASSIGNED')))[1]
                AS closing_event_type,
            (ARRAY_AGG(ea.event_time ORDER BY ea.event_time DESC, ea.event_id DESC)
                FILTER (WHERE ea.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                                 'SWAPPED_OUT','NO_SHOW','UNASSIGNED')))[1]
                AS closing_event_time
        FROM episode_assigned ea
        WHERE ea.episode_seq > 0
        GROUP BY ea.shift_id, ea.episode_seq
    ),
    episode_with_shift AS (
        SELECT
            ep.*,
            MAX(ep.episode_seq) OVER (PARTITION BY ep.shift_id) AS max_episode_seq,
            s.shift_date,
            s.organization_id,
            s.department_id,
            s.sub_department_id,
            s.lifecycle_status,
            s.deleted_at,
            s.scheduled_start,
            s.scheduled_end,
            s.attendance_status,
            lct.val AS late_cancel_threshold
        FROM episode_agg ep
        JOIN public.shifts s ON s.id = ep.shift_id
        CROSS JOIN late_cancel_threshold lct
    ),
    episode_final AS (
        SELECT
            ews.shift_id,
            ews.episode_seq,
            ews.employee_id,
            ews.opened_at,
            ews.became_active_at,
            ews.closing_event_time AS closed_at,
            CASE
                WHEN ews.deleted_at IS NOT NULL THEN 'shift_deleted'
                WHEN ews.closing_event_type = 'REJECTED'       THEN 'rejected'
                WHEN ews.closing_event_type = 'IGNORED'        THEN 'ignored'
                WHEN ews.closing_event_type = 'SWAPPED_OUT'    THEN 'swapped_out'
                WHEN ews.closing_event_type = 'NO_SHOW'        THEN 'no_show'
                WHEN ews.closing_event_type = 'UNASSIGNED'     THEN 'unassigned'
                WHEN ews.closing_event_type IN ('CANCELLED', 'LATE_CANCELLED') THEN
                    CASE
                        WHEN ews.scheduled_start IS NOT NULL
                             AND ews.closing_event_time IS NOT NULL
                             AND (ews.scheduled_start - ews.closing_event_time) <= ews.late_cancel_threshold
                        THEN 'cancelled_late'
                        ELSE 'cancelled_standard'
                    END
                WHEN ews.closing_event_type IS NULL
                     AND ews.lifecycle_status = 'Completed'
                     AND ews.episode_seq = ews.max_episode_seq THEN 'fulfilled'
                ELSE 'open'
            END AS terminal_outcome,
            ews.had_accept,
            ews.had_emergency,
            ews.had_swap_in,
            COALESCE(ews.had_checked_in, FALSE) AS attended_from_events,
            COALESCE(ews.had_late_in_event, FALSE) AS late_in_from_events,
            COALESCE(ews.had_early_out_event, FALSE) AS early_out_from_events,
            ews.shift_date,
            ews.organization_id,
            ews.department_id,
            ews.sub_department_id,
            ews.scheduled_start,
            ews.scheduled_end,
            ews.attendance_status
        FROM episode_with_shift ews
    ),
    ts_agg AS (
        SELECT
            ts.shift_id,
            ts.employee_id,
            MIN(ts.clock_in)  AS clock_in,
            MAX(ts.clock_out) AS clock_out,
            MIN(
                -- Manager-adjusted billable start (timesheets.start_time is only
                -- ever persisted on a manual edit) OVERRIDES the raw clock-in —
                -- the `*` on the Live Rules badge flows into the metrics.
                COALESCE(
                    (ts.work_date + ts.start_time) AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney'),
                    ts.clock_in
                )
            ) AS effective_clock_in,
            MAX(
                -- Manager-adjusted billable end overrides the raw clock-out.
                COALESCE(
                    (CASE WHEN ts.end_time < ts.start_time THEN ts.work_date + interval '1 day' + ts.end_time ELSE ts.work_date + ts.end_time END) AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney'),
                    ts.clock_out
                )
            ) AS effective_clock_out
        FROM public.timesheets ts
        JOIN public.shifts s ON s.id = ts.shift_id
        WHERE ts.shift_id = p_shift_id          -- ← pushed to the lowest scan
        GROUP BY ts.shift_id, ts.employee_id
    ),
    episodes_for_shift AS (
        SELECT
            ef.shift_id,
            ef.episode_seq,
            ef.employee_id,
            ef.opened_at,
            ef.closed_at,
            ef.terminal_outcome,
            ef.had_accept,
            ef.had_emergency,
            ef.had_swap_in,
            (ef.attended_from_events OR t.clock_in IS NOT NULL) AS attended,
            (ef.late_in_from_events
                OR (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
                    AND t.effective_clock_in > ef.scheduled_start + interval '7.5 minutes')
            ) AS late_in,
            (ef.early_out_from_events
                OR (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
                    AND t.effective_clock_out < ef.scheduled_end - interval '7.5 minutes')
            ) AS early_out,
            ef.shift_date,
            ef.organization_id,
            ef.department_id,
            ef.sub_department_id,
            ef.became_active_at,
            ef.scheduled_start,
            -- Attendance additions
            (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
             AND t.effective_clock_in < ef.scheduled_start - interval '7.5 minutes'
            ) AS early_in,
            (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
             AND t.effective_clock_out > ef.scheduled_end + interval '7.5 minutes'
            ) AS late_out,
            (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
             AND t.effective_clock_in >= ef.scheduled_start - interval '7.5 minutes'
             AND t.effective_clock_in <= ef.scheduled_start + interval '7.5 minutes'
            ) AS on_time_in,
            (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
             AND t.effective_clock_out >= ef.scheduled_end - interval '7.5 minutes'
             AND t.effective_clock_out <= ef.scheduled_end + interval '7.5 minutes'
            ) AS on_time_out,
            ef.attendance_status
        FROM episode_final ef
        LEFT JOIN ts_agg t
            ON t.shift_id = ef.shift_id
            AND t.employee_id = ef.employee_id
            AND t.effective_clock_in >= ef.opened_at
            AND (ef.closed_at IS NULL OR t.effective_clock_in <= ef.closed_at)
    )
    SELECT
        ep.shift_id,
        ep.episode_seq,
        ep.employee_id,
        CASE
            WHEN ep.had_emergency THEN 'emergency'
            WHEN ep.had_swap_in   THEN 'trade_approve'
            WHEN EXISTS (
                SELECT 1
                FROM public.shift_events se
                WHERE se.shift_id = ep.shift_id
                  AND se.event_type = 'ASSIGNED'
                  AND se.metadata->>'op' = 'select_winner'
                  AND se.event_time >= ep.opened_at
                  AND (ep.closed_at IS NULL OR se.event_time <= ep.closed_at)
            ) THEN 'bid_win'
            ELSE 'publish_confirm'
        END AS source,
        COALESCE(ep.became_active_at, ep.opened_at) AS became_active_at,
        ep.closed_at AS ended_at,
        CASE
            WHEN ep.terminal_outcome = 'fulfilled'          THEN 'worked'
            WHEN ep.terminal_outcome = 'cancelled_standard' THEN 'dropped_std'
            WHEN ep.terminal_outcome = 'cancelled_late'     THEN 'dropped_late'
            WHEN ep.terminal_outcome = 'no_show'            THEN 'no_show'
            WHEN ep.terminal_outcome = 'swapped_out'        THEN 'traded_out'
            WHEN ep.terminal_outcome = 'unassigned'         THEN 'reassigned'
            WHEN ep.terminal_outcome = 'open'
                 AND ep.episode_seq < MAX(ep.episode_seq) OVER (PARTITION BY ep.shift_id)
                                                             THEN 'reassigned'
            WHEN ep.terminal_outcome = 'open'               THEN NULL
            ELSE NULL
        END AS end_reason,
        ep.attended,
        ep.late_in,
        ep.early_out,
        (ep.terminal_outcome = 'open'
            AND ep.episode_seq = MAX(ep.episode_seq) OVER (PARTITION BY ep.shift_id))
                                                            AS is_current,
        ep.organization_id,
        ep.department_id,
        ep.sub_department_id,
        ep.shift_date,
        ep.scheduled_start,
        now() AS refreshed_at,
        ep.early_in,
        ep.late_out,
        ep.on_time_in,
        ep.on_time_out,
        (ep.attendance_status = 'auto_clock_out') AS auto_clock_out
    FROM episodes_for_shift ep
    WHERE (ep.had_accept OR ep.had_emergency OR ep.had_swap_in)
      AND ep.terminal_outcome <> 'shift_deleted';
END;
$function$;


-- ── 5a. Reclassify historical Pass-5 fabrications ──────────────────────────
-- Pass 5 stamped actual_end = scheduled end with note 'auto_clocked_out' while
-- leaving attendance_status at checked_in/late. Those were never real
-- clock-outs: reclassify as auto clock-outs and null the fabricated actuals.
-- Rows a manager has since corrected (actual_end ≠ scheduled end) are kept.
UPDATE public.shifts s SET
  attendance_status  = 'auto_clock_out',
  actual_end         = NULL,
  actual_net_minutes = NULL,
  attendance_note    = 'Auto-completed by system (12.5hr limit)',
  updated_at         = now()
WHERE s.attendance_note = 'auto_clocked_out'
  AND s.attendance_status IN ('checked_in', 'late')
  AND s.actual_end IS NOT DISTINCT FROM COALESCE(
        s.end_at,
        (s.shift_date::text || ' ' || s.end_time::text || ' Australia/Sydney')::TIMESTAMPTZ);

-- ── 5b. Refresh snapshots for shifts whose flags may change ─────────────────
-- (auto clock-outs + any shift carrying a manual billable override)
DO $refresh$
DECLARE
    v_rec record;
BEGIN
    FOR v_rec IN
        SELECT DISTINCT x.shift_id
        FROM (
            SELECT id AS shift_id FROM public.shifts
            WHERE attendance_status = 'auto_clock_out'
            UNION
            SELECT ts.shift_id FROM public.timesheets ts
            WHERE ts.start_time IS NOT NULL OR ts.end_time IS NOT NULL
        ) x
    LOOP
        PERFORM public.sm_refresh_shift_snapshots(v_rec.shift_id);
    END LOOP;
END;
$refresh$;

-- ── 5c. Recompute quarter scorecards ────────────────────────────────────────
DO $recompute$
DECLARE
    v_rec record;
BEGIN
    FOR v_rec IN
        SELECT DISTINCT employee_id, quarter_year FROM public.employee_performance_metrics
    LOOP
        PERFORM public.compute_employee_quarter_metrics(v_rec.employee_id, v_rec.quarter_year);
    END LOOP;
END;
$recompute$;
