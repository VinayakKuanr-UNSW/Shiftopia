-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005130421). Do not re-run against production. Afterwards the template
-- reads status = archived, is_active = false.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Archive the one roster template the retired Baseline FT flow left behind.
--
-- "Set-up full-time baseline" (created_from = 'baseline_ft', 2026-08-31) is the
-- only template holding full-time shift rows — all 5 of its rows are FT, which
-- trg_no_ft_template_shifts has refused for every new or changed row since; these
-- predate the guard. Full-time shifts are now created on the Rosters page
-- (Office group), so the template has no remaining purpose. It was still a draft
-- with no shifts ever created from it and no apply batches.
--
-- Archived, not deleted (reversible). Note apply_template_to_date_range_v2 does
-- not check status, so archiving takes it out of normal use rather than making
-- it impossible to apply; the FT shift triggers still govern anything it stamps.
-- The WHERE clause re-checks every premise so this is a no-op if any changed.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.roster_templates
   SET status = 'archived', is_active = false, updated_at = now()
 WHERE id = '5915d5cd-c844-4024-86d0-299838281260'
   AND created_from = 'baseline_ft'
   AND status = 'draft'
   AND NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.template_id = '5915d5cd-c844-4024-86d0-299838281260')
   AND NOT EXISTS (SELECT 1 FROM public.roster_template_batches b WHERE b.template_id = '5915d5cd-c844-4024-86d0-299838281260');
