/*
  Migration: Fix audit trigger for shift deletions
  
  The original trigger tries to log a DELETE event with the OLD.id,
  but because the FK has ON DELETE CASCADE, the audit events are
  deleted before the trigger finishes. 
  
  Solution: Change the trigger to BEFORE DELETE and use a temporary table
  or simply skip logging deletes in the trigger (delete events are not critical).
*/

-- Drop the existing trigger
DROP TRIGGER IF EXISTS shift_audit_trigger ON shifts;

-- Recreate the function with BEFORE DELETE handling
CREATE OR REPLACE FUNCTION log_shift_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id uuid;
  v_user_name text := 'System';
  v_user_role text := 'system_automation';
  v_batch_id uuid;
  v_old_dept_name text;
  v_new_dept_name text;
  v_old_role_name text;
  v_new_role_name text;
  v_old_emp_name text;
  v_new_emp_name text;
  v_event_type text;
BEGIN
  -- Get current user (may be NULL for cron/system)
  v_user_id := auth.uid();
  
  -- Get batch_id if set (for bulk operations)
  BEGIN
    v_batch_id := current_setting('app.current_batch_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_batch_id := NULL;
  END;
  
  -- Resolve user name and role
  IF v_user_id IS NOT NULL THEN
    SELECT 
      COALESCE(e.first_name || ' ' || e.last_name, 'Unknown User'),
      COALESCE(up.role, 'manager')
    INTO v_user_name, v_user_role
    FROM user_profiles up
    LEFT JOIN employees e ON up.employee_id = e.id
    WHERE up.id = v_user_id;
    
    IF v_user_name IS NULL THEN v_user_name := 'Unknown User'; END IF;
    IF v_user_role IS NULL THEN v_user_role := 'manager'; END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_event_type := CASE WHEN NEW.is_draft THEN 'shift_created_draft' ELSE 'shift_created_published' END;
    
    INSERT INTO shift_audit_events (
      shift_id, event_type, event_category, 
      performed_by_id, performed_by_name, performed_by_role,
      new_data, batch_id
    ) VALUES (
      NEW.id, v_event_type, 'creation',
      v_user_id, v_user_name, v_user_role,
      to_jsonb(NEW), v_batch_id
    );
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- Department change (resolve to name)
    IF OLD.department_id IS DISTINCT FROM NEW.department_id THEN
      SELECT name INTO v_old_dept_name FROM departments WHERE id = OLD.department_id;
      SELECT name INTO v_new_dept_name FROM departments WHERE id = NEW.department_id;
      
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category,
        performed_by_id, performed_by_name, performed_by_role,
        field_changed, old_value, new_value, batch_id
      ) VALUES (
        NEW.id, 'field_updated', 'modification',
        v_user_id, v_user_name, v_user_role,
        'department', COALESCE(v_old_dept_name, 'None'), COALESCE(v_new_dept_name, 'None'), v_batch_id
      );
    END IF;
    
    -- Role change (resolve to name)
    IF OLD.role_id IS DISTINCT FROM NEW.role_id THEN
      SELECT name INTO v_old_role_name FROM roles WHERE id = OLD.role_id;
      SELECT name INTO v_new_role_name FROM roles WHERE id = NEW.role_id;
      
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category,
        performed_by_id, performed_by_name, performed_by_role,
        field_changed, old_value, new_value, batch_id
      ) VALUES (
        NEW.id, 'field_updated', 'modification',
        v_user_id, v_user_name, v_user_role,
        'role', COALESCE(v_old_role_name, 'None'), COALESCE(v_new_role_name, 'None'), v_batch_id
      );
    END IF;
    
    -- Employee assignment (resolve to name)
    IF OLD.assigned_employee_id IS DISTINCT FROM NEW.assigned_employee_id THEN
      SELECT first_name || ' ' || last_name INTO v_old_emp_name FROM employees WHERE id = OLD.assigned_employee_id;
      SELECT first_name || ' ' || last_name INTO v_new_emp_name FROM employees WHERE id = NEW.assigned_employee_id;
      
      v_event_type := CASE 
        WHEN NEW.assigned_employee_id IS NOT NULL THEN 'employee_assigned' 
        ELSE 'employee_unassigned' 
      END;
      
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category,
        performed_by_id, performed_by_name, performed_by_role,
        field_changed, old_value, new_value, batch_id
      ) VALUES (
        NEW.id, v_event_type, 'assignment',
        v_user_id, v_user_name, v_user_role,
        'assigned_employee', COALESCE(v_old_emp_name, 'Unassigned'), COALESCE(v_new_emp_name, 'Unassigned'), v_batch_id
      );
    END IF;
    
    -- Start time change
    IF OLD.start_time IS DISTINCT FROM NEW.start_time THEN
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category,
        performed_by_id, performed_by_name, performed_by_role,
        field_changed, old_value, new_value, batch_id
      ) VALUES (
        NEW.id, 'field_updated', 'modification',
        v_user_id, v_user_name, v_user_role,
        'start_time', OLD.start_time, NEW.start_time, v_batch_id
      );
    END IF;
    
    -- End time change
    IF OLD.end_time IS DISTINCT FROM NEW.end_time THEN
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category,
        performed_by_id, performed_by_name, performed_by_role,
        field_changed, old_value, new_value, batch_id
      ) VALUES (
        NEW.id, 'field_updated', 'modification',
        v_user_id, v_user_name, v_user_role,
        'end_time', OLD.end_time, NEW.end_time, v_batch_id
      );
    END IF;
    
    -- Shift date change
    IF OLD.shift_date IS DISTINCT FROM NEW.shift_date THEN
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category,
        performed_by_id, performed_by_name, performed_by_role,
        field_changed, old_value, new_value, batch_id
      ) VALUES (
        NEW.id, 'field_updated', 'modification',
        v_user_id, v_user_name, v_user_role,
        'shift_date', OLD.shift_date::text, NEW.shift_date::text, v_batch_id
      );
    END IF;
    
    -- Notes change
    IF OLD.notes IS DISTINCT FROM NEW.notes THEN
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category,
        performed_by_id, performed_by_name, performed_by_role,
        field_changed, old_value, new_value, batch_id
      ) VALUES (
        NEW.id, 'field_updated', 'modification',
        v_user_id, v_user_name, v_user_role,
        'notes', COALESCE(OLD.notes, ''), COALESCE(NEW.notes, ''), v_batch_id
      );
    END IF;
    
    -- Bidding status
    IF OLD.is_on_bidding IS DISTINCT FROM NEW.is_on_bidding THEN
      v_event_type := CASE WHEN NEW.is_on_bidding THEN 'pushed_to_bidding' ELSE 'removed_from_bidding' END;
      
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category,
        performed_by_id, performed_by_name, performed_by_role, batch_id
      ) VALUES (
        NEW.id, v_event_type, 'bidding',
        v_user_id, v_user_name, v_user_role, v_batch_id
      );
    END IF;
    
    -- Published status
    IF OLD.is_published IS DISTINCT FROM NEW.is_published THEN
      v_event_type := CASE WHEN NEW.is_published THEN 'published' ELSE 'unpublished' END;
      
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category,
        performed_by_id, performed_by_name, performed_by_role, batch_id
      ) VALUES (
        NEW.id, v_event_type, 'status',
        v_user_id, v_user_name, v_user_role, v_batch_id
      );
    END IF;
    
    -- Draft status
    IF OLD.is_draft IS DISTINCT FROM NEW.is_draft THEN
      v_event_type := CASE WHEN NEW.is_draft THEN 'unpublished' ELSE 'published' END;
      
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category,
        performed_by_id, performed_by_name, performed_by_role,
        field_changed, old_value, new_value, batch_id
      ) VALUES (
        NEW.id, 'status_changed', 'status',
        v_user_id, v_user_name, v_user_role,
        'is_draft', OLD.is_draft::text, NEW.is_draft::text, v_batch_id
      );
    END IF;
    
  -- SKIP DELETE LOGGING - The cascade will delete audit events anyway
  -- and trying to insert with the deleted shift_id causes FK violations.
  -- Deletion events are tracked via the shift_deleted_log table instead.
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger for INSERT and UPDATE only (not DELETE)
CREATE TRIGGER shift_audit_trigger
  AFTER INSERT OR UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION log_shift_changes();

-- Create a separate log table for deleted shifts that doesn't have FK constraint
CREATE TABLE IF NOT EXISTS shift_deleted_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL,
  deleted_by_id uuid,
  deleted_by_name text DEFAULT 'System',
  shift_data jsonb NOT NULL,
  deleted_at timestamptz DEFAULT now()
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_shift_deleted_log_shift_id ON shift_deleted_log(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_deleted_log_deleted_at ON shift_deleted_log(deleted_at DESC);

-- RLS
ALTER TABLE shift_deleted_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view deleted shifts" ON shift_deleted_log;
CREATE POLICY "Authenticated users can view deleted shifts" 
  ON shift_deleted_log FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can log deletions" ON shift_deleted_log;
CREATE POLICY "Authenticated users can log deletions" 
  ON shift_deleted_log FOR INSERT TO authenticated WITH CHECK (true);

-- Create a BEFORE DELETE trigger to log deletions
CREATE OR REPLACE FUNCTION log_shift_deletion()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id uuid;
  v_user_name text := 'System';
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NOT NULL THEN
    SELECT COALESCE(e.first_name || ' ' || e.last_name, 'Unknown User')
    INTO v_user_name
    FROM user_profiles up
    LEFT JOIN employees e ON up.employee_id = e.id
    WHERE up.id = v_user_id;
  END IF;
  
  INSERT INTO shift_deleted_log (shift_id, deleted_by_id, deleted_by_name, shift_data)
  VALUES (OLD.id, v_user_id, v_user_name, to_jsonb(OLD));
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS shift_deletion_log_trigger ON shifts;
CREATE TRIGGER shift_deletion_log_trigger
  BEFORE DELETE ON shifts
  FOR EACH ROW EXECUTE FUNCTION log_shift_deletion();
