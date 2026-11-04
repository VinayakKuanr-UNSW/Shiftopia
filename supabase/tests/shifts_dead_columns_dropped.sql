-- shifts dead columns cleanup test
--
-- Checks:
--   A. shifts has none of the 11 dead columns:
--      locked_at, timesheet_id, compliance_override_reason, offer_sent_at,
--      cancellation_reason, cancelled_by_user_id, published_by_user_id,
--      dropped_by_id, confirmed_at, assignment_source, event_tags
--   B. dropped_by_id constraint and index are gone
--   C. no trigger definition on shifts names timesheet_id or compliance_override_reason
-- Ends by raising, so nothing persists.
--
-- Expected output: PASSED (rolled back): A B C

DO $$
DECLARE
  v_names  text;
  v_passed text := '';
BEGIN
  -- A. Check columns are gone
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO v_names
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'shifts'
    AND column_name IN (
      'locked_at', 'timesheet_id', 'compliance_override_reason',
      'offer_sent_at', 'cancellation_reason', 'cancelled_by_user_id',
      'published_by_user_id', 'dropped_by_id', 'confirmed_at',
      'assignment_source', 'event_tags'
    );
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — shifts still has %', v_names;
  END IF;
  v_passed := v_passed || 'A ';

  -- B. Check index & constraint are gone
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shifts_dropped_by_id_fkey') THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — FK shifts_dropped_by_id_fkey still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_shifts_dropped_by_id') THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — index idx_shifts_dropped_by_id still exists';
  END IF;
  v_passed := v_passed || 'B ';

  -- C. Check triggers
  SELECT string_agg(tgname, ', ') INTO v_names FROM pg_trigger
  WHERE tgrelid = 'public.shifts'::regclass AND NOT tgisinternal
    AND (pg_get_triggerdef(oid) ILIKE '%timesheet_id%'
         OR pg_get_triggerdef(oid) ILIKE '%compliance_override_reason%');
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — triggers still name dropped columns: %', v_names;
  END IF;
  v_passed := v_passed || 'C';

  RAISE EXCEPTION 'PASSED (rolled back): %', v_passed;
END
$$;

