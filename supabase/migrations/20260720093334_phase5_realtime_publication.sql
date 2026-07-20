-- =============================================================================
-- Phase 5 (M6) — Add the self-service tables to the supabase_realtime publication.
--
-- Only `notifications` was realtime, so the My Bids / My Swaps / My Leaves list
-- views relied on 60s react-query staleness (Leave had no polling at all). Adding
-- these tables lets the client subscribe and invalidate on change. RLS is
-- enforced for realtime, so subscribers only receive rows they may read (the
-- Phase-1 scoped policies apply). Default REPLICA IDENTITY (primary key) is
-- sufficient for the INSERT/UPDATE payloads the client uses to invalidate.
-- Idempotent: skip any table already in the publication.
-- =============================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shift_bids','shift_swaps','swap_offers','leave_requests','leave_balances']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
