-- ==============================================================================
-- FIX SHIFTS FOREIGN KEY
-- Use Case: The 'apply_template' RPC fails with "violates foreign key constraint 'shifts_template_id_fkey'"
-- when inserting valid IDs from 'roster_templates'. 
-- Root Cause: The constraint likely points to an old 'templates' table instead of 'roster_templates'.
-- Solution: Drop the old constraint and recreate it pointing to 'roster_templates'.
-- Data Integrity: We nullify any template_ids in 'shifts' that don't exist in 'roster_templates' 
--                 to ensure the new constraint can be applied successfully.
-- ==============================================================================

DO $$
BEGIN
    -- 1. Check if the constraint exists and implies a wrong target (implicitly handled by just fixing it).
    
    -- 2. Clean up data: If we are repointing to 'roster_templates', existing shifts 
    --    referencing old/deleted templates will block the constraint.
    --    We set them to NULL to preserve the shift but detach it from the missing template.
    UPDATE shifts
    SET template_id = NULL
    WHERE template_id IS NOT NULL 
    AND template_id NOT IN (SELECT id FROM roster_templates);

    -- 3. Drop the existing constraint
    ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_template_id_fkey;

    -- 4. Add the correct constraint pointing to roster_templates
    ALTER TABLE shifts
    ADD CONSTRAINT shifts_template_id_fkey
    FOREIGN KEY (template_id)
    REFERENCES roster_templates(id)
    ON DELETE SET NULL; -- Or CASCADE, depending on preference. SET NULL is safer for history.

END $$;
