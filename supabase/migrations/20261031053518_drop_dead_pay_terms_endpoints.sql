-- Gross Pay follow-up 1 (#24, narrowed): drop the pay-terms endpoints nothing calls.
--
-- Pay is shown in Gross Pay alone, which reads hr.contract_pay_terms itself.
-- Consumers checked 2026-10-31 against main (app, edge functions, solver, ML),
-- every function, view, policy and cron job:
--   get_shift_pay_terms        no caller (get-roster-view v18 stopped merging it)
--   my_shift_pay_terms         no caller (computed field; only the generated types)
--   get_prospective_pay_terms  no caller
--   shift_pay_terms_for        called only by the two above
--   internal.prospective_pay_terms  called only by shift_pay_terms_for
-- KEPT, though #24 listed them: public.shift_pay_terms (get-roster-view still
-- selects it) and internal.shift_pay_terms (internal.shift_cost prices with it).
--
-- Test: supabase/tests/dead_pay_terms_endpoints_dropped.sql

DROP FUNCTION public.get_prospective_pay_terms(uuid[], uuid[]);
DROP FUNCTION public.my_shift_pay_terms(public.shifts);
DROP FUNCTION public.get_shift_pay_terms(uuid[]);
DROP FUNCTION public.shift_pay_terms_for(public.shifts, uuid);
DROP FUNCTION internal.prospective_pay_terms(public.shifts, uuid);
