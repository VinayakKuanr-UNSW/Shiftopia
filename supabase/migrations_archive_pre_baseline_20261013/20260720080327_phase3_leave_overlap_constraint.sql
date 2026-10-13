-- =============================================================================
-- Phase 3 (H5) — Prevent overlapping / duplicate leave.
--
-- createLeaveRequest never checked for existing requests and there was no DB
-- guard, so an employee could submit overlapping/duplicate leave for the same
-- dates; both could be approved, double-deducting balance and multiplying roster
-- conflicts. This adds the authoritative hard guarantee: no two PENDING/APPROVED
-- leave requests for the same employee may cover overlapping dates (any type —
-- you cannot be on two leaves at once). Cancelled/rejected rows are excluded so
-- a re-request after cancellation is allowed.
--
-- Verified against prod first: 0 existing overlapping pairs, so the constraint
-- creates cleanly. Requires btree_gist for the `employee_id WITH =` gist opclass.
-- NOT YET APPLIED — pending checkpoint sign-off.
-- =============================================================================

-- btree_gist provides the gist opclass for uuid equality used below. Installed in
-- the `extensions` schema (Supabase convention; already on the DB search_path).
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- Ensure the opclass is resolvable during the ALTER regardless of the apply
-- session's default search_path.
SET search_path = public, extensions, pg_catalog;

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(start_date, end_date, '[]') WITH &&
  ) WHERE (status IN ('pending', 'approved'));

COMMENT ON CONSTRAINT leave_requests_no_overlap ON public.leave_requests IS
  'H5: an employee cannot hold two pending/approved leave requests covering '
  'overlapping dates (inclusive). Cancelled/rejected are excluded so a '
  're-request after cancellation is permitted.';
