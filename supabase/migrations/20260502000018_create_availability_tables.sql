-- Migration to create availability tables

-- 1. Create availability_rules table
CREATE TABLE IF NOT EXISTS public.availability_rules (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    start_date          date NOT NULL,
    start_time          time NOT NULL,
    end_time            time NOT NULL,
    repeat_type         text NOT NULL DEFAULT 'none' CHECK (repeat_type IN ('none', 'daily', 'weekly', 'fortnightly')),
    repeat_days         integer[], -- e.g. [1, 2] (1=Mon)
    repeat_end_date     date,
    reason              text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 2. Create availability_slots table
CREATE TABLE IF NOT EXISTS public.availability_slots (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id             uuid NOT NULL REFERENCES public.availability_rules(id) ON DELETE CASCADE,
    profile_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    slot_date           date NOT NULL,
    start_time          time NOT NULL,
    end_time            time NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_availability_rules_profile_id ON public.availability_rules(profile_id);
CREATE INDEX IF NOT EXISTS idx_availability_slots_profile_id_date ON public.availability_slots(profile_id, slot_date);
CREATE INDEX IF NOT EXISTS idx_availability_slots_rule_id ON public.availability_slots(rule_id);

-- 4. Enable RLS
ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;

-- 5. Policies
DO $$ 
BEGIN
    DROP POLICY IF EXISTS auth_read_availability_rules ON public.availability_rules;
    CREATE POLICY auth_read_availability_rules ON public.availability_rules 
        FOR SELECT TO authenticated USING (true);

    DROP POLICY IF EXISTS auth_write_availability_rules ON public.availability_rules;
    CREATE POLICY auth_write_availability_rules ON public.availability_rules 
        FOR ALL TO authenticated USING (auth.uid() = profile_id OR is_admin());

    DROP POLICY IF EXISTS auth_read_availability_slots ON public.availability_slots;
    CREATE POLICY auth_read_availability_slots ON public.availability_slots 
        FOR SELECT TO authenticated USING (true);

    DROP POLICY IF EXISTS auth_write_availability_slots ON public.availability_slots;
    CREATE POLICY auth_write_availability_slots ON public.availability_slots 
        FOR ALL TO authenticated USING (auth.uid() = profile_id OR is_admin());
END $$;

-- 6. Comments
COMMENT ON TABLE public.availability_rules IS 'Source of truth for employee availability patterns.';
COMMENT ON TABLE public.availability_slots IS 'Materialized availability slots for calendar rendering and conflict checking.';
