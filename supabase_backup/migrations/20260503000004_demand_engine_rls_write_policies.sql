-- ============================================================
-- 20260503000004_demand_engine_rls_write_policies.sql
--
-- demand_tensor and demand_templates are written by the rule
-- engine running with the SUPABASE service-role key (which
-- bypasses RLS). These policies are the safety net for any
-- future flow that runs writes from a user context — currently
-- only managers/admins should be able to manipulate engine
-- output directly.
-- ============================================================

-- ── demand_tensor ────────────────────────────────────────────

ALTER TABLE IF EXISTS public.demand_tensor ENABLE ROW LEVEL SECURITY;

-- INSERT
DROP POLICY IF EXISTS "manager_insert_demand_tensor" ON public.demand_tensor;
CREATE POLICY "manager_insert_demand_tensor"
    ON public.demand_tensor
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.app_access_certificates
            WHERE user_id = auth.uid()
              AND access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        )
    );

-- UPDATE
DROP POLICY IF EXISTS "manager_update_demand_tensor" ON public.demand_tensor;
CREATE POLICY "manager_update_demand_tensor"
    ON public.demand_tensor
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.app_access_certificates
            WHERE user_id = auth.uid()
              AND access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.app_access_certificates
            WHERE user_id = auth.uid()
              AND access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        )
    );

-- DELETE
DROP POLICY IF EXISTS "manager_delete_demand_tensor" ON public.demand_tensor;
CREATE POLICY "manager_delete_demand_tensor"
    ON public.demand_tensor
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.app_access_certificates
            WHERE user_id = auth.uid()
              AND access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        )
    );

-- ── demand_templates ─────────────────────────────────────────

ALTER TABLE IF EXISTS public.demand_templates ENABLE ROW LEVEL SECURITY;

-- INSERT
DROP POLICY IF EXISTS "manager_insert_demand_templates" ON public.demand_templates;
CREATE POLICY "manager_insert_demand_templates"
    ON public.demand_templates
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.app_access_certificates
            WHERE user_id = auth.uid()
              AND access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        )
    );

-- UPDATE
DROP POLICY IF EXISTS "manager_update_demand_templates" ON public.demand_templates;
CREATE POLICY "manager_update_demand_templates"
    ON public.demand_templates
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.app_access_certificates
            WHERE user_id = auth.uid()
              AND access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.app_access_certificates
            WHERE user_id = auth.uid()
              AND access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        )
    );

-- DELETE
DROP POLICY IF EXISTS "manager_delete_demand_templates" ON public.demand_templates;
CREATE POLICY "manager_delete_demand_templates"
    ON public.demand_templates
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.app_access_certificates
            WHERE user_id = auth.uid()
              AND access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        )
    );
