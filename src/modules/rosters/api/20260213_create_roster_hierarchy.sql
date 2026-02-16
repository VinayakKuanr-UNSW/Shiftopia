-- Migration: Create Roster Hierarchy (Groups & Subgroups)
-- Date: 2026-02-13
-- Purpose: Implement Phase 1 of Roster Refactor.
-- 1. Create roster_groups table (linked to rosters)
-- 2. Create roster_subgroups table (linked to roster_groups)
-- 3. Add roster_subgroup_id to shifts table (linked to roster_subgroups)

-- 1. Create roster_groups
CREATE TABLE IF NOT EXISTS roster_groups (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    roster_id uuid REFERENCES rosters(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    sort_order int DEFAULT 0,
    external_id text, -- For mapping to fixed types like 'convention_centre' if needed
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_roster_groups_roster_id ON roster_groups(roster_id);

-- 2. Create roster_subgroups
CREATE TABLE IF NOT EXISTS roster_subgroups (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    roster_group_id uuid REFERENCES roster_groups(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    sort_order int DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_roster_subgroups_group_id ON roster_subgroups(roster_group_id);

-- 3. Update shifts table
-- We add the column as nullable because existing shifts won't have it yet.
-- Phase 2 (Backfill) will populate this.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shifts' AND column_name = 'roster_subgroup_id') THEN
        ALTER TABLE shifts 
        ADD COLUMN roster_subgroup_id uuid REFERENCES roster_subgroups(id) ON DELETE SET NULL;
        
        CREATE INDEX idx_shifts_roster_subgroup ON shifts(roster_subgroup_id);
    END IF;
END $$;

-- Policies (RLS) - Enable RLS on new tables
ALTER TABLE roster_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_subgroups ENABLE ROW LEVEL SECURITY;

-- Simple RLS for now (mimic rosters RLS)
-- Authenticated users can read/write if they have access to the roster (simplified for Phase 1)
-- Adjusting strictly to "authenticated" for now to match current dev permissions, can refine later.

CREATE POLICY "Enable read access for authenticated users" ON roster_groups
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable write access for authenticated users" ON roster_groups
    FOR ALL TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON roster_subgroups
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable write access for authenticated users" ON roster_subgroups
    FOR ALL TO authenticated USING (true);
