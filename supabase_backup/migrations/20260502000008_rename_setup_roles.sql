-- ==========================================
-- RENAME SET-UP ROLES AND UPDATE EMPLOYMENT TYPES
-- ==========================================

DO $$ 
DECLARE
    sd_id uuid;
BEGIN
    -- 1. Find Sub-Department ID for 'Set-up'
    SELECT id INTO sd_id FROM public.sub_departments WHERE name = 'Set-up';
    
    IF sd_id IS NOT NULL THEN
        -- Rename roles in Set-up based on their levels
        UPDATE public.roles r SET name = 'Graduate' FROM public.remuneration_levels rl WHERE r.remuneration_level_id = rl.id AND r.sub_department_id = sd_id AND rl.level_name = 'Level 0';
        UPDATE public.roles r SET name = 'Trainee' FROM public.remuneration_levels rl WHERE r.remuneration_level_id = rl.id AND r.sub_department_id = sd_id AND rl.level_name = 'Level 1';
        UPDATE public.roles r SET name = 'Team Member' FROM public.remuneration_levels rl WHERE r.remuneration_level_id = rl.id AND r.sub_department_id = sd_id AND rl.level_name = 'Level 2';
        UPDATE public.roles r SET name = 'TM3' FROM public.remuneration_levels rl WHERE r.remuneration_level_id = rl.id AND r.sub_department_id = sd_id AND rl.level_name = 'Level 3';
        UPDATE public.roles r SET name = 'Team Leader' FROM public.remuneration_levels rl WHERE r.remuneration_level_id = rl.id AND r.sub_department_id = sd_id AND rl.level_name = 'Level 4';
        UPDATE public.roles r SET name = 'Supervisor' FROM public.remuneration_levels rl WHERE r.remuneration_level_id = rl.id AND r.sub_department_id = sd_id AND rl.level_name = 'Level 5';
        UPDATE public.roles r SET name = 'Assistant Manager' FROM public.remuneration_levels rl WHERE r.remuneration_level_id = rl.id AND r.sub_department_id = sd_id AND rl.level_name = 'Level 6';
        UPDATE public.roles r SET name = 'Manager' FROM public.remuneration_levels rl WHERE r.remuneration_level_id = rl.id AND r.sub_department_id = sd_id AND rl.level_name = 'Level 7';
    END IF;

    -- 2. Global Employment Type Update for ALL roles
    -- L0-L4 -> Casual
    UPDATE public.roles r SET employment_type = 'Casual' FROM public.remuneration_levels rl 
    WHERE r.remuneration_level_id = rl.id 
    AND rl.level_name IN ('Level 0', 'Level 1', 'Level 2', 'Level 3', 'Level 4');

    -- L5-L7 -> Full Time
    UPDATE public.roles r SET employment_type = 'Full Time' FROM public.remuneration_levels rl 
    WHERE r.remuneration_level_id = rl.id 
    AND rl.level_name IN ('Level 5', 'Level 6', 'Level 7');
    
    -- Explicitly remove 'Part Time' by converting them to the new logic
    -- (Handled by the above updates)
END $$;
