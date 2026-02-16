-- ==============================================================================
-- PHASE 4: CLEANUP & STRICTNESS
-- ==============================================================================

-- 1. Backfill roster_subgroup_id for any lingering shifts
--    Attempts to match existing `group_type` + `sub_group_name` to `roster_groups` + `roster_subgroups`.
UPDATE shifts s
SET roster_subgroup_id = rsg.id
FROM roster_subgroups rsg
JOIN roster_groups rg ON rsg.roster_group_id = rg.id
WHERE s.roster_id = rg.roster_id
  AND s.roster_subgroup_id IS NULL
  AND s.sub_group_name = rsg.name
  AND (
      -- Match strict external_id mapping
      s.group_type::text = rg.external_id
      OR
      -- Fallback: Match by name logic (Convention Centre -> convention_centre)
      LOWER(REPLACE(rg.name, ' ', '_')) = s.group_type::text
  );

-- 2. Delete Orphan Shifts
--    Any shift that STILL has NULL roster_subgroup_id is considered invalid/corrupt legacy data
--    that cannot be mapped to the new hierarchy.
DELETE FROM shifts WHERE roster_subgroup_id IS NULL;

-- 3. Enforce NOT NULL Constraint
--    Now that we are clean, ensure strict referential integrity.
ALTER TABLE shifts 
    ALTER COLUMN roster_subgroup_id SET NOT NULL;

-- 4. Drop Unused Tables
--    `roster_days` was an intermediate or legacy table not used in the new hierarchy.
DROP TABLE IF EXISTS roster_days;

-- 5. Comments on Deprecation
COMMENT ON COLUMN shifts.group_type IS 'DEPRECATED: Use roster_subgroup_id -> roster_groups.external_id instead.';
COMMENT ON COLUMN shifts.sub_group_name IS 'DEPRECATED: Use roster_subgroup_id -> roster_subgroups.name instead.';
