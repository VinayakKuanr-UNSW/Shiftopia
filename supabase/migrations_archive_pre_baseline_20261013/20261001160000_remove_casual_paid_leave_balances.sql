-- Remove annual / personal balances held by casual-only employees.
-- Audit H1 follow-up, 2026-10-01 — approved by the user in chat.
--
-- cl 12.5(b): the 25% casual loading is full recompense for paid annual and
-- personal leave, so a casual has no such balance. 17 casual-only employees
-- held one each (34 rows): created 2026-07-10..08-07, frozen since 2026-08-24,
-- used_hours = 0, none ever backed by a permanent contract. Since migration
-- 20261001120000 they could no longer be drawn on; this removes them.
--
-- REVERSIBLE: every removed row is copied first to
-- `_backup_leave_balances_casual_20261001` (RLS on, no policies, no grants —
-- service role only). To restore:
--   INSERT INTO public.leave_balances SELECT * FROM public._backup_leave_balances_casual_20261001;

CREATE TABLE IF NOT EXISTS public._backup_leave_balances_casual_20261001
  AS SELECT * FROM public.leave_balances WITH NO DATA;

ALTER TABLE public._backup_leave_balances_casual_20261001 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._backup_leave_balances_casual_20261001 FROM PUBLIC, anon, authenticated;

WITH casual_only AS (
  SELECT uc.user_id
  FROM hr.user_contracts uc
  WHERE uc.status = 'Active'
  GROUP BY uc.user_id
  HAVING bool_and(lower(coalesce(uc.employment_status::text, '')) LIKE '%casual%')
)
INSERT INTO public._backup_leave_balances_casual_20261001
SELECT b.*
FROM public.leave_balances b
JOIN casual_only c ON c.user_id = b.employee_id
WHERE b.leave_type IN ('annual', 'personal')
  AND b.used_hours = 0;  -- never drawn on; a used balance is not removed here

DELETE FROM public.leave_balances b
USING public._backup_leave_balances_casual_20261001 k
WHERE b.id = k.id;
