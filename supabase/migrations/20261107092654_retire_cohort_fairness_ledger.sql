-- Retire the cohort fairness engine.
--
-- Fairness is casual-only and opportunity-adjusted since 20261107030325
-- (casual_fairness_ledger, fairness_opportunities). Nothing in the app reads
-- fairness_ledger or calls these functions any more. The ledger was derived
-- data (recomputable from shifts, bids and contracts); its last generation was
-- exported before this ran.
--
-- Rollback: the definitions are in 20251015000000_baseline_schema.sql and
-- 20260805030000_fairness_eba_weighted_metrics.sql; the rows in
-- ~/Documents/superman-db-exports/2026-11-07/fairness_ledger.csv.

SELECT cron.unschedule(jobname)
  FROM cron.job
 WHERE jobname IN ('nightly_fairness_recompute', 'weekly_fairness_ledger_prune');

DROP FUNCTION public.request_fairness_ledger_recompute(uuid, date);
DROP FUNCTION public.recompute_all_fairness_ledgers();
DROP FUNCTION public.recompute_fairness_ledger(uuid, date, integer, uuid, text);
DROP FUNCTION public.get_fairness_debts_latest(uuid, uuid[], date);
DROP FUNCTION public.prune_fairness_ledger(integer);

DROP TABLE public.fairness_ledger;
