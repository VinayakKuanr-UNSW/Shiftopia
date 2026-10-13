-- SYNTHETIC continuous-service start dates — test data, NOT HR records.
-- Requested by the user 2026-10-01 ("you can have random start dates").
--
-- Every profile gets a date between 2016-12-01 (ICC Sydney opened) and
-- 2026-08-24 (the bulk contract date), chosen from a hash of the profile id so
-- it is stable and reproducible — re-running gives the same dates, nobody gets
-- a new one on each deploy. This switches on long service leave, FDV-in-days
-- and the 12-month service checks for testing.
--
-- ⚠ These are not real. Replace with HR's records before anything that pays or
-- grants entitlements (LSL, parental leave) is relied on. The column comment is
-- updated to say so, so the data cannot be mistaken for real later.
--
-- Only fills NULLs: a date someone has already recorded is never overwritten.
-- To undo: UPDATE public.profiles SET continuous_service_start = NULL;

UPDATE public.profiles
SET continuous_service_start =
  DATE '2016-12-01'
  + (abs(hashtext(id::text)) % (DATE '2026-08-24' - DATE '2016-12-01' + 1))
WHERE continuous_service_start IS NULL;

COMMENT ON COLUMN public.profiles.continuous_service_start IS
  'Date continuous service with ICC Sydney began (LSL cl 49, 12-month service tests cl 50-52, FDV year cl 46). '
  'SYNTHETIC TEST DATA seeded 2026-10-01 (hash of profile id, 2016-12-01..2026-08-24) — replace with HR records '
  'before relying on it. NULL = not recorded; the app never infers it from contract or hire dates.';
