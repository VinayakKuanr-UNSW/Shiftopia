-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005124035). Do not re-run against production. Rollback-only dry-run
-- beforehand: the ML upsert run twice with a NULL scenario_id landed on ONE row;
-- anon read 0 rows; employee read unchanged, employee rollback-delete 0 rows;
-- manager rollback-delete removed the run's row.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Give demand_forecasts the columns both of its writers already assume.
--
-- ml/api.py::_persist_results upserts synthesis_run_id, scenario_id, version and
-- feature_payload with on_conflict (event_id, role, time_slot, version,
-- scenario_id), and synthesisRuns.queries.ts::rollbackRun deletes
-- `.eq('synthesis_run_id', runId)`. None of those columns, nor that unique key,
-- ever existed in prod, so:
--   * every rollback's forecast delete failed (logged, non-fatal — 9 of 50 runs
--     have been rolled back);
--   * the ML write would 500 the moment a caller passed a run id. It is dormant
--     only because the client never does yet (useShiftSynthesis "P1 follow-up").
--
-- The key is NULLS NOT DISTINCT: scenario_id is NULL for every non-scenario
-- forecast, and with default NULL semantics no two such rows would conflict, so
-- the upsert would append a duplicate on every call instead of replacing.
--
-- The 2026-10-05 open-write sweep (20261005073424) removed the open write
-- policies here; the rollback delete now gets a scoped one — the same
-- `shift.create` over the run's scope that demand_tensor's policies use. anon's
-- read (a USING true policy) is dropped; signed-in reads are unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.demand_forecasts
  ADD COLUMN synthesis_run_id uuid REFERENCES public.synthesis_runs(id) ON DELETE CASCADE,
  ADD COLUMN scenario_id      text,
  ADD COLUMN version          integer NOT NULL DEFAULT 1,
  ADD COLUMN feature_payload  jsonb;

CREATE UNIQUE INDEX demand_forecasts_upsert_key
  ON public.demand_forecasts (event_id, role, time_slot, version, scenario_id) NULLS NOT DISTINCT;
CREATE INDEX idx_demand_forecasts_synthesis_run_id ON public.demand_forecasts (synthesis_run_id);

CREATE POLICY demand_forecasts_delete_run_manager ON public.demand_forecasts
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.synthesis_runs sr
                  WHERE sr.id = demand_forecasts.synthesis_run_id
                    AND public.user_has_action_in_scope('shift.create', sr.organization_id, sr.department_id, sr.sub_department_id)));

DROP POLICY "Allow anon select on demand_forecasts" ON public.demand_forecasts;
