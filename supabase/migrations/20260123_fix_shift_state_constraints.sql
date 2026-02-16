-- Fix Shift State Inconsistencies and Add Constraints
-- Migration: 20260123_fix_shift_state_constraints.sql
-- 
-- Valid States:
-- 1. Draft + Assigned
-- 2. Draft + Unassigned
-- 3. Published + Assigned (NOT Bidding)
-- 4. Published + Unassigned + Bidding (Bidding ONLY in this state)

-- STEP 1: Fix any shifts that are Draft + On Bidding (should be Published)
UPDATE shifts
SET 
  is_draft = FALSE,
  is_published = TRUE,
  lifecycle_status = 'published'
WHERE deleted_at IS NULL
  AND is_draft = TRUE 
  AND is_on_bidding = TRUE;

-- STEP 2: Fix any shifts that are On Bidding + Assigned (should NOT be on bidding)
UPDATE shifts
SET 
  is_on_bidding = FALSE,
  bidding_enabled = FALSE,
  fulfillment_status = 'scheduled'
WHERE deleted_at IS NULL
  AND is_on_bidding = TRUE 
  AND assigned_employee_id IS NOT NULL;

-- STEP 3: Fix any shifts that are Draft + Published (should be one or the other)
UPDATE shifts
SET is_published = FALSE
WHERE deleted_at IS NULL
  AND is_draft = TRUE 
  AND is_published = TRUE;

-- STEP 4: Add CHECK constraints to enforce valid state combinations
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS chk_draft_bidding_exclusive;
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS chk_bidding_requires_unassigned;
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS chk_draft_published_exclusive;

-- Constraint 1: Bidding can only exist on Published shifts
ALTER TABLE shifts ADD CONSTRAINT chk_draft_bidding_exclusive
  CHECK (NOT (is_draft = TRUE AND is_on_bidding = TRUE));

-- Constraint 2: Bidding requires Unassigned status
ALTER TABLE shifts ADD CONSTRAINT chk_bidding_requires_unassigned
  CHECK (NOT (is_on_bidding = TRUE AND assigned_employee_id IS NOT NULL));

-- Constraint 3: Draft and Published are mutually exclusive
ALTER TABLE shifts ADD CONSTRAINT chk_draft_published_exclusive
  CHECK (NOT (is_draft = TRUE AND is_published = TRUE));
