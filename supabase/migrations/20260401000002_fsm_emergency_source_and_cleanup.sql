-- FSM Migration Part 2: emergency_source column + legacy value cleanup + CHECK constraint
-- Depends on Part 1 being committed (no_show enum value must exist before CHECK constraint).

-- ============================================================
-- 1. Add emergency_source column
-- ============================================================
ALTER TABLE public.shifts
ADD COLUMN IF NOT EXISTS emergency_source text
    CHECK (emergency_source IN ('manual', 'auto'))
    DEFAULT NULL;

-- ============================================================
-- 2. Backfill emergency_source from existing emergency_assigned rows
--    before we normalise assignment_outcome.
-- ============================================================
UPDATE public.shifts
SET emergency_source = 'manual'
WHERE assignment_outcome = 'emergency_assigned'
  AND emergency_source IS NULL;

-- ============================================================
-- 3. Normalise legacy assignment_outcome values
--    offered  → NULL  (S3: assigned + outcome = null)
--    pending  → NULL  (same logic)
--    emergency_assigned → confirmed  (was a confirmed assignment)
-- ============================================================
UPDATE public.shifts
SET assignment_outcome = NULL
WHERE assignment_outcome IN ('offered', 'pending');

UPDATE public.shifts
SET assignment_outcome = 'confirmed'
WHERE assignment_outcome = 'emergency_assigned';

-- ============================================================
-- 4. Add CHECK constraint to lock down future values
-- ============================================================
ALTER TABLE public.shifts
ADD CONSTRAINT valid_assignment_outcome
    CHECK (
        assignment_outcome IS NULL
        OR assignment_outcome IN ('confirmed', 'no_show')
    );
