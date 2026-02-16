
-- Create availability statuses enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'availability_status') THEN
    CREATE TYPE availability_status AS ENUM (
      'Available',
      'Unavailable',
      'Partial',
      'Limited',
      'Tentative',
      'On Leave',
      'Not Specified'
    );
  END IF;
END $$;

-- Create availability table for storing employee availability
CREATE TABLE IF NOT EXISTS public.availabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status availability_status NOT NULL DEFAULT 'Not Specified',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(employee_id, date)
);

-- Create time slots table for storing specific time availability
CREATE TABLE IF NOT EXISTS public.availability_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  availability_id UUID NOT NULL REFERENCES availabilities(id) ON DELETE CASCADE,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status availability_status NOT NULL DEFAULT 'Available',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create availability presets table
CREATE TABLE IF NOT EXISTS public.availability_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'custom',
  pattern JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create preset time slots table
CREATE TABLE IF NOT EXISTS public.preset_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id UUID NOT NULL REFERENCES availability_presets(id) ON DELETE CASCADE,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status availability_status NOT NULL DEFAULT 'Available',
  days_of_week INTEGER[], -- Array of day numbers (0=Sunday, 1=Monday, etc.)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create availability cutoff dates table for manager controls
CREATE TABLE IF NOT EXISTS public.availability_cutoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cutoff_date DATE NOT NULL,
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_active BOOLEAN DEFAULT true
);

-- Enable RLS on all tables
ALTER TABLE public.availabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preset_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_cutoffs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for availabilities
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can view all availabilities" ON public.availabilities;
  DROP POLICY IF EXISTS "Users can insert their own availabilities" ON public.availabilities;
  DROP POLICY IF EXISTS "Users can update their own availabilities" ON public.availabilities;
  DROP POLICY IF EXISTS "Users can delete their own availabilities" ON public.availabilities;
END $$;

CREATE POLICY "Users can view all availabilities" ON public.availabilities FOR SELECT USING (true);
CREATE POLICY "Users can insert their own availabilities" ON public.availabilities FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update their own availabilities" ON public.availabilities FOR UPDATE USING (true);
CREATE POLICY "Users can delete their own availabilities" ON public.availabilities FOR DELETE USING (true);

-- RLS Policies for time slots
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can view all time slots" ON public.availability_time_slots;
  DROP POLICY IF EXISTS "Users can insert time slots" ON public.availability_time_slots;
  DROP POLICY IF EXISTS "Users can update time slots" ON public.availability_time_slots;
  DROP POLICY IF EXISTS "Users can delete time slots" ON public.availability_time_slots;
END $$;

CREATE POLICY "Users can view all time slots" ON public.availability_time_slots FOR SELECT USING (true);
CREATE POLICY "Users can insert time slots" ON public.availability_time_slots FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update time slots" ON public.availability_time_slots FOR UPDATE USING (true);
CREATE POLICY "Users can delete time slots" ON public.availability_time_slots FOR DELETE USING (true);

-- RLS Policies for presets (public read, admin write)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone can view presets" ON public.availability_presets;
  DROP POLICY IF EXISTS "Anyone can insert presets" ON public.availability_presets;
  DROP POLICY IF EXISTS "Anyone can update presets" ON public.availability_presets;
  DROP POLICY IF EXISTS "Anyone can delete presets" ON public.availability_presets;
END $$;

CREATE POLICY "Anyone can view presets" ON public.availability_presets FOR SELECT USING (true);
CREATE POLICY "Anyone can insert presets" ON public.availability_presets FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update presets" ON public.availability_presets FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete presets" ON public.availability_presets FOR DELETE USING (true);

-- RLS Policies for preset time slots
DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone can view preset time slots" ON public.preset_time_slots;
  DROP POLICY IF EXISTS "Anyone can insert preset time slots" ON public.preset_time_slots;
  DROP POLICY IF EXISTS "Anyone can update preset time slots" ON public.preset_time_slots;
  DROP POLICY IF EXISTS "Anyone can delete preset time slots" ON public.preset_time_slots;
END $$;

CREATE POLICY "Anyone can view preset time slots" ON public.preset_time_slots FOR SELECT USING (true);
CREATE POLICY "Anyone can insert preset time slots" ON public.preset_time_slots FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update preset time slots" ON public.preset_time_slots FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete preset time slots" ON public.preset_time_slots FOR DELETE USING (true);

-- RLS Policies for cutoffs
DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone can view cutoffs" ON public.availability_cutoffs;
  DROP POLICY IF EXISTS "Anyone can insert cutoffs" ON public.availability_cutoffs;
  DROP POLICY IF EXISTS "Anyone can update cutoffs" ON public.availability_cutoffs;
END $$;

CREATE POLICY "Anyone can view cutoffs" ON public.availability_cutoffs FOR SELECT USING (true);
CREATE POLICY "Anyone can insert cutoffs" ON public.availability_cutoffs FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update cutoffs" ON public.availability_cutoffs FOR UPDATE USING (true);

-- Store preset IDs for reference (only if presets don't exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.availability_presets WHERE name = 'Weekdays Only') THEN
    WITH preset_inserts AS (
      INSERT INTO public.availability_presets (name, type, pattern) VALUES
      ('Weekdays Only', 'weekdays', '{}'),
      ('Weekends Only', 'weekends', '{}'),
      ('Mornings Only', 'custom', '{}'),
      ('Evenings Only', 'custom', '{}'),
      ('Full Day', 'custom', '{}'),
      ('Fully Unavailable', 'custom', '{}')
      RETURNING id, name
    )
-- Insert preset time slots using the generated UUIDs
INSERT INTO public.preset_time_slots (preset_id, start_time, end_time, status, days_of_week)
SELECT 
  p.id,
  CASE p.name
    WHEN 'Weekdays Only' THEN '09:00'::TIME
    WHEN 'Weekends Only' THEN '10:00'::TIME
    WHEN 'Mornings Only' THEN '07:00'::TIME
    WHEN 'Evenings Only' THEN '17:00'::TIME
    WHEN 'Full Day' THEN '00:00'::TIME
    WHEN 'Fully Unavailable' THEN '00:00'::TIME
  END,
  CASE p.name
    WHEN 'Weekdays Only' THEN '17:00'::TIME
    WHEN 'Weekends Only' THEN '18:00'::TIME
    WHEN 'Mornings Only' THEN '12:00'::TIME
    WHEN 'Evenings Only' THEN '23:00'::TIME
    WHEN 'Full Day' THEN '23:59'::TIME
    WHEN 'Fully Unavailable' THEN '23:59'::TIME
  END,
  CASE p.name
    WHEN 'Fully Unavailable' THEN 'Unavailable'::availability_status
    ELSE 'Available'::availability_status
  END,
  CASE p.name
    WHEN 'Weekdays Only' THEN ARRAY[1,2,3,4,5]
    WHEN 'Weekends Only' THEN ARRAY[0,6]
    ELSE NULL
  END
FROM preset_inserts p;
  END IF;
END $$;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_availabilities_updated_at ON public.availabilities;
CREATE TRIGGER update_availabilities_updated_at BEFORE UPDATE ON public.availabilities
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_availability_time_slots_updated_at ON public.availability_time_slots;
CREATE TRIGGER update_availability_time_slots_updated_at BEFORE UPDATE ON public.availability_time_slots
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_availability_presets_updated_at ON public.availability_presets;
CREATE TRIGGER update_availability_presets_updated_at BEFORE UPDATE ON public.availability_presets
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for all availability tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.availabilities;
ALTER PUBLICATION supabase_realtime ADD TABLE public.availability_time_slots;
ALTER PUBLICATION supabase_realtime ADD TABLE public.availability_presets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.preset_time_slots;
ALTER PUBLICATION supabase_realtime ADD TABLE public.availability_cutoffs;
