-- shifts Phase 2b (database, column kept): no deleted_at logic is left except
-- get_shift_delta's returned column, which goes with the column drop.
--
-- Covers the shifts_phase2b_deleted_at_logic migration. Checks:
--   A. no function in public/hr/internal names deleted_at, except get_shift_delta
--   B. v_shift_assignment_episodes names no deleted_at, still runs as the
--      caller (security_invoker) and keeps its SELECT grants
--   C. no index on shifts names deleted_at; the template-instance key is still
--      UNIQUE on (roster_id, template_instance_id) for non-NULL instances
-- Ends by raising, so nothing persists.
--
-- Expected output (as the error text):  PASSED (rolled back): A B C
-- Last run: 2026-10-30 against Supabase dev — FAILED before the migration, PASSED after.

DO $$
DECLARE
  v_names  text;
  v_passed text := '';
BEGIN
  -- A
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_names
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'hr', 'internal')
    AND p.prosrc ILIKE '%deleted_at%'
    AND p.proname <> 'get_shift_delta';
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — still names deleted_at: %', v_names;
  END IF;
  v_passed := v_passed || 'A ';

  -- B
  IF pg_get_viewdef('public.v_shift_assignment_episodes'::regclass) ILIKE '%deleted%' THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — v_shift_assignment_episodes still names deleted_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.v_shift_assignment_episodes'::regclass
                 AND 'security_invoker=on' = ANY (reloptions)) THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — v_shift_assignment_episodes lost security_invoker';
  END IF;
  IF NOT (has_table_privilege('authenticated', 'public.v_shift_assignment_episodes', 'SELECT')
          AND has_table_privilege('service_role', 'public.v_shift_assignment_episodes', 'SELECT')) THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — v_shift_assignment_episodes lost a SELECT grant';
  END IF;
  v_passed := v_passed || 'B ';

  -- C
  SELECT string_agg(indexname, ', ') INTO v_names
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'shifts' AND indexdef ILIKE '%deleted_at%';
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — indexes still name deleted_at: %', v_names;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE schemaname = 'public' AND indexname = 'shifts_roster_template_instance_key'
                   AND indexdef = 'CREATE UNIQUE INDEX shifts_roster_template_instance_key ON public.shifts USING btree (roster_id, template_instance_id) WHERE (template_instance_id IS NOT NULL)') THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — shifts_roster_template_instance_key is missing or changed shape';
  END IF;
  v_passed := v_passed || 'C';

  RAISE EXCEPTION 'PASSED (rolled back): %', v_passed;
END
$$;
