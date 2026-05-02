-- ==========================================
-- ALIGN ROSTER METADATA
-- ==========================================

-- 1. Roster Groups
ALTER TABLE public.roster_groups
ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS external_id text,
ADD COLUMN IF NOT EXISTS roster_id uuid REFERENCES public.rosters(id),
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 2. Roster Subgroups
ALTER TABLE public.roster_subgroups
ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS required_headcount integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS min_headcount integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 3. Migration to fix data if roster_id is missing but roster_day_id exists
-- (Assuming roster_groups was linked to roster_days in an older schema)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'roster_groups' AND column_name = 'roster_day_id') THEN
        UPDATE public.roster_groups rg
        SET roster_id = rd.roster_id
        FROM public.roster_days rd
        WHERE rg.roster_day_id = rd.id
        AND rg.roster_id IS NULL;
    END IF;
END $$;
