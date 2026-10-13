-- ============================================================================
-- WS-E (part 1) · Cover unindexed foreign keys
-- ============================================================================
-- Advisor (performance): 19 x unindexed_foreign_keys. An FK with no covering
-- index forces sequential scans on joins and on cascade / RESTRICT checks when
-- the parent row is updated or deleted. All additive + IF NOT EXISTS, so this
-- is a safe, reversible change.
--
-- Note: CREATE INDEX (non-CONCURRENTLY) takes a brief lock; these tables are
-- small-to-moderate. If any table is large at apply time, run the equivalent
-- CREATE INDEX CONCURRENTLY manually outside a transaction instead.
-- ----------------------------------------------------------------------------
SET search_path = public;

CREATE INDEX IF NOT EXISTS idx_assignment_events_shift_id            ON public.assignment_events (shift_id);
CREATE INDEX IF NOT EXISTS idx_assignment_runs_department_id         ON public.assignment_runs (department_id);
CREATE INDEX IF NOT EXISTS idx_assignment_runs_sub_department_id     ON public.assignment_runs (sub_department_id);
CREATE INDEX IF NOT EXISTS idx_compliance_rejections_user_id         ON public.compliance_rejections (user_id);
CREATE INDEX IF NOT EXISTS idx_demand_forecasts_event_id            ON public.demand_forecasts (event_id);
CREATE INDEX IF NOT EXISTS idx_demand_forecasts_role_id             ON public.demand_forecasts (role_id);
CREATE INDEX IF NOT EXISTS idx_demand_templates_superseded_by       ON public.demand_templates (superseded_by);
CREATE INDEX IF NOT EXISTS idx_gross_pay_records_computed_by        ON public.gross_pay_records (computed_by);
CREATE INDEX IF NOT EXISTS idx_planning_offers_offered_by           ON public.planning_offers (offered_by);
CREATE INDEX IF NOT EXISTS idx_planning_requests_manager_id         ON public.planning_requests (manager_id);
CREATE INDEX IF NOT EXISTS idx_planning_requests_target_employee_id ON public.planning_requests (target_employee_id);
CREATE INDEX IF NOT EXISTS idx_role_levels_remuneration_level       ON public.role_levels (remuneration_level);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_auto_decision_id         ON public.shift_swaps (auto_decision_id);
CREATE INDEX IF NOT EXISTS idx_shifts_remuneration_level            ON public.shifts (remuneration_level);
CREATE INDEX IF NOT EXISTS idx_swap_approval_rules_department_id    ON public.swap_approval_rules (department_id);
CREATE INDEX IF NOT EXISTS idx_swap_approval_rules_updated_by       ON public.swap_approval_rules (updated_by);
CREATE INDEX IF NOT EXISTS idx_swap_decisions_reverted_by           ON public.swap_decisions (reverted_by);
CREATE INDEX IF NOT EXISTS idx_template_shifts_remuneration_level   ON public.template_shifts (remuneration_level);

-- hr schema
CREATE INDEX IF NOT EXISTS idx_hr_user_contracts_remuneration_level ON hr.user_contracts (remuneration_level);
