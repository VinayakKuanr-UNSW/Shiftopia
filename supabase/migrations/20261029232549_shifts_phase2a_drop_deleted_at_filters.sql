-- shifts Phase 2a: drop every no-op `deleted_at IS NULL` filter from the database.
--
-- CHECK shifts_no_soft_delete keeps shifts.deleted_at NULL on every row, and
-- shifts is the only table in public/hr/internal with that column, so every
-- `deleted_at IS NULL` predicate in these functions is always true.
-- 36 functions are rebuilt from their live definitions (exported, md5-checked
-- 2026-10-30) with only those predicates removed: a whole-line filter is
-- deleted, a standalone WHERE hands its WHERE to the next AND, an inline
-- predicate is cut. No other line changes. Behaviour is identical.
--
-- Not in this step (they change only with the column drop, Phase 2b):
-- get_shift_delta's returned deleted_at column (the app reads it),
-- sm_refresh_shift_snapshots' 'shift_deleted' branch, and the always-false
-- `deleted_at IS NOT NULL` checks in fn_shift_not_started,
-- fn_shift_office_is_ft_only, fn_shift_shape_day_typed_guard and
-- internal.trg_shift_eba_compliance.
--
-- Plan: docs/handover/2026-10-30-shifts-table-plan.md.
-- Applied with psql in ONE transaction (user's choice: atomic, and too large
-- to pass through apply_migration), with its schema_migrations row recorded in
-- that same transaction exactly as apply_migration records one.
-- Rollback: ~/Documents/superman-db-exports/2026-10-30/phase2-deleted-at/fns/
-- (the 42 live definitions; SHA256SUMS).

CREATE OR REPLACE FUNCTION public.accrue_leave_balances()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
BEGIN
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 4.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 4.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'annual'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%casual%'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%flex%'
    AND NOT (
      LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
      AND (
        uc.pay_basis = 'eba_security_annualised'
        OR (uc.pay_basis IS NULL AND EXISTS (
          SELECT 1 FROM hr.roles r WHERE r.id = uc.role_id AND r.name ILIKE '%security%'
        ))
      )
    )
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 2.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 2.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'personal'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%casual%'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%flex%'
    AND NOT (
      LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
      AND (
        uc.pay_basis = 'eba_security_annualised'
        OR (uc.pay_basis IS NULL AND EXISTS (
          SELECT 1 FROM hr.roles r WHERE r.id = uc.role_id AND r.name ILIKE '%security%'
        ))
      )
    )
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((wk.weekly_hours * 4.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((wk.weekly_hours * 4.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN COUNT(s.id) > 0
               THEN SUM(COALESCE(s.net_length_minutes, s.scheduled_length_minutes, 0)) / 60.0 / 12.0
             ELSE COALESCE(uc.contracted_weekly_hours, 0.0)
           END AS weekly_hours
    FROM shifts s
    WHERE s.assigned_employee_id = uc.user_id
      AND s.shift_date >= CURRENT_DATE - 84
      AND s.shift_date < CURRENT_DATE
      AND s.lifecycle_status <> 'Cancelled'
  ) wk ON true
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'annual'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%flex%'
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((wk.weekly_hours * 2.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((wk.weekly_hours * 2.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN COUNT(s.id) > 0
               THEN SUM(COALESCE(s.net_length_minutes, s.scheduled_length_minutes, 0)) / 60.0 / 12.0
             ELSE COALESCE(uc.contracted_weekly_hours, 0.0)
           END AS weekly_hours
    FROM shifts s
    WHERE s.assigned_employee_id = uc.user_id
      AND s.shift_date >= CURRENT_DATE - 84
      AND s.shift_date < CURRENT_DATE
      AND s.lifecycle_status <> 'Cancelled'
  ) wk ON true
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'personal'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%flex%'
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((210.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((210.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  JOIN hr.roles r ON r.id = uc.role_id
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'annual'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
    AND (
      uc.pay_basis = 'eba_security_annualised'
      OR (uc.pay_basis IS NULL AND r.name ILIKE '%security%')
    )
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((84.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((84.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  JOIN hr.roles r ON r.id = uc.role_id
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'personal'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
    AND (
      uc.pay_basis = 'eba_security_annualised'
      OR (uc.pay_basis IS NULL AND r.name ILIKE '%security%')
    )
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = 76.0,
    accrued_hours = accrued_hours + GREATEST(0, 76.0 - balance_hours),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  LEFT JOIN public.profiles p ON p.id = uc.user_id
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'fdv'
    AND COALESCE(p.continuous_service_start, uc.start_date) <= CURRENT_DATE
    AND lb.as_of_date < (
      COALESCE(p.continuous_service_start, uc.start_date)
      + (EXTRACT(year FROM age(CURRENT_DATE, COALESCE(p.continuous_service_start, uc.start_date)))::int * interval '1 year')
    )::date;

END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_template_to_date_range_v2(p_template_id uuid, p_start_date date, p_end_date date, p_user_id uuid, p_source text DEFAULT 'roster_modal'::text, p_target_department_id uuid DEFAULT NULL::uuid, p_target_sub_department_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- Templates always add on top of what is there, and every shift they stamp
-- is unassigned: a template shift has no employee. An instance that has already
-- started is skipped and counted in shifts_skipped; trg_shift_not_started
-- refuses it anyway.
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
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_template_apply(p_template_id, p_target_department_id, p_target_sub_department_id);
  -- Audit attribution is the CALLER, never a client-supplied id (2026-10-18;
  -- the rule sm_bulk_publish_shifts got on 2026-10-13). p_user_id fed
  -- roster_template_batches.applied_by, rosters.created_by,
  -- shifts.created_by_user_id and the shift_events actor. System callers
  -- (cron, service role) keep the id they pass.
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

        -- One apply at a time per roster day, so the "already stamped?" check
        -- below sees what a concurrent apply committed. Dates run ascending in
        -- every apply, so overlapping ranges take these locks in the same order.
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
                INSERT INTO roster_groups (roster_id, name, external_id, sort_order)
                VALUES (v_roster_id, v_tg.name, v_external_id, v_tg.sort_order)
                RETURNING id INTO v_rg_id;
            END IF;

            FOR v_tsg IN (SELECT * FROM template_subgroups WHERE group_id = v_tg.id) LOOP
                -- Same name in the same group = the same sub-group, whatever the case.
                SELECT id INTO v_rsg_id
                FROM roster_subgroups
                WHERE roster_group_id = v_rg_id AND lower(name) = lower(btrim(v_tsg.name));

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

                            -- DAY-TYPED COMPLIANCE: soft-skip an instance this
                            -- template cannot lawfully produce on THIS date.
                            -- Same predicate trg_shift_shape_3_day_typed
                            -- enforces, so skip and enforce cannot drift.
                            v_breach_window := public.shift_break_window_breach(
                                v_ts.start_time, v_ts.end_time, COALESCE(v_ts.unpaid_break_minutes, 0),
                                v_ts.break_start, v_ts.break_end);
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
                                start_at, end_at, tz_identifier,
                                paid_break_minutes, unpaid_break_minutes, break_start, break_end,
                                template_id, template_instance_id, is_from_template,
                                template_batch_id,
                                roster_subgroup_id,
                                group_type,
                                sub_group_name,
                                template_group,
                                template_sub_group,
                                lifecycle_status, notes,
                                created_by_user_id,
                                required_skills,
                                required_licenses,
                                event_tags,
                                event_ids
                            )
                            VALUES (
                                v_roster_id, v_template.organization_id, v_dept_id, v_sub_dept_id,
                                v_ts.role_id, v_curr_date, v_ts.start_time, v_ts.end_time,
                                v_shift_start_timestamp, v_shift_end_timestamp, 'Australia/Sydney',
                                COALESCE(v_ts.paid_break_minutes, 0), COALESCE(v_ts.unpaid_break_minutes, 0), v_ts.break_start, v_ts.break_end,
                                p_template_id, v_ts.id, true,
                                v_batch_id,
                                v_rsg_id,
                                v_external_id::template_group_type,
                                v_tsg.name,
                                v_external_id::template_group_type,
                                v_tsg.name,
                                'Draft', v_ts.notes,
                                p_user_id,
                                to_jsonb(v_ts.required_skills),
                                to_jsonb(v_ts.required_licenses),
                                to_jsonb(v_ts.event_tags),
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

CREATE OR REPLACE FUNCTION public.cancel_shift(p_shift_id uuid, p_cancelled_by uuid DEFAULT auth.uid(), p_reason text DEFAULT 'Shift cancelled'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift RECORD;
BEGIN
    -- Get current shift state
    SELECT * INTO v_shift
    FROM shifts
    WHERE id = p_shift_id
;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;
    
    -- Per state machine: Cannot cancel InProgress, Completed, or already Cancelled
    IF v_shift.lifecycle_status IN ('InProgress', 'Completed', 'Cancelled') THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', format('Cannot cancel shift in %s state', v_shift.lifecycle_status)
        );
    END IF;
    
    -- Transition → S15: Cancelled
    UPDATE shifts
    SET 
        lifecycle_status = 'Cancelled'::shift_lifecycle,
        is_cancelled = TRUE,
        cancelled_at = NOW(),
        cancelled_by_user_id = p_cancelled_by,
        cancellation_reason = p_reason,
        -- Clear bidding
        is_on_bidding = FALSE,
        bidding_status = 'not_on_bidding'::shift_bidding_status,
        -- Clear trading
        trading_status = 'NoTrade'::shift_trading,
        -- Clear assignment outcome (per state machine S15: outcome = null)
        assignment_outcome = NULL,
        updated_at = NOW(),
        last_modified_by = p_cancelled_by,
        last_modified_reason = p_reason
    WHERE id = p_shift_id;
    
    -- Trigger will sync to roster_shifts automatically
    
    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'transition', format('%s → S15', v_shift.lifecycle_status),
        'new_state', 'Cancelled'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_process_offer_expirations()
 RETURNS TABLE(res_shift_id uuid, from_state text, to_state text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift       RECORD;
    v_new_state   TEXT := 'S2';
    v_shift_start TIMESTAMPTZ;
BEGIN
    FOR v_shift IN
        SELECT s.*
        FROM public.shifts s
        WHERE s.lifecycle_status   = 'Published'
          AND s.assignment_status  = 'assigned'
          AND s.assignment_outcome IS NULL
          AND (
              (s.offer_expires_at IS NOT NULL AND s.offer_expires_at < NOW())
              OR
              (
                COALESCE(
                    s.start_at,
                    (s.shift_date::TEXT || ' ' || s.start_time::TEXT)::TIMESTAMP
                        AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
                ) < (NOW() + INTERVAL '4 hours')
              )
          )
        FOR UPDATE SKIP LOCKED
    LOOP
        v_shift_start := COALESCE(
            v_shift.start_at,
            (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP
                AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')
        );

        UPDATE public.shift_offers
        SET
            status         = 'Expired',
            responded_at   = NOW(),
            response_notes = CASE
                WHEN v_shift.offer_expires_at IS NOT NULL AND v_shift.offer_expires_at < NOW()
                    THEN 'Auto-expired: deadline passed'
                ELSE 'Auto-retracted: 4h pre-shift lockout reached'
            END
        WHERE shift_id = v_shift.id
          AND status   = 'Pending';

        UPDATE public.shifts
        SET
            lifecycle_status     = 'Draft',
            assignment_status    = 'assigned',
            assignment_outcome   = NULL,
            fulfillment_status   = 'none'::shift_fulfillment_status,
            is_on_bidding        = FALSE,
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            updated_at           = NOW(),
            last_modified_reason = CASE
                WHEN v_shift.offer_expires_at IS NOT NULL AND v_shift.offer_expires_at < NOW()
                    THEN 'Offer expired - Reverted to Draft Assigned'
                ELSE '4h Lockout - Auto-retracted to Draft Assigned'
            END
        WHERE id = v_shift.id;

        IF v_shift.assigned_employee_id IS NOT NULL THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (
                v_shift.id,
                v_shift.assigned_employee_id,
                'IGNORED',
                COALESCE(v_shift.offer_expires_at, NOW()),
                jsonb_build_object(
                    'source', 'fn_process_offer_expirations',
                    'reason', CASE
                        WHEN v_shift.offer_expires_at IS NOT NULL AND v_shift.offer_expires_at < NOW()
                            THEN 'offer_expired'
                        ELSE 'pre_shift_lockout'
                    END
                )
            );
        END IF;

        res_shift_id := v_shift.id;
        from_state   := 'S3';
        to_state     := v_new_state;
        RETURN NEXT;
    END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_shift_ft_one_per_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_other_start time;
    v_other_end   time;
BEGIN
    IF NEW.target_employment_type IS DISTINCT FROM 'FT'
       OR NEW.assigned_employee_id IS NULL
       OR COALESCE(NEW.is_cancelled, false) THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.assigned_employee_id   IS NOT DISTINCT FROM NEW.assigned_employee_id
       AND OLD.shift_date             IS NOT DISTINCT FROM NEW.shift_date
       AND OLD.target_employment_type IS NOT DISTINCT FROM NEW.target_employment_type THEN
        RETURN NEW;
    END IF;

    -- Two concurrent writes for the same person and day must not both pass.
    PERFORM pg_advisory_xact_lock(
        hashtextextended('ft_one_per_day:' || NEW.assigned_employee_id::text || ':' || NEW.shift_date::text, 0));

    SELECT s.start_time, s.end_time
      INTO v_other_start, v_other_end
      FROM public.shifts s
     WHERE s.assigned_employee_id = NEW.assigned_employee_id
       AND s.shift_date = NEW.shift_date
       AND s.id <> NEW.id
       AND NOT COALESCE(s.is_cancelled, false)
     ORDER BY s.start_time
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Already rostered on %: % – %. A full-time employee works one shift a day; a split shift is not permitted (ICC EBA cl 39.1). Edit that shift instead.',
            to_char(NEW.shift_date, 'Dy DD Mon'),
            to_char(v_other_start, 'HH24:MI'),
            to_char(v_other_end, 'HH24:MI')
            USING ERRCODE = 'check_violation', HINT = 'FT_ONE_SHIFT_PER_DAY';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_bidding_kpis(p_from date, p_to date, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(open_bidding_shifts integer, total_bids integer, winners_selected integer, unfilled_open_shifts integer, avg_bids_per_open_shift numeric, open_shift_fill_rate numeric, bid_success_rate numeric, unfilled_open_shift_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN QUERY
    WITH
    -- ── Open bidding-shift universe ───────────────────────────────────
    -- Every non-deleted shift in [p_from, p_to] + org/dept/subdept scope
    -- that ENTERED bidding. A shift entered bidding if it has a
    -- bidding_open_at timestamp OR at least one shift_bids row exists for
    -- it (covers the case where the open timestamp was never stamped but a
    -- bid was still recorded). Shifts with zero bids that WERE posted to
    -- bidding (bidding_open_at IS NOT NULL) remain in scope.
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
                s.bidding_open_at IS NOT NULL
                OR EXISTS (SELECT 1 FROM shift_bids b WHERE b.shift_id = s.id)
              )
    ),

    -- ── Bids placed on the open bidding shifts ────────────────────────
    -- total_bids counts shift_bids rows (any status) ONLY for shifts that
    -- are in the open-bidding universe above, keeping every metric over a
    -- single consistent scope.
    bid_counts AS (
        SELECT COUNT(b.id)::int AS total_bids
        FROM shift_bids b
        JOIN open_shifts os ON os.id = b.shift_id
    ),

    -- ── Single-row shift-grain aggregate ──────────────────────────────
    shift_metrics AS (
        SELECT
            COUNT(*)::int AS open_bidding_shifts,
            COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)::int
                AS winners_selected,
            COUNT(*) FILTER (WHERE assigned_employee_id IS NULL)::int
                AS unfilled_open_shifts
        FROM open_shifts
    )

    -- ── Single-row assembly with guarded divides + ROUND(...,2) ───────
    SELECT
        sm.open_bidding_shifts,
        bc.total_bids,
        sm.winners_selected,
        sm.unfilled_open_shifts,
        -- avg bids per open shift (plain ratio, not a percentage)
        CASE WHEN sm.open_bidding_shifts = 0 THEN 0
             ELSE ROUND(bc.total_bids::numeric / sm.open_bidding_shifts, 2)
        END AS avg_bids_per_open_shift,
        -- fill rate: winners / open shifts * 100
        CASE WHEN sm.open_bidding_shifts = 0 THEN 0
             ELSE ROUND(sm.winners_selected::numeric
                        / sm.open_bidding_shifts * 100, 2)
        END AS open_shift_fill_rate,
        -- bid success rate: winners (winning bids) / all bids placed * 100
        CASE WHEN bc.total_bids = 0 THEN 0
             ELSE ROUND(sm.winners_selected::numeric
                        / bc.total_bids * 100, 2)
        END AS bid_success_rate,
        -- unfilled open-shift rate: unfilled / open shifts * 100
        CASE WHEN sm.open_bidding_shifts = 0 THEN 0
             ELSE ROUND(sm.unfilled_open_shifts::numeric
                        / sm.open_bidding_shifts * 100, 2)
        END AS unfilled_open_shift_rate
    FROM shift_metrics sm
    CROSS JOIN bid_counts bc;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_employee_shift_window(p_employee_id uuid, p_start_date date, p_end_date date, p_exclude_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, shift_date date, start_time time without time zone, end_time time without time zone, unpaid_break_minutes integer, user_contract_id uuid, paid_break_minutes integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.sm_request_is_system() AND p_employee_id IS DISTINCT FROM v_uid THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;

    IF NOT (
      EXISTS (
        SELECT 1
        FROM public.app_access_certificates ac
        JOIN public.rbac_permissions rp ON rp.access_level = ac.access_level
        WHERE ac.user_id = v_uid AND ac.is_active
          AND rp.action_code = 'shift.view' AND rp.scope::text <> 'SELF'
        UNION ALL
        SELECT 1
        FROM public.user_contracts uc
        JOIN public.rbac_permissions rp ON rp.access_level = uc.access_level
        WHERE uc.user_id = v_uid AND uc.status = 'Active'
          AND rp.action_code = 'shift.view' AND rp.scope::text <> 'SELF'
      )
      OR EXISTS (
        SELECT 1
        FROM public.shift_swaps r
        WHERE r.status IN ('OPEN', 'OFFER_SELECTED', 'MANAGER_PENDING')
          AND (
               (r.requester_id = v_uid AND r.target_id = p_employee_id)
            OR (r.requester_id = p_employee_id AND r.target_id = v_uid)
            OR EXISTS (
                 SELECT 1 FROM public.swap_offers o
                 WHERE o.swap_request_id = r.id
                   AND o.status IN ('SUBMITTED', 'SELECTED')
                   AND ((r.requester_id = v_uid AND o.offerer_id = p_employee_id)
                     OR (r.requester_id = p_employee_id AND o.offerer_id = v_uid)))
          )
      )
    ) THEN
      RAISE EXCEPTION 'not authorised to read this employee''s roster'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT 
    s.id,
    s.shift_date,
    s.start_time,
    s.end_time,
    s.unpaid_break_minutes,
    s.user_contract_id,
    s.paid_break_minutes
  FROM public.shifts s
  WHERE s.assigned_employee_id = p_employee_id
    AND s.shift_date >= p_start_date
    AND s.shift_date <= p_end_date
    AND s.lifecycle_status != 'Cancelled' -- Correct column name
    AND (p_exclude_id IS NULL OR s.id != p_exclude_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_employees_shift_window_bulk(p_employee_ids uuid[], p_start_date date, p_end_date date)
 RETURNS TABLE(id uuid, assigned_employee_id uuid, shift_date date, start_time time without time zone, end_time time without time zone, unpaid_break_minutes integer, user_contract_id uuid, paid_break_minutes integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_self_only boolean;
  v_wide      boolean;
BEGIN
  -- `auth.uid()`, never `current_user`: inside a SECURITY DEFINER body
  -- `current_user` is always the function OWNER and identifies nobody.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  v_self_only := NOT EXISTS (
    SELECT 1 FROM unnest(coalesce(p_employee_ids, '{}'::uuid[])) e(uid)
    WHERE e.uid IS DISTINCT FROM v_uid
  );

  IF NOT v_self_only THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.app_access_certificates ac
      JOIN public.rbac_permissions rp ON rp.access_level = ac.access_level
      WHERE ac.user_id = v_uid AND ac.is_active
        AND rp.action_code = 'shift.view' AND rp.scope::text <> 'SELF'
      UNION ALL
      SELECT 1
      FROM public.user_contracts uc
      JOIN public.rbac_permissions rp ON rp.access_level = uc.access_level
      WHERE uc.user_id = v_uid AND uc.status = 'Active'
        AND rp.action_code = 'shift.view' AND rp.scope::text <> 'SELF'
    ) INTO v_wide;

    IF NOT v_wide THEN
      RAISE EXCEPTION 'not authorised to read other employees'' rosters'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT s.id, s.assigned_employee_id, s.shift_date, s.start_time, s.end_time, s.unpaid_break_minutes, s.user_contract_id, s.paid_break_minutes
  FROM public.shifts s
  WHERE s.assigned_employee_id = ANY(p_employee_ids)
    AND s.shift_date >= p_start_date
    AND s.shift_date <= p_end_date
    AND s.lifecycle_status != 'Cancelled'
;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_kpi_marketplace_trend(p_from date, p_to date, p_grain text DEFAULT 'week'::text, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(bucket_start date, open_shifts integer, bids_placed integer, winners_selected integer, award_rate numeric, swaps_initiated integer, swaps_completed integer, swaps_rejected integer, swaps_cancelled integer, swap_completion_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_perm jsonb;
    v_allowed_org_ids uuid[]; v_allowed_dept_ids uuid[]; v_allowed_subdept_ids uuid[];
    v_org_ids uuid[]; v_dept_ids uuid[]; v_subdept_ids uuid[];
    v_grain text;
BEGIN
    IF NOT public.holds_action('kpi.view') THEN
        RAISE EXCEPTION 'insufficient_privilege: managerial access required for KPI aggregates';
    END IF;

    -- Whitelist, never interpolate: p_grain reaches date_trunc.
    v_grain := CASE lower(COALESCE(p_grain, 'week')) WHEN 'day' THEN 'day' ELSE 'week' END;

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
    WITH buckets AS (
        SELECT generate_series(
                   date_trunc(v_grain, p_from::timestamp),
                   date_trunc(v_grain, p_to::timestamp),
                   CASE v_grain WHEN 'day' THEN interval '1 day' ELSE interval '1 week' END
               )::date AS b
    ),
    scoped_shifts AS (
        SELECT s.id, date_trunc(v_grain, s.shift_date::timestamp)::date AS b, s.bidding_status
        FROM public.shifts s
        WHERE s.shift_date BETWEEN p_from AND p_to
          AND (array_length(v_org_ids,1)     IS NULL OR s.organization_id    = ANY(v_org_ids))
          AND (array_length(v_dept_ids,1)    IS NULL OR s.department_id     = ANY(v_dept_ids))
          AND (array_length(v_subdept_ids,1) IS NULL OR s.sub_department_id = ANY(v_subdept_ids))
    ),
    bid_agg AS (
        SELECT ss.b,
               COUNT(DISTINCT ss.id) FILTER (
                   WHERE ss.bidding_status NOT IN ('not_on_bidding', 'bidding_closed_no_winner')
                      OR sb.id IS NOT NULL
               )::int                                                    AS open_shifts,
               COUNT(sb.id)::int                                         AS bids_placed,
               COUNT(DISTINCT sb.shift_id) FILTER (WHERE sb.status = 'accepted')::int AS winners
        FROM scoped_shifts ss
        LEFT JOIN public.shift_bids sb ON sb.shift_id = ss.id
        GROUP BY ss.b
    ),
    swap_agg AS (
        SELECT ss.b,
               COUNT(sr.id)::int                                              AS initiated,
               COUNT(*) FILTER (WHERE sr.status = 'approved')::int            AS completed,
               COUNT(*) FILTER (WHERE sr.status = 'rejected')::int            AS rejected,
               COUNT(*) FILTER (WHERE sr.status = 'cancelled')::int           AS cancelled
        FROM scoped_shifts ss
        JOIN public.swap_requests sr ON sr.original_shift_id = ss.id
        GROUP BY ss.b
    )
    SELECT
        bk.b,
        COALESCE(ba.open_shifts, 0),
        COALESCE(ba.bids_placed, 0),
        COALESCE(ba.winners, 0),
        ROUND(CASE WHEN COALESCE(ba.open_shifts,0) = 0 THEN 0
                   ELSE ba.winners::numeric / ba.open_shifts * 100 END, 2),
        COALESCE(sa.initiated, 0),
        COALESCE(sa.completed, 0),
        COALESCE(sa.rejected, 0),
        COALESCE(sa.cancelled, 0),
        ROUND(CASE WHEN COALESCE(sa.initiated,0) = 0 THEN 0
                   ELSE sa.completed::numeric / sa.initiated * 100 END, 2)
    FROM buckets bk
    LEFT JOIN bid_agg  ba ON ba.b = bk.b
    LEFT JOIN swap_agg sa ON sa.b = bk.b
    ORDER BY bk.b;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_manager_scorecard(p_from date, p_to date, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(managed_published_shifts integer, filled_shifts integer, fill_rate numeric, open_shifts integer, covered_open_shifts integer, open_coverage_rate numeric, published_snapshots integer, distinct_shifts integer, churn_rate numeric, emergency_fill_count integer, emergency_fill_rate numeric, reassignment_count integer, avg_publish_lead_time_hours numeric, manager_actions integer, employee_actions integer, system_actions integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN QUERY
    WITH
    -- ── Scoped published shift universe ───────────────────────────────
    -- Every shift-grain metric (fill, coverage, publish lead time) is
    -- anchored here. Window: shift_date in [p_from, p_to]; org/dept/subdept
    -- ANDed. "Published" = lifecycle_status <> 'Draft' AND not soft-deleted.
    pub_shifts AS (
        SELECT
            s.id,
            s.assigned_employee_id,
            s.scheduled_start,
            s.published_at,
            s.bidding_open_at
        FROM shifts s
          WHERE s.lifecycle_status <> 'Draft'
          AND s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
    ),

    -- ── Per-shift open flag ───────────────────────────────────────────
    -- A shift is "open" (entered the marketplace as an unfilled posting) if
    -- it had >=1 OFFERED event OR >=1 shift_bids row OR went on bidding
    -- (bidding_open_at IS NOT NULL). "Covered" = open AND currently filled.
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
                OR ps.bidding_open_at IS NOT NULL
            ) AS is_open
        FROM pub_shifts ps
    ),

    -- ── Shift Fill Rate + Open Shift Coverage + Publish Lead Time ─────
    -- avg_publish_lead_time_hours: average over published shifts of
    -- (scheduled_start - published_at) in hours. Rows with NULL
    -- scheduled_start / NULL published_at or a NEGATIVE delta (published
    -- after the shift was due to start) are discarded via the FILTER so they
    -- don't pollute the average. LOW lead time = manager-negative.
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

    -- ── Snapshot universe (Churn + Emergency Fill + Reassignment) ─────
    -- Snapshot-grain metrics are scoped by the snapshot's OWN denormalized
    -- org/dept/subdept + shift_date (NOT by joining shifts), per spec.
    -- One snapshot = one published-active assignment episode.
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

    -- ── Action split over enriched shift_events (event-grain) ─────────
    -- Window each event by joining its shift (shift_date + org/dept/subdept
    -- scope). actor_role is the manager/employee/system attribution added by
    -- migration 20260626090000. Events whose actor_role is NULL/other fall
    -- into none of the three buckets (the three counts need not sum to the
    -- total event count). Soft-deleted shifts are excluded.
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

    -- ── Single-row assembly with guarded divides + ROUND(...,2) ───────
    SELECT
        -- Shift Fill Rate
        sm.managed_published_shifts,
        sm.filled_shifts,
        CASE WHEN sm.managed_published_shifts = 0 THEN 0
             ELSE ROUND(sm.filled_shifts::numeric / sm.managed_published_shifts * 100, 2) END
                                                                         AS fill_rate,
        -- Open Shift Coverage Rate
        sm.open_shifts,
        sm.covered_open_shifts,
        CASE WHEN sm.open_shifts = 0 THEN 0
             ELSE ROUND(sm.covered_open_shifts::numeric / sm.open_shifts * 100, 2) END
                                                                         AS open_coverage_rate,
        -- Assignment Churn Rate, as a PERCENTAGE: extra owners per 100 shifts
        -- = (snapshots - distinct shifts) / distinct shifts * 100. (Can exceed
        -- 100 if shifts average >2 owners.)
        spm.published_snapshots,
        spm.distinct_shifts,
        CASE WHEN spm.distinct_shifts = 0 THEN 0
             ELSE ROUND(
                 (spm.published_snapshots - spm.distinct_shifts)::numeric
                 / spm.distinct_shifts * 100, 2) END                    AS churn_rate,
        -- Emergency Fill: count + rate over all snapshots in scope. HIGH rate =
        -- poor planning / short lead time (manager-negative).
        spm.emergency_fill_count,
        CASE WHEN spm.published_snapshots = 0 THEN 0
             ELSE ROUND(spm.emergency_fill_count::numeric
                        / spm.published_snapshots * 100, 2) END          AS emergency_fill_rate,
        -- Reassignment volume (snapshots ended by a manager reassignment)
        spm.reassignment_count,
        -- Average publish lead time (hours); NULL -> 0 when no resolvable shifts
        ROUND(COALESCE(sm.avg_publish_lead_time_hours, 0), 2)            AS avg_publish_lead_time_hours,
        -- Action split (event-grain, by actor_role)
        am.manager_actions,
        am.employee_actions,
        am.system_actions
    FROM shift_metrics     sm
    CROSS JOIN snapshot_metrics spm
    CROSS JOIN action_metrics   am;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_marketplace_kpis(p_from date, p_to date, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(published_shifts integer, filled_shifts integer, fill_rate numeric, open_shifts integer, covered_open_shifts integer, open_coverage_rate numeric, published_snapshots integer, distinct_filled_shifts integer, churn_rate numeric, avg_time_to_fill_hours numeric, marketplace_eligible_shifts integer, marketplace_used_shifts integer, marketplace_utilization_rate numeric, offers_resolved integer, offer_accept_rate numeric, offer_reject_rate numeric, offer_ignore_rate numeric, trades_initiated integer, trade_completion_rate numeric, trade_rejection_rate numeric, trade_cancellation_rate numeric, trade_expiry_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN QUERY
    WITH
    -- ── Scoped published shift universe ───────────────────────────────
    -- Every shift-grain metric (fill, coverage, marketplace utilization,
    -- and the per-shift inputs to time-to-fill) is anchored here.
    -- Window: shift_date in [p_from, p_to]; org/dept/subdept ANDed.
    -- "Published" = lifecycle_status <> 'Draft' AND not soft-deleted.
    pub_shifts AS (
        SELECT
            s.id,
            s.assigned_employee_id,
            s.scheduled_start,
            s.shift_date,
            s.bidding_open_at,
            s.published_at,
            s.created_at,
            s.organization_id,
            s.department_id,
            s.sub_department_id
        FROM shifts s
          -- "published" = EVER published (published_at is set on first publish and
          -- survives a revert-to-Draft from offer-expiry / bidding-expiry). Using
          -- lifecycle_status <> 'Draft' would wrongly DROP shifts that were published,
          -- failed to fill, and reverted (e.g. a bidding shift that expired unfilled),
          -- inflating the fill rate. published_at IS NOT NULL keeps them in scope.
          WHERE s.published_at IS NOT NULL
          AND s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
    ),

    -- ── Per-shift marketplace touch flags ─────────────────────────────
    -- A shift "used the marketplace" if it had >=1 OFFERED event OR >=1
    -- shift_bids row OR >=1 shift_swaps row. A shift is "open" (entered the
    -- marketplace as an unfilled posting) if it had >=1 OFFERED event OR
    -- >=1 shift_bids row OR went on bidding (bidding_open_at IS NOT NULL).
    -- Trades alone do NOT make a shift "open" (a trade is a hand-off of an
    -- already-filled shift), but DO count toward marketplace utilization.
    shift_flags AS (
        SELECT
            ps.id,
            ps.assigned_employee_id,
            -- had an OFFERED event in the ledger
            EXISTS (
                SELECT 1 FROM shift_events e
                WHERE e.shift_id = ps.id AND e.event_type = 'OFFERED'
            ) AS had_offer,
            -- had at least one bid (any status)
            EXISTS (
                SELECT 1 FROM shift_bids b WHERE b.shift_id = ps.id
            ) AS had_bid,
            -- had at least one swap initiated against it as the requester's shift
            EXISTS (
                SELECT 1 FROM shift_swaps sw WHERE sw.requester_shift_id = ps.id
            ) AS had_swap,
            -- ever went on bidding (column set when a shift is posted to bidding)
            (ps.bidding_open_at IS NOT NULL) AS went_on_bidding
        FROM pub_shifts ps
    ),

    -- ── Shift Fill Rate + Open Shift Coverage Rate + Marketplace Util ──
    shift_metrics AS (
        SELECT
            COUNT(*)::int                                              AS published_shifts,
            COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)::int
                                                                       AS filled_shifts,
            -- open = entered marketplace as a posting
            COUNT(*) FILTER (WHERE had_offer OR had_bid OR went_on_bidding)::int
                                                                       AS open_shifts,
            -- covered = open AND currently filled
            COUNT(*) FILTER (
                WHERE (had_offer OR had_bid OR went_on_bidding)
                  AND assigned_employee_id IS NOT NULL
            )::int                                                     AS covered_open_shifts,
            -- marketplace-eligible = all published shifts in scope
            COUNT(*)::int                                              AS marketplace_eligible_shifts,
            -- marketplace-used = touched offer / bid / swap
            COUNT(*) FILTER (WHERE had_offer OR had_bid OR had_swap)::int
                                                                       AS marketplace_used_shifts
        FROM shift_flags
    ),

    -- ── Snapshot universe (Assignment Churn + Average Time To Fill) ───
    -- Snapshot-grain metrics are scoped by the snapshot's OWN denormalized
    -- org/dept/subdept + shift_date (NOT by joining shifts), per spec.
    -- One snapshot = one published-active assignment episode.
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

    -- Per-snapshot time-to-fill: hours from the marketplace-open moment to the
    -- moment the assignment became active.
    --   open_started_at := the latest shift_events.event_time STRICTLY BEFORE
    --                      became_active_at among OFFERED events for that shift
    --                      (the most recent preceding "posted/offered" signal).
    --   Fallbacks (when no preceding OFFERED event exists): the shift's
    --   bidding_open_at, then published_at, then created_at. All read from the
    --   `shifts` row (no org/dept scope needed — we already have the snapshot).
    -- Negative / NULL deltas are discarded (NULLIF guard) so a snapshot whose
    -- open moment can't be established does not pollute the average.
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
                sh.bidding_open_at,
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
            -- average over snapshots with a resolvable, non-negative open->active gap
            AVG(
                EXTRACT(EPOCH FROM (became_active_at - open_started_at)) / 3600.0
            ) FILTER (
                WHERE open_started_at IS NOT NULL
                  AND became_active_at IS NOT NULL
                  AND became_active_at >= open_started_at
            ) AS avg_time_to_fill_hours
        FROM ttf
    ),

    -- ── Offer funnel over RESOLVED offers (event-sourced) ─────────────
    -- Resolved = ACCEPTED + REJECTED + IGNORED (an OFFERED with no terminal
    -- event is still pending and is excluded). Scoped by joining shifts for
    -- the window + org/dept/subdept. The three rates sum to 100.
    -- ── Offer funnel — EPISODE-sourced (an offer = an S3 OFFERED in an episode) ──
    -- IMPORTANT: a raw ACCEPTED event is emitted for offer-accepts AND for bid-wins
    -- (select_winner sets assignment_outcome='confirmed') AND for trade-confirms.
    -- Counting raw ACCEPTED events therefore OVER-counts the acceptance rate. The
    -- offer funnel must count only episodes that carried a real S3 offer (had_offer):
    --   accepted = had_offer AND had_accept       (the offer was accepted — even if
    --                                               later dropped/swapped; that's a
    --                                               separate cancellation event)
    --   ignored  = had_offer AND not accepted AND terminal_outcome='ignored'
    --   rejected = had_offer AND not accepted AND terminal_outcome NOT IN ('ignored','open')
    --   resolved = accepted + rejected + ignored  (a still-outstanding offer with
    --              terminal_outcome='open' is pending and excluded)
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

    -- ── Trade funnel over shift_swaps in window ───────────────────────
    -- Scoped by joining the requester's shift (requester_shift_id) for the
    -- window + org/dept/subdept. Bucket mapping over swap_request_status:
    --   completed   := APPROVED    (the trade went through)
    --   rejected    := REJECTED    (the manager rejected the trade)
    --   cancelled   := CANCELLED   (the requester withdrew the trade)
    --   expired     := EXPIRED
    --   (OPEN / OFFER_SELECTED / MANAGER_PENDING are still in-flight: counted
    --    in the denominator `total` but in none of the four terminal buckets,
    --    so the four rates need not sum to 100.)
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

    -- ── Single-row assembly with guarded divides + ROUND(...,2) ───────
    SELECT
        -- Fill Rate
        sm.published_shifts,
        sm.filled_shifts,
        CASE WHEN sm.published_shifts = 0 THEN 0
             ELSE ROUND(sm.filled_shifts::numeric / sm.published_shifts * 100, 2) END
                                                                       AS fill_rate,
        -- Open Shift Coverage Rate
        sm.open_shifts,
        sm.covered_open_shifts,
        CASE WHEN sm.open_shifts = 0 THEN 0
             ELSE ROUND(sm.covered_open_shifts::numeric / sm.open_shifts * 100, 2) END
                                                                       AS open_coverage_rate,
        -- Assignment Churn Rate, as a PERCENTAGE: extra owners per 100 published
        -- shifts = (snapshots - distinct shifts) / distinct shifts * 100. (Expressed
        -- as a % so it aligns with the UI formatting + thresholds; can exceed 100 if
        -- shifts average >2 owners.)
        spm.published_snapshots,
        spm.distinct_filled_shifts,
        CASE WHEN spm.distinct_filled_shifts = 0 THEN 0
             ELSE ROUND(
                 (spm.published_snapshots - spm.distinct_filled_shifts)::numeric
                 / spm.distinct_filled_shifts * 100, 2) END           AS churn_rate,
        -- Average Time To Fill (hours); NULL -> 0 when no resolvable snapshots
        ROUND(COALESCE(tm.avg_time_to_fill_hours, 0), 2)              AS avg_time_to_fill_hours,
        -- Marketplace Utilization Rate
        sm.marketplace_eligible_shifts,
        sm.marketplace_used_shifts,
        CASE WHEN sm.marketplace_eligible_shifts = 0 THEN 0
             ELSE ROUND(sm.marketplace_used_shifts::numeric
                        / sm.marketplace_eligible_shifts * 100, 2) END AS marketplace_utilization_rate,
        -- Offer funnel (resolved)
        om.resolved                                                   AS offers_resolved,
        CASE WHEN om.resolved = 0 THEN 0
             ELSE ROUND(om.accepted::numeric / om.resolved * 100, 2) END AS offer_accept_rate,
        CASE WHEN om.resolved = 0 THEN 0
             ELSE ROUND(om.rejected::numeric / om.resolved * 100, 2) END AS offer_reject_rate,
        CASE WHEN om.resolved = 0 THEN 0
             ELSE ROUND(om.ignored::numeric  / om.resolved * 100, 2) END AS offer_ignore_rate,
        -- Trade funnel
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

CREATE OR REPLACE FUNCTION public.get_metric_detailed_analysis(p_metric_id text, p_start_date date, p_end_date date, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_current_val text;
    v_target_val text;
    v_trend text;
    v_summary text;
    v_details text;
    v_chart_data jsonb;
    v_recs text[];
    v_title text;
    v_chart_type text := 'line';
BEGIN
    v_recs := ARRAY['Review staff availability patterns', 'Analyze demand variance by day-of-week', 'Consider automated notifications for schedule changes'];

    IF p_metric_id = 'shift-fill-rate' THEN
        v_title := 'Shift Fill Rate Analysis';
        WITH daily AS (
            SELECT shift_date as d, COUNT(*) as t, COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL) as f
            FROM shifts WHERE shift_date BETWEEN p_start_date AND p_end_date AND lifecycle_status != 'Draft'
            AND (p_org_ids IS NULL OR organization_id = ANY(p_org_ids)) AND (p_dept_ids IS NULL OR department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(f::numeric/NULLIF(t,0)*100,1))) INTO v_chart_data FROM daily;

        SELECT ROUND(COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)::numeric/NULLIF(COUNT(*),0)*100,1)::text INTO v_current_val
        FROM shifts WHERE shift_date BETWEEN p_start_date AND p_end_date AND lifecycle_status != 'Draft'
        AND (p_org_ids IS NULL OR organization_id = ANY(p_org_ids)) AND (p_dept_ids IS NULL OR department_id = ANY(p_dept_ids));
        
        v_target_val := '95%';
        v_summary := 'Current fill rate is ' || COALESCE(v_current_val, '0') || '% across the selected period.';
        v_details := 'Shift fill rate tracks the percentage of published shifts that have an assigned employee. Falling below 90% typically indicates a recruitment need or a mismatch between staff availability and roster demand.';

    ELSIF p_metric_id = 'labour-cost-per-event' OR p_metric_id = 'estimated-cost' THEN
        v_title := 'Labour Cost Analysis';
        WITH daily AS (
            SELECT shift_date as d, COALESCE(SUM(public.fn_eba_shift_cost(s)),0) as c
            FROM shifts s WHERE s.shift_date BETWEEN p_start_date AND p_end_date AND s.assigned_employee_id IS NOT NULL
            AND (p_org_ids IS NULL OR organization_id = ANY(p_org_ids)) AND (p_dept_ids IS NULL OR department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(c, 2))) INTO v_chart_data FROM daily;

        SELECT ROUND(SUM(public.fn_eba_shift_cost(s)),0)::text INTO v_current_val
        FROM shifts s WHERE s.shift_date BETWEEN p_start_date AND p_end_date AND s.assigned_employee_id IS NOT NULL
        AND (p_org_ids IS NULL OR organization_id = ANY(p_org_ids)) AND (p_dept_ids IS NULL OR department_id = ANY(p_dept_ids));

        v_target_val := 'Budgeted';
        v_summary := 'Total estimated labour cost for this period is $' || COALESCE(v_current_val, '0') || '.';
        v_details := 'This represents the gross labour expenditure based on rostered hours and remuneration rates. It does not include payroll taxes or secondary benefits.';

    ELSIF p_metric_id = 'no-show-rate' THEN
        v_title := 'No-Show Rate Analysis';
        WITH daily AS (
            SELECT shift_date as d, COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL) as a, 
                   COUNT(*) FILTER (WHERE attendance_status = 'no_show' OR assignment_outcome = 'no_show') as n
            FROM shifts WHERE shift_date BETWEEN p_start_date AND p_end_date
            AND (p_org_ids IS NULL OR organization_id = ANY(p_org_ids)) AND (p_dept_ids IS NULL OR department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(n::numeric/NULLIF(a,0)*100,1))) INTO v_chart_data FROM daily;

        SELECT ROUND(COUNT(*) FILTER (WHERE attendance_status = 'no_show' OR assignment_outcome = 'no_show')::numeric/NULLIF(COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL),0)*100,1)::text INTO v_current_val
        FROM shifts WHERE shift_date BETWEEN p_start_date AND p_end_date AND assigned_employee_id IS NOT NULL
        AND (p_org_ids IS NULL OR organization_id = ANY(p_org_ids)) AND (p_dept_ids IS NULL OR department_id = ANY(p_dept_ids));

        v_target_val := '<2%';
        v_summary := 'The average no-show rate is ' || COALESCE(v_current_val, '0') || '%.';
        v_details := 'A high no-show rate is a critical indicator of poor employee engagement or scheduling conflicts. Investigate specific departments or roles with recurring issues.';

    ELSIF p_metric_id = 'attendance-compliance-rate' THEN
        v_title := 'Attendance Compliance Analysis';
        WITH daily AS (
            SELECT s.shift_date AS d,
                   COUNT(*) FILTER (WHERE s.end_reason = 'worked') AS w,
                   COUNT(*) FILTER (WHERE s.end_reason = 'worked' AND NOT s.late_in AND NOT s.early_out) AS ok
            FROM assignment_snapshots s
            WHERE s.shift_date BETWEEN p_start_date AND p_end_date
              AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
              AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(ok::numeric/NULLIF(w,0)*100,1))) INTO v_chart_data FROM daily;
        SELECT ROUND(COUNT(*) FILTER (WHERE s.end_reason = 'worked' AND NOT s.late_in AND NOT s.early_out)::numeric
                     / NULLIF(COUNT(*) FILTER (WHERE s.end_reason = 'worked'),0) * 100, 1)::text
        INTO v_current_val
        FROM assignment_snapshots s
        WHERE s.shift_date BETWEEN p_start_date AND p_end_date
          AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
          AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids));
        v_target_val := '95%';
        v_summary := 'Attendance compliance is ' || COALESCE(v_current_val, '0') || '% across the selected period.';
        v_details := 'Counts shifts that were worked AND clocked in on time AND clocked out on time, over shifts worked. The grace window is 7.5 minutes either side of schedule.';
        v_recs := ARRAY['Check whether late starts cluster on particular shift times', 'Review sites with repeated missing clock-outs', 'Confirm rosters give enough travel time between venues'];

    ELSIF p_metric_id = 'cancellation-rate' THEN
        v_title := 'Cancellation Analysis';
        WITH weekly AS (
            SELECT date_trunc('week', s.shift_date::timestamp)::date AS d,
                   COUNT(*) AS held,
                   COUNT(*) FILTER (WHERE s.end_reason IN ('dropped_std','dropped_late')) AS c
            FROM assignment_snapshots s
            WHERE s.shift_date BETWEEN p_start_date AND p_end_date
              AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
              AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(c::numeric/NULLIF(held,0)*100,1))) INTO v_chart_data FROM weekly;
        SELECT ROUND(COUNT(*) FILTER (WHERE s.end_reason IN ('dropped_std','dropped_late'))::numeric
                     / NULLIF(COUNT(*),0) * 100, 1)::text
        INTO v_current_val
        FROM assignment_snapshots s
        WHERE s.shift_date BETWEEN p_start_date AND p_end_date
          AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
          AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids));
        v_target_val := '5%';
        v_summary := 'Cancellation rate is ' || COALESCE(v_current_val, '0') || '% of shifts held.';
        v_details := 'Shifts released by the person holding them, over all shifts held. Two kinds, split at 24 hours notice: standard above, critical at or below. 4 hours is a different line entirely - the urgent/emergent boundary, where exchange operations are blocked.';
        v_recs := ARRAY['Look at the reason distribution before the rate', 'Critical cancellations matter more than the total', 'Check whether one sub-department carries most of them'];
        v_chart_type := 'bar';

    ELSIF p_metric_id = 'open-shift-award-rate' THEN
        v_title := 'Open-Shift Award Analysis';
        WITH weekly AS (
            SELECT date_trunc('week', s.shift_date::timestamp)::date AS d,
                   COUNT(DISTINCT s.id) AS opened,
                   COUNT(DISTINCT sb.shift_id) FILTER (WHERE sb.status = 'accepted') AS won
            FROM shifts s
            LEFT JOIN shift_bids sb ON sb.shift_id = s.id
            WHERE s.shift_date BETWEEN p_start_date AND p_end_date
              AND s.bidding_status NOT IN ('not_on_bidding','bidding_closed_no_winner')
              AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
              AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(won::numeric/NULLIF(opened,0)*100,1))) INTO v_chart_data FROM weekly;
        SELECT ROUND(COUNT(DISTINCT sb.shift_id) FILTER (WHERE sb.status = 'accepted')::numeric
                     / NULLIF(COUNT(DISTINCT s.id),0) * 100, 1)::text
        INTO v_current_val
        FROM shifts s
        LEFT JOIN shift_bids sb ON sb.shift_id = s.id
        WHERE s.shift_date BETWEEN p_start_date AND p_end_date
          AND s.bidding_status NOT IN ('not_on_bidding','bidding_closed_no_winner')
          AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
          AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids));
        v_target_val := '80%';
        v_summary := 'Open-shift award rate is ' || COALESCE(v_current_val, '0') || '% across the selected period.';
        v_details := 'Open bidding shifts that ended with a winner selected. Distinct from bid win rate, which is winners over ALL bids placed and falls as competition per shift rises.';
        v_recs := ARRAY['Check shifts that expired without a single bid first', 'Compare bids per shift against award rate', 'Review whether urgent shifts are opening late'];
        v_chart_type := 'bar';

    ELSIF p_metric_id = 'swap-completion-rate' THEN
        v_title := 'Swap Completion Analysis';
        WITH weekly AS (
            SELECT date_trunc('week', s.shift_date::timestamp)::date AS d,
                   COUNT(sr.id) AS started,
                   COUNT(*) FILTER (WHERE sr.status = 'approved') AS done
            FROM shifts s
            JOIN swap_requests sr ON sr.original_shift_id = s.id
            WHERE s.shift_date BETWEEN p_start_date AND p_end_date
              AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
              AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(done::numeric/NULLIF(started,0)*100,1))) INTO v_chart_data FROM weekly;
        SELECT ROUND(COUNT(*) FILTER (WHERE sr.status = 'approved')::numeric / NULLIF(COUNT(sr.id),0) * 100, 1)::text
        INTO v_current_val
        FROM shifts s
        JOIN swap_requests sr ON sr.original_shift_id = s.id
        WHERE s.shift_date BETWEEN p_start_date AND p_end_date
          AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
          AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids));
        v_target_val := '75%';
        v_summary := 'Swap completion rate is ' || COALESCE(v_current_val, '0') || '% of swaps initiated.';
        v_details := 'Swaps that reached an approved completion, over swaps initiated. The shortfall splits into manager rejections, requester withdrawals and expiries, each pointing at a different fix.';
        v_recs := ARRAY['Find which stage the pipeline leaks at before acting', 'Expiries suggest nobody saw the request', 'Manager rejections suggest a compliance or cost block'];
        v_chart_type := 'bar';

    ELSE
        -- FALLBACK
        v_title := initcap(replace(p_metric_id, '-', ' '));
        v_current_val := '—';
        v_target_val := '—';
        v_summary := 'Detailed analysis for ' || v_title || ' is pending full database migration.';
        v_details := 'We are currently mapping historical events to this metric. Please check back as more data points are indexed.';
        v_chart_data := '[]'::jsonb;
    END IF;

    v_trend := 'stable';

    RETURN json_build_object(
        'title', v_title,
        'summary', v_summary,
        'details', v_details,
        'metrics', jsonb_build_object(
            'current', COALESCE(v_current_val, '0'),
            'target', COALESCE(v_target_val, '—'),
            'trend', v_trend
        ),
        'chartData', COALESCE(v_chart_data, '[]'::jsonb),
        'chartType', v_chart_type,
        'recommendations', v_recs
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_roster_planner_stats(p_organization_id uuid, p_start_date date, p_end_date date, p_department_ids uuid[] DEFAULT NULL::uuid[], p_sub_department_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(total_shifts integer, assigned_shifts integer, open_shifts integer, published_shifts integer, cancelled_shifts integer, total_net_minutes bigint, unique_employees integer, est_cost numeric, budget_cost numeric, scheduled_cost numeric, actual_cost numeric, actual_net_minutes bigint, costed_shifts integer, uncosted_shifts integer, actual_shifts integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH scoped AS (
      SELECT
          s.*,
          s AS shift_row,
          CASE
              WHEN ts.start_time IS NOT NULL AND ts.end_time IS NOT NULL THEN
                  GREATEST(0, (EXTRACT(EPOCH FROM (
                      (s.shift_date + ts.end_time)
                        + CASE WHEN ts.end_time <= ts.start_time
                               THEN INTERVAL '1 day' ELSE INTERVAL '0' END
                        - (s.shift_date + ts.start_time)
                  )) / 60)::int - COALESCE(s.unpaid_break_minutes, 0))
              WHEN s.actual_start IS NOT NULL AND s.actual_end IS NOT NULL THEN
                  GREATEST(0, (EXTRACT(EPOCH FROM (s.actual_end - s.actual_start)) / 60)::int
                              - COALESCE(s.unpaid_break_minutes, 0))
              ELSE NULL
          END AS worked_minutes
      FROM public.shifts s
      LEFT JOIN LATERAL (
          SELECT t.start_time, t.end_time
            FROM public.timesheets t
           WHERE t.shift_id = s.id
           ORDER BY t.start_time NULLS LAST
           LIMIT 1
      ) ts ON TRUE
      WHERE s.organization_id = p_organization_id
        AND s.shift_date BETWEEN p_start_date AND p_end_date
        AND (p_department_ids IS NULL OR s.department_id = ANY(p_department_ids))
        AND (p_sub_department_ids IS NULL OR s.sub_department_id = ANY(p_sub_department_ids))
  ),
  priced AS (
      SELECT
          scoped.*,
          -- Full award pricing on the assignee's contract terms (or the shift's
          -- own terms when unassigned): cl 41 penalties, cl 41.4, cl 42 OT, cl 43
          -- night, cl 28.1 meal, cl 28.2 first aid, cl 12/56.2 minimum
          -- engagement, cl 29 higher duties, Sch 2 §2 annualised Security, salary.
          internal.shift_cost(shift_row, net_length_minutes) AS sched_shift_cost,
          CASE WHEN worked_minutes IS NULL THEN NULL
               ELSE internal.shift_cost(shift_row, worked_minutes)
          END AS actual_shift_cost
      FROM scoped
  )
  SELECT
      COUNT(*) FILTER (WHERE NOT is_cancelled)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NULL)::int,
      COUNT(*) FILTER (WHERE lifecycle_status IN ('Published','InProgress','Completed'))::int,
      COUNT(*) FILTER (WHERE is_cancelled)::int,
      COALESCE(SUM(net_length_minutes) FILTER (WHERE NOT is_cancelled), 0)::bigint,
      COUNT(DISTINCT assigned_employee_id) FILTER (WHERE NOT is_cancelled)::int,
      COALESCE(SUM(sched_shift_cost) FILTER (WHERE NOT is_cancelled), 0)::numeric,
      (
        SELECT COALESCE(SUM(
          db.budgeted_cost
          * ( (LEAST(db.period_end, p_end_date) - GREATEST(db.period_start, p_start_date) + 1)::numeric
              / NULLIF((db.period_end - db.period_start + 1), 0) )
        ), 0)::numeric
        FROM public.department_budgets db
        JOIN public.departments d ON d.id = db.dept_id AND d.organization_id = p_organization_id
        WHERE db.period_start <= p_end_date AND db.period_end >= p_start_date
          AND (p_department_ids IS NULL OR db.dept_id = ANY(p_department_ids))
      ),
      COALESCE(SUM(sched_shift_cost) FILTER (WHERE NOT is_cancelled), 0)::numeric,
      COALESCE(SUM(actual_shift_cost) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL), 0)::numeric,
      COALESCE(SUM(worked_minutes) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL), 0)::bigint,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND sched_shift_cost IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND sched_shift_cost IS NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL)::int
  FROM priced;
$function$;

CREATE OR REPLACE FUNCTION public.get_roster_summary(p_organization_id uuid, p_start_date date, p_end_date date, p_department_ids uuid[] DEFAULT NULL::uuid[], p_sub_department_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(shift_date date, group_type text, sub_group_name text, total_shifts integer, assigned_shifts integer, open_shifts integer, published_shifts integer, draft_shifts integer, cancelled_shifts integer, total_net_minutes bigint, unique_employees integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
  SELECT
    s.shift_date,
    s.group_type::text,
    s.sub_group_name::text,
    COUNT(*)::int                                            AS total_shifts,
    COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)::int AS assigned_shifts,
    COUNT(*) FILTER (WHERE s.assigned_employee_id IS NULL)::int    AS open_shifts,
    COUNT(*) FILTER (WHERE s.lifecycle_status IN ('Published', 'InProgress', 'Completed'))::int  AS published_shifts,
    COUNT(*) FILTER (WHERE s.lifecycle_status = 'Draft')::int      AS draft_shifts,
    COUNT(*) FILTER (WHERE s.is_cancelled)::int                    AS cancelled_shifts,
    COALESCE(SUM(s.net_length_minutes), 0)::bigint                 AS total_net_minutes,
    COUNT(DISTINCT s.assigned_employee_id)::int                    AS unique_employees
  FROM shifts s
  WHERE s.organization_id = p_organization_id
    AND s.shift_date BETWEEN p_start_date AND p_end_date
    AND (p_department_ids IS NULL OR s.department_id = ANY(p_department_ids))
    AND (p_sub_department_ids IS NULL OR s.sub_department_id = ANY(p_sub_department_ids))
  GROUP BY s.shift_date, s.group_type, s.sub_group_name
  ORDER BY s.shift_date, s.group_type, s.sub_group_name;
$function$;

CREATE OR REPLACE FUNCTION hr.contract_delete_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
    v_shifts int;
BEGIN
    -- Counted as the owner, so row-level security can't hide a shift from the check.
    SELECT count(*) INTO v_shifts
      FROM public.shifts s
     WHERE s.user_contract_id = OLD.id
;
    IF v_shifts > 0 THEN
        RAISE EXCEPTION '% rostered under this contract. Reassign or unassign % before deleting the contract.',
            CASE WHEN v_shifts = 1 THEN '1 shift is' ELSE v_shifts || ' shifts are' END,
            CASE WHEN v_shifts = 1 THEN 'it' ELSE 'them' END
            USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION internal.eba_check_assignment(p_shift_id uuid, p_employee_id uuid, p_shift_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_unpaid_break_mins integer DEFAULT NULL::integer, p_role_id uuid DEFAULT NULL::uuid)
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

    -- The governing contract: the shift's own link when it is this person's,
    -- else the one auto_link_shift_to_contract would link — in force on the
    -- day, in scope, ranked target > role > sub-department.
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

    -- Person-wide, as V8 reads it: a Security role on any active contract.
    v_security := EXISTS (SELECT 1 FROM public.roles r WHERE r.id = v_role AND r.name ILIKE '%security%')
               OR EXISTS (SELECT 1 FROM hr.user_contracts uc JOIN public.roles r ON r.id = uc.role_id
                           WHERE uc.user_id = p_employee_id AND uc.status = 'Active' AND r.name ILIKE '%security%');

    -- The fallback for a shift that cannot be placed on one contract: salaried
    -- only when EVERY active contract is.
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
               CASE WHEN s.break_start IS NOT NULL AND s.break_end IS NOT NULL
                    THEN public.shift_minutes_after_start(s.break_start, s.break_end)
                    ELSE s.unpaid_break_minutes END AS meal_break_minutes,
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
               CASE WHEN v_shift.break_start IS NOT NULL AND v_shift.break_end IS NOT NULL
                    THEN public.shift_minutes_after_start(v_shift.break_start, v_shift.break_end)
                    ELSE v_unpaid END,
               COALESCE(v_shift.is_training, false),
               COALESCE(v_contract.engagement_kind = 'multi_hire', false),
               COALESCE(v_contract.pay_basis = 'salary', v_all_salaried),
               true
    ) x;

    -- V8_LEAVE_CONFLICT
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

    -- V8_QUALIFICATIONS / V8_QUALIFICATION_EXPIRED
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

    -- V8_EMPLOYMENT_TARGET — the scopes fn_enforce_shift_employment_target
    -- accepts: the contract for this role, else any in this sub-department.
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

CREATE OR REPLACE FUNCTION internal.toil_eligible_work(p_employee uuid, p_from date, p_to date)
 RETURNS TABLE(shift_id uuid, timesheet_id uuid, user_contract_id uuid, shift_date date, net_minutes integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'internal'
AS $function$
    SELECT s.id, t.id, s.user_contract_id, s.shift_date,
           internal.toil_billable_net_minutes(
               t.start_time, t.end_time, s.actual_start, s.actual_end,
               s.shift_date, s.start_time, s.end_time,
               t.unpaid_break_minutes, s.unpaid_break_minutes)
      FROM public.shifts s
      JOIN public.timesheets t ON t.shift_id = s.id
     WHERE s.assigned_employee_id = p_employee
       AND s.shift_date BETWEEN p_from AND p_to
       AND NOT s.is_cancelled
       AND t.status = 'approved'
       AND s.user_contract_id IS NOT NULL
       AND internal.toil_contract_eligible(s.user_contract_id, s.shift_date);
$function$;

CREATE OR REPLACE FUNCTION public.process_shift_timers()
 RETURNS TABLE(operation text, affected integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count INT := 0;
    v_rec   RECORD;
BEGIN
    -- 1. Expire pending offers S3 -> S2
    FOR v_rec IN SELECT * FROM public.fn_process_offer_expirations() LOOP
        v_count := v_count + 1;
    END LOOP;
    IF v_count > 0 THEN operation:='OFFER_EXPIRED'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 2. Bidding timeout S5/S6 -> S1
    WITH timed_out AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'Draft',
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            is_on_bidding        = FALSE,
            locked_at            = NULL,
            updated_at           = NOW(),
            last_modified_reason = 'Bidding timeout: T-4h passed, no winner — reverted to draft'
        WHERE lifecycle_status = 'Published'
          AND bidding_status IN (
              'on_bidding'::shift_bidding_status,
              'on_bidding_normal'::shift_bidding_status,
              'on_bidding_urgent'::shift_bidding_status
          )
          AND assignment_status = 'unassigned'
          AND (
              (start_at IS NOT NULL AND start_at < NOW() + INTERVAL '4 hours')
              OR
              (start_at IS NULL AND
               (shift_date::TEXT || ' ' || start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'Australia/Sydney')
               < NOW() + INTERVAL '4 hours')
          )
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM timed_out;
    IF v_count > 0 THEN operation:='BIDDING_TIMEOUT'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 3. Auto-start S4/S7 -> S11/S12
    WITH started AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'InProgress',
            updated_at           = NOW(),
            last_modified_reason = 'Auto-started: scheduled start time reached'
        WHERE lifecycle_status = 'Published'
          AND assignment_outcome IN ('confirmed', 'emergency_assigned')
          AND (
              (start_at IS NOT NULL AND start_at <= NOW())
              OR
              (start_at IS NULL AND
               (shift_date::TEXT || ' ' || start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'Australia/Sydney')
               <= NOW())
          )
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM started;
    IF v_count > 0 THEN operation:='AUTO_START'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 4. Auto-complete S11/S12 -> S13/S14
    WITH completed AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'Completed',
            updated_at           = NOW(),
            last_modified_reason = 'Auto-completed: scheduled end time reached'
        WHERE lifecycle_status = 'InProgress'
          AND (
              (end_at IS NOT NULL AND end_at <= NOW())
              OR
              (end_at IS NULL AND
               (shift_date::TEXT || ' ' || end_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'Australia/Sydney')
               <= NOW())
          )
          AND NOT (attendance_status IN ('checked_in', 'late') AND actual_end IS NULL)
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM completed;
    IF v_count > 0 THEN operation:='AUTO_COMPLETE'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 5. Expire in-flight swap requests S9/S10 -> S4 at T-4h (+ their child offers).
    WITH expired_swaps AS (
        UPDATE public.shift_swaps sw SET
            status     = 'EXPIRED',
            updated_at = NOW()
        FROM public.shifts rs
        WHERE rs.id = sw.requester_shift_id
          AND sw.status IN ('OPEN', 'MANAGER_PENDING', 'OFFER_SELECTED')
          AND (
              (sw.expires_at IS NOT NULL AND sw.expires_at < NOW())
              OR
              (rs.start_at IS NOT NULL AND rs.start_at < NOW() + INTERVAL '4 hours')
              OR
              (rs.start_at IS NULL AND
               (rs.shift_date::TEXT || ' ' || rs.start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(rs.timezone, 'Australia/Sydney')
               < NOW() + INTERVAL '4 hours')
          )
        RETURNING sw.id, sw.requester_shift_id, sw.target_shift_id
    ),
    expired_offers AS (
        UPDATE public.swap_offers so SET
            status     = 'EXPIRED',
            updated_at = NOW()
        FROM expired_swaps e
        WHERE so.swap_request_id = e.id
          AND so.status IN ('SUBMITTED', 'SELECTED')
        RETURNING so.id
    ),
    to_revert AS (
        SELECT DISTINCT ON (s.id)
               s.id,
               s.assigned_employee_id,
               public.get_shift_fsm_state(s.lifecycle_status, s.assignment_status, s.assignment_outcome, s.trading_status, s.is_cancelled, s.bidding_status) AS from_state,
               public.get_shift_fsm_state(s.lifecycle_status, s.assignment_status, s.assignment_outcome, 'NoTrade'::public.shift_trading, s.is_cancelled, s.bidding_status) AS to_state
        FROM public.shifts s
        JOIN expired_swaps e ON s.id IN (e.requester_shift_id, e.target_shift_id)
        WHERE s.trading_status IN ('TradeRequested', 'TradeAccepted')
    ),
    reverted AS (
        UPDATE public.shifts s SET
            trading_status       = 'NoTrade',
            trade_requested_at   = NULL,
            updated_at           = NOW(),
            last_modified_reason = 'Swap request expired: not concluded before T-4h — reverted to confirmed (S4)'
        FROM to_revert t
        WHERE s.id = t.id
        RETURNING s.id
    ),
    logged AS (
        INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role, domain)
        SELECT t.id, t.assigned_employee_id, 'OP_APPLIED', NOW(),
               jsonb_build_object('op', 'trade_expired', 'domain', 'trade',
                                  'from_state', t.from_state, 'to_state', t.to_state,
                                  'reason', 'Swap request expired: not concluded before T-4h — reverted to confirmed (S4)',
                                  'source', 'process_shift_timers'),
               'system', 'trade'
        FROM to_revert t
        ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM expired_swaps;
    IF v_count > 0 THEN operation:='SWAP_EXPIRED'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 6. No-show: the shift has ENDED and nobody clocked in. A shift inside the
    --    employee's APPROVED leave is not a no-show — the absence is authorised
    --    (it stays 'unknown'; leave pay comes from leave_requests).
    WITH no_shows AS (
        UPDATE public.shifts SET
            attendance_status    = 'no_show',
            updated_at           = NOW(),
            last_modified_reason = 'No-show: shift ended with no clock-in'
        WHERE lifecycle_status IN ('InProgress', 'Completed')
          AND attendance_status = 'unknown'
          AND (
              (end_at IS NOT NULL AND end_at <= NOW())
              OR
              (end_at IS NULL AND
               (shift_date::TEXT || ' ' || end_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'Australia/Sydney')
               <= NOW())
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.leave_requests lr
              WHERE lr.employee_id = shifts.assigned_employee_id
                AND lr.status = 'approved'
                AND shifts.shift_date BETWEEN lr.start_date::date AND lr.end_date::date
          )
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM no_shows;
    IF v_count > 0 THEN operation:='NO_SHOW'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 7. Auto clock-out: still clocked in 12.5h after the later of clock-in and start.
    FOR v_rec IN SELECT * FROM public.sm_handle_auto_clock_out() LOOP
        v_count := v_count + 1;
    END LOOP;
    IF v_count > 0 THEN operation:='AUTO_CLOCK_OUT'; affected:=v_count; RETURN NEXT; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_accept_offer(p_shift_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_shift RECORD; v_state text; v_name text; v_role text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_assignee_or(p_shift_id, p_user_id, 'shift.assign');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;
  SELECT COALESCE(first_name||' '||COALESCE(last_name,''), email), COALESCE(left(lower(legacy_system_role::text),50),'employee')
    INTO v_name, v_role FROM public.profiles WHERE id = p_user_id;
  v_name := COALESCE(v_name, 'System'); v_role := COALESCE(v_role, 'employee');
  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  IF v_state != 'S3' THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_accept_offer requires state S3, current state is %s', v_state));
  END IF;
  UPDATE public.shifts SET
    assignment_outcome    = 'confirmed'::public.shift_assignment_outcome,
    confirmed_at          = NOW(),
    fulfillment_status    = 'scheduled'::public.shift_fulfillment_status,
    last_modified_by      = p_user_id,
    updated_at            = NOW()
  WHERE id = p_shift_id;
  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S4');
END; $function$;

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
    IF v_pre.remuneration_level IS DISTINCT FROM v_cur.remuneration_level THEN
      v_changes := v_changes || jsonb_build_object('remuneration_level',
        jsonb_build_object('old', to_jsonb(v_pre.remuneration_level), 'new', to_jsonb(v_cur.remuneration_level)));
    END IF;
    IF v_pre.group_type IS DISTINCT FROM v_cur.group_type THEN
      v_changes := v_changes || jsonb_build_object('group_type',
        jsonb_build_object('old', to_jsonb(v_pre.group_type), 'new', to_jsonb(v_cur.group_type)));
    END IF;
    IF v_pre.sub_group_name IS DISTINCT FROM v_cur.sub_group_name THEN
      v_changes := v_changes || jsonb_build_object('sub_group_name',
        jsonb_build_object('old', to_jsonb(v_pre.sub_group_name), 'new', to_jsonb(v_cur.sub_group_name)));
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
      'assignment_source', v_cur.assignment_source,
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

CREATE OR REPLACE FUNCTION public.sm_bulk_assign_atomic(p_assignments jsonb, p_user_id uuid DEFAULT auth.uid(), p_expected_versions jsonb DEFAULT NULL::jsonb)
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

CREATE OR REPLACE FUNCTION public.sm_clock_in(p_shift_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_shift RECORD; v_state text; v_name text; v_role text;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;

  -- P0 fix: bind to the authenticated caller (or a manager acting on
  -- an employee's behalf), and require the target employee to
  -- actually be the one assigned to this shift.
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT public.can_act_on_shift('timesheet.approve', p_shift_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to clock in on behalf of this employee');
  END IF;
  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift is not assigned to this employee');
  END IF;

  SELECT COALESCE(first_name||' '||COALESCE(last_name,''), email), COALESCE(left(lower(legacy_system_role::text),50),'employee')
    INTO v_name, v_role FROM public.profiles WHERE id = p_user_id;
  v_name := COALESCE(v_name, 'System'); v_role := COALESCE(v_role, 'employee');
  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  IF v_state NOT IN ('S4', 'S9', 'S10') THEN RETURN jsonb_build_object('success', false, 'error', format('sm_clock_in requires state S4, S9 or S10, current state is %s', v_state)); END IF;
  UPDATE public.shifts SET
    lifecycle_status = 'InProgress'::public.shift_lifecycle, trading_status = 'NoTrade'::public.shift_trading,
    last_modified_by = p_user_id, updated_at = NOW()
  WHERE id = p_shift_id;
  -- shift_audit_events insert removed
  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S11');
END; $function$;

CREATE OR REPLACE FUNCTION public.sm_close_bidding(p_shift_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_state TEXT;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_shift_action(p_shift_id, 'bid.close');
    v_state := get_shift_state_id(p_shift_id);

    IF v_state NOT IN ('S5', 'S6') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   format('Cannot close bidding from state %s (must be S5 or S6)', v_state)
        );
    END IF;

    UPDATE public.shifts
    SET
        lifecycle_status     = 'Draft',
        bidding_status       = 'not_on_bidding',
        is_on_bidding        = FALSE,
        locked_at            = NULL,
        updated_at           = NOW(),
        last_modified_by     = p_user_id,
        last_modified_reason = COALESCE(p_reason, 'Bidding closed manually — reverted to draft')
    WHERE id = p_shift_id
;

    RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S1');

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_create_swap_request(p_requester_shift_id uuid, p_target_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_caller  uuid := auth.uid();
  v_shift   shifts%ROWTYPE;
  v_start   timestamptz;
  v_swap_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated', 'code', 'UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_shift FROM shifts WHERE id = p_requester_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Shift not found', 'code', 'SHIFT_NOT_FOUND');
  END IF;

  IF v_shift.assigned_employee_id IS DISTINCT FROM v_caller AND NOT public.can_act_on_shift('swap.approve', v_shift.id) THEN
    RETURN json_build_object('success', false, 'error', 'You are not assigned to this shift', 'code', 'FORBIDDEN');
  END IF;

  v_start := COALESCE(
    v_shift.start_at,
    (v_shift.shift_date::text || ' ' || v_shift.start_time::text)::timestamp
      AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')
  );
  IF v_start IS NOT NULL AND v_start - now() < interval '4 hours' THEN
    RETURN json_build_object('success', false, 'error', 'Time locked: shift starts in < 4h', 'code', 'TIME_LOCKED');
  END IF;

  IF EXISTS (
    SELECT 1 FROM shift_swaps
    WHERE requester_shift_id = p_requester_shift_id
      AND status IN ('OPEN', 'MANAGER_PENDING')
  ) THEN
    RETURN json_build_object('success', false, 'error', 'An active swap already exists for this shift', 'code', 'SWAP_EXISTS');
  END IF;

  INSERT INTO shift_swaps (requester_id, requester_shift_id, target_id, reason, status)
  VALUES (v_caller, p_requester_shift_id, p_target_id, p_reason, 'OPEN')
  RETURNING id INTO v_swap_id;

  UPDATE shifts
  SET trading_status = 'TradeRequested', trade_requested_at = now()
  WHERE id = p_requester_shift_id;

  RETURN json_build_object('success', true, 'swap_id', v_swap_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_emergency_assign(p_shift_id uuid, p_employee_id uuid, p_reason text DEFAULT 'Emergency assignment'::text, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_shift RECORD; v_state text; v_name text; v_role text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_shift_action(p_shift_id, 'shift.assign');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;

  SELECT COALESCE(first_name||' '||COALESCE(last_name,''), email), COALESCE(left(lower(legacy_system_role::text),50),'manager')
    INTO v_name, v_role FROM public.profiles WHERE id = p_user_id;
  v_name := COALESCE(v_name, 'System'); v_role := COALESCE(v_role, 'system');

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);

  IF v_state NOT IN ('S4', 'S5') THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_emergency_assign requires state S4 or S5, current state is %s', v_state));
  END IF;

  UPDATE public.shifts SET
    assigned_employee_id = p_employee_id,
    assigned_at = NOW(),
    assignment_status = 'assigned'::public.shift_assignment_status,
    assignment_outcome = 'confirmed'::public.shift_assignment_outcome,
    assignment_source = 'direct',
    bidding_status = 'not_on_bidding'::public.shift_bidding_status,
    is_on_bidding = FALSE,
    fulfillment_status = 'scheduled'::public.shift_fulfillment_status,
    confirmed_at = NOW(),
    emergency_assigned_at = NOW(),
    compliance_checked_at = NOW(),
    last_modified_by = p_user_id,
    updated_at = NOW()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S4', 'assigned_to', p_employee_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.sm_employee_drop_shift(p_shift_id uuid, p_employee_id uuid DEFAULT auth.uid(), p_reason text DEFAULT NULL::text, p_reason_code text DEFAULT NULL::text)
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
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_assignee_or(p_shift_id, p_employee_id, 'shift.assign');
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;

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

CREATE OR REPLACE FUNCTION public.sm_manager_cancel(p_shift_id uuid, p_user_id uuid DEFAULT auth.uid(), p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE 
    v_shift RECORD;
    v_state TEXT;
    v_user_name TEXT;
    v_user_role TEXT;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_shift_action(p_shift_id, 'shift.edit');
    SELECT * INTO v_shift FROM shifts 
    WHERE id = p_shift_id
    FOR UPDATE;
    
    IF NOT FOUND THEN 
        RETURN jsonb_build_object('success', false, 'error', 'Not found'); 
    END IF;
    
    v_state := get_shift_state_id(p_shift_id);
    
    IF v_state IN ('S11', 'S12', 'S13', 'S14', 'S15') THEN 
        RETURN jsonb_build_object('success', false, 'error', format('Cannot cancel from %s', v_state)); 
    END IF;
    
    IF p_user_id IS NOT NULL THEN
        SELECT COALESCE(first_name || ' ' || last_name, email),
               COALESCE(legacy_system_role::text, 'manager')
        INTO v_user_name, v_user_role
        FROM profiles WHERE id = p_user_id;
    END IF;
    v_user_name := COALESCE(v_user_name, 'System');
    v_user_role := COALESCE(v_user_role, 'manager');
    
    UPDATE shifts 
    SET lifecycle_status = 'Cancelled', 
        is_cancelled = TRUE, 
        cancelled_at = NOW(), 
        cancelled_by_user_id = p_user_id,
        cancellation_reason = p_reason, 
        is_on_bidding = FALSE, 
        bidding_status = 'not_on_bidding', 
        trading_status = 'NoTrade',
        assignment_outcome = NULL, 
        updated_at = NOW(), 
        last_modified_by = p_user_id 
    WHERE id = p_shift_id;
    
    RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S15');
END; 
$function$;

CREATE OR REPLACE FUNCTION public.sm_move_shift(p_shift_id uuid, p_group_type text DEFAULT NULL::text, p_sub_group_name text DEFAULT NULL::text, p_shift_group_id uuid DEFAULT NULL::uuid, p_roster_subgroup_id uuid DEFAULT NULL::uuid, p_shift_date date DEFAULT NULL::date, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_found BOOLEAN;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_shift_action(p_shift_id, 'shift.edit');
    UPDATE shifts SET
        -- Cast TEXT parameter to the ENUM type required by the table
        group_type         = CASE 
                                WHEN p_group_type IS NULL THEN group_type 
                                ELSE p_group_type::template_group_type 
                             END,
        sub_group_name     = COALESCE(p_sub_group_name, sub_group_name),
        shift_group_id     = p_shift_group_id,
        roster_subgroup_id = p_roster_subgroup_id,
        shift_date         = COALESCE(p_shift_date, shift_date),
        roster_date        = COALESCE(p_shift_date, roster_date),
        updated_at         = NOW(),
        last_modified_by   = p_user_id
    WHERE id = p_shift_id
;

    v_found := FOUND;

    IF NOT v_found THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found or already deleted');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_reject_offer(p_shift_id uuid, p_user_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_shift RECORD; v_state text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_assignee_or(p_shift_id, p_user_id, 'shift.assign');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: You can only reject shifts offered to you');
  END IF;

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);

  IF v_state != 'S3' THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_reject_offer requires state S3, current state is %s', v_state));
  END IF;

  UPDATE public.shifts SET
    assigned_employee_id = NULL,
    assigned_at          = NULL,
    assignment_status    = 'unassigned'::public.shift_assignment_status,
    assignment_outcome   = NULL,
    bidding_status       = 'on_bidding'::public.shift_bidding_status,
    is_on_bidding        = TRUE,
    fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
    last_rejected_by     = p_user_id,
    last_dropped_by      = NULL,
    last_modified_by     = p_user_id,
    updated_at           = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
  VALUES (p_shift_id, p_user_id, 'REJECTED', NOW(), jsonb_build_object('source', 'sm_reject_offer', 'reason', p_reason));

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S5');
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_reject_offer(p_shift_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_shift RECORD; v_state text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_assignee_or(p_shift_id, p_user_id, 'shift.assign');
  -- 1. Get shift and lock it
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  
  IF NOT FOUND THEN 
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); 
  END IF;
  
  -- 2. Authorization check: Only the assigned employee can reject their own offer
  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: You can only reject shifts offered to you');
  END IF;

  -- 3. State check: Must be in S3 (Published + Offered)
  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  
  IF v_state != 'S3' THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_reject_offer requires state S3, current state is %s', v_state));
  END IF;
  
  -- 4. Transition S3 -> S5 (Bidding)
  UPDATE public.shifts SET
    assigned_employee_id = NULL,
    assigned_at          = NULL,
    assignment_status    = 'unassigned'::public.shift_assignment_status,
    assignment_outcome   = NULL,
    bidding_status       = 'on_bidding'::public.shift_bidding_status,
    is_on_bidding        = TRUE,
    fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
    last_rejected_by     = p_user_id,
    last_dropped_by      = NULL,
    last_modified_by     = p_user_id,
    updated_at           = NOW()
  WHERE id = p_shift_id;

  -- 5. Log the event for permanent history
  INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
  VALUES (p_shift_id, p_user_id, 'REJECTED', NOW());
  
  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S5');
END; 
$function$;

CREATE OR REPLACE FUNCTION public.sm_request_trade(p_shift_id uuid, p_user_id uuid, p_target_employee_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift             RECORD;
    v_state             TEXT;
    v_shift_start       TIMESTAMPTZ;
    v_hours_until_start NUMERIC;
    v_swap_id           UUID;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_assignee_or(p_shift_id, p_user_id, 'shift.assign');
    -- 1. Lock the shift row
    SELECT * INTO v_shift
    FROM public.shifts
    WHERE id = p_shift_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;

    -- 2. Derive current state using the canonical function
    v_state := public.fn_shift_state(
        v_shift.lifecycle_status::TEXT,
        v_shift.assignment_status::TEXT,
        v_shift.assignment_outcome::TEXT,
        v_shift.bidding_status::TEXT,
        v_shift.trading_status::TEXT,
        COALESCE(v_shift.is_cancelled, FALSE)
    );

    -- 3. Must be S4 (Published + Confirmed + NoTrade)
    IF v_state != 'S4' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Cannot request trade from state %s — must be S4 (Confirmed)', v_state)
        );
    END IF;

    -- 4. Requesting user must be the assigned employee
    IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'You are not assigned to this shift'
        );
    END IF;

    -- 5. Time lock: cannot trade within 4h of shift start
    v_shift_start := COALESCE(
        v_shift.start_at,
        (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP
            AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')
    );
    v_hours_until_start := EXTRACT(EPOCH FROM (v_shift_start - NOW())) / 3600.0;

    IF v_hours_until_start < 4 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format(
                'Cannot request trade: shift starts in %sh (4h lockout applies)',
                round(v_hours_until_start, 1)
            )
        );
    END IF;

    -- 6. Transition shift: S4 → S9
    --    fn_audit_shift_update trigger will fire and log TRADE_REQUESTED
    UPDATE public.shifts
    SET
        trading_status      = 'TradeRequested'::shift_trading,
        trade_requested_at  = NOW(),
        updated_at          = NOW(),
        last_modified_by    = p_user_id,
        last_modified_reason = 'Employee requested trade'
    WHERE id = p_shift_id;

    -- 7. Create the swap request record.
    --    The BEFORE INSERT trigger fn_set_swap_expires_at auto-sets
    --    expires_at = shift_start - 4h.
    --    The AFTER INSERT trigger fn_audit_swap_event does NOT log
    --    TRADE_REQUESTED (removed in dedup fix) — shift trigger handles it.
    INSERT INTO public.shift_swaps (
        requester_id,
        requester_shift_id,
        target_id,         -- NULL = open trade (anyone can respond)
        target_shift_id,   -- NULL = no specific counter-shift required
        swap_type,
        status
    ) VALUES (
        p_user_id,
        p_shift_id,
        p_target_employee_id,
        NULL,
        'swap',
        'OPEN'
    )
    RETURNING id INTO v_swap_id;

    RETURN jsonb_build_object(
        'success',    true,
        'swap_id',    v_swap_id,
        'trade_id',   p_shift_id,
        'from_state', 'S4',
        'to_state',   'S9',
        'expires_at', (SELECT expires_at FROM public.shift_swaps WHERE id = v_swap_id)
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_select_bid_winner(p_shift_id uuid, p_winner_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_shift  public.shifts%ROWTYPE;
  v_state  text;
  v_tts    int;
  v_ver    int;
  v_idem   uuid;
  v_result jsonb;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR SHARE;
  IF NOT FOUND OR v_shift.is_cancelled THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_GONE');
  END IF;
  v_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome,
    v_shift.trading_status, v_shift.is_cancelled, v_shift.bidding_status);
  IF NOT public.fsm_op_is_legal(v_state, 'select_winner') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ILLEGAL_STATE', 'state', v_state);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shift_bids
    WHERE shift_id = p_shift_id AND employee_id = p_winner_id AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'WINNER_NOT_PENDING');
  END IF;
  v_tts := EXTRACT(EPOCH FROM (v_shift.scheduled_start - now()))::int;
  IF v_tts < 4 * 3600 THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_TIME_LOCKED', 'tts_seconds', v_tts);
  END IF;
  v_ver  := v_shift.version;
  v_idem := extensions.uuid_generate_v5('00000000-0000-0000-0000-0000000000bb'::uuid,
              p_shift_id::text || ':' || v_ver::text || ':' || p_winner_id::text);
  v_result := public.sm_apply_shift_op(p_shift_id, v_ver, 'select_winner',
                jsonb_build_object('winner_id', p_winner_id), v_idem);
  IF COALESCE((v_result->>'ok')::boolean, false)
     AND v_result->>'code' IN ('APPLIED', 'IDEMPOTENT_REPLAY') THEN
    RETURN jsonb_build_object('success', true, 'version', v_result->>'version');
  END IF;
  RETURN jsonb_build_object('success', false,
                            'error', COALESCE(v_result->>'code', 'GATEWAY_FAILURE'), 'detail', v_result);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_select_bid_winner error (shift=%): %', p_shift_id, SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_unassign_shift(p_shift_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_shift RECORD; v_state text; v_to_state text;
  v_user_name text; v_user_role text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_shift_action(p_shift_id, 'shift.assign');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;
  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  IF v_state NOT IN ('S2', 'S3', 'S4') THEN
    RETURN jsonb_build_object('success', false, 'error', format('Cannot unassign from state %s (requires S2, S3, or S4)', v_state));
  END IF;

  v_to_state := CASE WHEN v_shift.lifecycle_status = 'Published' THEN 'S5' ELSE 'S1' END;
  UPDATE public.shifts SET
    assigned_employee_id = NULL,
    assigned_at          = NULL,
    assignment_status    = 'unassigned'::public.shift_assignment_status,
    assignment_outcome   = NULL,
    bidding_status       = CASE WHEN v_shift.lifecycle_status = 'Published'
                                THEN 'on_bidding'::public.shift_bidding_status
                                ELSE 'not_on_bidding'::public.shift_bidding_status END,
    is_on_bidding        = (v_shift.lifecycle_status = 'Published'),
    fulfillment_status   = CASE WHEN v_shift.lifecycle_status = 'Published'
                                THEN 'bidding'::public.shift_fulfillment_status
                                ELSE 'none'::public.shift_fulfillment_status END,
    confirmed_at         = NULL,
    last_modified_by     = p_user_id,
    updated_at           = NOW()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', v_to_state);
END; $function$;

CREATE OR REPLACE FUNCTION public.sm_unpublish_shift(p_shift_id uuid, p_user_id uuid DEFAULT auth.uid(), p_reason text DEFAULT 'Unpublished'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift RECORD;
  v_state text;
  v_to_state text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_shift_action(p_shift_id, 'shift.publish');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  IF v_state NOT IN ('S3', 'S4', 'S5', 'S9', 'S10') THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_unpublish_shift requires a Published state (S3/S4/S5/S9/S10), current state is %s', v_state));
  END IF;

  -- Cancel active trade/swap requests if unpublishing a trade-pending shift (S9/S10)
  IF v_shift.trading_status IN ('TradeRequested', 'TradeAccepted') THEN
    UPDATE public.shift_swaps SET
      status = 'CANCELLED',
      updated_at = NOW()
    WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
      AND status IN ('OPEN', 'MANAGER_PENDING', 'OFFER_SELECTED');

    UPDATE public.shifts SET
      trading_status = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL,
      last_modified_by = p_user_id,
      updated_at = NOW()
    WHERE id IN (
      SELECT CASE WHEN requester_shift_id = p_shift_id THEN target_shift_id ELSE requester_shift_id END
      FROM public.shift_swaps
      WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
    ) AND id <> p_shift_id;

    UPDATE public.swap_requests SET
      status = 'cancelled',
      updated_at = NOW()
    WHERE (original_shift_id = p_shift_id OR offered_shift_id = p_shift_id)
      AND status IN ('pending_employee', 'pending_manager');

    UPDATE public.shifts SET
      trading_status = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL,
      last_modified_by = p_user_id,
      updated_at = NOW()
    WHERE id IN (
      SELECT CASE WHEN original_shift_id = p_shift_id THEN offered_shift_id ELSE original_shift_id END
      FROM public.swap_requests
      WHERE (original_shift_id = p_shift_id OR offered_shift_id = p_shift_id)
    ) AND id <> p_shift_id;

    UPDATE public.shifts SET
      trading_status = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL
    WHERE id = p_shift_id;
  END IF;

  IF v_state IN ('S3', 'S4', 'S9', 'S10') THEN
    v_to_state := 'S2';
    UPDATE public.shifts SET
      lifecycle_status   = 'Draft'::public.shift_lifecycle,
      assignment_outcome = NULL,
      bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
      is_on_bidding      = FALSE,
      fulfillment_status = 'none'::public.shift_fulfillment_status,
      last_modified_by   = p_user_id,
      last_modified_reason = p_reason,
      updated_at         = NOW()
    WHERE id = p_shift_id;
  ELSE
    v_to_state := 'S1';
    UPDATE public.shifts SET
      lifecycle_status   = 'Draft'::public.shift_lifecycle,
      bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
      is_on_bidding      = FALSE,
      fulfillment_status = 'none'::public.shift_fulfillment_status,
      last_modified_by   = p_user_id,
      last_modified_reason = p_reason,
      updated_at         = NOW()
    WHERE id = p_shift_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', v_to_state);
END;
$function$;
