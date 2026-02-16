
-- Create a bids table that matches the structure expected by bidService.ts
CREATE TABLE IF NOT EXISTS public.bids (
  id SERIAL PRIMARY KEY,
  shift_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT
);

-- Add Row Level Security
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;

-- Create policies for the bids table (drop if exists first to avoid conflicts)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone can view bids" ON public.bids;
  DROP POLICY IF EXISTS "Anyone can insert bids" ON public.bids;
  DROP POLICY IF EXISTS "Anyone can update bids" ON public.bids;
  DROP POLICY IF EXISTS "Anyone can delete bids" ON public.bids;
END $$;

CREATE POLICY "Anyone can view bids" ON public.bids FOR SELECT USING (true);
CREATE POLICY "Anyone can insert bids" ON public.bids FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update bids" ON public.bids FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete bids" ON public.bids FOR DELETE USING (true);
