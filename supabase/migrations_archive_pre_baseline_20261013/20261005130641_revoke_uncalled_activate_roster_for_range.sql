-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005130641). Do not re-run against production.
-- ─────────────────────────────────────────────────────────────────────────────

-- activate_roster_for_range creates roster rows for any organisation /
-- department / sub-department and date range. It is SECURITY DEFINER, reads
-- auth.uid() only to stamp created_by, and checks nothing — so any signed-in
-- user could create rosters anywhere. It has no callers: the client stopped
-- using it (useRosterMutations.ts says so), no SQL function or cron job calls
-- it. Found by the follow-up to 20261005130320 (functions whose only reference
-- to the caller is attribution, not a check). Client EXECUTE removed.

REVOKE ALL ON FUNCTION public.activate_roster_for_range(uuid, uuid, uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_roster_for_range(uuid, uuid, uuid, date, date) TO service_role;
