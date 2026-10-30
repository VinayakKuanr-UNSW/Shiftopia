-- ============================================================================
-- Drop unused performance-metrics functions
-- ============================================================================
-- Found by audit: none of these four have a frontend caller (confirmed by
-- grep across src/), and none are called by any other SQL function, trigger,
-- or pg_cron job in this schema. They exist alongside the now-superseded
-- employee_performance_metrics snapshot flow:
--   - refresh_all_performance_metrics()      — recomputed only the *current*
--     calendar quarter into the snapshot table Insights never read from.
--   - refresh_performance_metrics()          — looped active profiles calling
--     refresh_employee_performance_metrics(); also uncalled.
--   - refresh_performance_materialized_view() — refreshes employee_daily_metrics,
--     a materialized view with no frontend reader.
--   - get_team_metrics()                     — a third, independently
--     hand-written copy of the reliability-score formula (missing the
--     punctuality penalty terms present in get_quarterly_performance_report
--     and compute_employee_quarter_metrics), never wired to any screen.
--
-- refresh_employee_performance_metrics() and compute_employee_quarter_metrics()
-- are intentionally NOT dropped here — they still back whatever purpose the
-- employee_performance_metrics snapshot table's quarter-lock mechanism serves
-- outside of Insights/Employee Profile.
-- ============================================================================

DROP FUNCTION IF EXISTS "public"."refresh_all_performance_metrics"();
DROP FUNCTION IF EXISTS "public"."refresh_performance_metrics"();
DROP FUNCTION IF EXISTS "public"."refresh_performance_materialized_view"();
DROP FUNCTION IF EXISTS "public"."get_team_metrics"("uuid"[], "uuid"[], "uuid"[], timestamp with time zone, timestamp with time zone);
