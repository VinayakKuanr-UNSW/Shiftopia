-- shifts cleanup: Tier 3 Track 1 drops (6 columns)
--   - is_locked: dead lockout boolean; 0 DB writers/readers.
--   - compliance_snapshot: redundant jsonb blob; side table shift_compliance_snapshots holds real record.
--   - compliance_checked_at: ghost timestamp; lives on shift_compliance_snapshots.
--   - compliance_override: boolean flag; lives on shift_compliance_snapshots.is_overridden.
--   - emergency_assigned_by: dead user id; actor info is in shift_events.
--   - emergency_assigned_at: redundant timestamp; emergency state is tracked by assignment_outcome = 'emergency_assigned'.
--
-- All 20 live rows hold NULL or false in these columns; nothing is lost.
-- Functions are patched from their live definitions with exact match counts.
-- Test: supabase/tests/shifts_tier3_track1_dropped.sql

DO $$
DECLARE r record; v_def text; v_hits int;
BEGIN
  -- 1. Premise check
  IF EXISTS (
    SELECT 1 FROM public.shifts
    WHERE is_locked IS NOT FALSE
       OR compliance_snapshot IS NOT NULL
       OR compliance_checked_at IS NOT NULL
       OR compliance_override IS NOT FALSE
       OR emergency_assigned_by IS NOT NULL
       OR emergency_assigned_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'shifts holds data in a column this migration drops';
  END IF;

  -- 2. Function patches
  FOR r IN SELECT * FROM (VALUES
      (1, 'public._apply_shift_op_write', 
       '\n\s+emergency_assigned_at\s+=\s+NOW\(\),\n\s+emergency_assigned_by\s+=\s+p_actor,', 
       '', 1),
      (2, 'public.delete_user_entirely', 
       '\n\s+UPDATE public\.shifts\s+SET emergency_assigned_by = NULLIF\(emergency_assigned_by, user_uuid\) WHERE emergency_assigned_by = user_uuid;', 
       '', 1),
      (3, 'public.get_dept_insights_breakdown', 
       'COUNT\(\*\) FILTER \(WHERE s\.emergency_assigned_at IS NOT NULL\)::int', 
       'COUNT(*) FILTER (WHERE s.assignment_outcome = ''emergency_assigned'')::int', 1),
      (4, 'public.get_insights_summary', 
       'COUNT\(\*\) FILTER \(WHERE s\.emergency_assigned_at IS NOT NULL\)', 
       'COUNT(*) FILTER (WHERE s.assignment_outcome = ''emergency_assigned'')', 1),
      (5, 'public.get_insights_summary', 
       'SELECT COUNT\(\*\) FILTER \(WHERE s\.compliance_override = true\)\n\s+INTO v_comp_over\n\s+FROM shifts s\n\s+WHERE', 
       'SELECT COUNT(*) INTO v_comp_over FROM shifts s JOIN shift_compliance_snapshots scs ON scs.shift_id = s.id WHERE scs.is_overridden = true AND', 1),
      (6, 'public.sm_emergency_assign', 
       '\n\s+emergency_assigned_at = NOW\(\),\n\s+compliance_checked_at = NOW\(\),', 
       '', 1)
    ) AS t(ord, fn, pat, rep, expected) ORDER BY ord
  LOOP
    v_def := pg_get_functiondef(r.fn::regproc);
    SELECT count(*) INTO v_hits FROM regexp_matches(v_def, r.pat, 'g');
    IF v_hits <> r.expected THEN
      RAISE EXCEPTION 'patch % on %: % matches, expected %', r.ord, r.fn, v_hits, r.expected;
    END IF;
    EXECUTE regexp_replace(v_def, r.pat, r.rep, 'g');
  END LOOP;

  -- 3. Drop compliance snapshot sync trigger & function
  DROP TRIGGER IF EXISTS trg_sync_compliance_snapshot ON public.shifts;
  DROP FUNCTION IF EXISTS public._sync_compliance_snapshot();

  -- 4. Drop constraint and index on emergency_assigned_by
  ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_emergency_assigned_by_fkey;
  DROP INDEX IF EXISTS public.idx_shifts_emergency_assigned_by;

  -- 5. Drop the 6 columns
  ALTER TABLE public.shifts
    DROP COLUMN is_locked,
    DROP COLUMN compliance_snapshot,
    DROP COLUMN compliance_checked_at,
    DROP COLUMN compliance_override,
    DROP COLUMN emergency_assigned_by,
    DROP COLUMN emergency_assigned_at;

END $$;

