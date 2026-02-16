# State Machine Verification & Stabilization Plan

## Technical Implementation Document

**Version**: 1.0  
**Status**: Planning  
**Last Updated**: 2026-01-25

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Pre-Migration Checklist](#2-pre-migration-checklist)
3. [Phase 1: Schema Fixes (Non-breaking)](#3-phase-1-schema-fixes-non-breaking)
4. [Phase 2: Constraints](#4-phase-2-constraints)
5. [Phase 3: Cleanup (Breaking)](#5-phase-3-cleanup-breaking)
6. [Phase 4: Missing Logic](#6-phase-4-missing-logic)
7. [Verification Test Suite](#7-verification-test-suite)
8. [Rollback Procedures](#8-rollback-procedures)
9. [Deployment Checklist](#9-deployment-checklist)
10. [Post-Migration Validation](#10-post-migration-validation)

---

## 1. Executive Summary

### 1.1 Objective

Transform the `shifts` table from a mixed-state representation (booleans + text + enums) to a strict orthogonal state machine with database-level enforcement of the 15 valid states (S1-S15).

### 1.2 Risk Assessment

| Phase | Risk Level | Rollback Complexity | Downtime Required |
|-------|------------|---------------------|-------------------|
| Phase 1 | 🟢 Low | Simple DROP | None |
| Phase 2 | 🟡 Medium | DROP CONSTRAINT | None |
| Phase 3 | 🔴 High | Restore from backup | Maintenance window |
| Phase 4 | 🟢 Low | DROP FUNCTION | None |

### 1.3 Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1 | 2-3 hours | None |
| Phase 2 | 1-2 hours | Phase 1 complete + data validation |
| Phase 3 | 4-6 hours | Phase 2 complete + app code updates |
| Phase 4 | 2-3 hours | Phase 1 complete |

---

## 2. Pre-Migration Checklist

### 2.1 Data Audit Queries

Run these queries to understand current state before migration:

```sql
-- 2.1.1 Count shifts by lifecycle_status (text values)
SELECT lifecycle_status, COUNT(*) 
FROM shifts 
GROUP BY lifecycle_status 
ORDER BY COUNT(*) DESC;

-- 2.1.2 Find any invalid lifecycle_status values
SELECT DISTINCT lifecycle_status 
FROM shifts 
WHERE lifecycle_status NOT IN ('Draft', 'Published', 'InProgress', 'Completed', 'Cancelled');

-- 2.1.3 Count trade states
SELECT 
  is_trade_requested,
  COUNT(*) as count
FROM shifts
GROUP BY is_trade_requested;

-- 2.1.4 Find orphaned employee references
SELECT COUNT(*) 
FROM shifts 
WHERE employee_id IS NOT NULL 
  AND assigned_employee_id IS NOT NULL 
  AND employee_id != assigned_employee_id;

-- 2.1.5 Current state distribution (approximate S1-S15)
SELECT 
  lifecycle_status,
  assignment_status,
  assignment_outcome,
  bidding_status,
  CASE WHEN is_trade_requested THEN 'TradeRequested' ELSE 'NoTrade' END as trading_approx,
  COUNT(*) as count
FROM shifts
GROUP BY 1, 2, 3, 4, 5
ORDER BY count DESC;

-- 2.1.6 Find potentially invalid state combinations
SELECT id, lifecycle_status, assignment_status, assignment_outcome, bidding_status
FROM shifts
WHERE 
  -- Draft should not have Confirmed outcome
  (lifecycle_status = 'Draft' AND assignment_outcome = 'Confirmed')
  OR
  -- Unassigned should not have an outcome
  (assignment_status = 'Unassigned' AND assignment_outcome IS NOT NULL)
  OR
  -- OnBidding requires Unassigned
  (bidding_status IN ('OnBiddingNormal', 'OnBiddingUrgent') AND assignment_status = 'Assigned')
  OR
  -- InProgress/Completed requires Assigned
  (lifecycle_status IN ('InProgress', 'Completed') AND assignment_status = 'Unassigned');
```

### 2.2 Backup Procedure

```bash
# Full database backup before migration
pg_dump -h $SUPABASE_DB_HOST -U postgres -d postgres \
  --schema=public \
  -F c -f "backup_pre_migration_$(date +%Y%m%d_%H%M%S).dump"

# Shifts table only backup
pg_dump -h $SUPABASE_DB_HOST -U postgres -d postgres \
  --table=public.shifts \
  -F c -f "backup_shifts_$(date +%Y%m%d_%H%M%S).dump"
```

### 2.3 Application Code Audit

Before starting, identify all code that references:

```bash
# Search patterns in codebase
grep -r "is_draft" --include="*.ts" --include="*.tsx"
grep -r "is_published" --include="*.ts" --include="*.tsx"
grep -r "is_cancelled" --include="*.ts" --include="*.tsx"
grep -r "is_on_bidding" --include="*.ts" --include="*.tsx"
grep -r "is_trade_requested" --include="*.ts" --include="*.tsx"
grep -r "lifecycle_status" --include="*.ts" --include="*.tsx"
grep -r "employee_id" --include="*.ts" --include="*.tsx" | grep -v "assigned_employee_id"
```

---

## 3. Phase 1: Schema Fixes (Non-breaking)

### 3.1 Migration: Create Enums

**File**: `migrations/001_create_state_enums.sql`

```sql
-- ============================================================================
-- Migration 001: Create State Machine Enums
-- ============================================================================
-- Description: Creates missing enums for shift state machine
-- Rollback: DROP TYPE statements at bottom
-- ============================================================================

BEGIN;

-- 3.1.1 Create shift_lifecycle enum (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_lifecycle') THEN
    CREATE TYPE shift_lifecycle AS ENUM (
      'Draft',
      'Published', 
      'InProgress',
      'Completed',
      'Cancelled'
    );
    RAISE NOTICE 'Created enum: shift_lifecycle';
  ELSE
    RAISE NOTICE 'Enum shift_lifecycle already exists';
  END IF;
END $$;

-- 3.1.2 Create shift_trading enum
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_trading') THEN
    CREATE TYPE shift_trading AS ENUM (
      'NoTrade',
      'TradeRequested',
      'TradeAccepted',
      'TradeApproved'
    );
    RAISE NOTICE 'Created enum: shift_trading';
  ELSE
    RAISE NOTICE 'Enum shift_trading already exists';
  END IF;
END $$;

-- 3.1.3 Verify existing enums have correct values
-- Check shift_assignment (should be: Unassigned, Assigned)
DO $$
DECLARE
  expected_values text[] := ARRAY['Unassigned', 'Assigned'];
  actual_values text[];
BEGIN
  SELECT array_agg(enumlabel ORDER BY enumsortorder) INTO actual_values
  FROM pg_enum
  WHERE enumtypid = 'assignment_status'::regtype;
  
  IF actual_values IS NULL THEN
    RAISE WARNING 'Enum assignment_status not found!';
  ELSIF actual_values != expected_values THEN
    RAISE WARNING 'assignment_status values mismatch. Expected: %, Got: %', expected_values, actual_values;
  ELSE
    RAISE NOTICE 'assignment_status enum values verified: %', actual_values;
  END IF;
END $$;

-- Check shift_bidding (should be: NotOnBidding, OnBiddingNormal, OnBiddingUrgent, BiddingClosedNoWinner)
DO $$
DECLARE
  expected_values text[] := ARRAY['NotOnBidding', 'OnBiddingNormal', 'OnBiddingUrgent', 'BiddingClosedNoWinner'];
  actual_values text[];
BEGIN
  SELECT array_agg(enumlabel ORDER BY enumsortorder) INTO actual_values
  FROM pg_enum
  WHERE enumtypid = 'bidding_status'::regtype;
  
  IF actual_values IS NULL THEN
    RAISE WARNING 'Enum bidding_status not found!';
  ELSIF actual_values != expected_values THEN
    RAISE WARNING 'bidding_status values mismatch. Expected: %, Got: %', expected_values, actual_values;
  ELSE
    RAISE NOTICE 'bidding_status enum values verified: %', actual_values;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK SCRIPT (run manually if needed)
-- ============================================================================
-- DROP TYPE IF EXISTS shift_trading;
-- DROP TYPE IF EXISTS shift_lifecycle;
```

### 3.2 Migration: Add Trading Status Column

**File**: `migrations/002_add_trading_status.sql`

```sql
-- ============================================================================
-- Migration 002: Add trading_status Column
-- ============================================================================
-- Description: Adds trading_status enum column and backfills from boolean
-- Rollback: ALTER TABLE shifts DROP COLUMN trading_status;
-- ============================================================================

BEGIN;

-- 3.2.1 Add trading_status column with default
ALTER TABLE shifts 
ADD COLUMN IF NOT EXISTS trading_status shift_trading NOT NULL DEFAULT 'NoTrade';

-- 3.2.2 Backfill from is_trade_requested boolean
-- Note: We can only determine TradeRequested from the boolean
-- TradeAccepted and TradeApproved states need to be derived from trade_requests table
UPDATE shifts s
SET trading_status = CASE 
  WHEN s.is_trade_requested = true THEN 'TradeRequested'::shift_trading
  ELSE 'NoTrade'::shift_trading
END
WHERE s.trading_status = 'NoTrade' 
  AND s.is_trade_requested = true;

-- 3.2.3 Advanced backfill from trade_requests table (if data exists)
UPDATE shifts s
SET trading_status = 
  CASE 
    WHEN tr.status = 'approved' THEN 'TradeApproved'::shift_trading
    WHEN tr.status = 'accepted' THEN 'TradeAccepted'::shift_trading
    WHEN tr.status = 'pending' THEN 'TradeRequested'::shift_trading
    ELSE s.trading_status
  END
FROM trade_requests tr
WHERE tr.shift_id = s.id
  AND tr.status IN ('pending', 'accepted', 'approved')
  AND s.lifecycle_status = 'Published';

-- 3.2.4 Create index for trading status queries
CREATE INDEX IF NOT EXISTS idx_shifts_trading_status 
ON shifts (trading_status) 
WHERE trading_status != 'NoTrade';

-- 3.2.5 Log migration stats
DO $$
DECLARE
  stats jsonb;
BEGIN
  SELECT jsonb_object_agg(trading_status, cnt) INTO stats
  FROM (
    SELECT trading_status, COUNT(*) as cnt 
    FROM shifts 
    GROUP BY trading_status
  ) t;
  RAISE NOTICE 'Trading status distribution after migration: %', stats;
END $$;

COMMIT;
```

### 3.3 Migration: Convert Lifecycle Status to Enum

**File**: `migrations/003_convert_lifecycle_to_enum.sql`

```sql
-- ============================================================================
-- Migration 003: Convert lifecycle_status from TEXT to ENUM
-- ============================================================================
-- Description: Converts lifecycle_status column from TEXT to shift_lifecycle enum
-- Rollback: Complex - see rollback section
-- ============================================================================

BEGIN;

-- 3.3.1 First, fix any invalid values
UPDATE shifts 
SET lifecycle_status = 'Draft' 
WHERE lifecycle_status IS NULL OR lifecycle_status = '';

UPDATE shifts 
SET lifecycle_status = 'Cancelled'
WHERE lifecycle_status NOT IN ('Draft', 'Published', 'InProgress', 'Completed', 'Cancelled');

-- 3.3.2 Add new enum column
ALTER TABLE shifts 
ADD COLUMN lifecycle_status_enum shift_lifecycle;

-- 3.3.3 Copy data with explicit casting
UPDATE shifts 
SET lifecycle_status_enum = lifecycle_status::shift_lifecycle;

-- 3.3.4 Verify all rows migrated
DO $$
DECLARE
  null_count integer;
BEGIN
  SELECT COUNT(*) INTO null_count FROM shifts WHERE lifecycle_status_enum IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % rows have NULL lifecycle_status_enum', null_count;
  END IF;
END $$;

-- 3.3.5 Drop old column and rename new one
ALTER TABLE shifts DROP COLUMN lifecycle_status;
ALTER TABLE shifts RENAME COLUMN lifecycle_status_enum TO lifecycle_status;
ALTER TABLE shifts ALTER COLUMN lifecycle_status SET NOT NULL;
ALTER TABLE shifts ALTER COLUMN lifecycle_status SET DEFAULT 'Draft';

-- 3.3.6 Update any existing triggers/views that reference this column
-- (These may need manual review based on your specific triggers)

-- 3.3.7 Create index
CREATE INDEX IF NOT EXISTS idx_shifts_lifecycle_status ON shifts (lifecycle_status);

COMMIT;

-- ============================================================================
-- ROLLBACK SCRIPT (complex - run manually)
-- ============================================================================
-- ALTER TABLE shifts ADD COLUMN lifecycle_status_text TEXT;
-- UPDATE shifts SET lifecycle_status_text = lifecycle_status::TEXT;
-- ALTER TABLE shifts DROP COLUMN lifecycle_status;
-- ALTER TABLE shifts RENAME COLUMN lifecycle_status_text TO lifecycle_status;
-- ALTER TABLE shifts ALTER COLUMN lifecycle_status SET NOT NULL;
```

### 3.4 Migration: Consolidate Employee ID Columns

**File**: `migrations/004_consolidate_employee_id.sql`

```sql
-- ============================================================================
-- Migration 004: Consolidate Employee ID Columns
-- ============================================================================
-- Description: Ensures assigned_employee_id is authoritative, prepares employee_id for removal
-- Rollback: Reverse the UPDATE statement
-- ============================================================================

BEGIN;

-- 3.4.1 Audit current state
DO $$
DECLARE
  both_set integer;
  only_employee_id integer;
  only_assigned integer;
  mismatch integer;
BEGIN
  SELECT COUNT(*) INTO both_set FROM shifts 
  WHERE employee_id IS NOT NULL AND assigned_employee_id IS NOT NULL;
  
  SELECT COUNT(*) INTO only_employee_id FROM shifts 
  WHERE employee_id IS NOT NULL AND assigned_employee_id IS NULL;
  
  SELECT COUNT(*) INTO only_assigned FROM shifts 
  WHERE employee_id IS NULL AND assigned_employee_id IS NOT NULL;
  
  SELECT COUNT(*) INTO mismatch FROM shifts 
  WHERE employee_id IS NOT NULL 
    AND assigned_employee_id IS NOT NULL 
    AND employee_id != assigned_employee_id;
  
  RAISE NOTICE 'Employee ID audit:';
  RAISE NOTICE '  Both set: %', both_set;
  RAISE NOTICE '  Only employee_id: %', only_employee_id;
  RAISE NOTICE '  Only assigned_employee_id: %', only_assigned;
  RAISE NOTICE '  Mismatches: %', mismatch;
  
  IF mismatch > 0 THEN
    RAISE WARNING 'Found % mismatches - manual review required!', mismatch;
  END IF;
END $$;

-- 3.4.2 Copy employee_id to assigned_employee_id where assigned is NULL
UPDATE shifts 
SET assigned_employee_id = employee_id
WHERE assigned_employee_id IS NULL 
  AND employee_id IS NOT NULL;

-- 3.4.3 Update assignment_status to match
UPDATE shifts
SET assignment_status = 'Assigned'
WHERE assigned_employee_id IS NOT NULL
  AND assignment_status = 'Unassigned';

UPDATE shifts
SET assignment_status = 'Unassigned'
WHERE assigned_employee_id IS NULL
  AND assignment_status = 'Assigned';

-- 3.4.4 Mark employee_id as deprecated (add comment)
COMMENT ON COLUMN shifts.employee_id IS 
  'DEPRECATED: Use assigned_employee_id instead. Will be removed in Phase 3.';

-- 3.4.5 Create sync trigger (temporary, until Phase 3)
CREATE OR REPLACE FUNCTION sync_employee_id_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- Keep columns in sync during transition period
  IF NEW.assigned_employee_id IS DISTINCT FROM OLD.assigned_employee_id THEN
    NEW.employee_id := NEW.assigned_employee_id;
  ELSIF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    NEW.assigned_employee_id := NEW.employee_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_employee_ids ON shifts;
CREATE TRIGGER trg_sync_employee_ids
  BEFORE UPDATE ON shifts
  FOR EACH ROW
  EXECUTE FUNCTION sync_employee_id_columns();

COMMIT;
```

---

## 4. Phase 2: Constraints

### 4.1 Migration: Add Valid State Combination Constraint

**File**: `migrations/005_add_state_constraint.sql`

```sql
-- ============================================================================
-- Migration 005: Add Valid State Combination Constraint
-- ============================================================================
-- Description: Enforces the 15 valid shift states (S1-S15) at database level
-- Rollback: ALTER TABLE shifts DROP CONSTRAINT valid_shift_state_combination;
-- ============================================================================

BEGIN;

-- 4.1.1 First, identify and log any existing invalid states
CREATE TEMP TABLE invalid_shifts AS
SELECT id, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status
FROM shifts
WHERE NOT (
  -- S1: Draft + Unassigned
  (lifecycle_status = 'Draft' AND assignment_status = 'Unassigned' 
   AND assignment_outcome IS NULL AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S2: Draft + Assigned + Pending
  (lifecycle_status = 'Draft' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Pending' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S3: Published + Assigned + Offered
  (lifecycle_status = 'Published' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Offered' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S4: Published + Assigned + Confirmed
  (lifecycle_status = 'Published' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Confirmed' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S5: Published + Unassigned + OnBiddingNormal
  (lifecycle_status = 'Published' AND assignment_status = 'Unassigned' 
   AND assignment_outcome IS NULL AND bidding_status = 'OnBiddingNormal' AND trading_status = 'NoTrade')
  OR
  -- S6: Published + Unassigned + OnBiddingUrgent
  (lifecycle_status = 'Published' AND assignment_status = 'Unassigned' 
   AND assignment_outcome IS NULL AND bidding_status = 'OnBiddingUrgent' AND trading_status = 'NoTrade')
  OR
  -- S7: Published + Assigned + EmergencyAssigned
  (lifecycle_status = 'Published' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'EmergencyAssigned' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S8: Published + Unassigned + BiddingClosedNoWinner
  (lifecycle_status = 'Published' AND assignment_status = 'Unassigned' 
   AND assignment_outcome IS NULL AND bidding_status = 'BiddingClosedNoWinner' AND trading_status = 'NoTrade')
  OR
  -- S9: Published + Confirmed + TradeRequested
  (lifecycle_status = 'Published' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Confirmed' AND bidding_status = 'NotOnBidding' AND trading_status = 'TradeRequested')
  OR
  -- S10: Published + Confirmed + TradeAccepted
  (lifecycle_status = 'Published' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Confirmed' AND bidding_status = 'NotOnBidding' AND trading_status = 'TradeAccepted')
  OR
  -- S11: InProgress + Assigned + Confirmed
  (lifecycle_status = 'InProgress' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Confirmed' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S12: InProgress + Assigned + EmergencyAssigned
  (lifecycle_status = 'InProgress' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'EmergencyAssigned' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S13: Completed + Assigned + Confirmed
  (lifecycle_status = 'Completed' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Confirmed' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S14: Completed + Assigned + EmergencyAssigned
  (lifecycle_status = 'Completed' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'EmergencyAssigned' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S15: Cancelled (any assignment state allowed)
  (lifecycle_status = 'Cancelled' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade'
   AND assignment_outcome IS NULL)
);

-- 4.1.2 Report invalid shifts
DO $$
DECLARE
  invalid_count integer;
BEGIN
  SELECT COUNT(*) INTO invalid_count FROM invalid_shifts;
  IF invalid_count > 0 THEN
    RAISE WARNING 'Found % shifts in invalid states. These must be fixed before constraint can be added.', invalid_count;
    RAISE WARNING 'Run: SELECT * FROM invalid_shifts; to see details';
    RAISE EXCEPTION 'Cannot add constraint with invalid data';
  ELSE
    RAISE NOTICE 'All shifts are in valid states. Proceeding with constraint.';
  END IF;
END $$;

-- 4.1.3 Add the constraint
ALTER TABLE shifts ADD CONSTRAINT valid_shift_state_combination CHECK (
  -- S1: Draft + Unassigned
  (lifecycle_status = 'Draft' AND assignment_status = 'Unassigned' 
   AND assignment_outcome IS NULL AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S2: Draft + Assigned + Pending
  (lifecycle_status = 'Draft' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Pending' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S3: Published + Assigned + Offered
  (lifecycle_status = 'Published' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Offered' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S4: Published + Assigned + Confirmed
  (lifecycle_status = 'Published' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Confirmed' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S5: Published + Unassigned + OnBiddingNormal
  (lifecycle_status = 'Published' AND assignment_status = 'Unassigned' 
   AND assignment_outcome IS NULL AND bidding_status = 'OnBiddingNormal' AND trading_status = 'NoTrade')
  OR
  -- S6: Published + Unassigned + OnBiddingUrgent
  (lifecycle_status = 'Published' AND assignment_status = 'Unassigned' 
   AND assignment_outcome IS NULL AND bidding_status = 'OnBiddingUrgent' AND trading_status = 'NoTrade')
  OR
  -- S7: Published + Assigned + EmergencyAssigned
  (lifecycle_status = 'Published' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'EmergencyAssigned' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S8: Published + Unassigned + BiddingClosedNoWinner
  (lifecycle_status = 'Published' AND assignment_status = 'Unassigned' 
   AND assignment_outcome IS NULL AND bidding_status = 'BiddingClosedNoWinner' AND trading_status = 'NoTrade')
  OR
  -- S9: Published + Confirmed + TradeRequested
  (lifecycle_status = 'Published' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Confirmed' AND bidding_status = 'NotOnBidding' AND trading_status = 'TradeRequested')
  OR
  -- S10: Published + Confirmed + TradeAccepted
  (lifecycle_status = 'Published' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Confirmed' AND bidding_status = 'NotOnBidding' AND trading_status = 'TradeAccepted')
  OR
  -- S11: InProgress + Assigned + Confirmed
  (lifecycle_status = 'InProgress' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Confirmed' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S12: InProgress + Assigned + EmergencyAssigned
  (lifecycle_status = 'InProgress' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'EmergencyAssigned' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S13: Completed + Assigned + Confirmed
  (lifecycle_status = 'Completed' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'Confirmed' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S14: Completed + Assigned + EmergencyAssigned
  (lifecycle_status = 'Completed' AND assignment_status = 'Assigned' 
   AND assignment_outcome = 'EmergencyAssigned' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade')
  OR
  -- S15: Cancelled
  (lifecycle_status = 'Cancelled' AND bidding_status = 'NotOnBidding' AND trading_status = 'NoTrade'
   AND assignment_outcome IS NULL)
);

-- 4.1.4 Add comment for documentation
COMMENT ON CONSTRAINT valid_shift_state_combination ON shifts IS 
  'Enforces the 15 valid shift states (S1-S15) per state machine specification. See state-machine.md for details.';

DROP TABLE IF EXISTS invalid_shifts;

COMMIT;
```

### 4.2 Data Remediation Script

**File**: `migrations/005a_fix_invalid_states.sql`

Run this BEFORE migration 005 if invalid states exist:

```sql
-- ============================================================================
-- Migration 005a: Fix Invalid State Combinations
-- ============================================================================
-- Description: Remediates shifts in invalid states before adding constraint
-- Run this manually, review each fix carefully
-- ============================================================================

BEGIN;

-- 4.2.1 Fix: Draft shifts with non-Pending outcome
UPDATE shifts
SET assignment_outcome = 'Pending'
WHERE lifecycle_status = 'Draft'
  AND assignment_status = 'Assigned'
  AND assignment_outcome NOT IN ('Pending') 
  AND assignment_outcome IS NOT NULL;

-- 4.2.2 Fix: Unassigned shifts with non-null outcome
UPDATE shifts
SET assignment_outcome = NULL
WHERE assignment_status = 'Unassigned'
  AND assignment_outcome IS NOT NULL;

-- 4.2.3 Fix: OnBidding shifts that are Assigned (should be Unassigned)
UPDATE shifts
SET 
  assignment_status = 'Unassigned',
  assignment_outcome = NULL,
  assigned_employee_id = NULL
WHERE bidding_status IN ('OnBiddingNormal', 'OnBiddingUrgent')
  AND assignment_status = 'Assigned';

-- 4.2.4 Fix: InProgress/Completed shifts that are Unassigned (should be Cancelled)
UPDATE shifts
SET lifecycle_status = 'Cancelled'
WHERE lifecycle_status IN ('InProgress', 'Completed')
  AND assignment_status = 'Unassigned';

-- 4.2.5 Fix: Trading status on non-Confirmed shifts
UPDATE shifts
SET trading_status = 'NoTrade'
WHERE trading_status != 'NoTrade'
  AND (assignment_outcome != 'Confirmed' OR assignment_outcome IS NULL);

-- 4.2.6 Fix: Bidding status on Assigned shifts (except BiddingClosedNoWinner on Unassigned)
UPDATE shifts
SET bidding_status = 'NotOnBidding'
WHERE bidding_status IN ('OnBiddingNormal', 'OnBiddingUrgent')
  AND assignment_status = 'Assigned';

-- 4.2.7 Fix: Cancelled shifts - ensure clean state
UPDATE shifts
SET 
  bidding_status = 'NotOnBidding',
  trading_status = 'NoTrade',
  assignment_outcome = NULL
WHERE lifecycle_status = 'Cancelled';

-- 4.2.8 Log what was fixed
DO $$
BEGIN
  RAISE NOTICE 'Data remediation complete. Run audit query to verify.';
END $$;

COMMIT;
```

---

## 5. Phase 3: Cleanup (Breaking)

### 5.1 Pre-Cleanup: Application Code Changes Required

Before running Phase 3 migrations, update application code:

```typescript
// BEFORE (using deprecated columns)
const isDraft = shift.is_draft;
const isPublished = shift.is_published;
const employeeId = shift.employee_id;

// AFTER (using enum columns)
const isDraft = shift.lifecycle_status === 'Draft';
const isPublished = shift.lifecycle_status === 'Published';
const employeeId = shift.assigned_employee_id;
```

### 5.2 Migration: Remove Redundant Boolean Columns

**File**: `migrations/006_remove_redundant_columns.sql`

```sql
-- ============================================================================
-- Migration 006: Remove Redundant Boolean/Text Columns
-- ============================================================================
-- Description: Drops deprecated columns that duplicate enum values
-- WARNING: BREAKING CHANGE - Ensure all application code is updated first
-- Rollback: Restore from backup (columns cannot be easily recreated)
-- ============================================================================

BEGIN;

-- 5.2.1 Safety check: Verify application is not using these columns
-- This will fail if any views/functions still reference them
-- (Comment out the DROP statements and run to check dependencies)

-- 5.2.2 Drop redundant boolean columns
ALTER TABLE shifts DROP COLUMN IF EXISTS is_draft;
ALTER TABLE shifts DROP COLUMN IF EXISTS is_published;
ALTER TABLE shifts DROP COLUMN IF EXISTS is_cancelled;
ALTER TABLE shifts DROP COLUMN IF EXISTS is_on_bidding;
ALTER TABLE shifts DROP COLUMN IF EXISTS is_urgent;
ALTER TABLE shifts DROP COLUMN IF EXISTS is_trade_requested;
ALTER TABLE shifts DROP COLUMN IF EXISTS is_locked;

-- 5.2.3 Drop redundant text columns
ALTER TABLE shifts DROP COLUMN IF EXISTS assignment_status_text;
ALTER TABLE shifts DROP COLUMN IF EXISTS assignment_method_text;
ALTER TABLE shifts DROP COLUMN IF EXISTS bidding_priority_text;
ALTER TABLE shifts DROP COLUMN IF EXISTS lock_reason_text;
ALTER TABLE shifts DROP COLUMN IF EXISTS cancellation_type_text;
ALTER TABLE shifts DROP COLUMN IF EXISTS compliance_status_text;

-- 5.2.4 Drop the legacy status column (if separate from lifecycle_status)
-- ALTER TABLE shifts DROP COLUMN IF EXISTS status;

-- 5.2.5 Drop sync trigger (no longer needed)
DROP TRIGGER IF EXISTS trg_sync_employee_ids ON shifts;
DROP FUNCTION IF EXISTS sync_employee_id_columns();

-- 5.2.6 Log dropped columns
DO $$
BEGIN
  RAISE NOTICE 'Dropped redundant columns: is_draft, is_published, is_cancelled, is_on_bidding, is_urgent, is_trade_requested, is_locked';
  RAISE NOTICE 'Dropped text columns: assignment_status_text, assignment_method_text, bidding_priority_text, lock_reason_text';
END $$;

COMMIT;
```

### 5.3 Migration: Remove Duplicate Employee ID Column

**File**: `migrations/007_remove_employee_id.sql`

```sql
-- ============================================================================
-- Migration 007: Remove Duplicate employee_id Column
-- ============================================================================
-- Description: Removes employee_id, keeping only assigned_employee_id
-- WARNING: BREAKING CHANGE
-- Rollback: Restore from backup
-- ============================================================================

BEGIN;

-- 5.3.1 Final verification that data is synced
DO $$
DECLARE
  mismatch_count integer;
BEGIN
  SELECT COUNT(*) INTO mismatch_count
  FROM shifts
  WHERE employee_id IS DISTINCT FROM assigned_employee_id
    AND employee_id IS NOT NULL
    AND assigned_employee_id IS NOT NULL;
    
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Found % mismatched employee IDs. Cannot proceed.', mismatch_count;
  END IF;
END $$;

-- 5.3.2 Drop the foreign key constraint first
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_assigned_to_fkey;

-- 5.3.3 Drop the employee_id column
ALTER TABLE shifts DROP COLUMN IF EXISTS employee_id;

-- 5.3.4 Ensure assigned_employee_id has proper foreign key
ALTER TABLE shifts 
  DROP CONSTRAINT IF EXISTS fk_shifts_assigned_profile;

ALTER TABLE shifts
  ADD CONSTRAINT fk_shifts_assigned_employee 
  FOREIGN KEY (assigned_employee_id) 
  REFERENCES profiles(id)
  ON DELETE SET NULL;

-- 5.3.5 Create index on assigned_employee_id
CREATE INDEX IF NOT EXISTS idx_shifts_assigned_employee 
ON shifts (assigned_employee_id) 
WHERE assigned_employee_id IS NOT NULL;

COMMIT;
```

### 5.4 Create Backward Compatibility Views (Optional)

**File**: `migrations/008_compatibility_views.sql`

```sql
-- ============================================================================
-- Migration 008: Create Backward Compatibility Views
-- ============================================================================
-- Description: Creates views that expose old column names for gradual migration
-- These can be dropped once all code is updated
-- ============================================================================

CREATE OR REPLACE VIEW shifts_compat AS
SELECT 
  s.*,
  -- Computed boolean columns
  (s.lifecycle_status = 'Draft') as is_draft,
  (s.lifecycle_status = 'Published') as is_published,
  (s.lifecycle_status = 'Cancelled') as is_cancelled,
  (s.bidding_status IN ('OnBiddingNormal', 'OnBiddingUrgent')) as is_on_bidding,
  (s.bidding_status = 'OnBiddingUrgent') as is_urgent,
  (s.trading_status != 'NoTrade') as is_trade_requested,
  -- Computed text columns
  s.assignment_status::text as assignment_status_text,
  s.bidding_status::text as bidding_priority_text,
  -- Alias for employee_id
  s.assigned_employee_id as employee_id
FROM shifts s;

COMMENT ON VIEW shifts_compat IS 
  'DEPRECATED: Backward compatibility view. Use shifts table directly with enum columns.';
```

---

## 6. Phase 4: Missing Logic

### 6.1 RPC: Select Bidding Winner

**File**: `migrations/009_rpc_select_bidding_winner.sql`

```sql
-- ============================================================================
-- RPC: select_bidding_winner
-- ============================================================================
-- Transitions: S5 → S4, S6 → S4
-- ============================================================================

CREATE OR REPLACE FUNCTION select_bidding_winner(
  p_shift_id uuid,
  p_bid_id uuid,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift record;
  v_bid record;
  v_employee record;
  v_compliance_result jsonb;
BEGIN
  -- 6.1.1 Lock and fetch shift
  SELECT * INTO v_shift
  FROM shifts
  WHERE id = p_shift_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;
  
  -- 6.1.2 Validate current state (must be S5 or S6)
  IF v_shift.lifecycle_status != 'Published' 
     OR v_shift.assignment_status != 'Unassigned'
     OR v_shift.bidding_status NOT IN ('OnBiddingNormal', 'OnBiddingUrgent') THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Shift is not in bidding state',
      'current_state', jsonb_build_object(
        'lifecycle', v_shift.lifecycle_status,
        'assignment', v_shift.assignment_status,
        'bidding', v_shift.bidding_status
      )
    );
  END IF;
  
  -- 6.1.3 Fetch and validate bid
  SELECT sb.*, p.id as profile_id, p.full_name
  INTO v_bid
  FROM shift_bids sb
  JOIN profiles p ON p.id = sb.employee_id
  WHERE sb.id = p_bid_id
    AND sb.shift_id = p_shift_id
    AND sb.status = 'pending';
    
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bid not found or not pending');
  END IF;
  
  -- 6.1.4 Run compliance check
  SELECT * INTO v_compliance_result
  FROM check_employee_compliance(v_bid.employee_id, p_shift_id);
  
  IF NOT (v_compliance_result->>'passed')::boolean THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Employee does not pass compliance check',
      'compliance', v_compliance_result
    );
  END IF;
  
  -- 6.1.5 Update shift to S4 (Published + Confirmed)
  UPDATE shifts
  SET 
    assignment_status = 'Assigned',
    assignment_outcome = 'Confirmed',
    bidding_status = 'NotOnBidding',
    trading_status = 'NoTrade',
    assigned_employee_id = v_bid.employee_id,
    assigned_at = now(),
    updated_at = now(),
    version = version + 1
  WHERE id = p_shift_id;
  
  -- 6.1.6 Update winning bid
  UPDATE shift_bids
  SET 
    status = 'accepted',
    allocation_reason = 'Selected by manager',
    reviewed_at = now(),
    reviewed_by = p_actor_id,
    updated_at = now()
  WHERE id = p_bid_id;
  
  -- 6.1.7 Reject other bids
  UPDATE shift_bids
  SET 
    status = 'rejected',
    allocation_reason = 'Another bid selected',
    reviewed_at = now(),
    reviewed_by = p_actor_id,
    updated_at = now()
  WHERE shift_id = p_shift_id
    AND id != p_bid_id
    AND status = 'pending';
  
  -- 6.1.8 Log audit event
  INSERT INTO shift_audit_events (
    shift_id, event_type, event_category,
    performed_by_id, performed_by_name, performed_by_role,
    old_data, new_data, metadata
  ) VALUES (
    p_shift_id, 'bidding_winner_selected', 'assignment',
    p_actor_id, (SELECT full_name FROM profiles WHERE id = p_actor_id), 'manager',
    jsonb_build_object('bidding_status', v_shift.bidding_status),
    jsonb_build_object('assignment_status', 'Assigned', 'assignment_outcome', 'Confirmed'),
    jsonb_build_object('bid_id', p_bid_id, 'employee_id', v_bid.employee_id)
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'employee_id', v_bid.employee_id,
    'employee_name', v_bid.full_name,
    'new_state', 'S4'
  );
END;
$$;
```

### 6.2 RPC: Close Bidding No Winner

**File**: `migrations/010_rpc_close_bidding_no_winner.sql`

```sql
-- ============================================================================
-- RPC: close_bidding_no_winner
-- ============================================================================
-- Transitions: S5 → S8, S6 → S8
-- ============================================================================

CREATE OR REPLACE FUNCTION close_bidding_no_winner(
  p_shift_id uuid,
  p_reason text DEFAULT NULL,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift record;
  v_pending_bids integer;
BEGIN
  -- 6.2.1 Lock and fetch shift
  SELECT * INTO v_shift
  FROM shifts
  WHERE id = p_shift_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;
  
  -- 6.2.2 Validate current state (must be S5 or S6)
  IF v_shift.lifecycle_status != 'Published' 
     OR v_shift.assignment_status != 'Unassigned'
     OR v_shift.bidding_status NOT IN ('OnBiddingNormal', 'OnBiddingUrgent') THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Shift is not in bidding state'
    );
  END IF;
  
  -- 6.2.3 Check for pending bids (optional warning)
  SELECT COUNT(*) INTO v_pending_bids
  FROM shift_bids
  WHERE shift_id = p_shift_id AND status = 'pending';
  
  -- 6.2.4 Update shift to S8 (BiddingClosedNoWinner)
  UPDATE shifts
  SET 
    bidding_status = 'BiddingClosedNoWinner',
    updated_at = now(),
    version = version + 1
  WHERE id = p_shift_id;
  
  -- 6.2.5 Reject all pending bids
  UPDATE shift_bids
  SET 
    status = 'rejected',
    allocation_reason = COALESCE(p_reason, 'Bidding closed without winner'),
    reviewed_at = now(),
    reviewed_by = p_actor_id,
    updated_at = now()
  WHERE shift_id = p_shift_id
    AND status = 'pending';
  
  -- 6.2.6 Close bid window if exists
  UPDATE shift_bid_windows
  SET 
    status = 'closed',
    closes_at = now()
  WHERE shift_id = p_shift_id
    AND status = 'open';
  
  -- 6.2.7 Log audit event
  INSERT INTO shift_audit_events (
    shift_id, event_type, event_category,
    performed_by_id, performed_by_name, performed_by_role,
    old_data, new_data, metadata
  ) VALUES (
    p_shift_id, 'bidding_closed_no_winner', 'bidding',
    p_actor_id, (SELECT full_name FROM profiles WHERE id = p_actor_id), 'manager',
    jsonb_build_object('bidding_status', v_shift.bidding_status),
    jsonb_build_object('bidding_status', 'BiddingClosedNoWinner'),
    jsonb_build_object('reason', p_reason, 'rejected_bids', v_pending_bids)
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'rejected_bids', v_pending_bids,
    'new_state', 'S8'
  );
END;
$$;
```

### 6.3 Scheduled Job: Process Time Transitions

**File**: `migrations/011_scheduled_time_transitions.sql`

```sql
-- ============================================================================
-- Scheduled Job: process_shift_time_transitions
-- ============================================================================
-- Transitions: 
--   Published → InProgress (when start time crossed)
--   InProgress → Completed (when end time crossed)
-- Schedule: Run every 1 minute via pg_cron or external scheduler
-- ============================================================================

CREATE OR REPLACE FUNCTION process_shift_time_transitions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now timestamptz := now();
  v_to_inprogress integer := 0;
  v_to_completed integer := 0;
  v_shift record;
BEGIN
  -- 6.3.1 Transition Published → InProgress
  -- Only for S4 (Confirmed) and S7 (EmergencyAssigned)
  FOR v_shift IN
    SELECT id, assignment_outcome
    FROM shifts
    WHERE lifecycle_status = 'Published'
      AND assignment_status = 'Assigned'
      AND assignment_outcome IN ('Confirmed', 'EmergencyAssigned')
      AND scheduled_start <= v_now
      AND bidding_status = 'NotOnBidding'
      AND trading_status = 'NoTrade'
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE shifts
    SET 
      lifecycle_status = 'InProgress',
      updated_at = v_now,
      version = version + 1
    WHERE id = v_shift.id;
    
    -- Log the transition
    INSERT INTO shift_audit_events (
      shift_id, event_type, event_category,
      performed_by_name, performed_by_role,
      old_data, new_data
    ) VALUES (
      v_shift.id, 'time_transition_inprogress', 'lifecycle',
      'System', 'scheduler',
      jsonb_build_object('lifecycle_status', 'Published'),
      jsonb_build_object('lifecycle_status', 'InProgress')
    );
    
    v_to_inprogress := v_to_inprogress + 1;
  END LOOP;
  
  -- 6.3.2 Transition InProgress → Completed
  FOR v_shift IN
    SELECT id, assignment_outcome
    FROM shifts
    WHERE lifecycle_status = 'InProgress'
      AND scheduled_end <= v_now
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE shifts
    SET 
      lifecycle_status = 'Completed',
      updated_at = v_now,
      version = version + 1
    WHERE id = v_shift.id;
    
    -- Log the transition
    INSERT INTO shift_audit_events (
      shift_id, event_type, event_category,
      performed_by_name, performed_by_role,
      old_data, new_data
    ) VALUES (
      v_shift.id, 'time_transition_completed', 'lifecycle',
      'System', 'scheduler',
      jsonb_build_object('lifecycle_status', 'InProgress'),
      jsonb_build_object('lifecycle_status', 'Completed')
    );
    
    v_to_completed := v_to_completed + 1;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'timestamp', v_now,
    'transitions', jsonb_build_object(
      'to_inprogress', v_to_inprogress,
      'to_completed', v_to_completed
    )
  );
END;
$$;

-- 6.3.3 Create pg_cron schedule (if pg_cron is available)
-- SELECT cron.schedule(
--   'process-shift-time-transitions',
--   '* * * * *',  -- Every minute
--   'SELECT process_shift_time_transitions()'
-- );

-- 6.3.4 Alternative: Create a wrapper for external scheduler
CREATE OR REPLACE FUNCTION trigger_time_transitions()
RETURNS void
LANGUAGE sql
AS $$
  SELECT process_shift_time_transitions();
$$;
```

### 6.4 Helper: Get Current State ID

**File**: `migrations/012_helper_get_state_id.sql`

```sql
-- ============================================================================
-- Helper: get_shift_state_id
-- ============================================================================
-- Returns the state ID (S1-S15) for a shift based on its dimensions
-- ============================================================================

CREATE OR REPLACE FUNCTION get_shift_state_id(
  p_lifecycle shift_lifecycle,
  p_assignment assignment_status,
  p_outcome assignment_outcome,
  p_bidding bidding_status,
  p_trading shift_trading
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE
    WHEN p_lifecycle = 'Draft' AND p_assignment = 'Unassigned' 
         AND p_outcome IS NULL AND p_bidding = 'NotOnBidding' AND p_trading = 'NoTrade' 
         THEN 'S1'
    WHEN p_lifecycle = 'Draft' AND p_assignment = 'Assigned' 
         AND p_outcome = 'Pending' AND p_bidding = 'NotOnBidding' AND p_trading = 'NoTrade' 
         THEN 'S2'
    WHEN p_lifecycle = 'Published' AND p_assignment = 'Assigned' 
         AND p_outcome = 'Offered' AND p_bidding = 'NotOnBidding' AND p_trading = 'NoTrade' 
         THEN 'S3'
    WHEN p_lifecycle = 'Published' AND p_assignment = 'Assigned' 
         AND p_outcome = 'Confirmed' AND p_bidding = 'NotOnBidding' AND p_trading = 'NoTrade' 
         THEN 'S4'
    WHEN p_lifecycle = 'Published' AND p_assignment = 'Unassigned' 
         AND p_outcome IS NULL AND p_bidding = 'OnBiddingNormal' AND p_trading = 'NoTrade' 
         THEN 'S5'
    WHEN p_lifecycle = 'Published' AND p_assignment = 'Unassigned' 
         AND p_outcome IS NULL AND p_bidding = 'OnBiddingUrgent' AND p_trading = 'NoTrade' 
         THEN 'S6'
    WHEN p_lifecycle = 'Published' AND p_assignment = 'Assigned' 
         AND p_outcome = 'EmergencyAssigned' AND p_bidding = 'NotOnBidding' AND p_trading = 'NoTrade' 
         THEN 'S7'
    WHEN p_lifecycle = 'Published' AND p_assignment = 'Unassigned' 
         AND p_outcome IS NULL AND p_bidding = 'BiddingClosedNoWinner' AND p_trading = 'NoTrade' 
         THEN 'S8'
    WHEN p_lifecycle = 'Published' AND p_assignment = 'Assigned' 
         AND p_outcome = 'Confirmed' AND p_bidding = 'NotOnBidding' AND p_trading = 'TradeRequested' 
         THEN 'S9'
    WHEN p_lifecycle = 'Published' AND p_assignment = 'Assigned' 
         AND p_outcome = 'Confirmed' AND p_bidding = 'NotOnBidding' AND p_trading = 'TradeAccepted' 
         THEN 'S10'
    WHEN p_lifecycle = 'InProgress' AND p_assignment = 'Assigned' 
         AND p_outcome = 'Confirmed' AND p_bidding = 'NotOnBidding' AND p_trading = 'NoTrade' 
         THEN 'S11'
    WHEN p_lifecycle = 'InProgress' AND p_assignment = 'Assigned' 
         AND p_outcome = 'EmergencyAssigned' AND p_bidding = 'NotOnBidding' AND p_trading = 'NoTrade' 
         THEN 'S12'
    WHEN p_lifecycle = 'Completed' AND p_assignment = 'Assigned' 
         AND p_outcome = 'Confirmed' AND p_bidding = 'NotOnBidding' AND p_trading = 'NoTrade' 
         THEN 'S13'
    WHEN p_lifecycle = 'Completed' AND p_assignment = 'Assigned' 
         AND p_outcome = 'EmergencyAssigned' AND p_bidding = 'NotOnBidding' AND p_trading = 'NoTrade' 
         THEN 'S14'
    WHEN p_lifecycle = 'Cancelled' AND p_bidding = 'NotOnBidding' AND p_trading = 'NoTrade' 
         AND p_outcome IS NULL 
         THEN 'S15'
    ELSE 'INVALID'
  END;
END;
$$;

-- View to show all shifts with their state ID
CREATE OR REPLACE VIEW shifts_with_state AS
SELECT 
  s.*,
  get_shift_state_id(
    s.lifecycle_status, 
    s.assignment_status, 
    s.assignment_outcome, 
    s.bidding_status, 
    s.trading_status
  ) as state_id
FROM shifts s;
```

---

## 7. Verification Test Suite

### 7.1 Schema Verification Tests

**File**: `tests/verify_schema_standardization.ts`

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<boolean | string>) {
  try {
    const result = await fn();
    const passed = result === true;
    results.push({ 
      name, 
      passed, 
      details: typeof result === 'string' ? result : undefined 
    });
    console.log(passed ? `✅ ${name}` : `❌ ${name}: ${result}`);
  } catch (error) {
    results.push({ name, passed: false, details: String(error) });
    console.log(`❌ ${name}: ${error}`);
  }
}

async function main() {
  console.log('\n=== Schema Standardization Verification ===\n');

  // 7.1.1 Verify shift_lifecycle enum exists
  await test('shift_lifecycle enum exists', async () => {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT array_agg(enumlabel ORDER BY enumsortorder) as values
        FROM pg_enum
        WHERE enumtypid = 'shift_lifecycle'::regtype
      `
    });
    if (error) return error.message;
    const expected = ['Draft', 'Published', 'InProgress', 'Completed', 'Cancelled'];
    const actual = data?.[0]?.values;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      return `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    }
    return true;
  });

  // 7.1.2 Verify shift_trading enum exists
  await test('shift_trading enum exists', async () => {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT array_agg(enumlabel ORDER BY enumsortorder) as values
        FROM pg_enum
        WHERE enumtypid = 'shift_trading'::regtype
      `
    });
    if (error) return error.message;
    const expected = ['NoTrade', 'TradeRequested', 'TradeAccepted', 'TradeApproved'];
    const actual = data?.[0]?.values;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      return `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    }
    return true;
  });

  // 7.1.3 Verify trading_status column exists
  await test('trading_status column exists', async () => {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'shifts' AND column_name = 'trading_status'
      `
    });
    if (error) return error.message;
    if (!data || data.length === 0) return 'Column not found';
    if (data[0].is_nullable !== 'NO') return 'Column should be NOT NULL';
    return true;
  });

  // 7.1.4 Verify lifecycle_status is enum (not text)
  await test('lifecycle_status is enum type', async () => {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT data_type, udt_name
        FROM information_schema.columns
        WHERE table_name = 'shifts' AND column_name = 'lifecycle_status'
      `
    });
    if (error) return error.message;
    if (!data || data.length === 0) return 'Column not found';
    if (data[0].data_type !== 'USER-DEFINED' || data[0].udt_name !== 'shift_lifecycle') {
      return `Expected shift_lifecycle enum, got ${data[0].data_type} / ${data[0].udt_name}`;
    }
    return true;
  });

  // 7.1.5 Verify valid_shift_state_combination constraint exists
  await test('valid_shift_state_combination constraint exists', async () => {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'shifts'::regclass
          AND contype = 'c'
          AND conname = 'valid_shift_state_combination'
      `
    });
    if (error) return error.message;
    if (!data || data.length === 0) return 'Constraint not found';
    return true;
  });

  // 7.1.6 Verify redundant columns are removed (Phase 3)
  await test('is_draft column removed', async () => {
    const { data } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'shifts' AND column_name = 'is_draft'
      `
    });
    if (data && data.length > 0) return 'Column still exists';
    return true;
  });

  await test('is_published column removed', async () => {
    const { data } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'shifts' AND column_name = 'is_published'
      `
    });
    if (data && data.length > 0) return 'Column still exists';
    return true;
  });

  await test('is_trade_requested column removed', async () => {
    const { data } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'shifts' AND column_name = 'is_trade_requested'
      `
    });
    if (data && data.length > 0) return 'Column still exists';
    return true;
  });

  // 7.1.7 Verify employee_id column is removed
  await test('employee_id column removed (use assigned_employee_id)', async () => {
    const { data } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'shifts' AND column_name = 'employee_id'
      `
    });
    if (data && data.length > 0) return 'Column still exists';
    return true;
  });

  // 7.1.8 Verify new RPCs exist
  await test('select_bidding_winner RPC exists', async () => {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT routine_name FROM information_schema.routines
        WHERE routine_name = 'select_bidding_winner' AND routine_type = 'FUNCTION'
      `
    });
    if (error) return error.message;
    if (!data || data.length === 0) return 'Function not found';
    return true;
  });

  await test('close_bidding_no_winner RPC exists', async () => {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT routine_name FROM information_schema.routines
        WHERE routine_name = 'close_bidding_no_winner' AND routine_type = 'FUNCTION'
      `
    });
    if (error) return error.message;
    if (!data || data.length === 0) return 'Function not found';
    return true;
  });

  await test('process_shift_time_transitions RPC exists', async () => {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT routine_name FROM information_schema.routines
        WHERE routine_name = 'process_shift_time_transitions' AND routine_type = 'FUNCTION'
      `
    });
    if (error) return error.message;
    if (!data || data.length === 0) return 'Function not found';
    return true;
  });

  // Print summary
  console.log('\n=== Summary ===');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.details}`);
    });
    process.exit(1);
  }
}

main();
```

### 7.2 State Invariant Tests

**File**: `tests/verify_state_invariants.ts`

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('\n=== State Invariant Verification ===\n');

  // 7.2.1 No invalid state combinations exist
  console.log('Checking for invalid state combinations...');
  const { data: invalidStates } = await supabase
    .from('shifts_with_state')
    .select('id, state_id, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status')
    .eq('state_id', 'INVALID');

  if (invalidStates && invalidStates.length > 0) {
    console.log(`❌ Found ${invalidStates.length} shifts in invalid states:`);
    invalidStates.slice(0, 10).forEach(s => {
      console.log(`  - ${s.id}: ${s.lifecycle_status}/${s.assignment_status}/${s.assignment_outcome}/${s.bidding_status}/${s.trading_status}`);
    });
    if (invalidStates.length > 10) {
      console.log(`  ... and ${invalidStates.length - 10} more`);
    }
  } else {
    console.log('✅ No invalid state combinations found');
  }

  // 7.2.2 Invariant 1: Assignment cannot change after Confirmed
  console.log('\nChecking Invariant 1: Assignment immutability after Confirmed...');
  // This is enforced by constraint, so we just verify no Confirmed shifts have NULL employee
  const { data: confirmedNoEmployee } = await supabase
    .from('shifts')
    .select('id')
    .eq('assignment_outcome', 'Confirmed')
    .is('assigned_employee_id', null);

  if (confirmedNoEmployee && confirmedNoEmployee.length > 0) {
    console.log(`❌ Found ${confirmedNoEmployee.length} Confirmed shifts without employee`);
  } else {
    console.log('✅ All Confirmed shifts have assigned employee');
  }

  // 7.2.3 Invariant 2: OnBidding requires Unassigned
  console.log('\nChecking Invariant 2: OnBidding requires Unassigned...');
  const { data: biddingAssigned } = await supabase
    .from('shifts')
    .select('id')
    .in('bidding_status', ['OnBiddingNormal', 'OnBiddingUrgent'])
    .eq('assignment_status', 'Assigned');

  if (biddingAssigned && biddingAssigned.length > 0) {
    console.log(`❌ Found ${biddingAssigned.length} OnBidding shifts that are Assigned`);
  } else {
    console.log('✅ All OnBidding shifts are Unassigned');
  }

  // 7.2.4 Invariant 3: InProgress/Completed requires Assigned
  console.log('\nChecking Invariant 3: InProgress/Completed requires Assigned...');
  const { data: activeUnassigned } = await supabase
    .from('shifts')
    .select('id')
    .in('lifecycle_status', ['InProgress', 'Completed'])
    .eq('assignment_status', 'Unassigned');

  if (activeUnassigned && activeUnassigned.length > 0) {
    console.log(`❌ Found ${activeUnassigned.length} InProgress/Completed shifts that are Unassigned`);
  } else {
    console.log('✅ All InProgress/Completed shifts are Assigned');
  }

  // 7.2.5 Invariant 4: Trading only allowed from Confirmed
  console.log('\nChecking Invariant 4: Trading only from Confirmed...');
  const { data: tradingNonConfirmed } = await supabase
    .from('shifts')
    .select('id')
    .neq('trading_status', 'NoTrade')
    .neq('assignment_outcome', 'Confirmed');

  if (tradingNonConfirmed && tradingNonConfirmed.length > 0) {
    console.log(`❌ Found ${tradingNonConfirmed.length} Trading shifts that are not Confirmed`);
  } else {
    console.log('✅ All Trading shifts are Confirmed');
  }

  // 7.2.6 State distribution
  console.log('\n=== State Distribution ===');
  const { data: distribution } = await supabase
    .from('shifts_with_state')
    .select('state_id')
    .then(result => {
      if (!result.data) return { data: null };
      const counts: Record<string, number> = {};
      result.data.forEach(s => {
        counts[s.state_id] = (counts[s.state_id] || 0) + 1;
      });
      return { data: Object.entries(counts).sort((a, b) => b[1] - a[1]) };
    });

  if (distribution) {
    distribution.forEach(([state, count]) => {
      console.log(`  ${state}: ${count}`);
    });
  }
}

main();
```

### 7.3 Transition Tests

**File**: `tests/verify_transitions.ts`

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Test data cleanup
async function cleanupTestShifts() {
  await supabase
    .from('shifts')
    .delete()
    .like('id', 'test-%');
}

// Create shift in specific state
async function createShiftInState(stateId: string, testId: string) {
  const stateConfigs: Record<string, any> = {
    S1: { lifecycle_status: 'Draft', assignment_status: 'Unassigned', assignment_outcome: null, bidding_status: 'NotOnBidding', trading_status: 'NoTrade' },
    S2: { lifecycle_status: 'Draft', assignment_status: 'Assigned', assignment_outcome: 'Pending', bidding_status: 'NotOnBidding', trading_status: 'NoTrade' },
    S4: { lifecycle_status: 'Published', assignment_status: 'Assigned', assignment_outcome: 'Confirmed', bidding_status: 'NotOnBidding', trading_status: 'NoTrade' },
    S5: { lifecycle_status: 'Published', assignment_status: 'Unassigned', assignment_outcome: null, bidding_status: 'OnBiddingNormal', trading_status: 'NoTrade' },
    // Add more as needed
  };

  const config = stateConfigs[stateId];
  if (!config) throw new Error(`Unknown state: ${stateId}`);

  const { data, error } = await supabase
    .from('shifts')
    .insert({
      id: `test-${testId}`,
      ...config,
      // Required fields
      roster_id: 'test-roster-id', // Need valid roster
      department_id: 'test-dept-id', // Need valid dept
      scheduled_start: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      scheduled_end: new Date(Date.now() + 32 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function testTransition(
  name: string,
  fromState: string,
  action: () => Promise<any>,
  expectedState: string | 'ERROR'
) {
  const testId = `trans-${Date.now()}`;
  
  try {
    // Create shift in initial state
    await createShiftInState(fromState, testId);
    
    // Execute transition
    const result = await action();
    
    if (expectedState === 'ERROR') {
      if (result.success) {
        console.log(`❌ ${name}: Expected error, got success`);
        return false;
      }
      console.log(`✅ ${name}: Correctly blocked`);
      return true;
    }
    
    // Verify final state
    const { data: shift } = await supabase
      .from('shifts_with_state')
      .select('state_id')
      .eq('id', `test-${testId}`)
      .single();
    
    if (shift?.state_id === expectedState) {
      console.log(`✅ ${name}: ${fromState} → ${expectedState}`);
      return true;
    } else {
      console.log(`❌ ${name}: Expected ${expectedState}, got ${shift?.state_id}`);
      return false;
    }
  } catch (error) {
    if (expectedState === 'ERROR') {
      console.log(`✅ ${name}: Correctly threw error`);
      return true;
    }
    console.log(`❌ ${name}: ${error}`);
    return false;
  } finally {
    // Cleanup
    await supabase.from('shifts').delete().eq('id', `test-${testId}`);
  }
}

async function main() {
  console.log('\n=== Transition Verification ===\n');
  
  // Note: These tests require valid foreign key references
  // You may need to set up test data first
  
  // Test select_bidding_winner: S5 → S4
  // await testTransition(
  //   'Select bidding winner',
  //   'S5',
  //   () => supabase.rpc('select_bidding_winner', { p_shift_id: 'test-shift', p_bid_id: 'test-bid' }),
  //   'S4'
  // );
  
  // Test close_bidding_no_winner: S5 → S8
  // await testTransition(
  //   'Close bidding no winner',
  //   'S5',
  //   () => supabase.rpc('close_bidding_no_winner', { p_shift_id: 'test-shift' }),
  //   'S8'
  // );
  
  console.log('\n⚠️  Full transition tests require test data setup');
  console.log('See verification-agent-plan.md for complete test matrix');
}

main();
```

---

## 8. Rollback Procedures

### 8.1 Phase 1 Rollback

```sql
-- Rollback Migration 001
DROP TYPE IF EXISTS shift_trading;
DROP TYPE IF EXISTS shift_lifecycle;

-- Rollback Migration 002
ALTER TABLE shifts DROP COLUMN IF EXISTS trading_status;
DROP INDEX IF EXISTS idx_shifts_trading_status;

-- Rollback Migration 003 (complex)
ALTER TABLE shifts ADD COLUMN lifecycle_status_text TEXT;
UPDATE shifts SET lifecycle_status_text = lifecycle_status::TEXT;
ALTER TABLE shifts DROP COLUMN lifecycle_status;
ALTER TABLE shifts RENAME COLUMN lifecycle_status_text TO lifecycle_status;

-- Rollback Migration 004
DROP TRIGGER IF EXISTS trg_sync_employee_ids ON shifts;
DROP FUNCTION IF EXISTS sync_employee_id_columns();
COMMENT ON COLUMN shifts.employee_id IS NULL;
```

### 8.2 Phase 2 Rollback

```sql
-- Rollback Migration 005
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS valid_shift_state_combination;
```

### 8.3 Phase 3 Rollback

**⚠️ Phase 3 requires database restore from backup.**

```bash
# Restore from backup
pg_restore -h $SUPABASE_DB_HOST -U postgres -d postgres \
  -c backup_pre_phase3_YYYYMMDD.dump
```

### 8.4 Phase 4 Rollback

```sql
-- Rollback Migration 009-012
DROP FUNCTION IF EXISTS select_bidding_winner;
DROP FUNCTION IF EXISTS close_bidding_no_winner;
DROP FUNCTION IF EXISTS process_shift_time_transitions;
DROP FUNCTION IF EXISTS trigger_time_transitions;
DROP FUNCTION IF EXISTS get_shift_state_id;
DROP VIEW IF EXISTS shifts_with_state;
```

---

## 9. Deployment Checklist

### 9.1 Pre-Deployment

- [ ] Run data audit queries (Section 2.1)
- [ ] Create database backup
- [ ] Identify and update application code using deprecated columns
- [ ] Review all migration scripts
- [ ] Test migrations in staging environment
- [ ] Schedule maintenance window (for Phase 3)

### 9.2 Phase 1 Deployment

- [ ] Run migration 001_create_state_enums.sql
- [ ] Verify enums created correctly
- [ ] Run migration 002_add_trading_status.sql
- [ ] Verify trading_status backfill
- [ ] Run migration 003_convert_lifecycle_to_enum.sql
- [ ] Verify lifecycle_status conversion
- [ ] Run migration 004_consolidate_employee_id.sql
- [ ] Verify employee ID sync
- [ ] Run verify_schema_standardization.ts (partial)

### 9.3 Phase 2 Deployment

- [ ] Run data audit for invalid states
- [ ] If invalid states exist, run 005a_fix_invalid_states.sql
- [ ] Re-run audit to confirm all states valid
- [ ] Run migration 005_add_state_constraint.sql
- [ ] Verify constraint applied
- [ ] Test that invalid inserts are blocked

### 9.4 Phase 3 Deployment (Maintenance Window)

- [ ] Create pre-Phase 3 backup
- [ ] Notify stakeholders of maintenance
- [ ] Enable maintenance mode in application
- [ ] Deploy updated application code
- [ ] Run migration 006_remove_redundant_columns.sql
- [ ] Run migration 007_remove_employee_id.sql
- [ ] Optionally run migration 008_compatibility_views.sql
- [ ] Run verify_schema_standardization.ts (full)
- [ ] Run verify_state_invariants.ts
- [ ] Disable maintenance mode
- [ ] Monitor for errors

### 9.5 Phase 4 Deployment

- [ ] Run migration 009_rpc_select_bidding_winner.sql
- [ ] Run migration 010_rpc_close_bidding_no_winner.sql
- [ ] Run migration 011_scheduled_time_transitions.sql
- [ ] Run migration 012_helper_get_state_id.sql
- [ ] Configure pg_cron or external scheduler
- [ ] Verify all RPCs work correctly
- [ ] Run full verification suite

---

## 10. Post-Migration Validation

### 10.1 Automated Checks

```bash
# Run all verification tests
npm run test:schema
npm run test:invariants
npm run test:transitions

# Or combined
npm run test:state-machine
```

### 10.2 Manual Verification

1. **Create new shift** → Should be in S1
2. **Assign employee** → Should transition to S2
3. **Publish assigned shift** → Should transition to S3
4. **Employee accepts** → Should transition to S4
5. **Publish unassigned shift** → Should transition to S5
6. **Select bidding winner** → Should transition to S4
7. **Close bidding** → Should transition to S8
8. **Request trade** → Should transition to S9
9. **Wait for start time** → Should auto-transition to S11
10. **Wait for end time** → Should auto-transition to S13

### 10.3 Monitoring

```sql
-- Monitor for constraint violations (should always be 0)
SELECT COUNT(*) FROM shifts
WHERE get_shift_state_id(lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status) = 'INVALID';

-- Monitor state distribution over time
SELECT 
  date_trunc('hour', updated_at) as hour,
  get_shift_state_id(lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status) as state,
  COUNT(*)
FROM shifts
WHERE updated_at > now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY 1, 2;
```

---

## Appendix A: File Index

| File | Phase | Purpose |
|------|-------|---------|
| `migrations/001_create_state_enums.sql` | 1 | Create missing enums |
| `migrations/002_add_trading_status.sql` | 1 | Add trading dimension |
| `migrations/003_convert_lifecycle_to_enum.sql` | 1 | Convert lifecycle to enum |
| `migrations/004_consolidate_employee_id.sql` | 1 | Sync employee columns |
| `migrations/005_add_state_constraint.sql` | 2 | Add S1-S15 constraint |
| `migrations/005a_fix_invalid_states.sql` | 2 | Data remediation |
| `migrations/006_remove_redundant_columns.sql` | 3 | Remove booleans |
| `migrations/007_remove_employee_id.sql` | 3 | Remove duplicate column |
| `migrations/008_compatibility_views.sql` | 3 | Backward compat views |
| `migrations/009_rpc_select_bidding_winner.sql` | 4 | S5/S6→S4 transition |
| `migrations/010_rpc_close_bidding_no_winner.sql` | 4 | S5/S6→S8 transition |
| `migrations/011_scheduled_time_transitions.sql` | 4 | Time-based transitions |
| `migrations/012_helper_get_state_id.sql` | 4 | State ID helper |
| `tests/verify_schema_standardization.ts` | Test | Schema verification |
| `tests/verify_state_invariants.ts` | Test | Invariant verification |
| `tests/verify_transitions.ts` | Test | Transition testing |