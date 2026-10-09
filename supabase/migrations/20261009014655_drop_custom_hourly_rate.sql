-- Drop hr.user_contracts.custom_hourly_rate.
--
-- Someone on a level is paid that level (decision 2026-10-08): no per-contract
-- rate. The column has been pinned NULL by CHECK user_contracts_no_custom_hourly_rate
-- since 20261008100113 (0 non-null rows), and nothing in the database reads it.
--
-- The API view keeps a typed NULL in the column's place for now. The app
-- build deployed before 2026-10-09 still SELECTs it in leaveGrossPay.ts, and
-- one unknown name rejects a whole PostgREST select — which reads as "no
-- leave pay", not as an error (memory: postgrest-select-one-bad-name). The
-- only writer was the retired autoschedule-simulate (now a 410 stub). Remove
-- the placeholder once the current build is deployed.
--
-- CREATE OR REPLACE keeps the dependent v_group_all_participants and the grants;
-- security_invoker is restated because a bare replace resets view options.

CREATE OR REPLACE VIEW public.user_contracts WITH (security_invoker = on) AS
 SELECT id,
    user_id,
    organization_id,
    department_id,
    sub_department_id,
    role_id,
    status,
    start_date,
    end_date,
    NULL::numeric(10,2) AS custom_hourly_rate,
    notes,
    created_at,
    updated_at,
    created_by,
    access_level,
    employment_status,
    contracted_weekly_hours,
    is_apprentice,
    apprentice_type,
    apprentice_year,
    has_completed_year_12,
    is_trainee,
    trainee_category,
    trainee_level,
    trainee_exit_year,
    trainee_years_out,
    trainee_aqf_level,
    trainee_year,
    is_training_on_job,
    prefers_sba_loading,
    is_sws,
    sws_capacity_percentage,
    is_sws_trial,
    sws_trial_start_date,
    annual_guaranteed_hours,
    remuneration_level,
    ordinary_span_start,
    ordinary_span_end,
    ordinary_days,
    position_id,
    ordinary_hours_cycle_weeks,
    ordinary_hours_cycle_anchor,
    pay_basis,
    eba_exclusion_reason,
    annual_salary,
    engagement_kind,
    multi_hire_request_ref
   FROM hr.user_contracts;

ALTER TABLE hr.user_contracts DROP COLUMN custom_hourly_rate;
