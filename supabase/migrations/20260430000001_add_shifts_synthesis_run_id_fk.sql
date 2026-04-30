-- Add missing FK from shifts.synthesis_run_id → synthesis_runs(id)
-- The column existed but the FK constraint was never applied by the capstone team.
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_synthesis_run_id_fkey
  FOREIGN KEY (synthesis_run_id)
  REFERENCES public.synthesis_runs(id)
  ON DELETE SET NULL;

-- Ensure index exists (partial, only non-null for performance)
CREATE INDEX IF NOT EXISTS shifts_synthesis_run_id_idx
  ON public.shifts (synthesis_run_id)
  WHERE synthesis_run_id IS NOT NULL;

COMMENT ON COLUMN public.shifts.synthesis_run_id IS
  'Set when a shift was created by the shift synthesizer. '
  'Rollback of a run deletes all shifts with this id that are still unassigned.';
