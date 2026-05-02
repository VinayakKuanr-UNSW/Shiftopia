-- 20260502000001_demand_forecasts_phase1_hardening.sql
--
-- Phase-1 hardening of public.demand_forecasts.
--
-- Why: the ML writer (ml/api.py) and TS reader (demandTensorBuilder.service.ts)
-- both reference columns that the original foundation migration did not create
-- (time_slot, corrected_count, correction_factor, source, is_locked, version,
-- synthesis_run_id, role TEXT, model_version, etc.). Inserts therefore failed
-- silently and the cache layer never matched, forcing every page render to
-- re-call the ML service.
--
-- This migration:
--   1. Adds the missing columns with safe defaults so any pre-existing rows
--      remain valid.
--   2. Adds CHECK constraints to bound correction_factor and gate `source`.
--   3. Adds a UNIQUE index on the logical key (event_id, role, time_slot,
--      version, scenario_id) using NULLS NOT DISTINCT so UPSERTs are well
--      defined when scenario_id is NULL.
--   4. Adds an index on synthesis_run_id so rollback can fan out cheaply.
--
-- Notes:
--   - The original `role_id UUID` FK is left in place but is now optional —
--     the live pipeline keys forecasts by ML class name (`role`), and one
--     ML class can map to many DB role_ids.
--   - `synthesis_run_id` is intentionally not FK-constrained here to keep
--     this migration self-contained against migration ordering. Application
--     code is responsible for setting it.

BEGIN;

-- 1. New columns with safe defaults so the ALTER succeeds on any existing data.

ALTER TABLE public.demand_forecasts
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS time_slot INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS corrected_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correction_factor NUMERIC(5,3) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ML',
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS synthesis_run_id UUID,
  ADD COLUMN IF NOT EXISTS scenario_id UUID,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS feature_payload JSONB,
  ADD COLUMN IF NOT EXISTS model_version TEXT;

-- 2. Backfill `role` for any pre-existing rows, then make it NOT NULL.
UPDATE public.demand_forecasts SET role = '__legacy__' WHERE role IS NULL;
ALTER TABLE public.demand_forecasts ALTER COLUMN role SET NOT NULL;

-- 3. Bound correction_factor and gate `source`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'demand_forecasts_correction_factor_bounds'
  ) THEN
    ALTER TABLE public.demand_forecasts
      ADD CONSTRAINT demand_forecasts_correction_factor_bounds
        CHECK (correction_factor BETWEEN 0.3 AND 3.0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'demand_forecasts_source_check'
  ) THEN
    ALTER TABLE public.demand_forecasts
      ADD CONSTRAINT demand_forecasts_source_check
        CHECK (source IN ('ML', 'manual', 'baseline'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'demand_forecasts_time_slot_nonneg'
  ) THEN
    ALTER TABLE public.demand_forecasts
      ADD CONSTRAINT demand_forecasts_time_slot_nonneg
        CHECK (time_slot >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'demand_forecasts_counts_nonneg'
  ) THEN
    ALTER TABLE public.demand_forecasts
      ADD CONSTRAINT demand_forecasts_counts_nonneg
        CHECK (predicted_count >= 0 AND corrected_count >= 0);
  END IF;
END $$;

-- 4. Logical UNIQUE index used by UPSERTs from ml/api.py.
--    NULLS NOT DISTINCT so two NULL scenario_ids collide on the same key
--    (PG15+; Supabase runs PG15+).
CREATE UNIQUE INDEX IF NOT EXISTS uq_demand_forecasts_logical
  ON public.demand_forecasts (event_id, role, time_slot, version, scenario_id)
  NULLS NOT DISTINCT;

-- 5. Read-path indexes.
CREATE INDEX IF NOT EXISTS idx_demand_forecasts_event_role_slot
  ON public.demand_forecasts (event_id, role, time_slot);

CREATE INDEX IF NOT EXISTS idx_demand_forecasts_synthesis_run_id
  ON public.demand_forecasts (synthesis_run_id)
  WHERE synthesis_run_id IS NOT NULL;

COMMIT;
