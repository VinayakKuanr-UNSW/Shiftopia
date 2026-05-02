-- Demand Engine Reproducibility Hardening
-- Adds explicit snapshot fields to demand_tensor to ensure historical reproducibility.

ALTER TABLE public.demand_tensor
    ADD COLUMN IF NOT EXISTS timecard_ratio_used numeric NOT NULL DEFAULT 1.0,
    ADD COLUMN IF NOT EXISTS feedback_multiplier_used numeric NOT NULL DEFAULT 1.0,
    ADD COLUMN IF NOT EXISTS rule_version_id uuid, -- Link to specific rule version if available
    ADD COLUMN IF NOT EXISTS execution_timestamp timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.demand_tensor.timecard_ratio_used IS 'Snapshot of the L4 timecard ratio at execution time.';
COMMENT ON COLUMN public.demand_tensor.feedback_multiplier_used IS 'Snapshot of the L5 supervisor feedback multiplier at execution time.';
COMMENT ON COLUMN public.demand_tensor.rule_version_id IS 'Link to the specific version of rules used (future proofing).';
