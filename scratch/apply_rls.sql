ALTER TABLE IF EXISTS public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.employee_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.employee_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.employee_performance_metrics ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Allow public read on skills" ON public.skills;
    DROP POLICY IF EXISTS "Only admins can manage skills" ON public.skills;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE POLICY "Allow public read on skills" ON public.skills FOR SELECT TO authenticated USING (true);
CREATE POLICY "Only admins can manage skills" ON public.skills FOR ALL TO authenticated USING (public.is_admin());

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Allow public read on licenses" ON public.licenses;
    DROP POLICY IF EXISTS "Only admins can manage licenses" ON public.licenses;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE POLICY "Allow public read on licenses" ON public.licenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Only admins can manage licenses" ON public.licenses FOR ALL TO authenticated USING (public.is_admin());

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Users can view own skills" ON public.employee_skills;
    DROP POLICY IF EXISTS "Users can manage own skills" ON public.employee_skills;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE POLICY "Users can view own skills" ON public.employee_skills FOR SELECT TO authenticated USING (auth.uid() = employee_id OR public.is_admin());
CREATE POLICY "Users can manage own skills" ON public.employee_skills FOR ALL TO authenticated USING (auth.uid() = employee_id OR public.is_admin());

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Users can view own licenses" ON public.employee_licenses;
    DROP POLICY IF EXISTS "Users can manage own licenses" ON public.employee_licenses;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE POLICY "Users can view own licenses" ON public.employee_licenses FOR SELECT TO authenticated USING (auth.uid() = employee_id OR public.is_admin());
CREATE POLICY "Users can manage own licenses" ON public.employee_licenses FOR ALL TO authenticated USING (auth.uid() = employee_id OR public.is_admin());

GRANT EXECUTE ON FUNCTION public.get_quarterly_performance_report(integer, integer, uuid[], uuid[], uuid[]) TO authenticated;
