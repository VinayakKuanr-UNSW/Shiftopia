-- Migration: 20260805070000_template_shifts_employment_target.sql
-- Description: Gives `template_shifts` an employment target so shifts created by
--              `apply_template_to_date_range_v2` can satisfy the NOT NULL that
--              20260805080000 puts on `shifts.target_employment_type`.
--
-- Every shift must now declare who it is for, and template-generated shifts are
-- no exception. Templates are the only shift source that has no upstream shift to
-- copy from, so the value has to live on the template row itself.
--
-- BACKFILL VALUE — read this before changing it.
-- The 28 existing template_shifts rows predate this column, so a value has to be
-- chosen for them. 'Casual' is used because, under the new HARD match, the target
-- decides who may be assigned: of 140 active contracts in this org 114 are Casual,
-- so 'Casual' is the choice that strands the fewest template shifts. It is a
-- migration default, NOT a business judgement — these 28 rows should be reviewed
-- and re-targeted by a planner.

ALTER TABLE public.template_shifts
    ADD COLUMN IF NOT EXISTS target_employment_type text,
    ADD COLUMN IF NOT EXISTS target_requires_flexible boolean NOT NULL DEFAULT false;

-- Same vocabulary as shifts_target_employment_type_check — the template value is
-- copied verbatim onto the shift, so a value illegal there must be illegal here.
ALTER TABLE public.template_shifts
    DROP CONSTRAINT IF EXISTS template_shifts_target_employment_type_check;
ALTER TABLE public.template_shifts
    ADD CONSTRAINT template_shifts_target_employment_type_check
    CHECK (target_employment_type = ANY (ARRAY['FT'::text, 'PT'::text, 'Casual'::text]));

ALTER TABLE public.template_shifts
    DROP CONSTRAINT IF EXISTS template_shifts_target_flexible_requires_pt_check;
ALTER TABLE public.template_shifts
    ADD CONSTRAINT template_shifts_target_flexible_requires_pt_check
    CHECK (NOT target_requires_flexible OR target_employment_type = 'PT');

UPDATE public.template_shifts
   SET target_employment_type = 'Casual'
 WHERE target_employment_type IS NULL;

ALTER TABLE public.template_shifts
    ALTER COLUMN target_employment_type SET NOT NULL;

COMMENT ON COLUMN public.template_shifts.target_employment_type IS
    'Employment target copied onto every shift this template row generates. '
    'Mandatory: shifts.target_employment_type is NOT NULL.';
COMMENT ON COLUMN public.template_shifts.target_requires_flexible IS
    'Narrows a ''PT'' target to Flexible Part-Time staff only.';
