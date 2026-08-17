-- ============================================================================
-- F1 Fairness Ledger — resilient "latest window" read  (audit F-04, part 1)
-- ============================================================================
--
-- PROBLEM
--   Every read of `fairness_ledger` demanded an EXACT match on today's date:
--
--       .eq('organization_id', org).eq('window_end', <today>)
--
--   but `window_end` advances daily and the ONLY writer of a fresh window is a
--   fire-and-forget client-side call in the `usePublishRoster` success handler.
--   There is no scheduled recompute. So on any day nobody publishes, the read
--   matched zero rows, every `fairness_debts` map arrived `{}`, and both solver
--   blocks (`if not debts: continue`) skipped longitudinal fairness entirely.
--
--   The failure was silent AND intermittent: the run completed, the scorecard
--   rendered, and fairness quality silently became a function of publishing
--   cadence rather than policy. Nothing distinguished "no debt" from "no data".
--
-- FIX
--   Read the most recent window AT OR BEFORE the as-of date, per
--   (employee, metric), instead of requiring an exact hit. Once any recompute
--   has run, reads keep working — they just get progressively staler, which the
--   caller can now SEE: the function returns `window_end`, so the TS layer
--   derives an age in days and surfaces a degraded/stale signal instead of
--   silently behaving as though everyone's debt were zero.
--
--   `DISTINCT ON (employee_id, metric) ... ORDER BY ..., window_end DESC` does
--   this in one index-ordered pass. Doing it client-side would mean pulling
--   every historical window (the table grows one row per employee/metric/day —
--   see audit F-20) and de-duplicating in the browser.
--
-- SECURITY
--   Deliberately SECURITY INVOKER (the default). `fairness_ledger` already has
--   RLS — `fairness_ledger_org_scoped`, which admits legacy admins cross-org
--   OR holders of an active gamma+ certificate for that org — and an INVOKER
--   function inherits it unchanged. A SECURITY DEFINER function would have had
--   to restate that two-branch predicate, and any drift between the copy and
--   the policy becomes an IDOR (cf. `get_quarterly_performance_report`,
--   2026-07-30). service_role still bypasses RLS as before, so the worker path
--   is unaffected.
--
--   NOTE (recurring gotcha): Postgres auto-grants EXECUTE on new functions to
--   PUBLIC, which `anon` inherits — `REVOKE ... FROM PUBLIC` alone does NOT
--   close it. Both REVOKEs below are required; run `get_advisors` after apply.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_fairness_debts_latest(
    p_org_id       uuid,
    p_employee_ids uuid[] DEFAULT NULL,   -- NULL = every employee in the org
    p_as_of        date   DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    employee_id   uuid,
    metric        text,
    window_start  date,
    window_end    date,
    rolling_value numeric,
    team_average  numeric,
    debt          numeric
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
    SELECT DISTINCT ON (fl.employee_id, fl.metric)
           fl.employee_id,
           fl.metric,
           fl.window_start,
           fl.window_end,
           fl.rolling_value,
           fl.team_average,
           fl.debt
      FROM public.fairness_ledger fl
     WHERE fl.organization_id = p_org_id
       AND fl.window_end     <= p_as_of
       AND (p_employee_ids IS NULL OR fl.employee_id = ANY (p_employee_ids))
     ORDER BY fl.employee_id, fl.metric, fl.window_end DESC;
$$;

ALTER FUNCTION public.get_fairness_debts_latest(uuid, uuid[], date) OWNER TO postgres;

COMMENT ON FUNCTION public.get_fairness_debts_latest(uuid, uuid[], date) IS
    'F1 fairness ledger: most recent debt row per (employee, metric) with window_end <= p_as_of. '
    'Replaces the exact window_end = today match that made the ledger read empty on any day '
    'without a recompute (audit F-04). Returns window_end so callers can surface staleness. '
    'SECURITY INVOKER — fairness_ledger_org_scoped RLS is the single access-control source.';

-- Supports the DISTINCT ON ordering above. The existing
-- idx_fairness_ledger_lookup is (organization_id, metric, window_end), which
-- does not lead with employee_id and so cannot serve this ordering directly.
CREATE INDEX IF NOT EXISTS idx_fairness_ledger_latest
    ON public.fairness_ledger (organization_id, employee_id, metric, window_end DESC);

REVOKE ALL ON FUNCTION public.get_fairness_debts_latest(uuid, uuid[], date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_fairness_debts_latest(uuid, uuid[], date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_fairness_debts_latest(uuid, uuid[], date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fairness_debts_latest(uuid, uuid[], date) TO service_role;
