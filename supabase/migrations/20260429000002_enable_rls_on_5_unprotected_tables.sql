-- =====================================================================
--  Enable RLS on 5 unprotected `public` tables flagged by the security
--  advisor (lint: rls_disabled_in_public, ERROR level).
--
--  Strategy per table:
--   - Tables whose only access path is SECURITY DEFINER backend functions
--     get RLS enabled with NO policies. DEFINER calls bypass RLS, so server
--     workflows continue working; direct PostgREST access from anon/auth
--     clients is denied. Verified 2026-04-29 that no client query in src/
--     touches these tables directly.
--   - The `events` table IS read by clients (shifts.queries.ts:585), so it
--     gets a SELECT policy that allows access to:
--        a) admins,
--        b) legacy NULL-org rows (all 3 existing rows),
--        c) rows whose organization_id matches a user_contract for the caller.
--   - Lookup `role_levels` gets a broad SELECT to authenticated since it has
--     no tenancy column; treat as a global lookup table.
--
--  Behavior change risk
--   - DEFINER-only tables: zero client-side change (no client queries).
--   - events: existing 3 NULL-org rows remain visible; new properly-tagged
--     rows become org-scoped. Direct anon access (which never should have
--     worked) is now blocked.
-- =====================================================================

-- ── 1. role_levels — lookup table (no tenancy) ────────────────────────
ALTER TABLE public.role_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_levels_select_authenticated
    ON public.role_levels
    FOR SELECT
    TO authenticated
    USING (true);

COMMENT ON TABLE public.role_levels IS
    'Global lookup mapping roles to hierarchy ranks. RLS allows authenticated SELECT only.';

-- ── 2. attendance_records — DEFINER-only ──────────────────────────────
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.attendance_records IS
    'Employee attendance / clock-in records. All access is via SECURITY DEFINER backend RPCs; direct client access is intentionally denied by RLS-with-no-policies.';

-- ── 3. deleted_shifts — DEFINER-only audit ────────────────────────────
ALTER TABLE public.deleted_shifts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.deleted_shifts IS
    'Soft-delete audit trail for shifts. DEFINER-only — direct client access denied by RLS-with-no-policies.';

-- ── 4. events — client-readable, org-scoped ───────────────────────────
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_select_org_scoped
    ON public.events
    FOR SELECT
    TO authenticated
    USING (
        is_admin()
        OR organization_id IS NULL
        OR organization_id IN (
            SELECT uc.organization_id
            FROM public.user_contracts uc
            WHERE uc.user_id = (SELECT auth.uid())
        )
    );

COMMENT ON POLICY events_select_org_scoped ON public.events IS
    'Authenticated users see events for orgs where they have a user_contract. Admins see all. Legacy NULL-org rows remain visible.';

-- ── 5. employee_performance_snapshots — DEFINER-only ─────────────────
ALTER TABLE public.employee_performance_snapshots ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.employee_performance_snapshots IS
    'Per-employee reliability metrics. DEFINER-only — direct client access denied by RLS-with-no-policies.';
