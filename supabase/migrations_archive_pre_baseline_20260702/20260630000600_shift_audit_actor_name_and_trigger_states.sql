-- =============================================================================
-- Shift Audit System — actor NAMES on the timeline + state slots on trigger rows.
-- =============================================================================
-- Two changes, both so the History timeline can render the canonical row format
--   {from_state} · {action} · {actor name (role)} · {to_state} · HH:MM:SS
-- for EVERY row, not just gateway/RPC-emitted ones:
--
--   1. get_shift_event_timeline gains an `actor_name` column (LEFT JOIN profiles
--      on actor_id). NULL when the event has no actor (cron/system) — the UI then
--      shows only the role chip.
--
--   2. fn_capture_shift_event stamps from_state/to_state into the metadata of the
--      trigger-emitted events (ASSIGNED / UNASSIGNED / OFFERED / ACCEPTED /
--      EMERGENCY_ASSIGNED / CANCELLED / LATE_CANCELLED / CHECKED_IN / LATE_IN /
--      NO_SHOW), which previously carried no state. Computed once per row as the
--      net FSM transition (OLD→NEW; NULL→NEW on INSERT). Forward-only: pre-existing
--      trigger rows keep NULL states (rendered as "—").
--
-- Both are idempotent (DROP+recreate / CREATE OR REPLACE). The capture body is
-- the live prod definition (verified) PLUS the metadata addition — no other
-- behaviour changes. The COMPLETED branch already carried its own from/to and is
-- left verbatim.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_shift_event_timeline — add actor_name.
--    Signature changes (new OUT column) → DROP first, then recreate.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS "public"."get_shift_event_timeline"("p_shift_id" "uuid");

CREATE OR REPLACE FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid")
RETURNS TABLE(
    "event_id"   "uuid",
    "event_time" timestamp with time zone,
    "domain"     "text",
    "event_type" "public"."shift_event_type",
    "op"         "text",
    "actor_id"   "uuid",
    "actor_role" "text",
    "actor_name" "text",
    "employee_id" "uuid",
    "from_state" "text",
    "to_state"   "text",
    "from_version" "text",
    "to_version" "text",
    "changes"    "jsonb",
    "reason"     "text"
)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Replicate the shift_events SELECT RLS gate (see 20260630000100 header).
    -- SECURITY DEFINER bypasses RLS, so authorize explicitly: managers see any
    -- shift's timeline; a non-manager only sees a shift they are a subject of.
    IF NOT (
        EXISTS (
            SELECT 1
            FROM public.user_contracts uc
            WHERE uc.user_id = (SELECT auth.uid())
              AND uc.access_level = ANY (ARRAY[
                    'alpha'::public.access_level,
                    'beta'::public.access_level,
                    'gamma'::public.access_level,
                    'delta'::public.access_level,
                    'epsilon'::public.access_level,
                    'zeta'::public.access_level])
              AND uc.status = 'Active'
        )
        OR public.user_has_delta_access((SELECT auth.uid()))
        OR EXISTS (
            SELECT 1
            FROM public.shift_events se_auth
            WHERE se_auth.shift_id = p_shift_id
              AND se_auth.employee_id = (SELECT auth.uid())
        )
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        se.id                                       AS event_id,
        se.event_time                               AS event_time,
        COALESCE(se.domain, se.metadata->>'domain') AS domain,
        se.event_type                               AS event_type,
        se.metadata->>'op'                          AS op,
        se.actor_id                                 AS actor_id,
        se.actor_role                               AS actor_role,
        -- Human-readable actor name; NULL when there is no actor (cron/system) or
        -- the profile is gone — the UI then falls back to the role chip alone.
        COALESCE(
            p.full_name,
            NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '')
        )                                           AS actor_name,
        se.employee_id                              AS employee_id,
        se.metadata->>'from_state'                  AS from_state,
        se.metadata->>'to_state'                    AS to_state,
        se.metadata->>'from_version'                AS from_version,
        se.metadata->>'to_version'                  AS to_version,
        se.metadata->'changes'                      AS changes,
        se.metadata->>'reason'                      AS reason
    FROM public.shift_events se
    LEFT JOIN public.shifts s ON s.id = se.shift_id
    LEFT JOIN public.profiles p ON p.id = COALESCE(
        se.actor_id,
        CASE
            WHEN se.actor_role = 'employee' THEN se.employee_id
            WHEN se.actor_role = 'manager' THEN s.last_modified_by
        END
    )
    WHERE se.shift_id = p_shift_id
    ORDER BY se.event_time ASC, se.created_at ASC;
END;
$$;

ALTER FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") IS
  'Shift Audit System read path: ordered event timeline for one shift from the '
  'public.shift_events ledger, with the actor''s display name. SECURITY DEFINER '
  'but re-implements the shift_events SELECT RLS gate (manager OR subject-of-shift).';

GRANT ALL ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") TO "service_role";

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. fn_capture_shift_event — stamp from_state/to_state on the trigger events.
--    Body is the verified-live definition; only addition is `metadata` carrying
--    the net FSM transition on the previously state-less inserts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_capture_shift_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    -- Net FSM transition for this row write, shared by every event it emits.
    -- v_from stays NULL on INSERT (there is no prior state).
    v_from text;
    v_to   text;
BEGIN
    IF current_setting('app.audit.via_gateway', true) = '1' THEN
        RETURN NEW;
    END IF;

    v_to := public.get_shift_fsm_state(NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome, NEW.trading_status, NEW.is_cancelled, NEW.bidding_status);
    IF (TG_OP = 'UPDATE') THEN
        v_from := public.get_shift_fsm_state(OLD.lifecycle_status, OLD.assignment_status, OLD.assignment_outcome, OLD.trading_status, OLD.is_cancelled, OLD.bidding_status);
    END IF;

    -- 1. ASSIGNED / UNASSIGNED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assigned_employee_id IS NOT NULL AND OLD.assigned_employee_id IS NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        ELSIF (NEW.assigned_employee_id IS NULL AND OLD.assigned_employee_id IS NOT NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, OLD.assigned_employee_id, 'UNASSIGNED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    ELSIF (TG_OP = 'INSERT') THEN
        IF (NEW.assigned_employee_id IS NOT NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    -- 2. OFFERED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.fulfillment_status = 'offered' AND OLD.fulfillment_status IS DISTINCT FROM 'offered') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OFFERED', COALESCE(NEW.offer_sent_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    -- 3. ACCEPTED / EMERGENCY_ASSIGNED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assignment_outcome = 'confirmed' AND OLD.assignment_outcome IS DISTINCT FROM 'confirmed') THEN
            IF (NEW.emergency_assigned_at IS NOT NULL
                AND OLD.emergency_assigned_at IS DISTINCT FROM NEW.emergency_assigned_at) THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', COALESCE(NEW.emergency_assigned_at, now()),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            ELSE
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'ACCEPTED', COALESCE(NEW.confirmed_at, now()),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            END IF;
        ELSIF (NEW.assignment_outcome = 'emergency_assigned' AND OLD.assignment_outcome IS DISTINCT FROM 'emergency_assigned') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', COALESCE(NEW.emergency_assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    -- 4. CANCELLED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Cancelled' AND OLD.lifecycle_status IS DISTINCT FROM 'Cancelled') THEN
            IF (NEW.start_at IS NOT NULL AND (NEW.start_at - now()) < interval '12 hours') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'LATE_CANCELLED', now(),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            END IF;

            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'CANCELLED', COALESCE(NEW.cancelled_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    -- 4b. COMPLETED — lifecycle -> Completed (already carries its own from/to).
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Completed' AND OLD.lifecycle_status IS DISTINCT FROM 'Completed') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OP_APPLIED', now(),
                jsonb_build_object(
                    'op', 'complete',
                    'domain', 'lifecycle',
                    'from_state', v_from,
                    'to_state',   v_to,
                    'source', 'fn_capture_shift_event'
                ),
                'lifecycle');
        END IF;
    END IF;

    -- 4c. PUBLISHED — lifecycle -> Published.
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Published' AND OLD.lifecycle_status IS DISTINCT FROM 'Published') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OP_APPLIED', now(),
                jsonb_build_object(
                    'op', 'publish',
                    'domain', 'lifecycle',
                    'from_state', v_from,
                    'to_state',   v_to,
                    'source', 'fn_capture_shift_event'
                ),
                'lifecycle');
        END IF;
    END IF;

    -- 5. ATTENDANCE (CHECKED_IN, LATE_IN, NO_SHOW)
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.attendance_status IS DISTINCT FROM OLD.attendance_status) THEN
            IF (NEW.attendance_status = 'checked_in') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'CHECKED_IN', COALESCE(NEW.actual_start, now()),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            ELSIF (NEW.attendance_status = 'late') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'LATE_IN', COALESCE(NEW.actual_start, now()),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            ELSIF (NEW.attendance_status = 'no_show') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'NO_SHOW', now(),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;
