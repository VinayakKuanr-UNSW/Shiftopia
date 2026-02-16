-- =============================================================================
-- Compliance Checks Audit Table
-- =============================================================================
-- Stores a record of every compliance check performed for legal protection
-- and debugging. Never delete these records.
-- =============================================================================

CREATE TABLE IF NOT EXISTS compliance_checks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    action_type text NOT NULL CHECK (action_type IN ('add', 'assign', 'swap', 'bid')),
    shift_id uuid,  -- NULL for pre-creation checks
    candidate_shift jsonb NOT NULL,  -- The shift being evaluated
    results jsonb NOT NULL,  -- Array of ComplianceResult objects
    passed boolean NOT NULL,  -- Overall result
    performed_at timestamptz DEFAULT now(),
    performed_by uuid REFERENCES auth.users(id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_compliance_checks_employee ON compliance_checks(employee_id);
CREATE INDEX IF NOT EXISTS idx_compliance_checks_performed_at ON compliance_checks(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_checks_passed ON compliance_checks(passed);
CREATE INDEX IF NOT EXISTS idx_compliance_checks_action ON compliance_checks(action_type);

-- RLS
ALTER TABLE compliance_checks ENABLE ROW LEVEL SECURITY;

-- Admins can view all compliance checks
DROP POLICY IF EXISTS "admins_select_compliance" ON compliance_checks;
CREATE POLICY "admins_select_compliance" ON compliance_checks 
    FOR SELECT TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM profiles p 
            WHERE p.id = auth.uid() 
            AND p.system_role::text IN ('admin', 'manager')
        )
    );

-- Service can insert (via SECURITY DEFINER functions)
DROP POLICY IF EXISTS "service_insert_compliance" ON compliance_checks;
CREATE POLICY "service_insert_compliance" ON compliance_checks 
    FOR INSERT TO authenticated 
    WITH CHECK (true);

-- Add immutability - no updates or deletes
DROP POLICY IF EXISTS "no_update_compliance" ON compliance_checks;
CREATE POLICY "no_update_compliance" ON compliance_checks 
    FOR UPDATE TO authenticated 
    USING (false);

DROP POLICY IF EXISTS "no_delete_compliance" ON compliance_checks;
CREATE POLICY "no_delete_compliance" ON compliance_checks 
    FOR DELETE TO authenticated 
    USING (false);

COMMENT ON TABLE compliance_checks IS 
    'Immutable audit log of all compliance checks. Used for legal protection and debugging.';

-- =============================================================================
-- RPC to log compliance check
-- =============================================================================

CREATE OR REPLACE FUNCTION log_compliance_check(
    p_employee_id uuid,
    p_action_type text,
    p_shift_id uuid,
    p_candidate_shift jsonb,
    p_results jsonb,
    p_passed boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_check_id uuid;
BEGIN
    INSERT INTO compliance_checks (
        employee_id,
        action_type,
        shift_id,
        candidate_shift,
        results,
        passed,
        performed_by
    ) VALUES (
        p_employee_id,
        p_action_type,
        p_shift_id,
        p_candidate_shift,
        p_results,
        p_passed,
        auth.uid()
    )
    RETURNING id INTO v_check_id;
    
    RETURN v_check_id;
END;
$$;

GRANT EXECUTE ON FUNCTION log_compliance_check(uuid, text, uuid, jsonb, jsonb, boolean) TO authenticated;
