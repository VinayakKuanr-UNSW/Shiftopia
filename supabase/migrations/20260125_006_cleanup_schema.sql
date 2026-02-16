
-- Migration 006: Schema Cleanup with Dependencies (No Transaction Block)

-- 1. Drop Dependent Objects
DROP TRIGGER IF EXISTS trg_sync_employee_ids ON shifts;
DROP FUNCTION IF EXISTS sync_employee_id_columns();
DROP VIEW IF EXISTS shifts_with_state;
DROP POLICY IF EXISTS shifts_select ON shifts;

-- 2. Drop redundant columns
ALTER TABLE shifts 
  DROP COLUMN IF EXISTS employee_id,
  DROP COLUMN IF EXISTS is_trade_requested,
  DROP COLUMN IF EXISTS assignment_status_text,
  DROP COLUMN IF EXISTS assignment_method_text,
  DROP COLUMN IF EXISTS cancellation_type_text,
  DROP COLUMN IF EXISTS compliance_status_text;

-- 3. Recreate Policy (using assigned_employee_id)
CREATE POLICY shifts_select ON shifts FOR SELECT USING (
  (assigned_employee_id = auth.uid()) 
  OR (department_id = ANY (get_user_department_ids())) 
  OR (get_user_role() = ANY (ARRAY['admin'::text, 'manager'::text]))
);

-- 4. Recreate View (Updated to new schema automatically via *)
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

-- 5. Cleanup comments
COMMENT ON TABLE shifts IS 'Shifts table with standardized State Machine. Legacy columns/triggers removed.';
