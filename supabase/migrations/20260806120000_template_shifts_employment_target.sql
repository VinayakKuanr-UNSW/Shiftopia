-- Migration: 20260806120000_template_shifts_employment_target.sql
-- Description: Gives `template_shifts` an employment target, so a shift generated
--              from a template can inherit one instead of being priced on a guess.
--
-- SUPERSEDES the unapplied 20260805070000, which blanket-backfilled every row to
-- 'Casual'. Two reasons that could not be applied as written:
--
--   1. Its header reasons about "the 28 existing template_shifts rows". There are
--      SIX (verified 2026-08-06). The premise it was reviewed under is stale.
--   2. A blanket 'Casual' is exactly the assumption this whole change exists to
--      remove. It would have stamped the Supervisor row Casual, which is wrong.
--
-- The values below are a PLANNER DECISION recorded on 2026-08-06, not a default:
--   * "Team Member" (5 rows, 06:30-14:00, Level 2) -> Casual
--   * "Supervisor"  (1 row,  08:30-16:30, Level 5) -> FT
--
-- Set explicitly and row-by-row BEFORE the NOT NULL, so no row can acquire a
-- target by accident. The NOT NULL is added last and will fail loudly if any row
-- was missed rather than inventing a value for it.

ALTER TABLE public.template_shifts
    ADD COLUMN IF NOT EXISTS target_employment_type   text,
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

-- ── Explicit per-row targets (planner decision, 2026-08-06) ─────────────────
UPDATE public.template_shifts
   SET target_employment_type = 'Casual'
 WHERE target_employment_type IS NULL
   AND role_name = 'Team Member';

UPDATE public.template_shifts
   SET target_employment_type = 'FT'
 WHERE target_employment_type IS NULL
   AND role_name = 'Supervisor';

-- Anything still NULL was never decided on. Fail rather than guess.
DO $$
DECLARE v_missing text;
BEGIN
    SELECT string_agg(DISTINCT COALESCE(role_name, '(unnamed)'), ', ')
      INTO v_missing
      FROM public.template_shifts
     WHERE target_employment_type IS NULL;

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION
            'template_shifts rows have no employment target: %. Decide a target for '
            'each before re-running; this migration will not invent one.', v_missing;
    END IF;
END $$;

ALTER TABLE public.template_shifts
    ALTER COLUMN target_employment_type SET NOT NULL;

COMMENT ON COLUMN public.template_shifts.target_employment_type IS
    'MANDATORY. Employment target copied onto every shift this template row '
    'generates (see trg_shift_inherit_template_row). shifts.target_employment_type '
    'is NOT NULL, so a template row without one cannot produce a shift.';
COMMENT ON COLUMN public.template_shifts.target_requires_flexible IS
    'Narrows a ''PT'' target to Flexible Part-Time staff only. Mirrors '
    'EmployeeInput.is_flexible in the solver.';
