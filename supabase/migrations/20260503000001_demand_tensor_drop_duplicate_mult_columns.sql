-- Migration: 20260503000001_demand_tensor_drop_duplicate_mult_columns
-- Purpose:   Remove the duplicate columns timecard_mult and feedback_mult from
--            public.demand_tensor.  The semantically equivalent (and more
--            descriptive) columns timecard_ratio_used and
--            feedback_multiplier_used were introduced in migration
--            20260502000015_demand_engine_determinism.sql and have been
--            populated identically since that migration ran.
--
-- Safety net: copy any row where the kept column still holds its default (1.0)
-- but the old column was set to a different value (should not exist in
-- practice, but guards against any edge-case back-fill gap).

UPDATE public.demand_tensor
   SET timecard_ratio_used = timecard_mult
 WHERE timecard_ratio_used = 1.0
   AND timecard_mult <> 1.0;

UPDATE public.demand_tensor
   SET feedback_multiplier_used = feedback_mult
 WHERE feedback_multiplier_used = 1.0
   AND feedback_mult <> 1.0;

-- Drop the duplicate columns (idempotent).
ALTER TABLE public.demand_tensor
    DROP COLUMN IF EXISTS timecard_mult,
    DROP COLUMN IF EXISTS feedback_mult;

-- Document the canonical snapshot columns.
COMMENT ON COLUMN public.demand_tensor.timecard_ratio_used IS
    'Canonical snapshot of the L4 timecard adjustment ratio applied to this row''s headcount formula.  '
    'Replaces the former timecard_mult column (dropped in 20260503000001).';

COMMENT ON COLUMN public.demand_tensor.feedback_multiplier_used IS
    'Canonical snapshot of the L5 supervisor-feedback multiplier applied to this row''s headcount formula.  '
    'Replaces the former feedback_mult column (dropped in 20260503000001).';
