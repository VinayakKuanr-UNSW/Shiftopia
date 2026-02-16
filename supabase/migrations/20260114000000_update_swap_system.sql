-- Update swap_requests table with new columns
ALTER TABLE swap_requests 
ADD COLUMN IF NOT EXISTS priority text CHECK (priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS open_swap boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id),
ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);

-- Create index for filtering by organization and department
CREATE INDEX IF NOT EXISTS idx_swap_requests_org_status ON swap_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_swap_requests_dept_status ON swap_requests(department_id, status);
CREATE INDEX IF NOT EXISTS idx_swap_requests_status_created ON swap_requests(status, created_at);

-- Create swap_audit_logs table
CREATE TABLE IF NOT EXISTS swap_audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    swap_request_id uuid NOT NULL REFERENCES swap_requests(id) ON DELETE CASCADE,
    actor_id uuid REFERENCES auth.users(id),
    previous_status text,
    new_status text,
    reason text,
    created_at timestamptz DEFAULT now()
);

-- Enable RLS for swap_audit_logs
ALTER TABLE swap_audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for swap_audit_logs
CREATE POLICY "Authenticated users can view audit logs" 
    ON swap_audit_logs FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "System can insert audit logs" 
    ON swap_audit_logs FOR INSERT 
    TO authenticated 
    WITH CHECK (true);

-- Add CHECK constraints for logic enforcement
ALTER TABLE swap_requests 
DROP CONSTRAINT IF EXISTS check_rejection_reason,
DROP CONSTRAINT IF EXISTS check_open_swap_recipient;

ALTER TABLE swap_requests 
ADD CONSTRAINT check_rejection_reason 
CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL);

-- Logic: If open_swap is FALSE (direct swap), then swap_with_employee_id must be set. 
-- However, we must be careful with existing data. 
-- Assuming existing data follows this rule or is migrated.
ALTER TABLE swap_requests 
ADD CONSTRAINT check_open_swap_recipient 
CHECK (open_swap = true OR swap_with_employee_id IS NOT NULL);
