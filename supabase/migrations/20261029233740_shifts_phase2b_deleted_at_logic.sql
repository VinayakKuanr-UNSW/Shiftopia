-- shifts Phase 2b (database, column kept): the last always-false deleted_at logic.
--
-- CHECK shifts_no_soft_delete keeps shifts.deleted_at NULL on every row, so:
--   * the `deleted_at IS NOT NULL` early returns in fn_shift_not_started,
--     fn_shift_office_is_ft_only and fn_shift_shape_day_typed_guard never fire;
--   * internal.trg_shift_eba_compliance's "restored from deleted" test and its
--     "deleted at commit" test are always false;
--   * sm_refresh_shift_snapshots and v_shift_assignment_episodes can never
--     produce the 'shift_deleted' outcome (nothing in the app or the database
--     reads that value);
--   * every partial index `WHERE deleted_at IS NULL` covers every row.
-- Each function and the view are rebuilt from their live definitions with only
-- those lines removed. Behaviour is identical.
--
-- Left for the column drop (after the app half ships): get_shift_delta still
-- returns deleted_at because the deployed app reads it; then DROP CONSTRAINT
-- shifts_no_soft_delete and DROP COLUMN deleted_at.
--
-- Plan: docs/handover/2026-10-30-shifts-table-plan.md.
-- Rollback: ~/Documents/superman-db-exports/2026-10-30/phase2b-deleted-at/
-- (live definitions, indexes.sql; SHA256SUMS).

CREATE OR REPLACE FUNCTION public.fn_shift_not_started()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_start timestamptz;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.shift_date IS NOT DISTINCT FROM NEW.shift_date
     AND OLD.start_time IS NOT DISTINCT FROM NEW.start_time THEN
    RETURN NEW;
  END IF;

  v_start := (NEW.shift_date || ' ' || NEW.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
  IF v_start <= now() THEN
    RAISE EXCEPTION 'A shift cannot start in the past: % at % (Sydney time) has already passed.',
      to_char(NEW.shift_date, 'Dy DD Mon'), to_char(NEW.start_time, 'HH24:MI')
      USING ERRCODE = 'check_violation', HINT = 'SHIFT_STARTED';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_shift_office_is_ft_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NEW.group_type::text = 'office'
       AND NEW.target_employment_type IS DISTINCT FROM 'FT' THEN
        RAISE EXCEPTION
            'The Office group holds full-time shifts only (target_employment_type = %).',
            COALESCE(NEW.target_employment_type, 'NULL')
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.target_employment_type = 'FT'
       AND NEW.group_type::text IS DISTINCT FROM 'office' THEN
        RAISE EXCEPTION
            'Full-time shifts belong in the Office group only (group = %).',
            COALESCE(NEW.group_type::text, 'NULL')
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_shift_shape_day_typed_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_breach text;
BEGIN
    IF COALESCE(NEW.is_cancelled, false) THEN
        RETURN NEW;
    END IF;

    v_breach := public.shift_day_typed_shortfall(
        NEW.shift_date,
        NEW.start_time,
        NEW.end_time,
        NEW.unpaid_break_minutes,
        NEW.target_employment_type,
        NEW.target_requires_flexible,
        NEW.is_training,
        NEW.role_id
    );

    IF v_breach IS NOT NULL THEN
        RAISE EXCEPTION '%', v_breach USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
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
       AND NEW.unpaid_break_minutes     IS NOT DISTINCT FROM OLD.unpaid_break_minutes
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

    -- At commit: the row as it finally stands, not as this event saw it.
    SELECT * INTO v_cur FROM public.shifts s WHERE s.id = NEW.id;
    IF NOT FOUND
       OR v_cur.assigned_employee_id IS NULL
       OR COALESCE(v_cur.is_cancelled, false)
       OR v_cur.lifecycle_status = 'Cancelled' THEN
        RETURN NULL;
    END IF;

    -- A shift written several times in one transaction is checked once per
    -- final version (trg_increment_shift_version bumps it on every UPDATE).
    v_key  := v_cur.id::text || ':' || v_cur.version::text;
    v_done := COALESCE(current_setting('eba.checked', true), '');
    IF strpos(v_done, v_key) > 0 THEN
        RETURN NULL;
    END IF;
    PERFORM set_config('eba.checked', v_done || ',' || v_key, true);

    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_cur.assigned_employee_id::text));

    SELECT r.rule_id, r.details INTO v_hit
      FROM internal.eba_check_assignment(v_cur.id, v_cur.assigned_employee_id) r
     WHERE r.tier = 'BLOCKING'
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
    WHERE (ep.had_accept OR ep.had_emergency OR ep.had_swap_in);
END;
$function$;

CREATE OR REPLACE VIEW public.v_shift_assignment_episodes
WITH (security_invoker = on) AS
 WITH late_cancel_threshold AS (
         SELECT '24:00:00'::interval AS val
        ), ordered_events AS (
         SELECT se.id AS event_id,
            se.shift_id,
            se.employee_id,
            se.event_type,
            se.event_time,
            se.metadata,
            row_number() OVER (PARTITION BY se.shift_id ORDER BY se.event_time, se.id) AS rn
           FROM shift_events se
          WHERE se.employee_id IS NOT NULL
        ), classified AS (
         SELECT oe.event_id,
            oe.shift_id,
            oe.employee_id,
            oe.event_type,
            oe.event_time,
            oe.metadata,
            oe.rn,
            oe.event_type = ANY (ARRAY['ASSIGNED'::shift_event_type, 'OFFERED'::shift_event_type, 'EMERGENCY_ASSIGNED'::shift_event_type, 'SWAPPED_IN'::shift_event_type]) AS is_opening_type,
            oe.event_type = ANY (ARRAY['REJECTED'::shift_event_type, 'IGNORED'::shift_event_type, 'CANCELLED'::shift_event_type, 'LATE_CANCELLED'::shift_event_type, 'SWAPPED_OUT'::shift_event_type, 'NO_SHOW'::shift_event_type, 'UNASSIGNED'::shift_event_type]) AS is_closing_type
           FROM ordered_events oe
        ), boundary_events AS (
         SELECT c.shift_id,
            c.event_id,
            c.event_time,
            c.employee_id,
            c.is_opening_type,
            lag(c.is_closing_type) OVER w AS prev_boundary_was_closing,
            lag(c.employee_id) OVER w AS prev_boundary_employee
           FROM classified c
          WHERE c.is_opening_type OR c.is_closing_type
          WINDOW w AS (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id)
        ), boundary_starts AS (
         SELECT be.shift_id,
            be.event_id,
                CASE
                    WHEN be.is_opening_type AND (be.prev_boundary_employee IS NULL OR be.prev_boundary_was_closing OR be.employee_id IS DISTINCT FROM be.prev_boundary_employee) THEN 1
                    ELSE 0
                END AS starts_new_episode
           FROM boundary_events be
        ), episode_assigned AS (
         SELECT c.event_id,
            c.shift_id,
            c.employee_id,
            c.event_type,
            c.event_time,
            c.metadata,
            c.rn,
            c.is_opening_type,
            c.is_closing_type,
            sum(COALESCE(bs.starts_new_episode, 0)) OVER (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS episode_seq
           FROM classified c
             LEFT JOIN boundary_starts bs ON bs.shift_id = c.shift_id AND bs.event_id = c.event_id
        ), episode_agg AS (
         SELECT ea.shift_id,
            ea.episode_seq,
            (array_agg(ea.employee_id ORDER BY ea.event_time, ea.event_id))[1] AS employee_id,
            min(ea.event_time) AS opened_at,
            min(ea.event_time) FILTER (WHERE ea.event_type = ANY (ARRAY['ACCEPTED'::shift_event_type, 'EMERGENCY_ASSIGNED'::shift_event_type, 'SWAPPED_IN'::shift_event_type])) AS became_active_at,
            bool_or(ea.event_type = 'OFFERED'::shift_event_type) AS had_offer,
            bool_or(ea.event_type = 'ACCEPTED'::shift_event_type) AS had_accept,
            bool_or(ea.event_type = 'ASSIGNED'::shift_event_type) AS had_assign,
            bool_or(ea.event_type = 'EMERGENCY_ASSIGNED'::shift_event_type) AS had_emergency,
            bool_or(ea.event_type = 'SWAPPED_IN'::shift_event_type) AS had_swap_in,
            bool_or(ea.event_type = 'CHECKED_IN'::shift_event_type) AS had_checked_in,
            bool_or(ea.event_type = 'LATE_IN'::shift_event_type) AS had_late_in_event,
            bool_or(ea.event_type = 'EARLY_OUT'::shift_event_type) AS had_early_out_event,
            (array_agg(ea.event_type ORDER BY ea.event_time DESC, ea.event_id DESC) FILTER (WHERE ea.event_type = ANY (ARRAY['REJECTED'::shift_event_type, 'IGNORED'::shift_event_type, 'CANCELLED'::shift_event_type, 'LATE_CANCELLED'::shift_event_type, 'SWAPPED_OUT'::shift_event_type, 'NO_SHOW'::shift_event_type, 'UNASSIGNED'::shift_event_type])))[1] AS closing_event_type,
            (array_agg(ea.event_time ORDER BY ea.event_time DESC, ea.event_id DESC) FILTER (WHERE ea.event_type = ANY (ARRAY['REJECTED'::shift_event_type, 'IGNORED'::shift_event_type, 'CANCELLED'::shift_event_type, 'LATE_CANCELLED'::shift_event_type, 'SWAPPED_OUT'::shift_event_type, 'NO_SHOW'::shift_event_type, 'UNASSIGNED'::shift_event_type])))[1] AS closing_event_time
           FROM episode_assigned ea
          WHERE ea.episode_seq > 0
          GROUP BY ea.shift_id, ea.episode_seq
        ), episode_with_shift AS (
         SELECT ep.shift_id,
            ep.episode_seq,
            ep.employee_id,
            ep.opened_at,
            ep.became_active_at,
            ep.had_offer,
            ep.had_accept,
            ep.had_assign,
            ep.had_emergency,
            ep.had_swap_in,
            ep.had_checked_in,
            ep.had_late_in_event,
            ep.had_early_out_event,
            ep.closing_event_type,
            ep.closing_event_time,
            max(ep.episode_seq) OVER (PARTITION BY ep.shift_id) AS max_episode_seq,
            s.shift_date,
            s.organization_id,
            s.department_id,
            s.sub_department_id,
            s.lifecycle_status,
            s.scheduled_start,
            s.scheduled_end,
            s.attendance_status,
            lct.val AS late_cancel_threshold
           FROM episode_agg ep
             JOIN shifts s ON s.id = ep.shift_id
             CROSS JOIN late_cancel_threshold lct
        ), episode_final AS (
         SELECT ews.shift_id,
            ews.episode_seq,
            ews.employee_id,
            ews.opened_at,
            ews.became_active_at,
            ews.closing_event_time AS closed_at,
                CASE
                    WHEN ews.had_emergency THEN 'EMERGENCY_ASSIGNED'::text
                    WHEN ews.had_swap_in THEN 'SWAPPED_IN'::text
                    WHEN ews.had_assign THEN 'ASSIGNED'::text
                    WHEN ews.had_offer THEN 'OFFERED'::text
                    ELSE 'ASSIGNED'::text
                END AS opening_event,
                CASE
                    WHEN ews.closing_event_type = 'REJECTED'::shift_event_type THEN 'rejected'::text
                    WHEN ews.closing_event_type = 'IGNORED'::shift_event_type THEN 'ignored'::text
                    WHEN ews.closing_event_type = 'SWAPPED_OUT'::shift_event_type THEN 'swapped_out'::text
                    WHEN ews.closing_event_type = 'NO_SHOW'::shift_event_type THEN 'no_show'::text
                    WHEN ews.closing_event_type = 'UNASSIGNED'::shift_event_type THEN 'unassigned'::text
                    WHEN ews.closing_event_type = ANY (ARRAY['CANCELLED'::shift_event_type, 'LATE_CANCELLED'::shift_event_type]) THEN
                    CASE
                        WHEN ews.scheduled_start IS NOT NULL AND ews.closing_event_time IS NOT NULL AND (ews.scheduled_start - ews.closing_event_time) <= ews.late_cancel_threshold THEN 'cancelled_late'::text
                        ELSE 'cancelled_standard'::text
                    END
                    WHEN ews.closing_event_type IS NULL AND ews.lifecycle_status = 'Completed'::shift_lifecycle AND ews.episode_seq = ews.max_episode_seq THEN 'fulfilled'::text
                    ELSE 'open'::text
                END AS terminal_outcome,
            ews.had_offer,
            ews.had_accept,
            ews.had_assign,
            ews.had_emergency,
            ews.had_swap_in,
            COALESCE(ews.had_checked_in, false) AS attended_from_events,
            COALESCE(ews.had_late_in_event, false) AS late_in_from_events,
            COALESCE(ews.had_early_out_event, false) AS early_out_from_events,
            ews.shift_date,
            ews.organization_id,
            ews.department_id,
            ews.sub_department_id,
            ews.scheduled_start,
            ews.scheduled_end,
            ews.lifecycle_status,
            ews.attendance_status
           FROM episode_with_shift ews
        ), ts_agg AS (
         SELECT ts.shift_id,
            ts.employee_id,
            min(ts.clock_in) AS clock_in,
            max(ts.clock_out) AS clock_out,
            min(COALESCE(((ts.work_date + ts.start_time) AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney'::character varying)), ts.clock_in)) AS effective_clock_in,
            max(COALESCE((
                CASE
                    WHEN ts.end_time < ts.start_time THEN ts.work_date + '1 day'::interval + ts.end_time::interval
                    ELSE ts.work_date + ts.end_time
                END AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney'::character varying)), ts.clock_out)) AS effective_clock_out
           FROM timesheets ts
             JOIN shifts s ON s.id = ts.shift_id
          GROUP BY ts.shift_id, ts.employee_id
        )
 SELECT ef.shift_id,
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
    ef.attended_from_events OR t.clock_in IS NOT NULL AS attended,
    ef.late_in_from_events OR t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL AND t.effective_clock_in > (ef.scheduled_start + '00:07:30'::interval) AS late_in,
    ef.early_out_from_events OR t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL AND t.effective_clock_out < (ef.scheduled_end - '00:07:30'::interval) AS early_out,
    ef.shift_date,
    ef.organization_id,
    ef.department_id,
    ef.sub_department_id,
    ef.became_active_at,
    ef.scheduled_start,
    t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL AND t.effective_clock_in < (ef.scheduled_start - '00:07:30'::interval) AS early_in,
    t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL AND t.effective_clock_out > (ef.scheduled_end + '00:07:30'::interval) AS late_out,
    t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL AND t.effective_clock_in >= (ef.scheduled_start - '00:07:30'::interval) AND t.effective_clock_in <= (ef.scheduled_start + '00:07:30'::interval) AS on_time_in,
    t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL AND t.effective_clock_out >= (ef.scheduled_end - '00:07:30'::interval) AND t.effective_clock_out <= (ef.scheduled_end + '00:07:30'::interval) AS on_time_out,
    ef.attendance_status = 'auto_clock_out'::shift_attendance_status AS auto_clock_out
   FROM episode_final ef
     LEFT JOIN ts_agg t ON t.shift_id = ef.shift_id AND t.employee_id = ef.employee_id AND t.effective_clock_in >= ef.opened_at AND (ef.closed_at IS NULL OR t.effective_clock_in <= ef.closed_at);

-- Indexes: drop the deleted_at index; rebuild the rest without the always-true
-- predicate (and the covering index without the always-NULL INCLUDE column).
DROP INDEX public.idx_shifts_deleted_at;

DROP INDEX public.idx_shifts_org_dept_date;
CREATE INDEX idx_shifts_org_dept_date ON public.shifts USING btree (organization_id, department_id, shift_date);

DROP INDEX public.idx_shifts_org_dept_subdept_date;
CREATE INDEX idx_shifts_org_dept_subdept_date ON public.shifts USING btree (organization_id, department_id, sub_department_id, shift_date);

DROP INDEX public.idx_shifts_summary_covering;
CREATE INDEX idx_shifts_summary_covering ON public.shifts USING btree (organization_id, shift_date, group_type, sub_group_name) INCLUDE (assigned_employee_id, lifecycle_status, is_cancelled, net_length_minutes);

DROP INDEX public.shifts_roster_template_instance_key;
CREATE UNIQUE INDEX shifts_roster_template_instance_key ON public.shifts USING btree (roster_id, template_instance_id) WHERE (template_instance_id IS NOT NULL);

DROP INDEX public.idx_shifts_dead_cleanup_candidates;
CREATE INDEX idx_shifts_dead_cleanup_candidates ON public.shifts USING btree (lifecycle_status, updated_at) INCLUDE (end_at) WHERE (assigned_employee_id IS NULL);
