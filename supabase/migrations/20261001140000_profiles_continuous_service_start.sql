-- Where continuous service began — the one date long service leave (cl 49,
-- NSW LSL Act), the 12-month service tests (cl 50.2, 51.1, 52.1) and the FDV
-- employment year (cl 46.2) all depend on. Audit M1, 2026-10-01.
--
-- WHY A NEW COLUMN. Neither existing date records it:
--   hr.user_contracts.start_date  — all 101 active contracts start 2026-08-24
--                                   (recreated in one bulk migration);
--   profiles.hire_date            — 100 of 107 are 2026-05-05 (bulk default).
-- Computing service from either would tell every employee they have about
-- five weeks of it. The application reads THIS column only, and treats NULL as
-- "not recorded" — service checks stay silent and LSL shows as not calculable —
-- rather than guessing. HR fills it from their records.
--
-- Additive and nullable: no existing row or query changes.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS continuous_service_start date;

COMMENT ON COLUMN public.profiles.continuous_service_start IS
  'Date continuous service with ICC Sydney began (for LSL cl 49, 12-month service tests cl 50-52, FDV year cl 46). NULL = not recorded; the app does not infer it from contract or hire dates, which are bulk-migration artefacts.';
