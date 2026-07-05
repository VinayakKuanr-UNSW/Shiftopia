-- =============================================================================
-- Shift Audit System — make the ledger autoscheduler-aware.
-- =============================================================================
-- The autoscheduler commits assignments via sm_bulk_assign_atomic (its exclusive
-- caller is AutoSchedulerController → assignment-committer.commitAtomic). That
-- write fires fn_capture_shift_event's ASSIGNED branch, which — like a manual
-- assign — produced a generic "Assigned" attributed to Manager/System, with no
-- way to tell an auto-scheduled assignment from a hand-made one.
--
-- Fix (mirrors the gateway's `via_gateway` GUC pattern, so attribution is precise
-- to THIS write — no stale-column risk):
--   1. sm_bulk_assign_atomic sets a txn-local GUC app.audit.actor='autoscheduler'.
--   2. fn_capture_shift_event reads it and stamps the ASSIGNED event with
--      actor_role='autoscheduler' + metadata.source='autoscheduler'. All other
--      assign paths are unchanged (actor_role left NULL → enrich → 'manager').
--
-- Both CREATE OR REPLACE (no signature change), idempotent.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. sm_bulk_assign_atomic — tag the transaction as autoscheduler-driven.
--    Body is the live definition verbatim PLUS the single set_config call.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_bulk_assign_atomic(p_assignments jsonb, p_user_id uuid DEFAULT auth.uid(), p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_caller        uuid := auth.uid();
    v_user_name     text;
    v_user_role     text;
    v_pair          jsonb;
    v_employee_id   uuid;
    v_shift_ids     uuid[];
    v_pair_total    int;
    v_pair_success  int;
    v_pair_conflicts jsonb;
    v_total_requested   int := 0;
    v_total_success     int := 0;
    v_total_conflict    int := 0;
    v_per_employee      jsonb := '[]'::jsonb;
    v_all_conflicts     jsonb := '[]'::jsonb;
    v_updated_ids       uuid[];
    v_shift_id          uuid;
    v_final_result      jsonb;
    v_stored_result     jsonb;
BEGIN
    -- AUDIT: this RPC is the autoscheduler's exclusive commit path, so tag the
    -- whole transaction. fn_capture_shift_event reads this and attributes the
    -- ASSIGNED events to the Auto-Scheduler rather than the running manager.
    PERFORM set_config('app.audit.actor', 'autoscheduler', true);

    IF p_idempotency_key IS NOT NULL THEN
        SELECT result INTO v_stored_result
        FROM public.bulk_assign_idempotency
        WHERE key = p_idempotency_key;
        IF FOUND THEN
            RETURN v_stored_result;
        END IF;
    END IF;

    IF v_caller IS NOT NULL AND NOT (
           public.is_manager_or_above()
           OR public.is_admin()
           OR EXISTS (
                SELECT 1 FROM public.app_access_certificates c
                WHERE c.user_id = v_caller
                  AND c.is_active = true
                  AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
              )
         ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Not authorized to assign shifts',
            'total_requested', 0,
            'success_count', 0,
            'conflict_count', 0,
            'conflicts', '[]'::jsonb,
            'per_employee', '[]'::jsonb
        );
    END IF;

    IF p_user_id IS NOT NULL THEN
        SELECT COALESCE(first_name || ' ' || COALESCE(last_name, ''), email),
               left(lower(legacy_system_role::text), 50)
        INTO v_user_name, v_user_role
        FROM public.profiles
        WHERE id = p_user_id;
    ELSE
        v_user_name := 'System';
        v_user_role := 'system_automation';
    END IF;

    FOR v_pair IN SELECT * FROM jsonb_array_elements(p_assignments)
    LOOP
        v_employee_id := (v_pair->>'employee_id')::uuid;
        v_shift_ids   := ARRAY(
            SELECT (elem::text)::uuid
            FROM jsonb_array_elements_text(v_pair->'shift_ids') AS elem
        );
        v_pair_total    := array_length(v_shift_ids, 1);
        v_pair_success  := 0;
        v_pair_conflicts := '[]'::jsonb;
        v_updated_ids   := '{}';

        IF v_pair_total IS NULL OR v_pair_total = 0 THEN
            CONTINUE;
        END IF;

        v_total_requested := v_total_requested + v_pair_total;

        WITH updated_rows AS (
            UPDATE public.shifts s SET
                assigned_employee_id = v_employee_id,
                assignment_status    = 'assigned'::public.shift_assignment_status,
                assignment_outcome   = CASE
                                         WHEN s.lifecycle_status = 'Published'
                                         THEN 'confirmed'::public.shift_assignment_outcome
                                         ELSE s.assignment_outcome
                                       END,
                confirmed_at         = CASE
                                         WHEN s.lifecycle_status = 'Published'
                                         THEN NOW()
                                         ELSE s.confirmed_at
                                       END,
                updated_at           = NOW(),
                last_modified_by     = p_user_id
            WHERE s.id = ANY(v_shift_ids)
              AND s.deleted_at IS NULL
              AND (s.assigned_employee_id IS NULL OR s.assigned_employee_id = v_employee_id)
            RETURNING s.id
        )
        SELECT array_agg(id) INTO v_updated_ids FROM updated_rows;

        IF v_updated_ids IS NULL THEN
            v_updated_ids := '{}';
        END IF;

        v_pair_success := array_length(v_updated_ids, 1);
        IF v_pair_success IS NULL THEN v_pair_success := 0; END IF;

        FOREACH v_shift_id IN ARRAY v_shift_ids LOOP
            IF NOT (v_shift_id = ANY(v_updated_ids)) THEN
                v_pair_conflicts := v_pair_conflicts || to_jsonb(v_shift_id::text);
                v_all_conflicts  := v_all_conflicts  || to_jsonb(v_shift_id::text);
            END IF;
        END LOOP;

        v_total_success  := v_total_success  + v_pair_success;
        v_total_conflict := v_total_conflict + (v_pair_total - v_pair_success);

        v_per_employee := v_per_employee || jsonb_build_object(
            'employee_id', v_employee_id,
            'committed',   v_pair_success,
            'conflicts',   v_pair_conflicts
        );
    END LOOP;

    v_final_result := jsonb_build_object(
        'success',         true,
        'total_requested', v_total_requested,
        'success_count',   v_total_success,
        'conflict_count',  v_total_conflict,
        'conflicts',       v_all_conflicts,
        'per_employee',    v_per_employee
    );

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.bulk_assign_idempotency (key, result)
        VALUES (p_idempotency_key, v_final_result)
        ON CONFLICT (key) DO NOTHING;
    END IF;

    RETURN v_final_result;

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error in sm_bulk_assign_atomic: %', SQLERRM;
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'total_requested', v_total_requested,
        'success_count', 0,
        'conflict_count', 0,
        'conflicts', '[]'::jsonb,
        'per_employee', '[]'::jsonb
    );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. fn_capture_shift_event — attribute ASSIGNED to the autoscheduler when tagged.
--    Body is migration 20260630000800 verbatim PLUS: a v_auto flag and the
--    actor_role/source stamp on the two ASSIGNED inserts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_capture_shift_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_from  text;
    v_to    text;
    v_actor uuid;
    v_auto  boolean;
BEGIN
    IF current_setting('app.audit.via_gateway', true) = '1' THEN
        RETURN NEW;
    END IF;

    v_actor := auth.uid();
    -- Autoscheduler-driven write? (set by sm_bulk_assign_atomic for this txn.)
    v_auto  := COALESCE(current_setting('app.audit.actor', true), '') = 'autoscheduler';
    v_to := public.get_shift_fsm_state(NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome, NEW.trading_status, NEW.is_cancelled, NEW.bidding_status);
    IF (TG_OP = 'UPDATE') THEN
        v_from := public.get_shift_fsm_state(OLD.lifecycle_status, OLD.assignment_status, OLD.assignment_outcome, OLD.trading_status, OLD.is_cancelled, OLD.bidding_status);
    END IF;

    -- 1. ASSIGNED / UNASSIGNED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assigned_employee_id IS NOT NULL AND OLD.assigned_employee_id IS NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to)
                      || CASE WHEN v_auto THEN jsonb_build_object('source', 'autoscheduler') ELSE '{}'::jsonb END,
                    CASE WHEN v_auto THEN 'autoscheduler' ELSE NULL END);
        ELSIF (NEW.assigned_employee_id IS NULL AND OLD.assigned_employee_id IS NOT NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, OLD.assigned_employee_id, 'UNASSIGNED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    ELSIF (TG_OP = 'INSERT') THEN
        IF (NEW.assigned_employee_id IS NOT NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to)
                      || CASE WHEN v_auto THEN jsonb_build_object('source', 'autoscheduler') ELSE '{}'::jsonb END,
                    CASE WHEN v_auto THEN 'autoscheduler' ELSE NULL END);
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

    -- 4a. PUBLISHED — skipped when this write is an emergency assignment.
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Published' AND OLD.lifecycle_status IS DISTINCT FROM 'Published'
            AND NOT (NEW.emergency_assigned_at IS NOT NULL
                     AND OLD.emergency_assigned_at IS DISTINCT FROM NEW.emergency_assigned_at)) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', now(),
                jsonb_build_object('op', 'publish', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event'),
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle');
        END IF;
    END IF;

    -- 4b. COMPLETED — lifecycle -> Completed.
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

    -- 4c. IN PROGRESS — lifecycle -> InProgress (S4 -> S11).
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'InProgress' AND OLD.lifecycle_status IS DISTINCT FROM 'InProgress') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', COALESCE(NEW.actual_start, now()),
                jsonb_build_object('op', 'in_progress', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event'),
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'employee' END, 'lifecycle');
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