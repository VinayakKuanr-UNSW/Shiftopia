-- Migration: 20260805050000_add_target_requires_flexible_to_shifts.sql
-- Description: Adds the `target_requires_flexible` companion flag to `shifts` so a
--              planner can target Flexible Part-Time staff specifically.
--
-- WHY A SEPARATE BOOLEAN RATHER THAN A FOURTH `target_employment_type` TOKEN
-- -------------------------------------------------------------------------
-- `public.employment_status` carries four values ('Full-Time', 'Part-Time',
-- 'Casual', 'Flexible Part-Time'), but the OR-Tools solver deliberately models
-- flexibility as a SEPARATE axis: `normalize_employment_type()` collapses
-- 'Flexible Part-Time' -> 'PT' (optimizer-service/model_builder.py) and carries
-- flexibility in `EmployeeInput.is_flexible`, which is already plumbed end to end
-- (auto-scheduler.controller.ts -> ortools_runner.py).
--
-- Widening `shifts_target_employment_type_check` to a fourth 'Flexible PT' token
-- would therefore have been silently lossy: `ShiftInput.__post_init__` normalizes
-- the target through the SAME alias table, so a 'Flexible PT' shift would arrive
-- at the solver as plain 'PT' and match EVERY part-timer -- the opposite of the
-- planner's intent. Mirroring the solver's (type, is_flexible) tuple keeps the
-- planner, the eligibility filter and the solver reading one shared model.
--
-- The existing `shifts_target_employment_type_check` CHECK ('FT','PT','Casual')
-- is intentionally left UNCHANGED.

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS target_requires_flexible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.shifts.target_requires_flexible IS
    'When true, narrows a target_employment_type = ''PT'' shift to Flexible Part-Time '
    'staff only. Mirrors EmployeeInput.is_flexible in the solver. Only meaningful '
    'alongside target_employment_type = ''PT'' (enforced by shifts_target_flexible_requires_pt_check).';

-- The flag is only coherent for a PT target: 'Flexible Full-Time' and
-- 'Flexible Casual' are not employment statuses this business recognises. Guard
-- it at the DB rather than trusting every writer to keep the pair consistent.
ALTER TABLE public.shifts
    DROP CONSTRAINT IF EXISTS shifts_target_flexible_requires_pt_check;

ALTER TABLE public.shifts
    ADD CONSTRAINT shifts_target_flexible_requires_pt_check
    CHECK (NOT target_requires_flexible OR target_employment_type = 'PT');
