-- =============================================================================
-- Fix Audit Triggers to Use Profiles Table
-- =============================================================================
-- The user_profiles table has been merged into profiles.
-- This migration updates all audit triggers to use the new profiles table.
-- =============================================================================

-- ============================================================
-- 1. FIX log_shift_changes FUNCTION
-- ============================================================

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
  
  -- Resolve user name and role from profiles table (formerly user_profiles)
  IF v_user_id IS NOT NULL THEN
    SELECT 
      COALESCE(p.first_name || ' ' || COALESCE(p.last_name, ''), 'Unknown User'),
      COALESCE(p.system_role::text, 'manager')
    INTO v_user_name, v_user_role
    FROM profiles p
    WHERE p.id = v_user_id;
    
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
    
    -- Employee assignment (resolve to name from profiles)
    IF OLD.assigned_employee_id IS DISTINCT FROM NEW.assigned_employee_id THEN
      SELECT first_name || ' ' || COALESCE(last_name, '') INTO v_old_emp_name FROM profiles WHERE id = OLD.assigned_employee_id;
      SELECT first_name || ' ' || COALESCE(last_name, '') INTO v_new_emp_name FROM profiles WHERE id = NEW.assigned_employee_id;
      
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

-- ============================================================
-- 2. FIX log_bid_changes FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION log_bid_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id uuid;
  v_user_name text := 'Unknown';
  v_event_type text;
  v_performer_role text := 'employee';
BEGIN
  v_user_id := auth.uid();
  
  -- Get employee name from profiles (formerly employees)
  SELECT COALESCE(p.first_name || ' ' || COALESCE(p.last_name, ''), 'Unknown')
  INTO v_user_name
  FROM profiles p 
  WHERE p.id = COALESCE(NEW.employee_id, OLD.employee_id);

  -- Determine event type
  v_event_type := CASE
    WHEN TG_OP = 'INSERT' THEN 'bid_submitted'
    WHEN TG_OP = 'DELETE' THEN 'bid_withdrawn'
    WHEN NEW.bid_status = 'accepted' AND (OLD.bid_status IS NULL OR OLD.bid_status != 'accepted') THEN 'bid_accepted'
    WHEN NEW.bid_status = 'rejected' AND (OLD.bid_status IS NULL OR OLD.bid_status != 'rejected') THEN 'bid_rejected'
    WHEN NEW.bid_status = 'withdrawn' THEN 'bid_withdrawn'
    ELSE 'field_updated'
  END;
  
  -- Manager actions
  IF v_event_type IN ('bid_accepted', 'bid_rejected') THEN
    v_performer_role := 'manager';
    -- Get manager name instead from profiles
    SELECT COALESCE(p.first_name || ' ' || COALESCE(p.last_name, ''), 'Manager')
    INTO v_user_name
    FROM profiles p
    WHERE p.id = v_user_id;
  END IF;
  
  INSERT INTO shift_audit_events (
    shift_id, event_type, event_category,
    performed_by_id, performed_by_name, performed_by_role,
    metadata
  ) VALUES (
    COALESCE(NEW.shift_id, OLD.shift_id), v_event_type, 'bidding',
    v_user_id, COALESCE(v_user_name, 'Unknown'), v_performer_role,
    jsonb_build_object(
      'bid_id', COALESCE(NEW.id, OLD.id),
      'employee_id', COALESCE(NEW.employee_id, OLD.employee_id),
      'employee_name', v_user_name,
      'bid_notes', COALESCE(NEW.notes, OLD.notes)
    )
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. FIX log_shift_change FUNCTION (alternative trigger)
-- ============================================================

CREATE OR REPLACE FUNCTION log_shift_change()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
    v_event_category TEXT;
    v_field_changed TEXT;
    v_old_value TEXT;
    v_new_value TEXT;
    v_user_name TEXT;
    v_user_role TEXT := 'system_automation';
BEGIN
    -- Determine event type and category
    IF TG_OP = 'INSERT' THEN
        v_event_type := CASE 
            WHEN NEW.is_published THEN 'shift_created_published'
            ELSE 'shift_created_draft'
        END;
        v_event_category := 'creation';
    ELSIF TG_OP = 'UPDATE' THEN
        -- Determine specific update type
        IF OLD.assigned_employee_id IS NULL AND NEW.assigned_employee_id IS NOT NULL THEN
            v_event_type := 'employee_assigned';
            v_event_category := 'assignment';
            v_field_changed := 'assigned_employee';
        ELSIF OLD.assigned_employee_id IS NOT NULL AND NEW.assigned_employee_id IS NULL THEN
            v_event_type := 'employee_unassigned';
            v_event_category := 'assignment';
            v_field_changed := 'assigned_employee';
        ELSIF OLD.is_on_bidding = FALSE AND NEW.is_on_bidding = TRUE THEN
            v_event_type := 'pushed_to_bidding';
            v_event_category := 'bidding';
            v_field_changed := 'is_on_bidding';
            v_old_value := 'false';
            v_new_value := 'true';
        ELSIF OLD.is_on_bidding = TRUE AND NEW.is_on_bidding = FALSE THEN
            v_event_type := 'removed_from_bidding';
            v_event_category := 'bidding';
            v_field_changed := 'is_on_bidding';
            v_old_value := 'true';
            v_new_value := 'false';
        ELSIF OLD.is_published = FALSE AND NEW.is_published = TRUE THEN
            v_event_type := 'published';
            v_event_category := 'status';
            v_field_changed := 'is_published';
            v_old_value := 'false';
            v_new_value := 'true';
        ELSIF OLD.is_cancelled <> NEW.is_cancelled THEN
            v_event_type := CASE WHEN NEW.is_cancelled THEN 'shift_deleted' ELSE 'status_changed' END;
            v_event_category := 'status';
            v_field_changed := 'is_cancelled';
        ELSE
            v_event_type := 'field_updated';
            v_event_category := 'modification';
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        v_event_type := 'shift_deleted';
        v_event_category := 'status';
    END IF;

    -- Get user name and role from profiles (formerly from auth.users + user_profiles)
    SELECT COALESCE(p.first_name || ' ' || COALESCE(p.last_name, ''), 'System') INTO v_user_name
    FROM profiles p
    WHERE p.id = auth.uid();

    IF v_user_name IS NULL THEN
        v_user_name := 'System';
        v_user_role := 'system_automation';
    ELSE
        v_user_role := 'manager'; -- Default to manager for now
    END IF;

    -- Insert audit event
    INSERT INTO shift_audit_events (
        shift_id,
        event_type,
        event_category,
        performed_by_id,
        performed_by_name,
        performed_by_role,
        field_changed,
        old_value,
        new_value,
        old_data,
        new_data
    ) VALUES (
        COALESCE(NEW.id, OLD.id),
        v_event_type,
        v_event_category,
        auth.uid(),
        v_user_name,
        v_user_role,
        v_field_changed,
        v_old_value,
        v_new_value,
        CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(OLD) END,
        CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
    );

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. RECREATE TRIGGERS
-- ============================================================

-- Drop and recreate shift audit trigger
DROP TRIGGER IF EXISTS shift_audit_trigger ON shifts;
DROP TRIGGER IF EXISTS shifts_audit_trigger ON shifts;

CREATE TRIGGER shift_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON shifts
  FOR EACH ROW EXECUTE FUNCTION log_shift_changes();

-- Recreate bid audit trigger if shift_bids table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shift_bids') THEN
    DROP TRIGGER IF EXISTS bid_audit_trigger ON shift_bids;
    CREATE TRIGGER bid_audit_trigger
      AFTER INSERT OR UPDATE OR DELETE ON shift_bids
      FOR EACH ROW EXECUTE FUNCTION log_bid_changes();
  END IF;
END;
$$;

-- ============================================================
-- 5. ADD COMMENT
-- ============================================================

COMMENT ON FUNCTION log_shift_changes() IS 
  'Audit trigger for shifts table. Uses profiles table for user lookups (migrated from user_profiles).';
