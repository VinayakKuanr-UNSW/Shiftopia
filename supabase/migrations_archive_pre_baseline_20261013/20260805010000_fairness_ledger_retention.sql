-- ============================================================================
-- fairness_ledger retention  (audit F-20, growth half)
-- ============================================================================
--
-- The table's unique key is (organization_id, employee_id, metric, window_end)
-- and `window_end` advances daily, so a full recompute writes a NEW generation
-- of rows every day and nothing ever removes the old ones:
--
--     rows/year = employees x 6 metrics x 365
--
-- At 200 employees that is ~438k rows/year, per org, growing without bound. The
-- concurrency half of F-20 was fixed by deleting the client-side
-- read-modify-write; this is the growth half.
--
-- It is not merely a disk-space question. `get_fairness_debts_latest` does a
-- `DISTINCT ON ... ORDER BY window_end DESC` over every historical generation,
-- so the scan cost grows linearly with retained history for a result that only
-- ever needs the newest row per (employee, metric).
--
-- POLICY
--   Keep 2 x DEFAULT_WINDOW_DAYS (182 days). That is comfortably longer than
--   the 91-day rolling window the ledger reports on, so:
--     - `get_fairness_debts_latest` can still resolve an as-of date anywhere
--       inside the reporting window plus a full window of slack, and
--     - a debt can always be reconstructed for an employee querying a decision
--       made against a ledger generation from the previous quarter.
--   Anything older is strictly reconstructable by re-running the recompute
--   against the shift history, which is the real source of truth.
--
--   The newest generation per (org, employee, metric) is ALWAYS kept regardless
--   of age — otherwise an org that stops recomputing would have its ledger
--   silently deleted out from under the reads, turning a stale-but-usable
--   answer into "unavailable" (exactly the failure F-04 set out to remove).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prune_fairness_ledger(
    p_retain_days integer DEFAULT 182
)
RETURNS integer          -- rows deleted
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_deleted integer := 0;
BEGIN
    WITH newest AS (
        -- The generation each (org, employee, metric) would resolve to today.
        -- Never pruned, however old it is.
        SELECT DISTINCT ON (organization_id, employee_id, metric)
               organization_id, employee_id, metric, window_end
          FROM public.fairness_ledger
         ORDER BY organization_id, employee_id, metric, window_end DESC
    ),
    removed AS (
        DELETE FROM public.fairness_ledger fl
         USING newest n
         WHERE fl.organization_id = n.organization_id
           AND fl.employee_id     = n.employee_id
           AND fl.metric          = n.metric
           AND fl.window_end     <> n.window_end                  -- keep newest
           AND fl.window_end      < CURRENT_DATE - p_retain_days  -- and anything recent
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_deleted FROM removed;

    RETURN v_deleted;
END $$;

ALTER FUNCTION public.prune_fairness_ledger(integer) OWNER TO postgres;

COMMENT ON FUNCTION public.prune_fairness_ledger(integer) IS
    'Drops fairness_ledger generations older than p_retain_days, always keeping the newest generation per (org, employee, metric) so reads can never be starved. Audit F-20 (unbounded growth).';

REVOKE ALL ON FUNCTION public.prune_fairness_ledger(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_fairness_ledger(integer) FROM anon;
REVOKE ALL ON FUNCTION public.prune_fairness_ledger(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prune_fairness_ledger(integer) TO service_role;

-- Weekly, an hour after the nightly recompute so the two never contend.
-- Sunday 17:00 UTC ~= Monday 03:00 AEST / 04:00 AEDT.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('weekly_fairness_ledger_prune')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly_fairness_ledger_prune');

    PERFORM cron.schedule(
        'weekly_fairness_ledger_prune',
        '0 17 * * 0',
        'SELECT public.prune_fairness_ledger()'
    );
  ELSE
    RAISE WARNING 'pg_cron not installed — weekly_fairness_ledger_prune NOT scheduled. fairness_ledger will grow without bound.';
  END IF;
END $$;
