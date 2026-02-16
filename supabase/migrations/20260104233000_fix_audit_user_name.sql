-- Update log_shift_changes to default to email if profile not found
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
  v_email text;
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
    -- Try to get email from JWT
    BEGIN
      v_email := current_setting('request.jwt.claim.email', true);
    EXCEPTION WHEN OTHERS THEN
      v_email := 'Unknown';
    END;

    SELECT 
      COALESCE(e.first_name || ' ' || e.last_name, v_email, 'Unknown User'),
      COALESCE(up.role, 'manager')
    INTO v_user_name, v_user_role
    FROM user_profiles up
    LEFT JOIN employees e ON up.employee_id = e.id
    WHERE up.id = v_user_id;
    
    -- If no profile found, fall back to email
    IF v_user_name IS NULL THEN v_user_name := COALESCE(v_email, 'Unknown User'); END IF;
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
    
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO shift_audit_events (
      shift_id, event_type, event_category,
      performed_by_id, performed_by_name, performed_by_role,
      old_data, batch_id
    ) VALUES (
      OLD.id, 'shift_deleted', 'modification',
      v_user_id, v_user_name, v_user_role,
      to_jsonb(OLD), v_batch_id
    );
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
