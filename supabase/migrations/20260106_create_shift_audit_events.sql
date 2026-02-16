-- Drop the incorrectly named table
DROP TABLE IF EXISTS shift_audit_log CASCADE;
DROP FUNCTION IF EXISTS log_shift_change() CASCADE;

-- Create the correct table that matches the API
CREATE TABLE IF NOT EXISTS shift_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    event_category TEXT NOT NULL CHECK (event_category IN ('creation', 'modification', 'bidding', 'status', 'assignment', 'attendance')),
    performed_by_id UUID REFERENCES auth.users(id),
    performed_by_name TEXT NOT NULL,
    performed_by_role TEXT NOT NULL CHECK (performed_by_role IN ('manager', 'employee', 'admin', 'system_automation', 'cron_job', 'ai_scheduler')),
    field_changed TEXT,
    old_value TEXT,
    new_value TEXT,
    old_data JSONB,
    new_data JSONB,
    batch_id TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_shift_audit_events_shift_id ON shift_audit_events(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_audit_events_created_at ON shift_audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_audit_events_category ON shift_audit_events(event_category);
CREATE INDEX IF NOT EXISTS idx_shift_audit_events_batch_id ON shift_audit_events(batch_id);

-- Enable RLS
ALTER TABLE shift_audit_events ENABLE ROW LEVEL SECURITY;

-- Policy
CREATE POLICY "Authenticated users can view audit events" ON shift_audit_events
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- Function to log shift changes
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

-- Create trigger on shifts table
DROP TRIGGER IF EXISTS shifts_audit_trigger ON shifts;
CREATE TRIGGER shifts_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON shifts
    FOR EACH ROW
    EXECUTE FUNCTION log_shift_change();

-- Comment
COMMENT ON TABLE shift_audit_events IS 'Tracks all changes to shifts including creation, assignment, bidding, and deletion';
