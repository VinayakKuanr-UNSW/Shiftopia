-- shifts cleanup: drop 11 unused/dead columns.
--
-- Columns dropped:
--   - locked_at: dead lockout timestamp; 0 readers, only set to NULL in process_shift_timers.
--   - timesheet_id: dead link; 0 readers, only synced to shift_payroll_records.
--   - compliance_override_reason: dead text field; 0 writers, only synced to shift_compliance_snapshots.
--   - offer_sent_at: dead offer dispatch timestamp; 0 readers.
--   - cancellation_reason: dead column; 0 readers (reasons are stored on shift_events).
--   - cancelled_by_user_id, published_by_user_id: dead actor IDs; 0 readers (actor info is in shift_events).
--   - dropped_by_id: abandoned duplicate of last_dropped_by; never written by shift operations.
--   - confirmed_at: ghost timestamp; written by 6 RPCs but never read by any query or UI.
--   - assignment_source: write-only provenance; never read anywhere.
--   - event_tags: template artifact; never read on shifts.
--
-- All 20 live rows hold NULL (or '[]'::jsonb) in these columns; nothing is lost.
-- Functions are patched from their live definitions with exact match counts.
-- Test: supabase/tests/shifts_dead_columns_dropped.sql

DO $$
DECLARE r record; v_def text; v_hits int;
BEGIN
  -- 1. Premise check
  IF EXISTS (
    SELECT 1 FROM public.shifts
    WHERE locked_at IS NOT NULL
       OR timesheet_id IS NOT NULL
       OR compliance_override_reason IS NOT NULL
       OR offer_sent_at IS NOT NULL
       OR cancellation_reason IS NOT NULL
       OR cancelled_by_user_id IS NOT NULL
       OR published_by_user_id IS NOT NULL
       OR dropped_by_id IS NOT NULL
       OR confirmed_at IS NOT NULL
       OR assignment_source IS NOT NULL
       OR (event_tags IS NOT NULL AND event_tags <> '[]'::jsonb)
  ) THEN
    RAISE EXCEPTION 'shifts holds data in a column this migration drops';
  END IF;

  -- 2. Function patches
  FOR r IN SELECT * FROM (VALUES
      (1, 'public.process_shift_timers', '(\n\s+is_on_bidding\s+=\s+FALSE,)\n\s+locked_at\s+=\s+NULL,', '\1', 1),
      (2, 'public._sync_payroll_record', '\n\s+OR\s+NEW\.timesheet_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.timesheet_id', '', 1),
      (3, 'public._sync_payroll_record', ',\s+timesheet_id\s*\)', ')', 1),
      (4, 'public._sync_payroll_record', ',\s+NEW\.timesheet_id\s*\)', ')', 1),
      (5, 'public._sync_payroll_record', '\n\s+timesheet_id\s+=\s+EXCLUDED\.timesheet_id,', '', 1),
      (6, 'public._sync_payroll_record', '\s+OR\s+shift_payroll_records\.timesheet_id\s+IS\s+DISTINCT\s+FROM\s+EXCLUDED\.timesheet_id', '', 1),
      (7, 'public._sync_compliance_snapshot', '\n\s+OR\s+NEW\.compliance_override_reason\s+IS\s+DISTINCT\s+FROM\s+OLD\.compliance_override_reason', '', 1),
      (8, 'public._sync_compliance_snapshot', 'NEW\.compliance_override_reason', 'NULL', 1),
      (9, 'public.apply_template_to_date_range_v2', '\n\s+event_tags,', '', 1),
      (10, 'public.apply_template_to_date_range_v2', '\n\s+to_jsonb\(v_ts\.event_tags\),', '', 1),
      (11, 'public.delete_user_entirely', 'SET\s+cancelled_by_user_id\s+=\s+NULLIF\(cancelled_by_user_id,\s+user_uuid\),\s+published_by_user_id\s+=\s+NULLIF\(published_by_user_id,\s+user_uuid\),\s+emergency_assigned_by\s+=\s+NULLIF\(emergency_assigned_by,\s+user_uuid\),\s+dropped_by_id\s+=\s+NULLIF\(dropped_by_id,\s+user_uuid\)\s+WHERE\s+cancelled_by_user_id\s+=\s+user_uuid\s+OR\s+published_by_user_id\s+=\s+user_uuid\s+OR\s+emergency_assigned_by\s+=\s+user_uuid\s+OR\s+dropped_by_id\s+=\s+user_uuid;', 'SET emergency_assigned_by = NULLIF(emergency_assigned_by, user_uuid) WHERE emergency_assigned_by = user_uuid;', 1),
      (12, 'public.fn_capture_shift_event', 'COALESCE\(NEW\.offer_sent_at,\s*now\(\)\)', 'now()', 1),
      (13, 'public.fn_capture_shift_event', 'COALESCE\(NEW\.confirmed_at,\s*now\(\)\)', 'now()', 1),
      (14, 'public.sm_accept_offer', '\n\s+confirmed_at\s+=\s+NOW\(\),', '', 1),
      (15, 'public.sm_emergency_assign', '\n\s+assignment_source\s+=\s+\''direct\'',', '', 1),
      (16, 'public.sm_emergency_assign', '\n\s+confirmed_at\s+=\s+NOW\(\),', '', 1),
      (17, 'public.sm_employee_drop_shift', '\n\s+confirmed_at\s+=\s+NULL,', '', 1),
      (18, 'public.sm_unassign_shift', '\n\s+confirmed_at\s+=\s+NULL,', '', 1),
      (19, 'public.sm_bulk_publish_shifts', '\n\s+confirmed_at\s+=\s+CASE\s+WHEN\s+vt\.new_state_id\s+=\s+\''S4\''\s+THEN\s+NOW\(\)\s+ELSE\s+s\.confirmed_at\s+END,', '', 1),
      (20, 'public.sm_bulk_publish_shifts', '\n\s+offer_sent_at\s+=\s+CASE\s+WHEN\s+vt\.new_state_id\s+=\s+\''S3\''\s+THEN\s+NOW\(\)\s+ELSE\s+s\.offer_sent_at\s+END,', '', 1),
      (21, 'public.sm_create_shift', ',\s+assignment_source,', ',', 1),
      (22, 'public.sm_create_shift', '\n\s+v_assignment_source,', '', 1),
      (23, 'public.sm_apply_shift_op', '\''assignment_source\'',\s+v_cur\.assignment_source,', '''assignment_source'', p_payload->>''assignment_source'',', 1),
      (24, 'public._apply_shift_op_write', '\n\s+confirmed_at\s+=\s+CASE\s+WHEN\s+lifecycle_status\s+=\s+\''Published\''\s+THEN\s+NOW\(\)\s+ELSE\s+confirmed_at\s+END,', '', 1),
      (25, 'public._apply_shift_op_write', '\n\s+confirmed_at\s+=\s+NULL,', '', 1),
      (26, 'public._apply_shift_op_write', '\n\s+confirmed_at\s+=\s+NOW\(\),', '', 2),
      (27, 'public._apply_shift_op_write', '\n\s+confirmed_at\s+=\s+CASE\s+WHEN\s+v_do_unassign\s+THEN\s+NULL\s+ELSE\s+confirmed_at\s+END,', '', 1),
      (28, 'public._apply_shift_op_write', '\n\s+published_by_user_id\s*=\s*p_actor,', '', 3),
      (29, 'public._apply_shift_op_write', '\''assigned_employee_id\'',\''assignment_source\'',\''required_skills\''', '''assigned_employee_id'',''required_skills''', 1),
      (30, 'public._apply_shift_op_write', '\n\s+assignment_source\s+=\s+CASE\s+WHEN\s+v_do_assign\s+THEN\s+v_assign_src\s+WHEN\s+v_do_unassign\s+THEN\s+NULL\s+ELSE\s+assignment_source\s+END,', '', 1)
    ) AS t(ord, fn, pat, rep, expected) ORDER BY ord
  LOOP
    v_def := pg_get_functiondef(r.fn::regproc);
    SELECT count(*) INTO v_hits FROM regexp_matches(v_def, r.pat, 'g');
    IF v_hits <> r.expected THEN
      RAISE EXCEPTION 'patch % on %: % matches, expected %', r.ord, r.fn, v_hits, r.expected;
    END IF;
    EXECUTE regexp_replace(v_def, r.pat, r.rep, 'g');
  END LOOP;
END $$;

-- 3. Recreate Triggers whose definitions name dropped columns
DROP TRIGGER trg_sync_compliance_snapshot ON public.shifts;
CREATE TRIGGER trg_sync_compliance_snapshot AFTER INSERT OR UPDATE OF compliance_snapshot, eligibility_snapshot, compliance_checked_at, compliance_override ON public.shifts FOR EACH ROW EXECUTE FUNCTION _sync_compliance_snapshot();

DROP TRIGGER trg_sync_payroll_record ON public.shifts;
CREATE TRIGGER trg_sync_payroll_record AFTER INSERT OR UPDATE OF actual_start, actual_end, actual_net_minutes, payroll_exported ON public.shifts FOR EACH ROW EXECUTE FUNCTION _sync_payroll_record();

-- 4. Drop Constraints & Indexes
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_dropped_by_id_fkey;
DROP INDEX IF EXISTS public.idx_shifts_dropped_by_id;

-- 5. Drop Dead Columns
ALTER TABLE public.shifts
  DROP COLUMN locked_at,
  DROP COLUMN timesheet_id,
  DROP COLUMN compliance_override_reason,
  DROP COLUMN offer_sent_at,
  DROP COLUMN cancellation_reason,
  DROP COLUMN cancelled_by_user_id,
  DROP COLUMN published_by_user_id,
  DROP COLUMN dropped_by_id,
  DROP COLUMN confirmed_at,
  DROP COLUMN assignment_source,
  DROP COLUMN event_tags;
