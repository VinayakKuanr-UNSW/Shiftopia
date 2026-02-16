-- Verification Script for Phase 1
-- Run this in your Supabase SQL Editor

-- 1. Check if tables are empty
SELECT 
    (SELECT COUNT(*) FROM shifts) as shifts_count,
    (SELECT COUNT(*) FROM rosters) as rosters_count,
    (SELECT COUNT(*) FROM roster_templates) as templates_count,
    (SELECT COUNT(*) FROM template_groups) as template_groups_count;

-- 2. Test the trigger (Seeding fixed groups)
-- Replace '00000000-0000-0000-0000-000000000000' with a valid organization_id from your organizations table if possible,
-- or just run this to see if it works (it might fail if org_id is invalid, but the trigger will be tested).

-- First, let's get a valid org_id
-- SELECT id FROM organizations LIMIT 1;

-- Then insert a dummy template
-- INSERT INTO roster_templates (name, organization_id, published_month) 
-- VALUES ('Verification Template', 'PASTE_ORG_ID_HERE', '2026-03');

-- Then check groups
-- SELECT * FROM template_groups WHERE template_id = (SELECT id FROM roster_templates WHERE name = 'Verification Template');

-- 3. Check for the unique constraint
-- This should fail if you try to insert the same scope twice
-- INSERT INTO roster_templates (name, organization_id, published_month) 
-- VALUES ('Verification Template 2', 'PASTE_ORG_ID_HERE', '2026-03');
