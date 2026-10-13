-- STOPGAP: always-NULL hourly_rate_min / hourly_rate_max on remuneration_levels.
--
-- 20261008130022 dropped hr.remuneration_levels' invented money columns (EA
-- rates live in eba_rate). The deployed build (PR #21, faaa6a2) still names
-- them in ~15 selects — the roster shift lists, bids, swaps, payroll,
-- timesheets — through the public view, and reads hr.remuneration_levels
-- directly in two places (roster planner levels, user reference data). One
-- unknown column 400s a whole PostgREST select, which those screens show as
-- empty, not as an error. Since 2026-10-08 13:00 UTC.
--
-- The current working tree no longer selects them. These placeholders keep
-- the deployed build working until it is replaced: nullable, pinned NULL by
-- CHECK, so nothing can store an invented rate again. The deployed code reads
-- them only as fallbacks (`?? null`, `|| 0`) — no crash on NULL.
--
-- REMOVE (with the custom_hourly_rate placeholder in public.user_contracts)
-- once a build from the current branch is deployed.

ALTER TABLE hr.remuneration_levels
    ADD COLUMN hourly_rate_min numeric(10,2),
    ADD COLUMN hourly_rate_max numeric(10,2),
    ADD CONSTRAINT remuneration_levels_money_placeholders_null
        CHECK (hourly_rate_min IS NULL AND hourly_rate_max IS NULL);

COMMENT ON COLUMN hr.remuneration_levels.hourly_rate_min IS
  'STOPGAP placeholder, always NULL — for the build deployed before 2026-10-09. Drop once the current branch is deployed.';
COMMENT ON COLUMN hr.remuneration_levels.hourly_rate_max IS
  'STOPGAP placeholder, always NULL — for the build deployed before 2026-10-09. Drop once the current branch is deployed.';

-- Appended columns only; security_invoker restated (a bare replace resets it).
CREATE OR REPLACE VIEW public.remuneration_levels WITH (security_invoker = on) AS
 SELECT level_number,
    level_name,
    description,
    hourly_rate_min,
    hourly_rate_max
   FROM hr.remuneration_levels;
