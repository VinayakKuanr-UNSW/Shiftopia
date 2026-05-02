-- Add employment_type to roles table
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS employment_type text;

-- Add a comment explaining the purpose of this column
COMMENT ON COLUMN public.roles.employment_type IS 'The allowed or default employment type(s) for this role (e.g., "Full Time", "Casual", "Full Time / Casual")';
