-- Drop seven relations and one shifts column that nothing reads or writes.
--
-- Checked against the live database on 2026-10-29: no function body, view,
-- cron job or policy names them, and no code in src/, supabase/functions/,
-- supabase/tests/, tests/, scripts/, optimizer-service/ or ml/ does either
-- (generated types aside).
--   - baseline_ft_runs (1 row) / baseline_ft_patterns (0 rows): the Office
--     generator's tables. Its last code went in 25e6db26 (#32).
--   - shifts.baseline_run_id: NULL on every shift; only its own index and the
--     FK into baseline_ft_runs depend on it.
--   - employee_daily_metrics (materialized, 204 rows): nothing refreshes or
--     reads it.
--   - v_performance_data_quality_alerts, hr.v_headcount_by_level,
--     hr.v_org_chart, hr.v_promotion_ladder: no reader.
--
-- Kept on purpose: availability_rules_archive / availability_slots_archive
-- (the FT-availability removal's retained copy) and the venueops_* mirror.
--
-- Rollback: DDL and data are in
-- ~/Documents/superman-db-exports/2026-10-29/orphaned-relations/
-- (schema.sql, shifts_column.sql, *.csv, SHA256SUMS).

DROP VIEW hr.v_headcount_by_level;
DROP VIEW hr.v_org_chart;
DROP VIEW hr.v_promotion_ladder;
DROP VIEW public.v_performance_data_quality_alerts;
DROP MATERIALIZED VIEW public.employee_daily_metrics;
ALTER TABLE public.shifts DROP COLUMN baseline_run_id;
DROP TABLE public.baseline_ft_runs;
DROP TABLE public.baseline_ft_patterns;
