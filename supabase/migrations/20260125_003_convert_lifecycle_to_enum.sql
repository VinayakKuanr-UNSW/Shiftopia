
-- Migration 003: Convert lifecycle_status from TEXT to ENUM (No Transaction Block)

-- 1. Drop trigger that depends on the column (due to WHEN clause)
DROP TRIGGER IF EXISTS shift_lifecycle_change_trigger ON shifts;

-- 2. Disable validation trigger temporarily
ALTER TABLE shifts DISABLE TRIGGER trg_validate_shift_state_invariants;

-- 3. Fix any invalid values
UPDATE shifts 
SET lifecycle_status = 'Draft' 
WHERE lifecycle_status IS NULL OR lifecycle_status = '';

UPDATE shifts 
SET lifecycle_status = 'Cancelled'
WHERE lifecycle_status NOT IN ('Draft', 'Published', 'InProgress', 'Completed', 'Cancelled');

-- 4. Add new enum column
ALTER TABLE shifts 
ADD COLUMN IF NOT EXISTS lifecycle_status_enum shift_lifecycle;

-- 5. Copy data with explicit casting
UPDATE shifts 
SET lifecycle_status_enum = lifecycle_status::shift_lifecycle
WHERE lifecycle_status_enum IS NULL;

-- 6. Drop old column and rename new one
-- Removed Exception swallowing to fail fast
ALTER TABLE shifts DROP COLUMN lifecycle_status;
ALTER TABLE shifts RENAME COLUMN lifecycle_status_enum TO lifecycle_status;
ALTER TABLE shifts ALTER COLUMN lifecycle_status SET NOT NULL;
ALTER TABLE shifts ALTER COLUMN lifecycle_status SET DEFAULT 'Draft';

-- 7. Helper Index
CREATE INDEX IF NOT EXISTS idx_shifts_lifecycle_status ON shifts (lifecycle_status);

-- 8. Re-enable validation trigger
ALTER TABLE shifts ENABLE TRIGGER trg_validate_shift_state_invariants;

-- 9. Recreate the lifecycle change trigger
-- Note: Function log_lifecycle_change() uses ::text cast which works for Enums
CREATE TRIGGER shift_lifecycle_change_trigger 
AFTER UPDATE ON shifts 
FOR EACH ROW 
WHEN ((OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status)) 
EXECUTE FUNCTION log_lifecycle_change();
