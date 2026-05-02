-- ==========================================
-- CREATE SKILLS AND LICENSES TABLES
-- ==========================================

-- 1. Skills Catalog
CREATE TABLE IF NOT EXISTS public.skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    category text NOT NULL CHECK (category IN ('Safety', 'Operational', 'Technical', 'Compliance')),
    requires_expiration boolean DEFAULT false,
    default_validity_months integer,
    created_at timestamptz DEFAULT now()
);

-- 2. Employee Skills
CREATE TABLE IF NOT EXISTS public.employee_skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
    proficiency_level text NOT NULL DEFAULT 'Competent' CHECK (proficiency_level IN ('Novice', 'Competent', 'Proficient', 'Expert')),
    status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Expired', 'Pending', 'Revoked')),
    issue_date date,
    expiration_date date,
    verified_at timestamptz,
    notes text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 3. Licenses Catalog
CREATE TABLE IF NOT EXISTS public.licenses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    created_at timestamptz DEFAULT now()
);

-- 4. Employee Licenses
CREATE TABLE IF NOT EXISTS public.employee_licenses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    license_id uuid NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
    issue_date date,
    expiration_date date,
    status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Expired', 'Suspended')),
    verification_status text NOT NULL DEFAULT 'Unverified' CHECK (verification_status IN ('Unverified', 'Verified', 'Failed', 'Expired')),
    verified_at timestamptz,
    last_checked_at timestamptz,
    verification_metadata jsonb DEFAULT '{}'::jsonb,
    license_type text NOT NULL DEFAULT 'Standard' CHECK (license_type IN ('Standard', 'WorkRights', 'Professional')),
    has_restricted_work_limit boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_employee_skills_employee_id ON public.employee_skills(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_licenses_employee_id ON public.employee_licenses(employee_id);
CREATE INDEX IF NOT EXISTS idx_skills_category ON public.skills(category);

-- 6. Seed Basic Skills
INSERT INTO public.skills (name, category, description) VALUES
('First Aid', 'Safety', 'Basic first aid certification'),
('RSA', 'Compliance', 'Responsible Service of Alcohol'),
('Manual Handling', 'Safety', 'Safe lifting and movement techniques'),
('Customer Service', 'Operational', 'General hospitality customer service'),
('Fire Safety', 'Safety', 'Emergency evacuation and fire extinguisher use')
ON CONFLICT DO NOTHING;

-- 7. Seed Basic Licenses
INSERT INTO public.licenses (name, description) VALUES
('Driver License', 'Standard passenger vehicle license'),
('Forklift License', 'High risk work license for forklift operation'),
('Working with Children Check', 'State-based child safety clearance'),
('RSA Card', 'Physical competency card for alcohol service')
ON CONFLICT DO NOTHING;

-- 8. Enable RLS (Initially permissive)
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on skills" ON public.skills FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow public read on licenses" ON public.licenses FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow users to view own skills" ON public.employee_skills FOR SELECT TO authenticated USING (auth.uid() = employee_id OR is_admin());
CREATE POLICY "Allow users to view own licenses" ON public.employee_licenses FOR SELECT TO authenticated USING (auth.uid() = employee_id OR is_admin());

CREATE POLICY "Allow admins to manage skills" ON public.employee_skills FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Allow admins to manage licenses" ON public.employee_licenses FOR ALL TO authenticated USING (is_admin());
