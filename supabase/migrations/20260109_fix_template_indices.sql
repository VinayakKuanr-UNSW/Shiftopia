-- Migration: Fix Template Groups Indices
-- Date: 2026-01-09
-- Purpose: Remove conflicting global index on 'name' and ensure uniqueness is scoped to (template_id, name).

-- 1. Drop the problematic index reported by the error
DROP INDEX IF EXISTS template_groups_name_idx;

-- 2. Drop potential unique constraint on name if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_groups_name_key') THEN
        ALTER TABLE template_groups DROP CONSTRAINT template_groups_name_key;
    END IF;

    -- Drop the constraint reported by user
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_group_name_per_template') THEN
        ALTER TABLE template_groups DROP CONSTRAINT unique_group_name_per_template;
    END IF;
END $$;

-- 3. Create correct scoped unique index (to prevent duplicates within the same template only)
CREATE UNIQUE INDEX IF NOT EXISTS template_groups_template_id_name_idx ON template_groups (template_id, name);
