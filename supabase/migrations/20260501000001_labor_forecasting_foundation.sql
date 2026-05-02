-- 20260501000001_labor_forecasting_foundation.sql

-- 1. Add forecasting buckets to roles
ALTER TABLE public.roles
ADD COLUMN IF NOT EXISTS forecasting_bucket TEXT CHECK (
  forecasting_bucket IN ('static', 'semi_dynamic', 'dynamic')
);

-- 2. Add supervision ratios to roles
ALTER TABLE public.roles
ADD COLUMN IF NOT EXISTS supervision_ratio_min INT,
ADD COLUMN IF NOT EXISTS supervision_ratio_max INT;

-- 3. Add baseline eligibility to roles
ALTER TABLE public.roles
ADD COLUMN IF NOT EXISTS is_baseline_eligible BOOLEAN DEFAULT false;

-- 4. Add synthesis metadata to shifts
ALTER TABLE public.shifts
ADD COLUMN IF NOT EXISTS demand_source TEXT CHECK (
  demand_source IN ('baseline', 'ml_predicted', 'derived')
);

ALTER TABLE public.shifts
ADD COLUMN IF NOT EXISTS target_employment_type TEXT CHECK (
  target_employment_type IN ('FT', 'PT', 'Casual')
);

ALTER TABLE public.shifts
ADD COLUMN IF NOT EXISTS demand_group_id UUID;

-- 5. Create demand_forecasts table
-- Note: using event_id text to match venueops_events.event_id
CREATE TABLE IF NOT EXISTS public.demand_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT REFERENCES public.venueops_events(event_id) ON DELETE CASCADE,
  role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
  predicted_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS and add basic policies
ALTER TABLE public.demand_forecasts ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'demand_forecasts' AND policyname = 'authenticated_read_demand_forecasts'
    ) THEN
        CREATE POLICY "authenticated_read_demand_forecasts"
            ON public.demand_forecasts FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'demand_forecasts' AND policyname = 'authenticated_all_demand_forecasts'
    ) THEN
        CREATE POLICY "authenticated_all_demand_forecasts"
            ON public.demand_forecasts FOR ALL TO authenticated USING (true);
    END IF;
END $$;
