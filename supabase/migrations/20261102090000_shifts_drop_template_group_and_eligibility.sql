-- shifts cleanup: drop 3 deprecated/redundant columns:
--   - template_group: deprecated enum; 0 readers, superseded by roster_subgroup_id / group_type.
--   - template_sub_group: deprecated text; 0 readers, superseded by roster_subgroup_id / sub_group_name.
--   - eligibility_snapshot: unused jsonb blob; 0 readers, only copied in _sync_compliance_snapshot.
--
-- All 20 live rows hold NULL in these columns; nothing is lost.
-- Functions are patched from their live definitions with exact match counts.
-- Test: supabase/tests/shifts_tier2_columns_dropped.sql

DO $$
DECLARE r record; v_def text; v_hits int;
BEGIN
  -- 1. Premise check
  IF EXISTS (
    SELECT 1 FROM public.shifts
    WHERE template_group IS NOT NULL
       OR template_sub_group IS NOT NULL
       OR eligibility_snapshot IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'shifts holds data in a column this migration drops';
  END IF;

  -- 2. Function patches
  FOR r IN SELECT * FROM (VALUES
      (1, 'public.apply_template_to_date_range_v2', 
       '(\n\s+sub_group_name,)\n\s+template_group,\n\s+template_sub_group,', 
       '\1', 1),
      (2, 'public.apply_template_to_date_range_v2', 
       '(\n\s+v_external_id::template_group_type,\n\s+v_tsg\.name,)\n\s+v_external_id::template_group_type,\n\s+v_tsg\.name,', 
       '\1', 1),
      (3, 'public.sm_create_shift', 
       'template_id, template_group, template_sub_group, is_from_template,', 
       'template_id, is_from_template,', 1),
      (4, 'public.sm_create_shift', 
       '\(p_shift_data->>''template_id''\)::uuid,\n\s+\(p_shift_data->>''template_group''\)::template_group_type,\n\s+p_shift_data->>''template_sub_group'',', 
       '(p_shift_data->>''template_id'')::uuid,', 1),
      (5, 'public._sync_compliance_snapshot', 
       '\n\s+OR NEW\.eligibility_snapshot\s+IS DISTINCT FROM OLD\.eligibility_snapshot', 
       '', 1),
      (6, 'public._sync_compliance_snapshot', 
       '\n\s+eligibility_snapshot,', 
       '', 1),
      (7, 'public._sync_compliance_snapshot', 
       '\n\s+NEW\.eligibility_snapshot,', 
       '', 1),
      (8, 'public._sync_compliance_snapshot', 
       '\n\s+eligibility_snapshot\s+=\s+EXCLUDED\.eligibility_snapshot,', 
       '', 1),
      (9, 'public._sync_compliance_snapshot', 
       '\s+OR\s+shift_compliance_snapshots\.eligibility_snapshot\s+IS DISTINCT FROM EXCLUDED\.eligibility_snapshot', 
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

  -- 3. Trigger recreation without eligibility_snapshot in UPDATE OF list
  DROP TRIGGER IF EXISTS trg_sync_compliance_snapshot ON public.shifts;
  CREATE TRIGGER trg_sync_compliance_snapshot
    AFTER INSERT OR UPDATE OF compliance_snapshot, compliance_checked_at, compliance_override
    ON public.shifts
    FOR EACH ROW
    EXECUTE FUNCTION public._sync_compliance_snapshot();

  -- 4. Drop columns
  ALTER TABLE public.shifts
    DROP COLUMN template_group,
    DROP COLUMN template_sub_group,
    DROP COLUMN eligibility_snapshot;

END $$;

