-- Migration: Fix audit trigger to NOT insert on DELETE
-- Date: 2026-01-10
-- Purpose: The trigger was inserting an audit event on DELETE which causes FK violation
--          because the shift_id references a row being deleted. Solution: Skip logging for DELETE.

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
    -- SKIP DELETE operations - can't insert audit record for a deleted shift (FK constraint)
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;  -- Just let the delete proceed without logging
    END IF;

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
    END IF;

    -- Get user name and role
    SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System') INTO v_user_name
    FROM auth.users
    WHERE id = auth.uid();

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
        NEW.id,
        v_event_type,
        v_event_category,
        auth.uid(),
        v_user_name,
        v_user_role,
        v_field_changed,
        v_old_value,
        v_new_value,
        to_jsonb(OLD),
        to_jsonb(NEW)
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create trigger (only for INSERT and UPDATE, not DELETE)
DROP TRIGGER IF EXISTS shifts_audit_trigger ON shifts;
CREATE TRIGGER shifts_audit_trigger
    AFTER INSERT OR UPDATE ON shifts
    FOR EACH ROW
    EXECUTE FUNCTION log_shift_change();
