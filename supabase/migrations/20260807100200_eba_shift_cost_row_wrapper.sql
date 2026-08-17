-- Migration: 20260807100200_eba_shift_cost_row_wrapper.sql
-- Description: One place that answers "what does this shift cost?", so the four
--              cost-reporting RPCs cannot drift apart again.
--
-- Before this, each RPC carried its own rate expression and they had all rotted
-- differently — one summed `COALESCE(remuneration_rate, 0)` (always $0, because
-- that column is NULL on every shift), one used a hardcoded $25/h, and the
-- planner footer had its own inline eba_rate lookup. Callers now write
-- `public.fn_eba_shift_cost(s)` and get the full award figure.

CREATE OR REPLACE FUNCTION public.fn_eba_resolve_shift_rate(
    p_remuneration_level     smallint,
    p_target_employment_type text,
    p_shift_date             date,
    p_actual_hourly_rate     numeric DEFAULT NULL,
    p_remuneration_rate      numeric DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog','public'
AS $$
    -- An explicit per-shift rate always wins (a manager override must never be
    -- silently replaced by the schedule). Otherwise resolve the effective-dated
    -- EBA rate for this classification + basis. `paid_hourly_rate` already
    -- carries the 25% casual loading; the engine de-loads it internally.
    SELECT COALESCE(
        p_actual_hourly_rate,
        p_remuneration_rate,
        (
            SELECT er.paid_hourly_rate
              FROM public.eba_rate er
             WHERE er.classification = 'LEVEL_' || p_remuneration_level::text
               AND er.employment_basis = CASE
                       WHEN p_target_employment_type = 'Casual' THEN 'casual'
                       ELSE 'permanent' END
               AND er.effective_from <= p_shift_date
             ORDER BY er.effective_from DESC
             LIMIT 1
        )
    );
$$;

ALTER FUNCTION public.fn_eba_resolve_shift_rate(smallint, text, date, numeric, numeric) OWNER TO postgres;

COMMENT ON FUNCTION public.fn_eba_resolve_shift_rate(smallint, text, date, numeric, numeric) IS
    'Effective-dated pay rate for a shift. Prefers an explicit per-shift rate, else public.eba_rate for the classification + employment basis as at the shift date. Returns the PAID rate (casual loading included). Never reads hr.remuneration_levels, which holds the stale unloaded permanent rate.';


CREATE OR REPLACE FUNCTION public.fn_eba_shift_cost(s public.shifts)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog','public'
AS $$
    SELECT public.fn_eba_estimate_shift_cost(
        s.shift_date,
        s.start_time,
        s.net_length_minutes,
        s.scheduled_length_minutes,
        public.fn_eba_resolve_shift_rate(
            s.remuneration_level, s.target_employment_type, s.shift_date,
            s.actual_hourly_rate, s.remuneration_rate),
        s.target_employment_type,
        COALESCE(s.target_requires_flexible, false),
        COALESCE(s.is_training, false)
    );
$$;

ALTER FUNCTION public.fn_eba_shift_cost(public.shifts) OWNER TO postgres;

COMMENT ON FUNCTION public.fn_eba_shift_cost(public.shifts) IS
    'Full award cost of one shift as SCHEDULED. The single entry point every cost-reporting RPC should use, so the roster footer, the insights breakdown, the trend chart and coverage stats can never disagree about what a shift costs.';
