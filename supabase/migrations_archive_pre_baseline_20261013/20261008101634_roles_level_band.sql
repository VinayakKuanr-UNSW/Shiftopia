-- Roles carry a RANGE of levels; the pay level belongs to the contract.
--
-- hr.roles allowed exactly one role per level in each sub-department, and a
-- trigger created eight placeholder roles (one per level 0–7) for every new
-- sub-department. The ICC Sydney EA 2025 does not work that way:
--   • Schedule 1 lists positions at more than one level (Security Officer
--     L3/L4, Contact Centre Team Member L2/L3/L5, Event Delivery Supervisor
--     L6/L7), so a role has a band, and the contract picks the level.
--   • Real ladders don't have exactly eight rungs (a kitchen has ten ranks,
--     Event Setup fewer than eight), and several roles can share a level.
--
-- What changes:
--   1. Drop UNIQUE (subdepartment_id, remuneration_level) and make
--      remuneration_level optional. It now means the role's DEFAULT level for
--      new shifts, and which role demand at that level is assigned to by the
--      shift synthesiser (shiftSynthesizer.orchestrator.ts matches
--      sub-department + level). A partial unique index keeps that lookup to
--      one role per sub-department and level.
--   2. eba_level_min / eba_level_max: the role's band (NULL = no EA guidance,
--      any level allowed). typically_salaried: the contract wizard's default
--      pay basis for permanent engagements. Every existing role is backfilled
--      to a band of exactly its current level, so nothing behaves differently.
--   3. Drop the placeholder-role trigger. Roles are catalogued explicitly
--      (no client code creates roles or sub-departments; only migrations do).
--   4. Expose the new columns through the public.roles compat view.
--   5. Close a pre-auth read: hr.v_org_chart, hr.v_promotion_ladder and
--      hr.v_headcount_by_level ran as their owner (no security_invoker),
--      bypassing RLS, and were granted to anon. The hr schema is exposed to the
--      Data API, so the org chart, level ladder and headcounts were readable
--      with only the publishable key. No client code reads these views.

-- ── 1. A role's level is a default, not a unique rung ───────────────────────
ALTER TABLE hr.roles DROP CONSTRAINT roles_subdepartment_id_remuneration_level_key;
ALTER TABLE hr.roles ALTER COLUMN remuneration_level DROP NOT NULL;

CREATE UNIQUE INDEX roles_subdepartment_default_level_key
    ON hr.roles (subdepartment_id, remuneration_level)
    WHERE remuneration_level IS NOT NULL;

COMMENT ON COLUMN hr.roles.remuneration_level IS
  'Optional DEFAULT level: pre-fills new shifts of this role, and makes this the role that demand at this level is assigned to in its sub-department (unique per sub-department via roles_subdepartment_default_level_key). NOT the pay level — that is hr.user_contracts.remuneration_level.';

-- ── 2. The band ─────────────────────────────────────────────────────────────
ALTER TABLE hr.roles
    ADD COLUMN eba_level_min      smallint,
    ADD COLUMN eba_level_max      smallint,
    ADD COLUMN typically_salaried boolean NOT NULL DEFAULT false;

-- A CHECK passes when its expression is NULL, so nullable operands are tested
-- explicitly.
ALTER TABLE hr.roles
    ADD CONSTRAINT roles_eba_level_band_valid
        CHECK ((eba_level_min IS NULL AND eba_level_max IS NULL)
            OR (eba_level_min IS NOT NULL AND eba_level_max IS NOT NULL
                AND eba_level_min BETWEEN 0 AND 7
                AND eba_level_max BETWEEN 0 AND 7
                AND eba_level_min <= eba_level_max)),
    ADD CONSTRAINT roles_default_level_within_band
        CHECK (remuneration_level IS NULL
            OR eba_level_min IS NULL
            OR remuneration_level BETWEEN eba_level_min AND eba_level_max);

COMMENT ON COLUMN hr.roles.eba_level_min IS
  'Lowest EA Schedule 1 level this role is classified at. NULL with eba_level_max = no EA guidance (any level allowed). A contract outside the band is allowed with a note — EA levels are competency-based.';
COMMENT ON COLUMN hr.roles.eba_level_max IS
  'Highest EA Schedule 1 level this role is classified at. See eba_level_min.';
COMMENT ON COLUMN hr.roles.typically_salaried IS
  'Default pay basis offered by the contract wizard for Full-Time/Part-Time engagements in this role (salary outside the EA under cl 2.2). Casual engagements are always on a level regardless.';

UPDATE hr.roles
   SET eba_level_min = remuneration_level,
       eba_level_max = remuneration_level
 WHERE remuneration_level IS NOT NULL;

-- ── 3. No more placeholder roles ────────────────────────────────────────────
DROP TRIGGER trg_hr_seed_subdept_roles ON hr.subdepartments;
DROP FUNCTION hr.seed_subdepartment_roles();

-- ── 4. Compat view ──────────────────────────────────────────────────────────
-- CREATE OR REPLACE VIEW resets reloptions, so security_invoker is restated.
-- New columns are appended after the existing ones.
CREATE OR REPLACE VIEW public.roles
WITH (security_invoker = on) AS
SELECT id,
    subdepartment_id,
    remuneration_level,
    name,
    code,
    is_active,
    created_at,
    updated_at,
    description,
    responsibilities,
    forecasting_bucket,
    supervision_ratio_min,
    supervision_ratio_max,
    is_baseline_eligible,
    employment_type,
    eba_level_min,
    eba_level_max,
    typically_salaried
   FROM hr.roles;

-- ── 5. Close the pre-auth read on the hr reporting views ────────────────────
ALTER VIEW hr.v_org_chart          SET (security_invoker = on);
ALTER VIEW hr.v_promotion_ladder   SET (security_invoker = on);
ALTER VIEW hr.v_headcount_by_level SET (security_invoker = on);

REVOKE ALL ON hr.v_org_chart, hr.v_promotion_ladder, hr.v_headcount_by_level
    FROM PUBLIC, anon;
-- Read-only reports: none of the three is updatable anyway.
REVOKE INSERT, UPDATE, DELETE ON hr.v_org_chart, hr.v_promotion_ladder, hr.v_headcount_by_level
    FROM authenticated;
