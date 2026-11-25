-- Hygiene batch 1: cover every unindexed foreign key in public, and drop the
-- duplicate shift_bids -> profiles foreign key.
--
-- Covers exactly the 12 findings of the Supabase `unindexed_foreign_keys`
-- advisor (2026-11-25). Without these, deleting or re-keying a parent row
-- (sub_departments, profiles, availability_rules, organizations) seq-scans the
-- child table to enforce the constraint.
--
-- Nullable columns get a partial index (WHERE col IS NOT NULL): the RI check
-- `col = $1` implies NOT NULL, so the planner can still use it, and NULL rows
-- (most "who did it" columns) are not stored.
--
-- Plain CREATE INDEX, not CONCURRENTLY: migrations run inside a transaction,
-- and the largest table here (availability_slots, ~35k rows) builds in well
-- under a second. Reads are not blocked during the build; writes wait briefly.

-- ── Duplicate FK ─────────────────────────────────────────────────────────────
-- shift_bids_profile_fkey is identical to shift_bids_employee_id_fkey
-- (employee_id -> profiles(id) ON DELETE CASCADE). The app's PostgREST embeds
-- hint shift_bids_employee_id_fkey, so that one stays.
ALTER TABLE public.shift_bids DROP CONSTRAINT IF EXISTS shift_bids_profile_fkey;

-- ── availability_* ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_availability_slots_sub_department_id
  ON public.availability_slots (sub_department_id) WHERE sub_department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_availability_rules_sub_department_id
  ON public.availability_rules (sub_department_id) WHERE sub_department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_availability_requests_requested_by
  ON public.availability_requests (requested_by);

CREATE INDEX IF NOT EXISTS idx_availability_requests_responded_rule_id
  ON public.availability_requests (responded_rule_id) WHERE responded_rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_availability_requests_sub_department_id
  ON public.availability_requests (sub_department_id) WHERE sub_department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_availability_exceptions_created_by
  ON public.availability_exceptions (created_by) WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_availability_exceptions_sub_department_id
  ON public.availability_exceptions (sub_department_id) WHERE sub_department_id IS NOT NULL;

-- ── billables ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_billables_approved_by
  ON public.billables (approved_by) WHERE approved_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billables_payroll_exported_by
  ON public.billables (payroll_exported_by) WHERE payroll_exported_by IS NOT NULL;

-- ── fairness_opportunities ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fairness_opportunities_organization_id
  ON public.fairness_opportunities (organization_id);

-- ── first_aid_appointments ───────────────────────────────────────────────────
-- The GiST exclusion index leads with organization_id, so it does not cover
-- employee_id on its own.
CREATE INDEX IF NOT EXISTS idx_first_aid_appointments_employee_id
  ON public.first_aid_appointments (employee_id);

CREATE INDEX IF NOT EXISTS idx_first_aid_appointments_appointed_by
  ON public.first_aid_appointments (appointed_by) WHERE appointed_by IS NOT NULL;
