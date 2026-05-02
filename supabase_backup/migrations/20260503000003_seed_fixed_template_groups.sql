-- Migration: 20260503000003_seed_fixed_template_groups.sql
-- 
-- 1. Create trigger function to seed fixed ICC Sydney groups for every new template.
-- 2. Attach trigger to public.roster_templates.
-- 3. Retroactively seed any existing templates that have 0 groups.

-- 1. Create the trigger function
CREATE OR REPLACE FUNCTION public.fn_seed_fixed_template_groups()
RETURNS TRIGGER AS $$
BEGIN
    -- Seed the three fixed groups for ICC Sydney
    INSERT INTO public.template_groups (template_id, name, color, icon, sort_order)
    VALUES 
        (NEW.id, 'Convention Centre', '#3b82f6', 'building', 1),
        (NEW.id, 'Exhibition Centre', '#22c55e', 'layout-grid', 2),
        (NEW.id, 'Theatre',           '#ef4444', 'theater',     3);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Attach the trigger
DROP TRIGGER IF EXISTS trigger_seed_fixed_template_groups ON public.roster_templates;
CREATE TRIGGER trigger_seed_fixed_template_groups
AFTER INSERT ON public.roster_templates
FOR EACH ROW
EXECUTE FUNCTION public.fn_seed_fixed_template_groups();

-- 3. Retroactively seed existing templates with 0 groups
-- This ensures any templates that failed to seed via the UI are fixed.
INSERT INTO public.template_groups (template_id, name, color, icon, sort_order)
SELECT rt.id, g.name, g.color, g.icon, g.sort_order
FROM public.roster_templates rt
CROSS JOIN (
    VALUES 
        ('Convention Centre', '#3b82f6', 'building', 1),
        ('Exhibition Centre', '#22c55e', 'layout-grid', 2),
        ('Theatre',           '#ef4444', 'theater',     3)
) AS g(name, color, icon, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM public.template_groups tg 
    WHERE tg.template_id = rt.id
);

COMMENT ON FUNCTION public.fn_seed_fixed_template_groups IS 'Automatically seeds the three fixed ICC Sydney groups for every new roster template.';
