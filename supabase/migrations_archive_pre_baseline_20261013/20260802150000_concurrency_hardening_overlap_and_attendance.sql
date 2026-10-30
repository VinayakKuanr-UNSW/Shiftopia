-- Migration: 20260802150000_concurrency_hardening_overlap_and_attendance.sql
-- Description: Full concurrency hardening migration. Addresses FINDING-01 (deterministic employee advisory locking), FINDING-02 (pre-commit overlap compliance check), FINDING-04 (deterministic lock ordering for trade approvals to prevent deadlocks), FINDING-05 (unique attendance index excluding deleted rows), and background job distributed advisory locks.

-- 1. Hardened Shift Mutation Gateway Write Implementation
CREATE OR REPLACE FUNCTION public._apply_shift_op_write(p_shift_id uuid, p_op text, p_payload jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cur        RECORD;
  v_winner     uuid;
  v_emp        uuid;
  v_swap       public.shift_swaps%ROWTYPE;
  v_edit_state text;
  v_new_emp    uuid;
  v_do_assign   boolean := false;
  v_do_unassign boolean := false;
  v_assign_src  text;
BEGIN
  SELECT * INTO v_cur FROM public.shifts WHERE id = p_shift_id;

  IF p_op = 'assign' THEN
    v_emp := NULLIF(p_payload->>'employee_id', '')::uuid;
    IF v_emp IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'MISSING_EMPLOYEE_ID');
    END IF;

    -- Concurrency Guard (FINDING-01): Deterministic transactional advisory lock on employee ID
    -- to serialize concurrent assignment transactions targeting the same candidate employee.
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_emp::text));

    -- Pre-Commit Compliance & Overlap Guard (FINDING-02): Validate overlap under candidate advisory lock.
    IF public.check_shift_overlap(v_emp, v_cur.shift_date, v_cur.start_time, v_cur.end_time, p_shift_id) THEN
      RETURN jsonb_build_object('applied', false, 'note', 'CANDIDATE_OVERLAP');
    END IF;

    UPDATE public.shifts SET
      assigned_employee_id = v_emp,
      assigned_at          = NOW(),
      assignment_status    = 'assigned'::public.shift_assignment_status,
      assignment_outcome   = CASE WHEN lifecycle_status = 'Published'
                                  THEN 'confirmed'::public.shift_assignment_outcome
                                  ELSE assignment_outcome END,
      confirmed_at         = CASE WHEN lifecycle_status = 'Published'
                                  THEN NOW() ELSE confirmed_at END,
      bidding_status       = CASE WHEN lifecycle_status = 'Published'
                                  THEN 'not_on_bidding'::public.shift_bidding_status
                                  ELSE bidding_status END,
      is_on_bidding        = CASE WHEN lifecycle_status = 'Published'
                                  THEN FALSE ELSE is_on_bidding END,
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
      confirmed_at         = NULL,
      fulfillment_status   = 'none'::public.shift_fulfillment_status,
      last_modified_by     = p_actor,
      last_modified_reason = COALESCE(p_payload->>'reason', 'Unassigned via shift gateway'),
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'publish' THEN
    IF v_cur.assigned_employee_id IS NOT NULL THEN
      IF ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
            AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours' <= NOW() THEN
        UPDATE public.shifts SET
          lifecycle_status       = 'Published'::public.shift_lifecycle,
          fulfillment_status     = 'scheduled'::public.shift_fulfillment_status,
          assignment_outcome     = 'confirmed'::public.shift_assignment_outcome,
          bidding_status         = 'not_on_bidding'::public.shift_bidding_status,
          is_on_bidding          = FALSE,
          confirmed_at           = NOW(),
          emergency_assigned_at  = NOW(),
          emergency_assigned_by  = p_actor,
          published_at           = NOW(),
          published_by_user_id   = p_actor,
          last_modified_by       = p_actor,
          updated_at             = NOW()
        WHERE id = p_shift_id;
        RETURN jsonb_build_object('applied', true, 'mode', 'EMERGENCY_DIRECT');
      ELSE
        UPDATE public.shifts SET
          lifecycle_status       = 'Published'::public.shift_lifecycle,
          fulfillment_status     = 'scheduled'::public.shift_fulfillment_status,
          assignment_outcome     = 'offered'::public.shift_assignment_outcome,
          bidding_status         = 'not_on_bidding'::public.shift_bidding_status,
          is_on_bidding          = FALSE,
          offer_expires_at       = GREATEST(NOW(), ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours'),
          published_at           = NOW(),
          published_by_user_id   = p_actor,
          last_modified_by       = p_actor,
          updated_at             = NOW()
        WHERE id = p_shift_id;
        RETURN jsonb_build_object('applied', true, 'mode', 'OFFERED');
      END IF;
    ELSE
      UPDATE public.shifts SET
        lifecycle_status     = 'Published'::public.shift_lifecycle,
        fulfillment_status   = 'none'::public.shift_fulfillment_status,
        published_at         = NOW(),
        published_by_user_id = p_actor,
        last_modified_by     = p_actor,
        updated_at           = NOW()
      WHERE id = p_shift_id;
      RETURN jsonb_build_object('applied', true, 'mode', 'UNASSIGNED_OPEN');
    END IF;

  ELSIF p_op = 'approve_trade' THEN
    SELECT * INTO v_swap FROM public.shift_swaps WHERE id = (p_payload->>'swap_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('applied', false, 'note', 'SWAP_NOT_FOUND');
    END IF;

    -- Deadlock Prevention Guard (FINDING-04): Acquire employee advisory locks in deterministic ascending order
    IF v_swap.requester_id IS NOT NULL AND v_swap.target_id IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || LEAST(v_swap.requester_id::text, v_swap.target_id::text)));
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || GREATEST(v_swap.requester_id::text, v_swap.target_id::text)));
    END IF;

    UPDATE public.shift_swaps SET
      status = 'APPROVED'::public.swap_status,
      updated_at = NOW()
    WHERE id = v_swap.id;

    RETURN jsonb_build_object('applied', true);

  ELSE
    RETURN jsonb_build_object('applied', false, 'note', 'UNSUPPORTED_OP');
  END IF;
END;
$function$;

-- 2. Attendance Partial Unique Index (FINDING-05) excluding deleted rows
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_records_unique_shift_status 
ON public.attendance_records(shift_id, attendance_status) 
WHERE deleted_at IS NULL;

-- 3. Hardened Nightly Leave Accrual Cron (Job Concurrency Guard)
CREATE OR REPLACE FUNCTION public.accrue_leave_balances()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
BEGIN
  -- Concurrency Guard: Non-blocking advisory lock prevents overlapping background cron execution
  IF NOT pg_try_advisory_xact_lock(hashtext('job_accrue_leave_balances')) THEN
    RAISE NOTICE 'accrue_leave_balances: another instance is running. Skipping execution.';
    RETURN;
  END IF;

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 4.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 4.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
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
      AND EXISTS (
        SELECT 1 FROM hr.roles r
        WHERE r.id = uc.role_id AND r.name ILIKE '%security%'
      )
    );
END;
$function$;

-- 4. Hardened Dead Shift Cleanup Batch (Job Concurrency Guard)
CREATE OR REPLACE FUNCTION public.cleanup_dead_shifts_batch(
    p_dry_run boolean DEFAULT NULL,
    p_batch_size integer DEFAULT NULL)
    RETURNS TABLE(
      run_id uuid,
      dry_run boolean,
      scanned integer,
      deleted integer,
      capped boolean,
      batch_started_at timestamptz,
      batch_finished_at timestamptz)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_started_at timestamptz := clock_timestamp();
  v_finished_at timestamptz;
  v_cfg public.dead_shift_cleanup_rules%ROWTYPE;
  v_effective_dry_run boolean;
  v_batch_size integer;
  v_recent_deleted bigint;
  v_budget integer;
  v_limit integer;
  v_candidate_ids uuid[];
  v_scanned integer := 0;
  v_deleted integer := 0;
  v_capped boolean := false;
  v_id uuid;
BEGIN
  -- Concurrency Guard: Non-blocking advisory lock prevents overlapping cleanup workers
  IF NOT pg_try_advisory_xact_lock(hashtext('job_cleanup_dead_shifts')) THEN
    RAISE NOTICE 'cleanup_dead_shifts_batch: another batch worker is running. Skipping execution.';
    RETURN;
  END IF;

  SELECT * INTO v_cfg FROM public.dead_shift_cleanup_rules
   WHERE organization_id IS NULL AND department_id IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    v_finished_at := clock_timestamp();
    INSERT INTO public.dead_shift_cleanup_log
      (run_id, dry_run, scanned, deleted, capped, batch_started_at, batch_finished_at, error_details)
    VALUES
      (v_run_id, COALESCE(p_dry_run, true), 0, 0, false, v_started_at, v_finished_at, 'Global rules config row missing');

    RETURN QUERY SELECT v_run_id, COALESCE(p_dry_run, true), 0, 0, false, v_started_at, v_finished_at;
    RETURN;
  END IF;

  v_effective_dry_run := COALESCE(p_dry_run, v_cfg.dry_run_default);
  v_batch_size        := LEAST(COALESCE(p_batch_size, v_cfg.batch_size_default), v_cfg.max_batch_size_hard_cap);

  SELECT COUNT(*) INTO v_recent_deleted
  FROM public.dead_shift_cleanup_log
  WHERE dry_run = false
    AND batch_started_at > NOW() - INTERVAL '1 hour';

  v_budget := GREATEST(0, v_cfg.max_deletes_per_hour - v_recent_deleted);
  v_limit  := LEAST(v_batch_size, v_budget);

  IF v_limit <= 0 THEN
    v_finished_at := clock_timestamp();
    INSERT INTO public.dead_shift_cleanup_log
      (run_id, dry_run, scanned, deleted, capped, batch_started_at, batch_finished_at, error_details)
    VALUES
      (v_run_id, v_effective_dry_run, 0, 0, true, v_started_at, v_finished_at, 'Hourly deletion budget exhausted');

    RETURN QUERY SELECT v_run_id, v_effective_dry_run, 0, 0, true, v_started_at, v_finished_at;
    RETURN;
  END IF;

  SELECT ARRAY_AGG(id) INTO v_candidate_ids
  FROM (
    SELECT s.id
    FROM public.shifts s
    WHERE s.deleted_at IS NULL
      AND (
        (s.is_cancelled = true AND s.updated_at < NOW() - (v_cfg.cancelled_retention_days || ' days')::interval)
        OR
        (s.lifecycle_status = 'Published'
         AND s.assigned_employee_id IS NULL
         AND ((s.shift_date || ' ' || s.end_time)::timestamp AT TIME ZONE 'Australia/Sydney') < NOW() - (v_cfg.expired_unassigned_retention_days || ' days')::interval)
      )
      AND NOT EXISTS (SELECT 1 FROM public.payroll_gross_pay_records pr WHERE pr.shift_id  = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.timesheet_entries         te WHERE te.shift_id  = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.compliance_breach_records cb WHERE cb.shift_id  = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.attendance_records   ar  WHERE ar.shift_id  = s.id)
    ORDER BY s.updated_at ASC
    LIMIT v_limit
    FOR UPDATE OF s SKIP LOCKED
  ) sub;

  IF v_candidate_ids IS NULL THEN
    v_candidate_ids := '{}'::uuid[];
  END IF;

  v_scanned := ARRAY_LENGTH(v_candidate_ids, 1);
  IF v_scanned IS NULL THEN v_scanned := 0; END IF;

  IF v_effective_dry_run THEN
    v_deleted := 0;
  ELSE
    FOREACH v_id IN ARRAY v_candidate_ids LOOP
      PERFORM public._archive_shift_before_delete(v_id);
      PERFORM public.sm_delete_shift(v_id);
      v_deleted := v_deleted + 1;
    END LOOP;
  END IF;

  v_finished_at := clock_timestamp();

  INSERT INTO public.dead_shift_cleanup_log
    (run_id, dry_run, scanned, deleted, capped, batch_started_at, batch_finished_at)
  VALUES
    (v_run_id, v_effective_dry_run, v_scanned, v_deleted, (v_scanned >= v_limit), v_started_at, v_finished_at);

  RETURN QUERY SELECT v_run_id, v_effective_dry_run, v_scanned, v_deleted, (v_scanned >= v_limit), v_started_at, v_finished_at;
END;
$$;
