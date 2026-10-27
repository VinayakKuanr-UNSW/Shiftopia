-- sm_bulk_assign_atomic: book only what the AutoScheduler preview checked.
--
-- The preview compliance-checks each proposal, then Apply calls this function.
-- Between the two anything can change a shift, and the old body checked only
-- that nobody else held it:
--
--   * A shift whose times, role or target were edited after preview was booked
--     on a compliance check made against the old shift. The DB EBA trigger still
--     enforces the legal rules, but availability and role eligibility have no DB
--     backstop. p_expected_versions maps shift id -> the version the preview
--     saw; a locked version that differs (every UPDATE bumps it:
--     trg_increment_shift_version), or a shift missing from the map, is refused
--     and returned in `conflicts`. Same contract as sm_bulk_publish_shifts
--     (20261025094258). NULL keeps the old behaviour.
--   * It assigned any lifecycle state, and stamped Published shifts straight to
--     `confirmed` with no offer. The AutoScheduler's scope is Draft only, and this
--     is its sole caller, so anything else is refused.
--   * `last_modified_by` came from caller-supplied p_user_id. Now auth.uid()
--     unless the request is system (sm_request_is_system), as in the precedent.
--   * Rows were locked one pair at a time, in payload order. All target shifts
--     are now locked up front in id order, so two commits cannot deadlock.
--
-- Idempotency is now structural rather than keyed: a shift already assigned to
-- the intended employee counts as booked and is not rewritten, so a retried
-- Apply is a no-op for whatever the first attempt landed. The old key was
-- minted fresh per attempt by the only caller, so it never matched, and it was
-- replayed BEFORE the authorization check. Parameter and table are removed.
--
-- Body built from the live pg_get_functiondef on 2026-10-27; the authz guard
-- (role + per-shift scope) is kept verbatim.

DROP FUNCTION public.sm_bulk_assign_atomic(jsonb, uuid, uuid);
DROP TABLE public.bulk_assign_idempotency;

CREATE FUNCTION public.sm_bulk_assign_atomic(
    p_assignments jsonb,
    p_user_id uuid DEFAULT auth.uid(),
    p_expected_versions jsonb DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_caller        uuid := auth.uid();
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
    v_booked_ids        uuid[];
    v_shift_id          uuid;
BEGIN
    PERFORM set_config('app.audit.actor', 'autoscheduler', true);

    IF NOT public.sm_request_is_system() THEN
        IF NOT (
               (EXISTS (
                    SELECT 1 FROM public.app_access_certificates c
                    WHERE c.user_id = v_caller
                      AND c.is_active = true
                      AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
                  )
               -- scope guard (20261011 access matrix): every shift in every pair
               -- must be one the caller may assign in its own place.
               AND NOT EXISTS (
                    SELECT 1
                      FROM jsonb_array_elements(COALESCE(p_assignments, '[]'::jsonb)) AS pr(v),
                           jsonb_array_elements_text(COALESCE(pr.v->'shift_ids', '[]'::jsonb)) AS e(id)
                      JOIN public.shifts s ON s.id = e.id::uuid
                     WHERE NOT public.user_has_action_in_scope('shift.assign', s.organization_id, s.department_id, s.sub_department_id)))
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
        -- The audit trail names the caller, never a value the caller supplied.
        p_user_id := v_caller;
    END IF;

    -- Lock every target shift first, in id order.
    PERFORM 1
      FROM public.shifts s
     WHERE s.id IN (
            SELECT e.id::uuid
              FROM jsonb_array_elements(COALESCE(p_assignments, '[]'::jsonb)) AS pr(v),
                   jsonb_array_elements_text(COALESCE(pr.v->'shift_ids', '[]'::jsonb)) AS e(id))
     ORDER BY s.id
       FOR UPDATE;

    FOR v_pair IN SELECT * FROM jsonb_array_elements(p_assignments)
    LOOP
        v_employee_id := (v_pair->>'employee_id')::uuid;
        v_shift_ids   := ARRAY(
            SELECT (elem::text)::uuid
            FROM jsonb_array_elements_text(v_pair->'shift_ids') AS elem
        );
        v_pair_total    := array_length(v_shift_ids, 1);
        v_pair_conflicts := '[]'::jsonb;

        IF v_pair_total IS NULL OR v_pair_total = 0 THEN
            CONTINUE;
        END IF;

        v_total_requested := v_total_requested + v_pair_total;

        -- Book: unassigned Drafts unchanged since the preview checked them.
        WITH updated_rows AS (
            UPDATE public.shifts s SET
                assigned_employee_id = v_employee_id,
                assignment_status    = 'assigned'::public.shift_assignment_status,
                updated_at           = NOW(),
                last_modified_by     = p_user_id
            WHERE s.id = ANY(v_shift_ids)
              AND s.deleted_at IS NULL
              AND s.assigned_employee_id IS NULL
              AND s.lifecycle_status::text = 'Draft'
              AND (p_expected_versions IS NULL
                   OR (p_expected_versions ->> s.id::text)::int IS NOT DISTINCT FROM s.version)
            RETURNING s.id
        )
        SELECT COALESCE(array_agg(id), '{}') INTO v_booked_ids FROM updated_rows;

        -- Already this employee's (a retried Apply): booked, not rewritten.
        v_booked_ids := v_booked_ids || ARRAY(
            SELECT s.id FROM public.shifts s
             WHERE s.id = ANY(v_shift_ids)
               AND s.deleted_at IS NULL
               AND s.assigned_employee_id = v_employee_id
               AND NOT (s.id = ANY(v_booked_ids))
        );

        v_pair_success := COALESCE(array_length(v_booked_ids, 1), 0);

        FOREACH v_shift_id IN ARRAY v_shift_ids LOOP
            IF NOT (v_shift_id = ANY(v_booked_ids)) THEN
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

    RETURN jsonb_build_object(
        'success',         true,
        'total_requested', v_total_requested,
        'success_count',   v_total_success,
        'conflict_count',  v_total_conflict,
        'conflicts',       v_all_conflicts,
        'per_employee',    v_per_employee
    );

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

REVOKE ALL ON FUNCTION public.sm_bulk_assign_atomic(jsonb, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sm_bulk_assign_atomic(jsonb, uuid, jsonb) TO authenticated, service_role;
