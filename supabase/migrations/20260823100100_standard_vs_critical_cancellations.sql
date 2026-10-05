-- ============================================================================
-- Standard vs CRITICAL cancellations, split at 24h notice.
--
-- Two changes that belong together:
--
--   1. sm_employee_drop_shift moves its cutoff from 4h to 24h, emits
--      'critical' rather than 'urgent', and additionally stamps the three-band
--      shift URGENCY (normal / urgent / emergent) on the event. The two are
--      different questions: a drop at 2h notice is a CRITICAL cancellation
--      taken in the EMERGENT band. Recording both keeps an emergent breakdown
--      derivable later without a schema change.
--
--      Self-service cannot reach the emergent band — the drop button is locked
--      inside 4h — so an emergent-band drop only arrives via a manager or
--      override path. That is now visible in the data rather than an accident
--      of thresholds.
--
--   2. get_kpi_behaviour_summary renames its cancellation outputs from
--      "urgent" to "critical". "Urgent" is one of the urgency bands and means
--      4h < TTS <= 24h; reusing it for a cancellation kind made the two
--      concepts collide. DROP first — output column names are part of the
--      signature.
--
-- Verified against production in a rolled-back subtransaction:
--   72h notice -> standard / normal   / episode cancelled_standard
--   10h notice -> critical / urgent   / episode cancelled_late
--    2h notice -> critical / emergent / episode cancelled_late
--
-- Pairs with 20260823100000, which moves the same boundary inside
-- v_shift_assignment_episodes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sm_employee_drop_shift(
    p_shift_id    uuid,
    p_employee_id uuid DEFAULT auth.uid(),
    p_reason      text DEFAULT NULL::text,
    p_reason_code text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_shift          RECORD;
    v_state          text;
    v_reason         public.cancellation_reasons%ROWTYPE;
    v_notice         interval;
    v_notice_hours   numeric;
    v_is_critical    boolean;
    v_urgency        text;
    v_event_type     public.shift_event_type;
    -- Standard vs critical. NOT the same line as the emergent lockout.
    v_cancel_cutoff  constant interval := interval '24 hours';
    -- Urgent vs emergent. Mirrors EMERGENT_WINDOW_MS in bidding-urgency.ts.
    v_emergent_cutoff constant interval := interval '4 hours';
BEGIN
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND deleted_at IS NULL FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
    END IF;

    IF v_shift.assigned_employee_id IS DISTINCT FROM p_employee_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You are not assigned to this shift');
    END IF;

    v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status,
                                          v_shift.assignment_outcome, v_shift.trading_status,
                                          v_shift.is_cancelled);

    IF v_state NOT IN ('S3', 'S4') THEN
        RETURN jsonb_build_object('success', false,
            'error', format('sm_employee_drop_shift requires state S3 or S4, current state is %s', v_state));
    END IF;

    IF p_reason_code IS NOT NULL THEN
        SELECT * INTO v_reason
        FROM public.cancellation_reasons
        WHERE code = p_reason_code AND is_active;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false,
                'error', format('Unknown cancellation reason: %s', p_reason_code));
        END IF;

        IF v_reason.requires_note AND COALESCE(btrim(p_reason), '') = '' THEN
            RETURN jsonb_build_object('success', false,
                'error', format('Reason "%s" requires a note', v_reason.label));
        END IF;
    END IF;

    v_notice       := v_shift.start_at - now();
    v_notice_hours := ROUND(EXTRACT(epoch FROM v_notice)::numeric / 3600, 2);
    v_is_critical  := v_shift.start_at IS NOT NULL AND v_notice <= v_cancel_cutoff;
    v_urgency      := CASE
                          WHEN v_shift.start_at IS NULL             THEN 'normal'
                          WHEN v_notice <= v_emergent_cutoff        THEN 'emergent'
                          WHEN v_notice <= v_cancel_cutoff          THEN 'urgent'
                          ELSE 'normal'
                      END;
    v_event_type   := CASE WHEN v_is_critical THEN 'LATE_CANCELLED' ELSE 'CANCELLED' END::public.shift_event_type;

    PERFORM set_config('app.audit.employee_drop', '1', true);

    UPDATE public.shifts SET
        assigned_employee_id = NULL,
        assigned_at          = NULL,
        assignment_status    = 'unassigned'::public.shift_assignment_status,
        assignment_outcome   = NULL,
        bidding_status       = 'on_bidding'::public.shift_bidding_status,
        is_on_bidding        = TRUE,
        fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
        confirmed_at         = NULL,
        last_dropped_by      = p_employee_id,
        last_rejected_by     = NULL,
        last_modified_by     = p_employee_id,
        updated_at           = NOW()
    WHERE id = p_shift_id;

    PERFORM set_config('app.audit.employee_drop', '0', true);

    INSERT INTO public.shift_events
        (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
    VALUES (
        p_shift_id,
        p_employee_id,
        p_employee_id,
        v_event_type,
        now(),
        jsonb_build_object(
            'op',           'employee_drop',
            'from_state',   v_state,
            'to_state',     'S5',
            'cancellation', CASE WHEN v_is_critical THEN 'critical' ELSE 'standard' END,
            'urgency',      v_urgency,
            'notice_hours', v_notice_hours,
            'source',       'sm_employee_drop_shift'
        )
        || CASE WHEN p_reason_code IS NOT NULL
                THEN jsonb_build_object('reason_code', p_reason_code) ELSE '{}'::jsonb END
        || CASE WHEN COALESCE(btrim(p_reason), '') <> ''
                THEN jsonb_build_object('reason_note', btrim(p_reason)) ELSE '{}'::jsonb END,
        'employee',
        'assignment'
    )
    ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;

    RETURN jsonb_build_object(
        'success',      true,
        'from_state',   v_state,
        'to_state',     'S5',
        'cancellation', CASE WHEN v_is_critical THEN 'critical' ELSE 'standard' END,
        'urgency',      v_urgency,
        'notice_hours', v_notice_hours
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sm_employee_drop_shift(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sm_employee_drop_shift(uuid, uuid, text, text) TO authenticated, service_role;

-- ── get_kpi_behaviour_summary: urgent -> critical ───────────────────────────

DROP FUNCTION IF EXISTS public.get_kpi_behaviour_summary(date, date, uuid[], uuid[], uuid[]);

CREATE FUNCTION public.get_kpi_behaviour_summary(
    p_from        date,
    p_to          date,
    p_org_ids     uuid[] DEFAULT NULL::uuid[],
    p_dept_ids    uuid[] DEFAULT NULL::uuid[],
    p_subdept_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
    held                       integer,
    worked                     integer,
    no_show                    integer,
    standard_cancellations     integer,
    critical_cancellations     integer,
    swapped_out                integer,
    reassigned                 integer,
    emergency_assigned         integer,
    on_time_in                 integer,
    on_time_out                integer,
    early_clock_in             integer,
    late_clock_in              integer,
    early_clock_out            integer,
    late_clock_out             integer,
    auto_clock_out             integer,
    attendance_compliant       integer,
    employees                  integer,
    no_show_rate               numeric,
    on_time_in_rate            numeric,
    on_time_out_rate           numeric,
    early_clock_in_rate        numeric,
    late_clock_in_rate         numeric,
    early_clock_out_rate       numeric,
    late_clock_out_rate        numeric,
    auto_clock_out_rate        numeric,
    attendance_compliance_rate numeric,
    standard_cancel_rate       numeric,
    critical_cancel_rate       numeric,
    total_cancel_rate          numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_perm jsonb;
    v_allowed_org_ids uuid[]; v_allowed_dept_ids uuid[]; v_allowed_subdept_ids uuid[];
    v_org_ids uuid[]; v_dept_ids uuid[]; v_subdept_ids uuid[];
BEGIN
    IF NOT public.is_manager_or_above() THEN
        RAISE EXCEPTION 'insufficient_privilege: managerial access required for KPI aggregates';
    END IF;

    v_perm := public.resolve_user_permissions();

    SELECT COALESCE(array_agg(DISTINCT (org->>'id')::uuid), ARRAY[]::uuid[])
      INTO v_allowed_org_ids
      FROM jsonb_array_elements(COALESCE(v_perm->'allowed_scope_tree'->'organizations', '[]'::jsonb)) org;

    SELECT COALESCE(array_agg(DISTINCT (dept->>'id')::uuid), ARRAY[]::uuid[])
      INTO v_allowed_dept_ids
      FROM jsonb_array_elements(COALESCE(v_perm->'allowed_scope_tree'->'organizations', '[]'::jsonb)) org,
           jsonb_array_elements(COALESCE(org->'departments', '[]'::jsonb)) dept;

    SELECT COALESCE(array_agg(DISTINCT (sd->>'id')::uuid), ARRAY[]::uuid[])
      INTO v_allowed_subdept_ids
      FROM jsonb_array_elements(COALESCE(v_perm->'allowed_scope_tree'->'organizations', '[]'::jsonb)) org,
           jsonb_array_elements(COALESCE(org->'departments', '[]'::jsonb)) dept,
           jsonb_array_elements(COALESCE(dept->'subdepartments', '[]'::jsonb)) sd;

    IF array_length(v_allowed_org_ids, 1) IS NULL THEN RETURN; END IF;

    v_org_ids := CASE WHEN p_org_ids IS NULL THEN v_allowed_org_ids
                      ELSE ARRAY(SELECT unnest(p_org_ids) INTERSECT SELECT unnest(v_allowed_org_ids)) END;
    v_dept_ids := CASE WHEN p_dept_ids IS NULL THEN v_allowed_dept_ids
                       ELSE ARRAY(SELECT unnest(p_dept_ids) INTERSECT SELECT unnest(v_allowed_dept_ids)) END;
    v_subdept_ids := CASE WHEN p_subdept_ids IS NULL THEN v_allowed_subdept_ids
                          ELSE ARRAY(SELECT unnest(p_subdept_ids) INTERSECT SELECT unnest(v_allowed_subdept_ids)) END;

    RETURN QUERY
    WITH agg AS (
        SELECT
            COUNT(*)::int                                                            AS c_held,
            COUNT(*) FILTER (WHERE s.end_reason = 'worked')::int                     AS c_worked,
            COUNT(*) FILTER (WHERE s.end_reason = 'no_show')::int                    AS c_no_show,
            COUNT(*) FILTER (WHERE s.end_reason = 'dropped_std')::int                AS c_std,
            COUNT(*) FILTER (WHERE s.end_reason = 'dropped_late')::int               AS c_critical,
            COUNT(*) FILTER (WHERE s.end_reason = 'traded_out')::int                 AS c_swap,
            COUNT(*) FILTER (WHERE s.end_reason = 'reassigned')::int                 AS c_reassigned,
            COUNT(*) FILTER (WHERE s.source = 'emergency')::int                      AS c_emergency,
            COUNT(*) FILTER (WHERE s.on_time_in     AND s.end_reason = 'worked')::int AS c_oti,
            COUNT(*) FILTER (WHERE s.on_time_out    AND s.end_reason = 'worked')::int AS c_oto,
            COUNT(*) FILTER (WHERE s.early_in       AND s.end_reason = 'worked')::int AS c_ei,
            COUNT(*) FILTER (WHERE s.late_in        AND s.end_reason = 'worked')::int AS c_li,
            COUNT(*) FILTER (WHERE s.early_out      AND s.end_reason = 'worked')::int AS c_eo,
            COUNT(*) FILTER (WHERE s.late_out       AND s.end_reason = 'worked')::int AS c_lo,
            COUNT(*) FILTER (WHERE s.auto_clock_out AND s.end_reason = 'worked')::int AS c_aco,
            COUNT(*) FILTER (WHERE s.end_reason = 'worked'
                             AND NOT s.late_in AND NOT s.early_out)::int              AS c_compliant,
            COUNT(DISTINCT s.employee_id)::int                                        AS c_employees
        FROM public.assignment_snapshots s
        WHERE s.shift_date BETWEEN p_from AND p_to
          AND (array_length(v_org_ids,1)     IS NULL OR s.organization_id    = ANY(v_org_ids))
          AND (array_length(v_dept_ids,1)    IS NULL OR s.department_id     = ANY(v_dept_ids))
          AND (array_length(v_subdept_ids,1) IS NULL OR s.sub_department_id = ANY(v_subdept_ids))
    )
    SELECT
        a.c_held, a.c_worked, a.c_no_show, a.c_std, a.c_critical, a.c_swap, a.c_reassigned,
        a.c_emergency, a.c_oti, a.c_oto, a.c_ei, a.c_li, a.c_eo, a.c_lo, a.c_aco,
        a.c_compliant, a.c_employees,
        ROUND(CASE WHEN a.c_held   = 0 THEN 0 ELSE a.c_no_show::numeric   / a.c_held   * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_oti::numeric       / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_oto::numeric       / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_ei::numeric        / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_li::numeric        / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_eo::numeric        / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_lo::numeric        / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_aco::numeric       / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_compliant::numeric / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_held   = 0 THEN 0 ELSE a.c_std::numeric       / a.c_held   * 100 END, 2),
        ROUND(CASE WHEN a.c_held   = 0 THEN 0 ELSE a.c_critical::numeric  / a.c_held   * 100 END, 2),
        ROUND(CASE WHEN a.c_held   = 0 THEN 0 ELSE (a.c_std + a.c_critical)::numeric / a.c_held * 100 END, 2)
    FROM agg a;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_kpi_behaviour_summary(date, date, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_kpi_behaviour_summary(date, date, uuid[], uuid[], uuid[]) TO authenticated, service_role;
