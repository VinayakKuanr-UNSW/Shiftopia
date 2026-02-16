-- Migration: Fix Shift Lifecycle Log Types
-- Description: Converts log columns to TEXT to handle legacy vs new enum mismatches and updates trigger.
-- Timestamp: 20260122170000

BEGIN;

-- 1. Convert log columns to TEXT to support both old ('scheduled') and new ('published') values
ALTER TABLE shift_lifecycle_log 
    ALTER COLUMN old_status TYPE TEXT USING old_status::text,
    ALTER COLUMN new_status TYPE TEXT USING new_status::text;

-- 2. Update trigger function to cast to TEXT before inserting
CREATE OR REPLACE FUNCTION log_lifecycle_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status THEN
    INSERT INTO shift_lifecycle_log (shift_id, old_status, new_status, changed_by)
    VALUES (NEW.id, OLD.lifecycle_status::text, NEW.lifecycle_status::text, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
