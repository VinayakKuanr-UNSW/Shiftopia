-- 20260630000200_vocab_cleanup.sql
-- Repair/delete the dead lowercase event_type consumer to unify the audit vocabulary.
-- The function calculate_employee_metrics used lowercase event_type strings (offer_sent, completed, etc)
-- which do not exist in the UPPERCASE enum (OFFERED, ACCEPTED, ASSIGNED).
-- It was technically dropped in 20260618041241_perf_hygiene.sql, but we explicitly drop it here
-- per the audit system design spec to ensure the audit vocabulary is single-sourced.

DROP FUNCTION IF EXISTS public.calculate_employee_metrics(uuid, date, date);

-- Also drop the non-existent view it referenced for completeness.
DROP VIEW IF EXISTS public.v_employee_metric_events;
