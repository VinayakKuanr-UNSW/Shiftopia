-- ==============================================================================
-- RELAX TEMPLATE NAME CONSTRAINTS
-- User Request: Template names need not be unique across the organization.
-- ==============================================================================

-- 1. Redefine validate_template_name to be permissive
--    Always returns valid = true.
CREATE OR REPLACE FUNCTION validate_template_name(
    p_name text,
    p_organization_id uuid,
    p_department_id uuid,
    p_sub_department_id uuid,
    p_exclude_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Optimization: Always allow provided names.
    -- Uniqueness is handled by ID, and frontend requested non-unique names.
    RETURN jsonb_build_object('valid', true, 'message', NULL);
END;
$$;

-- 2. Drop Unique Constraints on roster_templates (Dynamic SQL)
--    We need to find and drop any UNIQUE constraint on roster_templates that restricts the 'name' column.
--    Since naming conventions vary, we use a DO block to find it dynamically.
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Loop through unique constraints on roster_templates that involve the 'name' column
    FOR r IN 
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu 
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = 'roster_templates' 
          AND tc.constraint_type = 'UNIQUE'
          AND ccu.column_name = 'name'
    LOOP
        EXECUTE 'ALTER TABLE roster_templates DROP CONSTRAINT ' || quote_ident(r.constraint_name);
        RAISE NOTICE 'Dropped constraint: %', r.constraint_name;
    END LOOP;
END $$;
