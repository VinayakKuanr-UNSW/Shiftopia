-- Migration: Fix Broken system_role References
-- Date: 2026-02-05
-- Purpose: Update functions to use legacy_system_role or certificates instead of deprecated system_role

-- 1. FIX auth_can_manage_templates
-- Allow Epsilon, Delta, Gamma, or legacy Admin/Manager
CREATE OR REPLACE FUNCTION public.auth_can_manage_templates()
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $$
BEGIN
  -- Check for High-Level Certificates
  IF EXISTS (
    SELECT 1 FROM app_access_certificates
    WHERE user_id = auth.uid()
    AND access_level IN ('gamma', 'delta', 'epsilon')
  ) THEN
    RETURN TRUE;
  END IF;

  -- Fallback to Legacy System Role
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND legacy_system_role IN ('admin', 'manager')
  );
END;
$$;

-- 2. FIX log_shift_changes (Audit Trigger)
-- Update to use legacy_system_role for logging
CREATE OR REPLACE FUNCTION public.log_shift_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id uuid;
  v_user_name text := 'System';
  v_user_role text := 'system_automation';
  v_batch_id uuid;
  v_event_type text;
  -- Additional vars for field resolution
  v_old_dept_name text;
  v_new_dept_name text;
  v_old_role_name text;
  v_new_role_name text;
  v_old_emp_name text;
  v_new_emp_name text;
BEGIN
  v_user_id := auth.uid();
  
  BEGIN
    v_batch_id := current_setting('app.current_batch_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_batch_id := NULL;
  END;
  
  IF v_user_id IS NOT NULL THEN
    SELECT 
      COALESCE(p.first_name || ' ' || COALESCE(p.last_name, ''), 'Unknown User'),
      COALESCE(p.legacy_system_role::text, 'manager')
    INTO v_user_name, v_user_role
    FROM profiles p
    WHERE p.id = v_user_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_event_type := CASE WHEN NEW.is_draft THEN 'shift_created_draft' ELSE 'shift_created_published' END;
    INSERT INTO shift_audit_events (
      shift_id, event_type, event_category, 
      performed_by_id, performed_by_name, performed_by_role, new_data, batch_id
    ) VALUES (
      NEW.id, v_event_type, 'creation',
      v_user_id, v_user_name, v_user_role, to_jsonb(NEW), v_batch_id
    );
  ELSIF TG_OP = 'UPDATE' THEN
    
    -- Assignment Change
    IF OLD.assigned_employee_id IS DISTINCT FROM NEW.assigned_employee_id THEN
       SELECT first_name || ' ' || COALESCE(last_name, '') INTO v_old_emp_name FROM profiles WHERE id = OLD.assigned_employee_id;
       SELECT first_name || ' ' || COALESCE(last_name, '') INTO v_new_emp_name FROM profiles WHERE id = NEW.assigned_employee_id;

      IF NEW.assigned_employee_id IS NULL THEN
        INSERT INTO shift_audit_events (
          shift_id, event_type, event_category, field_changed, old_value, new_value, performed_by_id, performed_by_name, performed_by_role, batch_id
        ) VALUES (
          NEW.id, 'employee_unassigned', 'assignment', 'assigned_employee_id', COALESCE(v_old_emp_name, 'Unassigned'), 'Unassigned', v_user_id, v_user_name, v_user_role, v_batch_id
        );
      ELSE
         INSERT INTO shift_audit_events (
          shift_id, event_type, event_category, field_changed, old_value, new_value, performed_by_id, performed_by_name, performed_by_role, batch_id
        ) VALUES (
          NEW.id, 'employee_assigned', 'assignment', 'assigned_employee_id', COALESCE(v_old_emp_name, 'Unassigned'), COALESCE(v_new_emp_name, 'Unknown'), v_user_id, v_user_name, v_user_role, v_batch_id
        );
      END IF;
    END IF;

    -- Time Changes
    IF OLD.start_time IS DISTINCT FROM NEW.start_time OR OLD.end_time IS DISTINCT FROM NEW.end_time OR OLD.shift_date IS DISTINCT FROM NEW.shift_date THEN
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category,
        performed_by_id, performed_by_name, performed_by_role, field_changed, old_value, new_value, batch_id
      ) VALUES (
        NEW.id, 'field_updated', 'schedule', 'time_range', 
        (OLD.shift_date || ' ' || OLD.start_time || ' - ' || OLD.end_time),
        (NEW.shift_date || ' ' || NEW.start_time || ' - ' || NEW.end_time),
         v_user_id, v_user_name, v_user_role, v_batch_id
      );
    END IF;

    -- Notes Change
    IF OLD.notes IS DISTINCT FROM NEW.notes THEN
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category, field_changed, old_value, new_value, performed_by_id, performed_by_name, performed_by_role, batch_id
      ) VALUES (
        NEW.id, 'field_updated', 'details', 'notes', COALESCE(OLD.notes, ''), COALESCE(NEW.notes, ''), v_user_id, v_user_name, v_user_role, v_batch_id
      );
    END IF;
    
    -- Status Changes
    IF OLD.is_on_bidding IS DISTINCT FROM NEW.is_on_bidding THEN
      v_event_type := CASE WHEN NEW.is_on_bidding THEN 'pushed_to_bidding' ELSE 'removed_from_bidding' END;
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category, performed_by_id, performed_by_name, performed_by_role, batch_id
      ) VALUES (
        NEW.id, v_event_type, 'bidding', v_user_id, v_user_name, v_user_role, v_batch_id
      );
    END IF;
    
    IF OLD.is_published IS DISTINCT FROM NEW.is_published THEN
      v_event_type := CASE WHEN NEW.is_published THEN 'published' ELSE 'unpublished' END;
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category, performed_by_id, performed_by_name, performed_by_role, batch_id
      ) VALUES (
        NEW.id, v_event_type, 'status', v_user_id, v_user_name, v_user_role, v_batch_id
      );
    END IF;
    
     IF OLD.is_draft IS DISTINCT FROM NEW.is_draft THEN
      INSERT INTO shift_audit_events (
        shift_id, event_type, event_category, field_changed, old_value, new_value, performed_by_id, performed_by_name, performed_by_role, batch_id
      ) VALUES (
        NEW.id, 'status_changed', 'status', 'is_draft', OLD.is_draft::text, NEW.is_draft::text, v_user_id, v_user_name, v_user_role, v_batch_id
      );
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
      INSERT INTO shift_audit_events (
      shift_id, event_type, event_category,
      performed_by_id, performed_by_name, performed_by_role, new_data, batch_id
    ) VALUES (
      OLD.id, 'shift_deleted', 'deletion',
      v_user_id, v_user_name, v_user_role, to_jsonb(OLD), v_batch_id
    );
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
