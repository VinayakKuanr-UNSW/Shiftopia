-- ============================================================================
-- fairness_ledger: let employees read their OWN row  (audit F-24)
-- ============================================================================
--
-- `fairness_ledger_org_scoped` gates both SELECT and WRITE on legacy-admin OR
-- an active gamma+ certificate. An employee cannot read even their own debt.
--
-- Nothing is broken today — every current caller is a manager surface or
-- service_role — but the failure mode is bad: RLS returns ZERO ROWS rather than
-- an error, which is indistinguishable from "the ledger has not been computed"
-- (audit F-04). Any employee-facing fairness transparency built on this would
-- silently show "no data" instead of "not permitted".
--
-- It is also a prerequisite for answering "why didn't I get that shift?" — a
-- question a longitudinal fairness system should be able to answer to the
-- person it affects, and plausibly an industrial-relations requirement rather
-- than just a product nicety.
--
-- SELECT only. Employees must never write their own fairness debt.
-- ============================================================================

DROP POLICY IF EXISTS fairness_ledger_self_read ON public.fairness_ledger;

CREATE POLICY fairness_ledger_self_read
    ON public.fairness_ledger
    FOR SELECT
    TO authenticated
    USING (employee_id = (SELECT auth.uid()));

COMMENT ON POLICY fairness_ledger_self_read ON public.fairness_ledger IS
    'F1: an employee may read their own fairness-ledger rows (SELECT only). Complements fairness_ledger_org_scoped, which covers managers/admins and all writes. Audit F-24.';

-- `(SELECT auth.uid())` rather than a bare `auth.uid()` is deliberate: the
-- scalar-subquery form is evaluated once per query instead of once per row,
-- which is the initplan optimisation applied across this schema during the
-- 2026-07 performance remediation. Keep it.
