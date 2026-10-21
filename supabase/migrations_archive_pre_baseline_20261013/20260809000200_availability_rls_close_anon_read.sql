-- ============================================================================
-- Close anonymous read access to declared availability.
--
-- BEFORE (verified in production 2026-08-08):
--   availability_rules | "Enable read access for all" | SELECT | {public} | true
--   availability_slots | "Enable read access for all" | SELECT | {public} | true
--
-- Role `public` includes `anon`, and the qualifier is literally `true`. Anyone
-- holding the publishable key could read every employee's declared availability
-- — 9,980 slot rows across 104 people. Writes were always correctly owner-scoped
-- (`auth.uid() = profile_id`); only reads were open.
--
-- AFTER: readable by the owner, or by a manager (gamma+ / legacy admin|manager).
--
-- ── Why owner-or-manager and NOT owner-or-manager-in-scope ──────────────────
--
-- Scope-narrowing is deliberately NOT done here. `scheduling/data/roster-fetcher`
-- pulls availability for the solver's whole candidate set; if a manager's scope
-- were narrower than that set, a scope-restricted policy would silently shrink
-- the solver's input and produce under-filled rosters that look like a solver
-- bug. That is precisely the failure mode of the AutoScheduler zero-fill
-- incident. This migration fixes the actual vulnerability — anonymous access —
-- without changing what any authenticated manager can already see. Narrowing to
-- scope is a separate change that needs its own verification against the solver.
--
-- ── Consumer audit (every direct reader of these tables) ────────────────────
--   availability/api/availability.api.ts        own rows only  (My Availabilities)
--   availability/api/availability-view.api.ts   own rows only
--   availability/api/team-availability.api.ts   manager        (Team Availability)
--   rosters/api/availability.api.ts             manager        (People Mode, assign warnings)
--   scheduling/data/roster-fetcher.ts           manager        (Auto Scheduler)
--   reserve-list/api/reserveList.api.ts         manager        (Reserve List)
-- No employee-facing surface reads another employee's availability, so no
-- employee loses anything they were using.
--
-- `generate_availability_slots()` is SECURITY DEFINER and so continues to
-- materialise slots regardless of the caller's policy.
-- ============================================================================

-- ── availability_rules ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Enable read access for all" ON public.availability_rules;

DROP POLICY IF EXISTS availability_rules_select ON public.availability_rules;
CREATE POLICY availability_rules_select
    ON public.availability_rules
    FOR SELECT TO authenticated
    USING (profile_id = (SELECT auth.uid()) OR public.is_manager_or_above());

COMMENT ON POLICY availability_rules_select ON public.availability_rules IS
    'Owner or manager. Replaces a USING(true) policy granted to PUBLIC (incl. anon).';

-- ── availability_slots ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Enable read access for all" ON public.availability_slots;

DROP POLICY IF EXISTS availability_slots_select ON public.availability_slots;
CREATE POLICY availability_slots_select
    ON public.availability_slots
    FOR SELECT TO authenticated
    USING (profile_id = (SELECT auth.uid()) OR public.is_manager_or_above());

COMMENT ON POLICY availability_slots_select ON public.availability_slots IS
    'Owner or manager. Replaces a USING(true) policy granted to PUBLIC (incl. anon).';

-- Table-level grants: RLS only filters rows that the role may reach at all.
REVOKE ALL ON public.availability_rules FROM anon;
REVOKE ALL ON public.availability_slots FROM anon;
