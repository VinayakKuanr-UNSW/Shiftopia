-- Fix Cascade Delete for Templates -> Shifts
-- Problem: Deleting a shift_template leaves orphaned shifts because there is no FK constraint.
-- Solution: Add FK constraint on shifts.template_id referencing shift_templates(id) with ON DELETE CASCADE.

-- 1. Add Foreign Key Constraint with Cascade Delete
-- We first try to drop it if it exists (though we found none) to be safe/idempotent.

DO $$
BEGIN
    -- Check if constraint exists, if not adds it. 
    -- We can't use IF NOT EXISTS with ALTER TABLE ADD CONSTRAINT directly in all pg versions easily without a block or just doing it.
    -- But since we found NO constraint, we can just add it. 
    -- However, basic safety: ensure invalid data doesn't block it. 
    -- (Optional: DELETE FROM shifts WHERE template_id IS NOT NULL AND template_id NOT IN (SELECT id FROM shift_templates);)
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shifts_template_id_fkey') THEN
        ALTER TABLE public.shifts
        ADD CONSTRAINT shifts_template_id_fkey
        FOREIGN KEY (template_id)
        REFERENCES public.shift_templates(id)
        ON DELETE CASCADE;
    END IF;
END $$;
