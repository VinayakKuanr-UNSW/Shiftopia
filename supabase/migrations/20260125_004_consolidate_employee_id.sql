
-- Migration 004: Consolidate Employee ID Columns (No Transaction Block)

-- 1. Copy employee_id to assigned_employee_id where assigned is NULL
UPDATE shifts 
SET assigned_employee_id = employee_id
WHERE assigned_employee_id IS NULL 
  AND employee_id IS NOT NULL;

-- 2. Update assignment_status to match (using lowercase enum values)
UPDATE shifts
SET assignment_status = 'assigned'
WHERE assigned_employee_id IS NOT NULL
  AND assignment_status = 'unassigned';

UPDATE shifts
SET assignment_status = 'unassigned'
WHERE assigned_employee_id IS NULL
  AND assignment_status = 'assigned';

-- 3. Mark employee_id as deprecated
COMMENT ON COLUMN shifts.employee_id IS 
  'DEPRECATED: Use assigned_employee_id instead. Will be removed in Phase 3.';

-- 4. Create sync trigger (temporary, until Phase 3)
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
