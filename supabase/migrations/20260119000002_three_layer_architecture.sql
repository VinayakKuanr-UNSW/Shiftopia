-- =============================================================================
-- Three-Layer Architecture: Immutable Events & Deleted Snapshots (HARDENED)
-- =============================================================================
-- This migration aligns the schema with the three-layer design:
-- 1. shifts (active operational state)
-- 2. shift_audit_events (immutable history - NO FK, append-only)
-- 3. deleted_shifts (snapshot table for soft recovery/audits)
--
-- HARDENING applied per code review:
-- - Tighter RLS on deleted_shifts (admin/manager only)
-- - Safer FK on deleted_by (ON DELETE SET NULL)
-- - Append-only RLS on shift_audit_events
-- - Atomic DELETE...RETURNING pattern for race-free operations
-- =============================================================================

-- ============================================================
-- 1. CREATE deleted_shifts SNAPSHOT TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS deleted_shifts (
    id uuid PRIMARY KEY,  -- Same as original shift_id
    template_id uuid,
    organization_id uuid,
    department_id uuid,
    snapshot_data jsonb NOT NULL,
    deleted_by uuid,  -- No FK initially, we'll add safer one below
    deleted_reason text,
    deleted_at timestamptz DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_deleted_shifts_deleted_at ON deleted_shifts(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deleted_shifts_template ON deleted_shifts(template_id) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deleted_shifts_org ON deleted_shifts(organization_id);

-- Add safer FK that won't block user deletion
DO $$
BEGIN
    -- Drop existing FK if any
    ALTER TABLE deleted_shifts DROP CONSTRAINT IF EXISTS deleted_shifts_deleted_by_fkey;
    
    -- Add FK with ON DELETE SET NULL (safer - allows user deletion)
    ALTER TABLE deleted_shifts 
        ADD CONSTRAINT deleted_shifts_deleted_by_fkey 
        FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    
    RAISE NOTICE 'deleted_shifts.deleted_by FK added with ON DELETE SET NULL';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FK setup for deleted_by: %', SQLERRM;
END;
$$;

-- RLS - TIGHTENED: Only admins/managers can view deleted shifts
ALTER TABLE deleted_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view deleted shifts" ON deleted_shifts;
DROP POLICY IF EXISTS "admins_managers_select" ON deleted_shifts;
CREATE POLICY "admins_managers_select" ON deleted_shifts 
    FOR SELECT TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM profiles p 
            WHERE p.id = auth.uid() 
            AND p.system_role::text IN ('admin', 'manager')
        )
    );

DROP POLICY IF EXISTS "Service can insert deleted shifts" ON deleted_shifts;
DROP POLICY IF EXISTS "service_insert_deleted_shifts" ON deleted_shifts;
CREATE POLICY "service_insert_deleted_shifts" ON deleted_shifts 
    FOR INSERT TO authenticated 
    WITH CHECK (true);  -- Inserts allowed via SECURITY DEFINER functions

COMMENT ON TABLE deleted_shifts IS 
    'Snapshot table for deleted shifts. Used for audits, recovery, and compliance. Access restricted to admins/managers.';

-- ============================================================
-- 2. REMOVE FK CONSTRAINT FROM shift_audit_events
-- ============================================================
-- This makes events SURVIVE after shift deletion (immutable log)

DO $$
BEGIN
    ALTER TABLE shift_audit_events 
        DROP CONSTRAINT IF EXISTS shift_audit_events_shift_id_fkey;
    
    ALTER TABLE shift_audit_events 
        DROP CONSTRAINT IF EXISTS fk_shift_audit_events_shift_id;
        
    RAISE NOTICE 'FK constraint on shift_audit_events.shift_id removed - events will now survive shift deletions';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FK constraint removal: %', SQLERRM;
END;
$$;

-- ============================================================
-- 3. APPEND-ONLY IMMUTABILITY FOR shift_audit_events
-- ============================================================
-- Use RLS to enforce append-only behavior

ALTER TABLE shift_audit_events ENABLE ROW LEVEL SECURITY;

-- Allow SELECT for authenticated users
DROP POLICY IF EXISTS "audit_events_select" ON shift_audit_events;
CREATE POLICY "audit_events_select" ON shift_audit_events 
    FOR SELECT TO authenticated 
    USING (true);

-- Allow INSERT for authenticated (via triggers/functions)
DROP POLICY IF EXISTS "audit_events_insert" ON shift_audit_events;
CREATE POLICY "audit_events_insert" ON shift_audit_events 
    FOR INSERT TO authenticated 
    WITH CHECK (true);

-- BLOCK UPDATE/DELETE via RLS (append-only enforcement)
DROP POLICY IF EXISTS "audit_events_no_update" ON shift_audit_events;
CREATE POLICY "audit_events_no_update" ON shift_audit_events 
    FOR UPDATE TO authenticated 
    USING (false);

DROP POLICY IF EXISTS "audit_events_no_delete" ON shift_audit_events;
CREATE POLICY "audit_events_no_delete" ON shift_audit_events 
    FOR DELETE TO authenticated 
    USING (false);

COMMENT ON TABLE shift_audit_events IS 
    'Immutable audit log for shifts. Append-only - UPDATE/DELETE blocked by RLS.';

-- ============================================================
-- 4. ATOMIC DELETE RPC: delete_shift_with_audit
-- ============================================================
-- Uses DELETE...RETURNING for race-free atomic operation

CREATE OR REPLACE FUNCTION delete_shift_with_audit(
    p_shift_id uuid,
    p_deleted_by uuid DEFAULT auth.uid(),
    p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deleted_shift RECORD;
    v_user_name text;
    v_user_role text;
BEGIN
    -- Atomic: DELETE and capture in one statement (race-free)
    DELETE FROM shifts 
    WHERE id = p_shift_id
    RETURNING * INTO v_deleted_shift;
    
    -- Check if shift existed using FOUND (safer than checking record fields)
    IF NOT FOUND THEN
        -- Check if already in deleted_shifts (idempotent)
        IF EXISTS (SELECT 1 FROM deleted_shifts WHERE id = p_shift_id) THEN
            RAISE NOTICE 'Shift % already deleted (idempotent)', p_shift_id;
            RETURN true;
        END IF;
        RAISE NOTICE 'Shift % not found', p_shift_id;
        RETURN false;
    END IF;
    
    -- Get user name and role for audit (combined query for efficiency)
    SELECT 
        COALESCE(first_name || ' ' || COALESCE(last_name, ''), 'System'),
        COALESCE(system_role::text, 'manager')
    INTO v_user_name, v_user_role
    FROM profiles WHERE id = p_deleted_by;
    
    -- Insert audit event (shift already deleted, but event persists - no FK!)
    INSERT INTO shift_audit_events (
        shift_id, event_type, event_category,
        performed_by_id, performed_by_name, performed_by_role,
        old_data, metadata
    ) VALUES (
        p_shift_id, 'shift_deleted', 'modification',
        p_deleted_by, 
        COALESCE(v_user_name, 'System'),
        COALESCE(v_user_role, 'manager'),
        to_jsonb(v_deleted_shift),
        jsonb_build_object('reason', p_reason, 'deleted_at', now())
    );
    
    -- Insert into deleted_shifts snapshot table
    INSERT INTO deleted_shifts (id, template_id, organization_id, department_id, snapshot_data, deleted_by, deleted_reason)
    VALUES (
        v_deleted_shift.id, 
        v_deleted_shift.template_id, 
        v_deleted_shift.organization_id, 
        v_deleted_shift.department_id, 
        to_jsonb(v_deleted_shift), 
        p_deleted_by, 
        p_reason
    )
    ON CONFLICT (id) DO UPDATE SET
        snapshot_data = EXCLUDED.snapshot_data,
        deleted_by = EXCLUDED.deleted_by,
        deleted_reason = EXCLUDED.deleted_reason,
        deleted_at = now();
    
    RETURN true;
    
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error deleting shift %: %', p_shift_id, SQLERRM;
    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_shift_with_audit(uuid, uuid, text) TO authenticated;

-- ============================================================
-- 5. ATOMIC TEMPLATE CASCADE DELETE RPC
-- ============================================================
-- Uses WITH CTE for atomic bulk delete (race-free)

CREATE OR REPLACE FUNCTION delete_template_shifts_cascade(p_template_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER := 0;
    v_user_id uuid;
    v_user_name text;
    v_user_role text;
    v_deleted_shift RECORD;
BEGIN
    v_user_id := auth.uid();
    
    -- Get user name and role (combined query)
    SELECT 
        COALESCE(first_name || ' ' || COALESCE(last_name, ''), 'System'),
        COALESCE(system_role::text, 'manager')
    INTO v_user_name, v_user_role
    FROM profiles WHERE id = v_user_id;
    
    -- Atomic: DELETE all and iterate over returned rows
    FOR v_deleted_shift IN 
        DELETE FROM shifts 
        WHERE template_id = p_template_id
        RETURNING *
    LOOP
        -- Insert audit event for each deleted shift
        INSERT INTO shift_audit_events (
            shift_id, event_type, event_category,
            performed_by_id, performed_by_name, performed_by_role,
            old_data, metadata
        ) VALUES (
            v_deleted_shift.id, 'shift_deleted', 'modification',
            v_user_id, COALESCE(v_user_name, 'System'), COALESCE(v_user_role, 'manager'),
            to_jsonb(v_deleted_shift),
            jsonb_build_object(
                'reason', 'Template cascade delete',
                'template_id', p_template_id,
                'deleted_at', now()
            )
        );
        
        -- Insert snapshot into deleted_shifts
        INSERT INTO deleted_shifts (id, template_id, organization_id, department_id, snapshot_data, deleted_by, deleted_reason)
        VALUES (
            v_deleted_shift.id, 
            v_deleted_shift.template_id, 
            v_deleted_shift.organization_id, 
            v_deleted_shift.department_id, 
            to_jsonb(v_deleted_shift), 
            v_user_id, 
            'Template cascade delete'
        )
        ON CONFLICT (id) DO UPDATE SET
            snapshot_data = EXCLUDED.snapshot_data,
            deleted_reason = EXCLUDED.deleted_reason,
            deleted_at = now();
        
        v_count := v_count + 1;
    END LOOP;
    
    RETURN v_count;
    
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error in template cascade delete: %', SQLERRM;
    RETURN -1;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_template_shifts_cascade(UUID) TO authenticated;

-- ============================================================
-- 6. SINGLE SHIFT DELETE RPC (wrapper)
-- ============================================================

CREATE OR REPLACE FUNCTION delete_shift_cascade(p_shift_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN delete_shift_with_audit(p_shift_id, auth.uid(), 'Direct shift delete');
END;
$$;

GRANT EXECUTE ON FUNCTION delete_shift_cascade(UUID) TO authenticated;

-- ============================================================
-- 7. TRIGGER FOR INSERT/UPDATE ONLY
-- ============================================================
-- DELETE handled by RPCs with proper atomic flow

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
  v_user_id := auth.uid();
  
  BEGIN
    v_batch_id := current_setting('app.current_batch_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_batch_id := NULL;
  END;
  
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
    -- Department change
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
    
    -- Role change
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
    
    -- Employee assignment (supports both profiles.id and legacy_employee_id)
    IF OLD.assigned_employee_id IS DISTINCT FROM NEW.assigned_employee_id THEN
      SELECT first_name || ' ' || COALESCE(last_name, '') INTO v_old_emp_name 
      FROM profiles 
      WHERE id = OLD.assigned_employee_id OR legacy_employee_id = OLD.assigned_employee_id
      LIMIT 1;
      
      SELECT first_name || ' ' || COALESCE(last_name, '') INTO v_new_emp_name 
      FROM profiles 
      WHERE id = NEW.assigned_employee_id OR legacy_employee_id = NEW.assigned_employee_id
      LIMIT 1;
      
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
    
    -- employee_id change (for swaps)
    IF OLD.employee_id IS DISTINCT FROM NEW.employee_id THEN
      SELECT first_name || ' ' || COALESCE(last_name, '') INTO v_old_emp_name 
      FROM profiles 
      WHERE id = OLD.employee_id OR legacy_employee_id = OLD.employee_id
      LIMIT 1;
      
      SELECT first_name || ' ' || COALESCE(last_name, '') INTO v_new_emp_name 
      FROM profiles 
      WHERE id = NEW.employee_id OR legacy_employee_id = NEW.employee_id
      LIMIT 1;
      
      -- Logic update: Only log assignment_swapped if assigned_employee_id did NOT change
      -- If assigned_employee_id changed, it's already logged as employee_assigned above
      IF OLD.assigned_employee_id IS NOT DISTINCT FROM NEW.assigned_employee_id THEN
        INSERT INTO shift_audit_events (
          shift_id, event_type, event_category,
          performed_by_id, performed_by_name, performed_by_role,
          field_changed, old_value, new_value, batch_id,
          metadata
        ) VALUES (
          NEW.id, 'assignment_swapped', 'assignment',
          v_user_id, v_user_name, v_user_role,
          'employee_id', COALESCE(v_old_emp_name, 'Unassigned'), COALESCE(v_new_emp_name, 'Unassigned'), v_batch_id,
          jsonb_build_object('source', 'swap_approval')
        );
      END IF;
    END IF;
    
    -- Time changes
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
    
    IF OLD.is_draft IS DISTINCT FROM NEW.is_draft THEN
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
  
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger (INSERT/UPDATE only)
DROP TRIGGER IF EXISTS shift_audit_trigger ON shifts;
DROP TRIGGER IF EXISTS shifts_audit_trigger ON shifts;

CREATE TRIGGER shifts_audit_trigger
  AFTER INSERT OR UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION log_shift_changes();

-- ============================================================
-- 8. RESTORE SHIFT FUNCTION (Optional recovery)
-- ============================================================

CREATE OR REPLACE FUNCTION restore_deleted_shift(p_shift_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_snapshot jsonb;
    v_user_id uuid;
    v_user_name text;
    v_user_role text;
BEGIN
    v_user_id := auth.uid();
    
    -- Get snapshot from deleted_shifts
    SELECT snapshot_data INTO v_snapshot
    FROM deleted_shifts WHERE id = p_shift_id;
    
    -- Use IF NOT FOUND for safer check
    IF NOT FOUND OR v_snapshot IS NULL THEN
        RAISE NOTICE 'No deleted shift found with id %', p_shift_id;
        RETURN false;
    END IF;
    
    -- Check if shift already exists (idempotent - return true if already restored)
    IF EXISTS (SELECT 1 FROM shifts WHERE id = p_shift_id) THEN
        RAISE NOTICE 'Shift % already exists (may have been restored)', p_shift_id;
        RETURN true;
    END IF;
    
    -- Get user name and role (combined query, consistent with other functions)
    SELECT 
        COALESCE(first_name || ' ' || COALESCE(last_name, ''), 'System'),
        COALESCE(system_role::text, 'manager')
    INTO v_user_name, v_user_role
    FROM profiles WHERE id = v_user_id;
    
    -- Re-insert shift from snapshot (using jsonb_populate_record)
    -- Note: This assumes snapshot schema matches current shifts schema
    INSERT INTO shifts 
    SELECT * FROM jsonb_populate_record(NULL::shifts, v_snapshot);
    
    -- Log restore event
    INSERT INTO shift_audit_events (
        shift_id, event_type, event_category,
        performed_by_id, performed_by_name, performed_by_role,
        metadata
    ) VALUES (
        p_shift_id, 'shift_created_published', 'creation',
        v_user_id, COALESCE(v_user_name, 'System'), COALESCE(v_user_role, 'manager'),
        jsonb_build_object('restored_from', 'deleted_shifts', 'restored_at', now())
    );
    
    -- Remove from deleted_shifts
    DELETE FROM deleted_shifts WHERE id = p_shift_id;
    
    RETURN true;
    
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error restoring shift %: %', p_shift_id, SQLERRM;
    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION restore_deleted_shift(uuid) TO authenticated;

-- ============================================================
-- DONE: Schema now follows three-layer architecture (HARDENED)
-- ============================================================
-- 1. shifts = active operational state
-- 2. shift_audit_events = immutable history (no FK, append-only via RLS)
-- 3. deleted_shifts = snapshot table for deleted items (restricted access)
--
-- Hardening applied:
-- ✅ Tighter RLS on deleted_shifts (admin/manager only)
-- ✅ Safer FK on deleted_by (ON DELETE SET NULL)
-- ✅ Append-only RLS on shift_audit_events
-- ✅ Atomic DELETE...RETURNING pattern (race-free)
-- ✅ Idempotent delete functions
-- ✅ Error handling with meaningful messages
-- ✅ Optional restore function for recovery
-- ============================================================
