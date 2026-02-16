-- Migration: Restore shift_audit_events table
-- Date: 2026-02-05
-- Purpose: Restore the missing shift_audit_events table required by audit triggers.

-- Create the table
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
DROP POLICY IF EXISTS "Authenticated users can view audit events" ON shift_audit_events;
CREATE POLICY "Authenticated users can view audit events" ON shift_audit_events
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- Grant permissions
GRANT SELECT ON shift_audit_events TO authenticated;
GRANT INSERT ON shift_audit_events TO authenticated; -- Needed if audit is logged directly, though usually via trigger/SEC_DEFINER
GRANT ALL ON shift_audit_events TO service_role;

-- Comment
COMMENT ON TABLE shift_audit_events IS 'Tracks all changes to shifts including creation, assignment, bidding, and deletion';
