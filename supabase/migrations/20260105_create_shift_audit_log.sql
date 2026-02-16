-- Create shift_audit_log table to track all shift lifecycle events
CREATE TABLE IF NOT EXISTS shift_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    performed_by UUID REFERENCES auth.users(id),
    performed_by_name TEXT,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    old_data JSONB,
    new_data JSONB,
    changes JSONB,
    notes TEXT,
    metadata JSONB
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_shift_audit_log_shift_id ON shift_audit_log(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_audit_log_performed_at ON shift_audit_log(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_audit_log_event_type ON shift_audit_log(event_type);

-- Enable RLS
ALTER TABLE shift_audit_log ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can view all audit logs
CREATE POLICY "Authenticated users can view audit logs" ON shift_audit_log
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- Function to log shift changes
CREATE OR REPLACE FUNCTION log_shift_change()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
    v_changes JSONB := '{}';
    v_user_name TEXT;
BEGIN
    -- Determine event type
    IF TG_OP = 'INSERT' THEN
        v_event_type := 'created';
    ELSIF TG_OP = 'UPDATE' THEN
        -- Determine specific update type
        IF OLD.assigned_employee_id IS NULL AND NEW.assigned_employee_id IS NOT NULL THEN
            v_event_type := 'assigned';
        ELSIF OLD.assigned_employee_id IS NOT NULL AND NEW.assigned_employee_id IS NULL THEN
            v_event_type := 'unassigned';
        ELSIF OLD.is_on_bidding = FALSE AND NEW.is_on_bidding = TRUE THEN
            v_event_type := 'pushed_to_bidding';
        ELSIF OLD.is_on_bidding = TRUE AND NEW.is_on_bidding = FALSE THEN
            v_event_type := 'pulled_from_bidding';
        ELSIF OLD.is_published = FALSE AND NEW.is_published = TRUE THEN
            v_event_type := 'published';
        ELSIF OLD.is_cancelled <> NEW.is_cancelled THEN
            v_event_type := CASE WHEN NEW.is_cancelled THEN 'cancelled' ELSE 'uncancelled' END;
        ELSE
            v_event_type := 'updated';
        END IF;
        
        -- Build changes object
        v_changes := jsonb_build_object(
            'assigned_employee_id', jsonb_build_object('old', OLD.assigned_employee_id, 'new', NEW.assigned_employee_id),
            'is_on_bidding', jsonb_build_object('old', OLD.is_on_bidding, 'new', NEW.is_on_bidding),
            'is_published', jsonb_build_object('old', OLD.is_published, 'new', NEW.is_published),
            'is_cancelled', jsonb_build_object('old', OLD.is_cancelled, 'new', NEW.is_cancelled)
        );
    ELSIF TG_OP = 'DELETE' THEN
        v_event_type := 'deleted';
    END IF;

    -- Get user name
    SELECT COALESCE(full_name, email, 'System') INTO v_user_name
    FROM auth.users
    WHERE id = auth.uid();

    -- Insert audit log
    INSERT INTO shift_audit_log (
        shift_id,
        event_type,
        performed_by,
        performed_by_name,
        old_data,
        new_data,
        changes
    ) VALUES (
        COALESCE(NEW.id, OLD.id),
        v_event_type,
        auth.uid(),
        v_user_name,
        CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(OLD) END,
        CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
        v_changes
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
COMMENT ON TABLE shift_audit_log IS 'Tracks all changes to shifts including creation, assignment, bidding, and deletion';

