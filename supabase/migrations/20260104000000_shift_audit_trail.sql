/*
  Shift Audit Trail System
  
  Creates comprehensive audit logging for shifts with:
  - Human-readable value resolution (names, not UUIDs)
  - Batch ID support for bulk operations
  - System actor handling (cron, AI scheduler)
  - Archive table for 7-year compliance retention
*/

-- ============================================================
-- 1. CREATE SHIFT_AUDIT_EVENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_category text NOT NULL,
  
  -- Actor identification
  performed_by_id uuid REFERENCES auth.users(id),
  performed_by_name text NOT NULL DEFAULT 'System',
  performed_by_role text NOT NULL DEFAULT 'system_automation',
  
  -- Change tracking (HUMAN-READABLE values, not UUIDs)
  field_changed text,
  old_value text,
  new_value text,
  old_data jsonb,
  new_data jsonb,
  
  -- Bulk operation support
  batch_id uuid,
  
  -- Metadata
  metadata jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz DEFAULT now(),
  
  CONSTRAINT valid_event_type CHECK (event_type IN (
    'shift_created_draft', 'shift_created_published',
    'field_updated', 'bulk_update', 'manual_adjustment',
    'status_changed', 'published', 'unpublished',
    'pushed_to_bidding', 'removed_from_bidding',
    'bid_submitted', 'bid_withdrawn', 'bid_accepted', 'bid_rejected',
    'employee_assigned', 'employee_unassigned', 'assignment_swapped',
    'checked_in', 'checked_out', 'no_show_recorded',
    'shift_completed', 'shift_cancelled', 'shift_deleted'
  )),
  
  CONSTRAINT valid_performed_by_role CHECK (performed_by_role IN (
    'manager', 'employee', 'admin', 'system_automation', 'cron_job', 'ai_scheduler'
  )),
  
  CONSTRAINT valid_event_category CHECK (event_category IN (
    'creation', 'modification', 'bidding', 'status', 'assignment', 'attendance'
  ))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shift_audit_shift_id ON shift_audit_events(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_audit_event_type ON shift_audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_shift_audit_created_at ON shift_audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_audit_batch_id ON shift_audit_events(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shift_audit_performed_by ON shift_audit_events(performed_by_id);
CREATE INDEX IF NOT EXISTS idx_shift_audit_category ON shift_audit_events(event_category);

-- ============================================================
-- 2. CREATE ARCHIVE TABLE (Same Schema)
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_audit_events_archive (
  id uuid PRIMARY KEY,
  shift_id uuid NOT NULL,
  event_type text NOT NULL,
  event_category text NOT NULL,
  performed_by_id uuid,
  performed_by_name text NOT NULL DEFAULT 'System',
  performed_by_role text NOT NULL DEFAULT 'system_automation',
  field_changed text,
  old_value text,
  new_value text,
  old_data jsonb,
  new_data jsonb,
  batch_id uuid,
  metadata jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_archive_shift_id ON shift_audit_events_archive(shift_id);
CREATE INDEX IF NOT EXISTS idx_archive_created_at ON shift_audit_events_archive(created_at DESC);

-- ============================================================
-- 3. ENABLE RLS
-- ============================================================

ALTER TABLE shift_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_audit_events_archive ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Authenticated users can view shift audit" ON shift_audit_events;
CREATE POLICY "Authenticated users can view shift audit" 
  ON shift_audit_events FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "System can create shift audit" ON shift_audit_events;
CREATE POLICY "System can create shift audit" 
  ON shift_audit_events FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can view shift audit archive" ON shift_audit_events_archive;
CREATE POLICY "Authenticated users can view shift audit archive" 
  ON shift_audit_events_archive FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 4. CREATE SET_BATCH_ID RPC FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION set_batch_id(batch_id uuid)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_batch_id', batch_id::text, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. CREATE SHIFT AUDIT TRIGGER FUNCTION
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

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS shift_audit_trigger ON shifts;
CREATE TRIGGER shift_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON shifts
  FOR EACH ROW EXECUTE FUNCTION log_shift_changes();

-- ============================================================
-- 6. CREATE BID AUDIT TRIGGER FUNCTION
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
  
  -- Get employee name
  SELECT COALESCE(e.first_name || ' ' || e.last_name, 'Unknown')
  INTO v_user_name
  FROM employees e 
  WHERE e.id = COALESCE(NEW.employee_id, OLD.employee_id);

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
    -- Get manager name instead
    SELECT COALESCE(e.first_name || ' ' || e.last_name, 'Manager')
    INTO v_user_name
    FROM user_profiles up
    LEFT JOIN employees e ON up.employee_id = e.id
    WHERE up.id = v_user_id;
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

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS bid_audit_trigger ON shift_bids;
CREATE TRIGGER bid_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON shift_bids
  FOR EACH ROW EXECUTE FUNCTION log_bid_changes();

-- ============================================================
-- 7. CREATE ARCHIVE JOB FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION archive_old_audit_events()
RETURNS void AS $$
BEGIN
  -- Move events older than 90 days to archive
  INSERT INTO shift_audit_events_archive
  SELECT * FROM shift_audit_events
  WHERE created_at < NOW() - INTERVAL '90 days';
  
  -- Delete archived events from main table
  DELETE FROM shift_audit_events
  WHERE created_at < NOW() - INTERVAL '90 days';
  
  -- Purge archive older than 7 years (for compliance)
  DELETE FROM shift_audit_events_archive
  WHERE created_at < NOW() - INTERVAL '7 years';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
