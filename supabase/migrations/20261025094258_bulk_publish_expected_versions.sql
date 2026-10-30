-- sm_bulk_publish_shifts: refuse a shift that changed after the app checked it.
--
-- The app compliance-checks each shift, then calls this function. Between the
-- two, anything can change the shift — the autoscheduler assigning an
-- unassigned draft, another manager reassigning one. This function re-read the
-- state under lock and published from it, so a shift checked as "unassigned,
-- nobody to check" and assigned a second later was sent as an offer to someone
-- no compliance check ever saw.
--
-- p_expected_versions maps shift id -> the version the check saw. A shift whose
-- locked version differs (every UPDATE bumps it: trg_increment_shift_version),
-- or that is missing from the map, is not published and comes back in
-- `stale_ids`. NULL keeps the old behaviour for the SQL callers that run no
-- check of their own (publish_roster_for_range, apply_template_to_date_range_v2).
--
-- Built from the live pg_get_functiondef (md5 845fe490df57017bcf35f7e34a81b924,
-- 2026-10-25) so the 2026-10-13 authz guard and the 2026-10-18 lock-first CTE
-- are kept. A new parameter is a new signature: the old one is dropped so
-- PostgREST never sees two overloads.

DROP FUNCTION IF EXISTS public.sm_bulk_publish_shifts(uuid[], uuid);

CREATE FUNCTION public.sm_bulk_publish_shifts(
    p_shift_ids uuid[],
    p_actor_id uuid DEFAULT auth.uid(),
    p_expected_versions jsonb DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_total_count int;
    v_success_count int;
    v_stale_ids uuid[];
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
            s.version,
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
    -- Changed since the caller's check (or never checked): not published.
    stale AS (
        SELECT l.id
        FROM locked l
        WHERE p_expected_versions IS NOT NULL
          AND (p_expected_versions ->> l.id::text)::int IS DISTINCT FROM l.version
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
        WHERE l.id NOT IN (SELECT id FROM stale)
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
    SELECT
        (SELECT count(*) FROM updated_rows),
        (SELECT COALESCE(array_agg(id), '{}') FROM stale)
    INTO v_success_count, v_stale_ids;

    RETURN jsonb_build_object(
        'success', true,
        'total_requested', v_total_count,
        'success_count', v_success_count,
        'failure_count', v_total_count - v_success_count,
        'stale_ids', to_jsonb(v_stale_ids),
        'message', format('Successfully published %s of %s shifts', v_success_count, v_total_count)
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error in sm_bulk_publish_shifts: %', SQLERRM;
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- A dropped function loses its grants; restore exactly the live set
-- (authenticated, service_role, postgres) and keep it off anon and PUBLIC.
REVOKE ALL ON FUNCTION public.sm_bulk_publish_shifts(uuid[], uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sm_bulk_publish_shifts(uuid[], uuid, jsonb) TO authenticated, service_role;
