-- Migration: 20261102120000_shifts_tier5_remun_bidding_time_overnight_drops.sql
-- Tier 5 (Groups A & B): Drop 5 dead/redundant columns from public.shifts:
--   Group A: remuneration_level, bidding_open_at, bidding_close_at
--   Group B: total_hours, is_overnight
-- Shifts table columns decrease: 65 -> 60.

-- 1. Drop index on remuneration_level
DROP INDEX IF EXISTS public.idx_shifts_remuneration_level;

-- 2. Drop constraints
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS check_bidding_time_range;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_remuneration_level_fkey;

-- 3. Update fn_shift_inherit_template_row (remove remuneration_level assignment)
CREATE OR REPLACE FUNCTION public.fn_shift_inherit_template_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_ts public.template_shifts%ROWTYPE;
BEGIN
    IF NEW.template_instance_id IS NOT NULL THEN
        SELECT * INTO v_ts FROM public.template_shifts WHERE id = NEW.template_instance_id;
        IF FOUND THEN
            NEW.target_employment_type   := COALESCE(NEW.target_employment_type,   v_ts.target_employment_type);
            NEW.target_requires_flexible := COALESCE(NEW.target_requires_flexible, v_ts.target_requires_flexible, false);
            NEW.display_order            := COALESCE(v_ts.sort_order, NEW.display_order, 0);
        END IF;
    END IF;
    IF NEW.target_employment_type IS NULL THEN
        RAISE EXCEPTION 'target_employment_type is required (shift on %, sub-department %). Every shift must declare the employment type it is for; there is no "Any". Set it on the shift, or on the template row it derives from.',
            NEW.shift_date, NEW.sub_department_id USING ERRCODE='23502';
    END IF;
    RETURN NEW;
END;
$function$;

-- 4. Update internal.shift_pay_terms (pass NULL::smallint for p_shift_level)
CREATE OR REPLACE FUNCTION internal.shift_pay_terms(s shifts)
 RETURNS TABLE(pay_basis text, employment_type text, substantive_level smallint, paid_level smallint, higher_duties boolean, base_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
#variable_conflict use_column
DECLARE
    c hr.user_contracts;
    h hr.contract_pay_terms;
BEGIN
    IF s.user_contract_id IS NOT NULL THEN
        SELECT * INTO c
          FROM hr.user_contracts uc
         WHERE uc.id = s.user_contract_id
           AND uc.user_id = s.assigned_employee_id;
    END IF;
    IF c.id IS NOT NULL THEN
        h := hr.contract_pay_terms_on(c.id, s.shift_date);
    END IF;

    RETURN QUERY
    SELECT * FROM internal.resolve_pay_terms(
        s.shift_date,
        NULL::smallint,
        s.target_employment_type,
        CASE WHEN c.id IS NULL THEN NULL ELSE COALESCE(h.pay_basis, c.pay_basis) END,
        CASE WHEN h.pay_basis IS NOT NULL THEN h.remuneration_level ELSE c.remuneration_level END,
        CASE WHEN h.pay_basis IS NOT NULL THEN h.annual_salary ELSE c.annual_salary END,
        c.employment_status::text,
        c.contracted_weekly_hours,
        COALESCE(c.is_apprentice, false) OR COALESCE(c.is_trainee, false) OR COALESCE(c.is_sws, false));
END;
$function$;

-- 5. Update public.sm_create_shift (remove remuneration_level from INSERT)
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

    PERFORM set_config('app.audit.via_gateway', '1', true);

    INSERT INTO shifts (
        roster_id, department_id, shift_date, start_time, end_time,
        organization_id, sub_department_id, display_order,
        shift_group_id, roster_subgroup_id, role_id,
        paid_break_minutes, unpaid_break_minutes, break_start, break_end, timezone,
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

-- 6. Update public.sm_bulk_publish_shifts (remove bidding_open_at write)
CREATE OR REPLACE FUNCTION public.sm_bulk_publish_shifts(p_shift_ids uuid[], p_actor_id uuid DEFAULT auth.uid(), p_expected_versions jsonb DEFAULT NULL::jsonb)
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

    WITH locked AS MATERIALIZED (
        SELECT
            s.id,
            s.version,
            s.assigned_employee_id,
            s.shift_date,
            s.target_employment_type,
            s.lifecycle_status,
            s.assignment_status,
            s.start_at
        FROM shifts s
        WHERE s.id = ANY(p_shift_ids)
        ORDER BY s.id
        FOR UPDATE
    ),
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
            l.start_at as shift_start_tz,
            get_time_category(l.start_at) as time_cat
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

-- 7. Update public._apply_shift_op_write (remove bidding_open_at, bidding_close_at, remuneration_level)
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

    -- Concurrency Contract: Lock employee identity before running checks
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_emp::text));

    -- Full EBA compliance check (blocking tier)
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
      -- Concurrency Contract: Lock employee identity before running checks
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_cur.assigned_employee_id::text));

      -- Full EBA compliance validation before publishing assigned shift
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
        -- Emergency window: confirm directly
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
      -- Unassigned shift publish: opens for bidding
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

    -- Concurrency Contract: Lock employee identity before running checks
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_winner::text));

    -- Full EBA compliance validation
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
      'unpaid_break_minutes','break_start','break_end','notes','role_id','sub_department_id',
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

    -- Concurrency Contract & Compliance checks on edit:
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
      p_payload ? 'break_start' OR p_payload ? 'break_end'
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

    -- Concurrency Contract: Multi-Employee Lock Ordering (Deadlock Prevention)
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

-- 8. Update public.get_bidding_kpis (remove bidding_open_at check)
CREATE OR REPLACE FUNCTION public.get_bidding_kpis(p_from date, p_to date, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(open_bidding_shifts integer, total_bids integer, winners_selected integer, unfilled_open_shifts integer, avg_bids_per_open_shift numeric, open_shift_fill_rate numeric, bid_success_rate numeric, unfilled_open_shift_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN QUERY
    WITH
    open_shifts AS (
        SELECT
            s.id,
            s.assigned_employee_id
        FROM shifts s
          WHERE s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
          AND (
                s.bidding_status IN ('on_bidding', 'on_bidding_normal', 'on_bidding_urgent', 'bidding_closed_no_winner')
                OR EXISTS (SELECT 1 FROM shift_bids b WHERE b.shift_id = s.id)
              )
    ),
    bid_counts AS (
        SELECT COUNT(b.id)::int AS total_bids
        FROM shift_bids b
        JOIN open_shifts os ON os.id = b.shift_id
    ),
    shift_metrics AS (
        SELECT
            COUNT(*)::int AS open_bidding_shifts,
            COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)::int
                AS winners_selected,
            COUNT(*) FILTER (WHERE assigned_employee_id IS NULL)::int
                AS unfilled_open_shifts
        FROM open_shifts
    )
    SELECT
        sm.open_bidding_shifts,
        bc.total_bids,
        sm.winners_selected,
        sm.unfilled_open_shifts,
        CASE WHEN sm.open_bidding_shifts = 0 THEN 0
             ELSE ROUND(bc.total_bids::numeric / sm.open_bidding_shifts, 2)
        END AS avg_bids_per_open_shift,
        CASE WHEN sm.open_bidding_shifts = 0 THEN 0
             ELSE ROUND(sm.winners_selected::numeric
                        / sm.open_bidding_shifts * 100, 2)
        END AS open_shift_fill_rate,
        CASE WHEN bc.total_bids = 0 THEN 0
             ELSE ROUND(sm.winners_selected::numeric
                        / bc.total_bids * 100, 2)
        END AS bid_success_rate,
        CASE WHEN sm.open_bidding_shifts = 0 THEN 0
             ELSE ROUND(sm.unfilled_open_shifts::numeric
                        / sm.open_bidding_shifts * 100, 2)
        END AS unfilled_open_shift_rate
    FROM shift_metrics sm
    CROSS JOIN bid_counts bc;
END;
$function$;

-- 9. Update public.get_manager_scorecard (remove bidding_open_at check)
CREATE OR REPLACE FUNCTION public.get_manager_scorecard(p_from date, p_to date, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(managed_published_shifts integer, filled_shifts integer, fill_rate numeric, open_shifts integer, covered_open_shifts integer, open_coverage_rate numeric, published_snapshots integer, distinct_shifts integer, churn_rate numeric, emergency_fill_count integer, emergency_fill_rate numeric, reassignment_count integer, avg_publish_lead_time_hours numeric, manager_actions integer, employee_actions integer, system_actions integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN QUERY
    WITH
    pub_shifts AS (
        SELECT
            s.id,
            s.assigned_employee_id,
            s.start_at AS scheduled_start,
            s.published_at,
            s.bidding_status
        FROM shifts s
          WHERE s.lifecycle_status <> 'Draft'
          AND s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
    ),
    shift_flags AS (
        SELECT
            ps.id,
            ps.assigned_employee_id,
            ps.scheduled_start,
            ps.published_at,
            (
                EXISTS (
                    SELECT 1 FROM shift_events e
                    WHERE e.shift_id = ps.id AND e.event_type = 'OFFERED'
                )
                OR EXISTS (
                    SELECT 1 FROM shift_bids b WHERE b.shift_id = ps.id
                )
                OR ps.bidding_status IN ('on_bidding', 'on_bidding_normal', 'on_bidding_urgent', 'bidding_closed_no_winner')
            ) AS is_open
        FROM pub_shifts ps
    ),
    shift_metrics AS (
        SELECT
            COUNT(*)::int                                                AS managed_published_shifts,
            COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)::int
                                                                         AS filled_shifts,
            COUNT(*) FILTER (WHERE is_open)::int                         AS open_shifts,
            COUNT(*) FILTER (WHERE is_open AND assigned_employee_id IS NOT NULL)::int
                                                                         AS covered_open_shifts,
            AVG(
                EXTRACT(EPOCH FROM (scheduled_start - published_at)) / 3600.0
            ) FILTER (
                WHERE scheduled_start IS NOT NULL
                  AND published_at   IS NOT NULL
                  AND scheduled_start >= published_at
            )                                                            AS avg_publish_lead_time_hours
        FROM shift_flags
    ),
    snaps AS (
        SELECT
            asnp.shift_id,
            asnp.source,
            asnp.end_reason
        FROM assignment_snapshots asnp
        WHERE asnp.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR asnp.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR asnp.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR asnp.sub_department_id = ANY(p_subdept_ids))
    ),
    snapshot_metrics AS (
        SELECT
            COUNT(*)::int                                                AS published_snapshots,
            COUNT(DISTINCT shift_id)::int                               AS distinct_shifts,
            COUNT(*) FILTER (WHERE source = 'emergency')::int           AS emergency_fill_count,
            COUNT(*) FILTER (WHERE end_reason = 'reassigned')::int      AS reassignment_count
        FROM snaps
    ),
    action_metrics AS (
        SELECT
            COUNT(*) FILTER (WHERE e.actor_role = 'manager')::int        AS manager_actions,
            COUNT(*) FILTER (WHERE e.actor_role = 'employee')::int       AS employee_actions,
            COUNT(*) FILTER (WHERE e.actor_role = 'system')::int         AS system_actions
        FROM shift_events e
        JOIN shifts s ON s.id = e.shift_id
          WHERE s.lifecycle_status <> 'Draft'
          AND s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
    )
    SELECT
        sm.managed_published_shifts,
        sm.filled_shifts,
        CASE WHEN sm.managed_published_shifts = 0 THEN 0
             ELSE ROUND(sm.filled_shifts::numeric / sm.managed_published_shifts * 100, 2) END
                                                                         AS fill_rate,
        sm.open_shifts,
        sm.covered_open_shifts,
        CASE WHEN sm.open_shifts = 0 THEN 0
             ELSE ROUND(sm.covered_open_shifts::numeric / sm.open_shifts * 100, 2) END
                                                                         AS open_coverage_rate,
        spm.published_snapshots,
        spm.distinct_shifts,
        CASE WHEN spm.distinct_shifts = 0 THEN 0
             ELSE ROUND(
                 (spm.published_snapshots - spm.distinct_shifts)::numeric
                 / spm.distinct_shifts * 100, 2) END                    AS churn_rate,
        spm.emergency_fill_count,
        CASE WHEN spm.published_snapshots = 0 THEN 0
             ELSE ROUND(spm.emergency_fill_count::numeric
                        / spm.published_snapshots * 100, 2) END          AS emergency_fill_rate,
        spm.reassignment_count,
        ROUND(COALESCE(sm.avg_publish_lead_time_hours, 0), 2)            AS avg_publish_lead_time_hours,
        am.manager_actions,
        am.employee_actions,
        am.system_actions
    FROM shift_metrics     sm
    CROSS JOIN snapshot_metrics spm
    CROSS JOIN action_metrics   am;
END;
$function$;

-- 10. Update public.get_marketplace_kpis (remove bidding_open_at check)
CREATE OR REPLACE FUNCTION public.get_marketplace_kpis(p_from date, p_to date, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(published_shifts integer, filled_shifts integer, fill_rate numeric, open_shifts integer, covered_open_shifts integer, open_coverage_rate numeric, published_snapshots integer, distinct_filled_shifts integer, churn_rate numeric, avg_time_to_fill_hours numeric, marketplace_eligible_shifts integer, marketplace_used_shifts integer, marketplace_utilization_rate numeric, offers_resolved integer, offer_accept_rate numeric, offer_reject_rate numeric, offer_ignore_rate numeric, trades_initiated integer, trade_completion_rate numeric, trade_rejection_rate numeric, trade_cancellation_rate numeric, trade_expiry_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN QUERY
    WITH
    pub_shifts AS (
        SELECT
            s.id,
            s.assigned_employee_id,
            s.start_at AS scheduled_start,
            s.shift_date,
            s.bidding_status,
            s.published_at,
            s.created_at,
            s.organization_id,
            s.department_id,
            s.sub_department_id
        FROM shifts s
          WHERE s.published_at IS NOT NULL
          AND s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
    ),
    shift_flags AS (
        SELECT
            ps.id,
            ps.assigned_employee_id,
            EXISTS (
                SELECT 1 FROM shift_events e
                WHERE e.shift_id = ps.id AND e.event_type = 'OFFERED'
            ) AS had_offer,
            EXISTS (
                SELECT 1 FROM shift_bids b WHERE b.shift_id = ps.id
            ) AS had_bid,
            EXISTS (
                SELECT 1 FROM shift_swaps sw WHERE sw.requester_shift_id = ps.id
            ) AS had_swap,
            (ps.bidding_status IN ('on_bidding', 'on_bidding_normal', 'on_bidding_urgent', 'bidding_closed_no_winner')) AS went_on_bidding
        FROM pub_shifts ps
    ),
    shift_metrics AS (
        SELECT
            COUNT(*)::int                                              AS published_shifts,
            COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)::int
                                                                       AS filled_shifts,
            COUNT(*) FILTER (WHERE had_offer OR had_bid OR went_on_bidding)::int
                                                                       AS open_shifts,
            COUNT(*) FILTER (
                WHERE (had_offer OR had_bid OR went_on_bidding)
                  AND assigned_employee_id IS NOT NULL
            )::int                                                     AS covered_open_shifts,
            COUNT(*)::int                                              AS marketplace_eligible_shifts,
            COUNT(*) FILTER (WHERE had_offer OR had_bid OR had_swap)::int
                                                                       AS marketplace_used_shifts
        FROM shift_flags
    ),
    snaps AS (
        SELECT
            asnp.shift_id,
            asnp.became_active_at,
            asnp.scheduled_start
        FROM assignment_snapshots asnp
        WHERE asnp.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR asnp.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR asnp.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR asnp.sub_department_id = ANY(p_subdept_ids))
    ),
    ttf AS (
        SELECT
            sn.shift_id,
            sn.became_active_at,
            COALESCE(
                (
                    SELECT MAX(e.event_time)
                    FROM shift_events e
                    WHERE e.shift_id   = sn.shift_id
                      AND e.event_type = 'OFFERED'
                      AND e.event_time < sn.became_active_at
                ),
                sh.published_at,
                sh.created_at
            ) AS open_started_at
        FROM snaps sn
        LEFT JOIN shifts sh ON sh.id = sn.shift_id
    ),
    snapshot_metrics AS (
        SELECT
            COUNT(*)::int                          AS published_snapshots,
            COUNT(DISTINCT shift_id)::int          AS distinct_filled_shifts
        FROM snaps
    ),
    ttf_metrics AS (
        SELECT
            AVG(
                EXTRACT(EPOCH FROM (became_active_at - open_started_at)) / 3600.0
            ) FILTER (
                WHERE open_started_at IS NOT NULL
                  AND became_active_at IS NOT NULL
                  AND became_active_at >= open_started_at
            ) AS avg_time_to_fill_hours
        FROM ttf
    ),
    offer_metrics AS (
        SELECT
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.had_accept)::int AS accepted,
            COUNT(*) FILTER (WHERE ep.had_offer AND NOT ep.had_accept
                                   AND ep.terminal_outcome NOT IN ('ignored','open'))::int AS rejected,
            COUNT(*) FILTER (WHERE ep.had_offer AND NOT ep.had_accept
                                   AND ep.terminal_outcome = 'ignored')::int AS ignored,
            COUNT(*) FILTER (WHERE ep.had_offer
                                   AND (ep.had_accept OR ep.terminal_outcome <> 'open'))::int AS resolved
        FROM v_shift_assignment_episodes ep
        WHERE ep.shift_date BETWEEN p_from AND p_to
          AND ep.terminal_outcome <> 'shift_deleted'
          AND (p_org_ids     IS NULL OR ep.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR ep.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR ep.sub_department_id = ANY(p_subdept_ids))
    ),
    trade_metrics AS (
        SELECT
            COUNT(*)::int                                                  AS total,
            COUNT(*) FILTER (WHERE ss.status = 'APPROVED')::int            AS completed,
            COUNT(*) FILTER (WHERE ss.status = 'REJECTED')::int            AS rejected,
            COUNT(*) FILTER (WHERE ss.status = 'CANCELLED')::int           AS cancelled,
            COUNT(*) FILTER (WHERE ss.status = 'EXPIRED')::int             AS expired
        FROM shift_swaps ss
        JOIN shifts s ON s.id = ss.requester_shift_id
          WHERE s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
    )
    SELECT
        sm.published_shifts,
        sm.filled_shifts,
        CASE WHEN sm.published_shifts = 0 THEN 0
             ELSE ROUND(sm.filled_shifts::numeric / sm.published_shifts * 100, 2) END
                                                                       AS fill_rate,
        sm.open_shifts,
        sm.covered_open_shifts,
        CASE WHEN sm.open_shifts = 0 THEN 0
             ELSE ROUND(sm.covered_open_shifts::numeric / sm.open_shifts * 100, 2) END
                                                                       AS open_coverage_rate,
        spm.published_snapshots,
        spm.distinct_filled_shifts,
        CASE WHEN sm.distinct_filled_shifts = 0 THEN 0
             ELSE ROUND(
                 (spm.published_snapshots - spm.distinct_filled_shifts)::numeric
                 / spm.distinct_filled_shifts * 100, 2) END           AS churn_rate,
        ROUND(COALESCE(tm.avg_time_to_fill_hours, 0), 2)              AS avg_time_to_fill_hours,
        sm.marketplace_eligible_shifts,
        sm.marketplace_used_shifts,
        CASE WHEN sm.marketplace_eligible_shifts = 0 THEN 0
             ELSE ROUND(sm.marketplace_used_shifts::numeric
                        / sm.marketplace_eligible_shifts * 100, 2) END AS marketplace_utilization_rate,
        om.resolved                                                   AS offers_resolved,
        CASE WHEN om.resolved = 0 THEN 0
             ELSE ROUND(om.accepted::numeric / om.resolved * 100, 2) END AS offer_accept_rate,
        CASE WHEN om.resolved = 0 THEN 0
             ELSE ROUND(om.rejected::numeric / om.resolved * 100, 2) END AS offer_reject_rate,
        CASE WHEN om.resolved = 0 THEN 0
             ELSE ROUND(om.ignored::numeric  / om.resolved * 100, 2) END AS offer_ignore_rate,
        trm.total                                                     AS trades_initiated,
        CASE WHEN trm.total = 0 THEN 0
             ELSE ROUND(trm.completed::numeric / trm.total * 100, 2) END AS trade_completion_rate,
        CASE WHEN trm.total = 0 THEN 0
             ELSE ROUND(trm.rejected::numeric / trm.total * 100, 2) END AS trade_rejection_rate,
        CASE WHEN trm.total = 0 THEN 0
             ELSE ROUND(trm.cancelled::numeric / trm.total * 100, 2) END AS trade_cancellation_rate,
        CASE WHEN trm.total = 0 THEN 0
             ELSE ROUND(trm.expired::numeric / trm.total * 100, 2) END AS trade_expiry_rate
    FROM shift_metrics    sm
    CROSS JOIN snapshot_metrics spm
    CROSS JOIN ttf_metrics      tm
    CROSS JOIN offer_metrics    om
    CROSS JOIN trade_metrics    trm;
END;
$function$;

-- 11. Finally, drop the 5 columns from public.shifts
ALTER TABLE public.shifts
  DROP COLUMN IF EXISTS remuneration_level,
  DROP COLUMN IF EXISTS bidding_open_at,
  DROP COLUMN IF EXISTS bidding_close_at,
  DROP COLUMN IF EXISTS total_hours,
  DROP COLUMN IF EXISTS is_overnight;

