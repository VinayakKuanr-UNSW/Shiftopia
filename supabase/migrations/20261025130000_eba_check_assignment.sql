-- Migration: 20261025130000_eba_check_assignment.sql
-- Move all EBA labour compliance rules from UI/Edge functions into database triggers and PL/pgSQL functions.
-- Source of truth: ICC Sydney EBA 2025.
-- Concurrency & Locking Contract: pg_advisory_xact_lock on emp_assign:employee_id; LEAST/GREATEST order for swaps.

CREATE OR REPLACE FUNCTION public.eba_check_assignment(
    p_shift_id uuid,
    p_employee_id uuid,
    p_shift_date date DEFAULT NULL,
    p_start_time time DEFAULT NULL,
    p_end_time time DEFAULT NULL,
    p_unpaid_break_mins integer DEFAULT NULL,
    p_role_id uuid DEFAULT NULL
)
RETURNS TABLE (
    is_compliant boolean,
    rule_id text,
    rule_name text,
    tier text,
    summary text,
    details text,
    payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
    v_shift public.shifts%ROWTYPE;
    v_engagement_kind text;
    v_daily_net_mins integer;
    v_engagement_count integer;
    v_day_shifts_count integer;
    v_gross_spread integer;
    v_total_breaks integer;
    v_net_spread integer;
    v_split_gap integer;
    v_short_sec_shifts integer;
    v_longest_daily_break integer;
    v_streak_start date;
    v_streak_end date;
    v_streak_len integer;
    v_shift_date date;
    v_start_time time;
    v_end_time time;
    v_unpaid_break_mins integer;
    v_role_id uuid;
    v_sub_department_id uuid;
    v_target_employment_type text;
    v_target_requires_flexible boolean;
    v_is_training boolean;
    
    v_emp_status text;
    v_contract_type text; -- 'FULL_TIME', 'PART_TIME', 'FLEXI_PART_TIME', 'CASUAL'
    v_is_security_role boolean := false;
    v_rest_gap_agreement_8h boolean := false;
    v_has_restricted_work_limit boolean := false;
    v_ordinary_hours_cycle_weeks smallint := 4;
    v_ordinary_hours_cycle_anchor date := '2024-01-01'::date;
    v_is_multi_hire boolean := false;

    v_other RECORD;
    v_cand_start timestamp;
    v_cand_end timestamp;
    v_gross_minutes integer;

    v_rule_violations_count integer := 0;

    v_cycle_days integer;
    v_cycle_weekly_limit numeric;
    v_cycle_total_limit numeric;
    v_cycle_idx integer;
    v_cycle_start date;
    v_cycle_end date;
    v_cycle_worked_hours numeric;
BEGIN
    -- 0. Short-circuit: no employee → compliant
    IF p_employee_id IS NULL THEN
        RETURN QUERY SELECT true, NULL::text, NULL::text, NULL::text, 'No employee assigned'::text, 'Shift has no assigned employee.'::text, '{}'::jsonb;
        RETURN;
    END IF;

    -- 1. Resolve shift parameters
    IF p_shift_id IS NOT NULL THEN
        SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
    END IF;

    v_shift_date := COALESCE(p_shift_date, v_shift.shift_date);
    v_start_time := COALESCE(p_start_time, v_shift.start_time);
    v_end_time := COALESCE(p_end_time, v_shift.end_time);
    v_unpaid_break_mins := COALESCE(p_unpaid_break_mins, v_shift.unpaid_break_minutes, 0);
    v_role_id := COALESCE(p_role_id, v_shift.role_id);
    v_sub_department_id := v_shift.sub_department_id;
    v_target_employment_type := v_shift.target_employment_type;
    v_target_requires_flexible := COALESCE(v_shift.target_requires_flexible, false);
    v_is_training := COALESCE(v_shift.is_training, false);

    IF v_shift_date IS NULL OR v_start_time IS NULL OR v_end_time IS NULL THEN
        RETURN QUERY SELECT true, NULL::text, NULL::text, NULL::text, 'Incomplete shift details'::text, 'Shift missing date or start/end time.'::text, '{}'::jsonb;
        RETURN;
    END IF;

    -- Calculate candidate timestamps
    v_cand_start := (v_shift_date::text || ' ' || v_start_time::text)::timestamp;
    IF v_end_time <= v_start_time AND v_end_time <> '00:00:00'::time THEN
        v_cand_end := ((v_shift_date + 1)::text || ' ' || v_end_time::text)::timestamp;
    ELSIF v_end_time = '00:00:00'::time AND v_start_time <> '00:00:00'::time THEN
        v_cand_end := ((v_shift_date + 1)::text || ' 00:00:00')::timestamp;
    ELSE
        v_cand_end := (v_shift_date::text || ' ' || v_end_time::text)::timestamp;
    END IF;

    v_gross_minutes := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_cand_end - v_cand_start)) / 60)::integer);

    -- 2. Resolve employee profiles & contracts
    SELECT COALESCE(rest_gap_agreement_8h, false)
      INTO v_rest_gap_agreement_8h
      FROM public.profiles
     WHERE id = p_employee_id;

    -- Student visa restricted work limit (live check against active licenses)
    SELECT EXISTS (
        SELECT 1 FROM public.employee_licenses el
         WHERE el.employee_id = p_employee_id
           AND el.has_restricted_work_limit = true
           AND (el.expiration_date IS NULL OR el.expiration_date >= v_shift_date)
    ) INTO v_has_restricted_work_limit;

    -- Contracts: Resolve governing contract for role or sub-department
    IF v_role_id IS NOT NULL THEN
        SELECT uc.employment_status::text, uc.engagement_kind, uc.ordinary_hours_cycle_weeks, uc.ordinary_hours_cycle_anchor
          INTO v_emp_status, v_engagement_kind, v_ordinary_hours_cycle_weeks, v_ordinary_hours_cycle_anchor
          FROM hr.user_contracts uc
         WHERE uc.user_id = p_employee_id
           AND uc.status = 'Active'
           AND uc.role_id = v_role_id
           AND (v_sub_department_id IS NULL OR uc.sub_department_id = v_sub_department_id OR uc.sub_department_id IS NULL)
         ORDER BY (uc.sub_department_id IS NOT DISTINCT FROM v_sub_department_id) DESC,
                  (uc.sub_department_id IS NOT NULL) DESC,
                  uc.id
         LIMIT 1;
    END IF;

    IF v_emp_status IS NULL THEN
        SELECT uc.employment_status::text, uc.engagement_kind, uc.ordinary_hours_cycle_weeks, uc.ordinary_hours_cycle_anchor
          INTO v_emp_status, v_engagement_kind, v_ordinary_hours_cycle_weeks, v_ordinary_hours_cycle_anchor
          FROM hr.user_contracts uc
         WHERE uc.user_id = p_employee_id
           AND uc.status = 'Active'
           AND (v_sub_department_id IS NULL OR uc.sub_department_id = v_sub_department_id OR uc.sub_department_id IS NULL)
         ORDER BY uc.id
         LIMIT 1;
    END IF;

    -- If still null, fallback to profile employment_type
    IF v_emp_status IS NULL THEN
        SELECT employment_type::text INTO v_emp_status
          FROM public.profiles
         WHERE id = p_employee_id;
    END IF;

    -- Normalize contract_type to ('FULL_TIME', 'PART_TIME', 'FLEXI_PART_TIME', 'CASUAL')
    IF lower(COALESCE(v_emp_status, '')) LIKE 'flexible%' THEN
        v_contract_type := 'FLEXI_PART_TIME';
    ELSIF lower(COALESCE(v_emp_status, '')) LIKE 'full%' THEN
        v_contract_type := 'FULL_TIME';
    ELSIF lower(COALESCE(v_emp_status, '')) LIKE 'part%' THEN
        v_contract_type := 'PART_TIME';
    ELSE
        v_contract_type := 'CASUAL';
    END IF;

    -- Multi-hire check
    IF v_engagement_kind = 'multi_hire' THEN
        v_is_multi_hire := true;
    END IF;

    -- Security role check
    IF v_role_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.roles WHERE id = v_role_id AND name ILIKE '%security%'
        ) INTO v_is_security_role;
    END IF;

    IF NOT v_is_security_role THEN
        SELECT EXISTS (
            SELECT 1 FROM hr.user_contracts uc
            JOIN public.roles r ON r.id = uc.role_id
            WHERE uc.user_id = p_employee_id
              AND uc.status = 'Active'
              AND r.name ILIKE '%security%'
        ) INTO v_is_security_role;
    END IF;

    -- Cycle defaults
    v_ordinary_hours_cycle_weeks := COALESCE(v_ordinary_hours_cycle_weeks, 4);
    IF v_is_security_role AND v_contract_type = 'FULL_TIME' THEN
        v_ordinary_hours_cycle_weeks := 8;
    END IF;
    v_ordinary_hours_cycle_anchor := COALESCE(v_ordinary_hours_cycle_anchor, '2024-01-01'::date);

    -- 3. Perform rule validations

    -- ── Rule 1: V8_NO_OVERLAP (BLOCKING) ──────────────────────────────────
    FOR v_other IN
        SELECT s.id, s.shift_date, s.start_time, s.end_time,
               (s.shift_date::text || ' ' || s.start_time::text)::timestamp AS other_start,
               CASE WHEN s.end_time <= s.start_time AND s.end_time <> '00:00:00'::time
                    THEN ((s.shift_date + 1)::text || ' ' || s.end_time::text)::timestamp
                    WHEN s.end_time = '00:00:00'::time AND s.start_time <> '00:00:00'::time
                    THEN ((s.shift_date + 1)::text || ' 00:00:00')::timestamp
                    ELSE (s.shift_date::text || ' ' || s.end_time::text)::timestamp
               END AS other_end
          FROM public.shifts s
         WHERE s.assigned_employee_id = p_employee_id
           AND NOT COALESCE(s.is_cancelled, false)
           AND (p_shift_id IS NULL OR s.id <> p_shift_id)
           AND s.shift_date BETWEEN v_shift_date - 1 AND v_shift_date + 1
    LOOP
        IF v_cand_start < v_other.other_end AND v_other.other_start < v_cand_end THEN
            v_rule_violations_count := v_rule_violations_count + 1;
            RETURN QUERY SELECT
                false,
                'V8_NO_OVERLAP'::text,
                'No Overlap'::text,
                'BLOCKING'::text,
                'Shift overlaps with an existing shift'::text,
                format('This shift overlaps with an existing shift on %s (%s–%s). One person cannot work two shifts at once.',
                       to_char(v_other.shift_date, 'YYYY-MM-DD'),
                       to_char(v_other.start_time, 'HH24:MI'),
                       to_char(v_other.end_time, 'HH24:MI')),
                jsonb_build_object('overlapping_shift_id', v_other.id, 'date', v_other.shift_date);
        END IF;
    END LOOP;

    -- ── Rule 2: V8_LEAVE_CONFLICT (BLOCKING) ──────────────────────────────
    FOR v_other IN
        SELECT lr.leave_type, lr.start_date, lr.end_date
          FROM public.leave_requests lr
         WHERE lr.employee_id = p_employee_id
           AND lr.status = 'approved'
           AND v_shift_date BETWEEN (lr.start_date AT TIME ZONE 'UTC')::date
                                AND (lr.end_date   AT TIME ZONE 'UTC')::date
    LOOP
        v_rule_violations_count := v_rule_violations_count + 1;
        RETURN QUERY SELECT
            false,
            'V8_LEAVE_CONFLICT'::text,
            'Approved Leave'::text,
            'BLOCKING'::text,
            'Employee is on approved leave'::text,
            format('This shift falls on %s, a day the employee has approved %s leave. Approved leave is a hard unavailability — unassign the leave or pick another employee.',
                   to_char(v_shift_date, 'YYYY-MM-DD'),
                   replace(v_other.leave_type, '_', ' ')),
            jsonb_build_object('leave_type', v_other.leave_type, 'date', v_shift_date);
    END LOOP;

    -- ── Rule 3: V8_QUALIFICATIONS & V8_QUALIFICATION_EXPIRED (BLOCKING) ───
    IF p_shift_id IS NOT NULL THEN
        -- Check skills
        FOR v_other IN
            WITH req_skills AS (
                SELECT skill_id FROM public.shift_skills WHERE shift_id = p_shift_id
                UNION
                SELECT (jsonb_array_elements_text(v_shift.required_skills))::uuid
                 WHERE v_shift.required_skills IS NOT NULL 
                   AND jsonb_typeof(v_shift.required_skills) = 'array'
                   AND jsonb_array_length(v_shift.required_skills) > 0
            )
            SELECT rs.skill_id, sk.name AS skill_name, es.expiration_date
              FROM req_skills rs
              JOIN public.skills sk ON sk.id = rs.skill_id
              LEFT JOIN public.employee_skills es ON es.employee_id = p_employee_id AND es.skill_id = rs.skill_id
        LOOP
            IF v_other.expiration_date IS NOT NULL AND v_other.expiration_date < v_shift_date THEN
                v_rule_violations_count := v_rule_violations_count + 1;
                RETURN QUERY SELECT
                    false,
                    'V8_QUALIFICATION_EXPIRED'::text,
                    'Expired Qualification'::text,
                    'BLOCKING'::text,
                    'Required skill expired before shift date'::text,
                    format('Skill "%s" expired on %s before shift date %s.', v_other.skill_name, to_char(v_other.expiration_date, 'YYYY-MM-DD'), to_char(v_shift_date, 'YYYY-MM-DD')),
                    jsonb_build_object('skill_id', v_other.skill_id, 'skill_name', v_other.skill_name, 'expiration_date', v_other.expiration_date);
            ELSIF v_other.expiration_date IS NULL AND NOT EXISTS (SELECT 1 FROM public.employee_skills WHERE employee_id = p_employee_id AND skill_id = v_other.skill_id) THEN
                v_rule_violations_count := v_rule_violations_count + 1;
                RETURN QUERY SELECT
                    false,
                    'V8_QUALIFICATIONS'::text,
                    'Qualifications'::text,
                    'BLOCKING'::text,
                    'Missing required skill'::text,
                    format('Required skill "%s" not held by employee.', v_other.skill_name),
                    jsonb_build_object('skill_id', v_other.skill_id, 'skill_name', v_other.skill_name);
            END IF;
        END LOOP;

        -- Check licenses
        FOR v_other IN
            WITH req_lic AS (
                SELECT license_id FROM public.shift_licenses WHERE shift_id = p_shift_id AND COALESCE(is_required, true) = true
                UNION
                SELECT (jsonb_array_elements_text(v_shift.required_licenses))::uuid
                 WHERE v_shift.required_licenses IS NOT NULL 
                   AND jsonb_typeof(v_shift.required_licenses) = 'array'
                   AND jsonb_array_length(v_shift.required_licenses) > 0
            )
            SELECT rl.license_id, l.name AS license_name,
                   (SELECT MAX(expiration_date) FROM public.employee_licenses el WHERE el.employee_id = p_employee_id AND el.license_id = rl.license_id) AS expiration_date,
                   EXISTS(SELECT 1 FROM public.employee_licenses el WHERE el.employee_id = p_employee_id AND el.license_id = rl.license_id) AS is_held
              FROM req_lic rl
              JOIN public.licenses l ON l.id = rl.license_id
        LOOP
            IF NOT v_other.is_held THEN
                v_rule_violations_count := v_rule_violations_count + 1;
                RETURN QUERY SELECT
                    false,
                    'V8_QUALIFICATIONS'::text,
                    'Qualifications'::text,
                    'BLOCKING'::text,
                    'Missing required license'::text,
                    format('Required license "%s" not held by employee.', v_other.license_name),
                    jsonb_build_object('license_id', v_other.license_id, 'license_name', v_other.license_name);
            ELSIF v_other.expiration_date IS NOT NULL AND v_other.expiration_date < v_shift_date THEN
                v_rule_violations_count := v_rule_violations_count + 1;
                RETURN QUERY SELECT
                    false,
                    'V8_QUALIFICATION_EXPIRED'::text,
                    'Expired Qualification'::text,
                    'BLOCKING'::text,
                    'Required license expired before shift date'::text,
                    format('License "%s" expired on %s before shift date %s.', v_other.license_name, to_char(v_other.expiration_date, 'YYYY-MM-DD'), to_char(v_shift_date, 'YYYY-MM-DD')),
                    jsonb_build_object('license_id', v_other.license_id, 'license_name', v_other.license_name, 'expiration_date', v_other.expiration_date);
            END IF;
        END LOOP;
    END IF;

    -- ── Rule 4: V8_EMPLOYMENT_TARGET (BLOCKING) ───────────────────────────
    IF v_target_employment_type IS NOT NULL AND v_target_employment_type <> '' THEN
        IF v_emp_status IS NULL OR public.fn_normalize_employment_type(v_emp_status) <> public.fn_normalize_employment_type(v_target_employment_type) THEN
            v_rule_violations_count := v_rule_violations_count + 1;
            RETURN QUERY SELECT
                false,
                'V8_EMPLOYMENT_TARGET'::text,
                'Employment Target'::text,
                'BLOCKING'::text,
                'Employment target mismatch'::text,
                format('This shift is for %s staff, but employee is %s on their active contract.', v_target_employment_type, COALESCE(v_emp_status, 'uncontracted')),
                jsonb_build_object('target_employment_type', v_target_employment_type, 'employee_status', v_emp_status);
        ELSIF v_target_requires_flexible AND lower(btrim(v_emp_status)) NOT LIKE 'flexible%' THEN
            v_rule_violations_count := v_rule_violations_count + 1;
            RETURN QUERY SELECT
                false,
                'V8_EMPLOYMENT_TARGET'::text,
                'Employment Target'::text,
                'BLOCKING'::text,
                'Requires Flexible Part-Time'::text,
                format('This shift requires Flexible Part-Time staff, but employee is %s.', v_emp_status),
                jsonb_build_object('target_employment_type', v_target_employment_type, 'employee_status', v_emp_status);
        END IF;
    END IF;

    -- ── Multi-Shift Evaluation (Rules 5 to 16) ───────────────────────────
    DROP TABLE IF EXISTS tmp_eval_shifts;
    CREATE TEMP TABLE tmp_eval_shifts ON COMMIT DROP AS
        SELECT s.id,
               s.shift_date,
               s.start_time,
               s.end_time,
               COALESCE(s.unpaid_break_minutes, 0) AS unpaid_break_minutes,
               COALESCE(s.paid_break_minutes, 0) AS paid_break_minutes,
               COALESCE(s.is_training, false) AS is_training,
               (s.shift_date::text || ' ' || s.start_time::text)::timestamp AS start_dt,
               CASE WHEN s.end_time <= s.start_time AND s.end_time <> '00:00:00'::time
                    THEN ((s.shift_date + 1)::text || ' ' || s.end_time::text)::timestamp
                    WHEN s.end_time = '00:00:00'::time AND s.start_time <> '00:00:00'::time
                    THEN ((s.shift_date + 1)::text || ' 00:00:00')::timestamp
                    ELSE (s.shift_date::text || ' ' || s.end_time::text)::timestamp
               END AS end_dt,
               EXISTS (SELECT 1 FROM hr.user_contracts uc WHERE uc.id = s.user_contract_id AND uc.engagement_kind = 'multi_hire') AS is_multi_hire,
               false AS is_candidate
          FROM public.shifts s
         WHERE s.assigned_employee_id = p_employee_id
           AND NOT COALESCE(s.is_cancelled, false)
           AND (p_shift_id IS NULL OR s.id <> p_shift_id)
           AND s.shift_date BETWEEN v_shift_date - 56 AND v_shift_date + 56
        UNION ALL
        SELECT COALESCE(p_shift_id, '00000000-0000-0000-0000-000000000000'::uuid) AS id,
               v_shift_date AS shift_date,
               v_start_time AS start_time,
               v_end_time AS end_time,
               v_unpaid_break_mins AS unpaid_break_minutes,
               CASE WHEN v_is_security_role THEN LEAST(v_unpaid_break_mins, 60) ELSE 0 END AS paid_break_minutes,
               v_is_training AS is_training,
               v_cand_start AS start_dt,
               v_cand_end AS end_dt,
               v_is_multi_hire AS is_multi_hire,
               true AS is_candidate;

    -- ── Rule 5: V8_MIN_REST_GAP (BLOCKING) ────────────────────────────────
    FOR v_other IN
        WITH ordered_shifts AS (
            SELECT *,
                   LEAD(start_dt) OVER (ORDER BY start_dt) AS next_start,
                   LEAD(end_dt) OVER (ORDER BY start_dt) AS next_end,
                   LEAD(shift_date) OVER (ORDER BY start_dt) AS next_date,
                   LEAD(is_multi_hire) OVER (ORDER BY start_dt) AS next_is_multi_hire,
                   LEAD(is_candidate) OVER (ORDER BY start_dt) AS next_is_candidate
              FROM tmp_eval_shifts
        )
        SELECT shift_date AS a_date,
               next_date AS b_date,
               ROUND(EXTRACT(EPOCH FROM (next_start - end_dt)) / 60)::integer AS gap_minutes,
               CASE WHEN is_multi_hire OR next_is_multi_hire OR v_rest_gap_agreement_8h THEN 480 ELSE 600 END AS req_minutes
          FROM ordered_shifts
         WHERE next_start IS NOT NULL
           AND next_date <> shift_date
           AND (is_candidate OR next_is_candidate)
           AND EXTRACT(EPOCH FROM (next_start - end_dt)) >= 0
           AND EXTRACT(EPOCH FROM (next_start - end_dt)) / 60 < CASE WHEN is_multi_hire OR next_is_multi_hire OR v_rest_gap_agreement_8h THEN 480 ELSE 600 END
    LOOP
        v_rule_violations_count := v_rule_violations_count + 1;
        RETURN QUERY SELECT
            false,
            'V8_MIN_REST_GAP'::text,
            'Minimum Rest Gap'::text,
            'BLOCKING'::text,
            format('Insufficient rest between days (%sh)', ROUND(v_other.gap_minutes / 60.0, 1))::text,
            format('Only %sh rest between the shift on %s and the shift on %s. Minimum required is %sh%s.',
                   ROUND(v_other.gap_minutes / 60.0, 1),
                   to_char(v_other.a_date, 'YYYY-MM-DD'),
                   to_char(v_other.b_date, 'YYYY-MM-DD'),
                   (v_other.req_minutes / 60)::text,
                   CASE WHEN v_other.req_minutes = 480 AND v_rest_gap_agreement_8h THEN ' (8h rest gap agreement)'
                        WHEN v_other.req_minutes = 480 THEN ' (multi-hire engagement)' ELSE '' END),
            jsonb_build_object('gap_minutes', v_other.gap_minutes, 'required_minutes', v_other.req_minutes, 'date_a', v_other.a_date, 'date_b', v_other.b_date);
    END LOOP;

    -- ── Rule 6: V8_MAX_DAILY_HOURS (BLOCKING) ────────────────────────────
    SELECT COALESCE(SUM(GREATEST(0, ROUND(EXTRACT(EPOCH FROM (end_dt - start_dt)) / 60)::integer - unpaid_break_minutes)), 0)
      INTO v_daily_net_mins
      FROM tmp_eval_shifts
     WHERE shift_date = v_shift_date;

    IF v_daily_net_mins > 720 THEN
        v_rule_violations_count := v_rule_violations_count + 1;
        RETURN QUERY SELECT
            false,
            'V8_MAX_DAILY_HOURS'::text,
            'Maximum Daily Hours'::text,
            'BLOCKING'::text,
            'Exceeds 12h daily limit'::text,
            format('Employee worked %sh on %s, exceeding the 12h cap.',
                   ROUND(v_daily_net_mins / 60.0, 1),
                   to_char(v_shift_date, 'YYYY-MM-DD')),
            jsonb_build_object('total_minutes', v_daily_net_mins, 'limit_minutes', 720, 'date', v_shift_date);
    END IF;

    -- ── Rule 7: V8_MAX_DAILY_ENGAGEMENTS (Casual Only, BLOCKING) ──────────
    IF v_contract_type = 'CASUAL' THEN
        SELECT COUNT(*)
          INTO v_engagement_count
          FROM tmp_eval_shifts
         WHERE shift_date = v_shift_date
           AND NOT is_training;

        IF v_engagement_count > 2 THEN
            v_rule_violations_count := v_rule_violations_count + 1;
            RETURN QUERY SELECT
                false,
                'V8_MAX_DAILY_ENGAGEMENTS'::text,
                'Maximum Daily Engagements (Casual)'::text,
                'BLOCKING'::text,
                format('Casual exceeds 2 engagements on %s (%s)', to_char(v_shift_date, 'YYYY-MM-DD'), v_engagement_count)::text,
                format('A casual Team Member may work no more than 2 separate engagements on any one day (ICC EBA cl. 35.4(f)). This roster places %s non-training shifts on %s.',
                       v_engagement_count,
                       to_char(v_shift_date, 'YYYY-MM-DD')),
                jsonb_build_object('engagement_count', v_engagement_count, 'max_engagements', 2, 'date', v_shift_date);
        END IF;
    END IF;

    -- ── Multi-Engagement Rules on Shift Date (Rules 8, 9, 10, 11, 16) ────
    SELECT COUNT(*) INTO v_day_shifts_count FROM tmp_eval_shifts WHERE shift_date = v_shift_date;

    IF v_day_shifts_count >= 2 THEN
        SELECT ROUND(EXTRACT(EPOCH FROM (MAX(end_dt) - MIN(start_dt))) / 60)::integer AS gross_spread,
               COALESCE(SUM(unpaid_break_minutes + paid_break_minutes), 0) AS total_breaks
          INTO v_gross_spread, v_total_breaks
          FROM tmp_eval_shifts
         WHERE shift_date = v_shift_date;

        -- Rule 8: V8_SPLIT_SHIFT_SPREAD (PT/FPT, net spread > 12h, BLOCKING)
        IF v_contract_type IN ('PART_TIME', 'FLEXI_PART_TIME') THEN
            v_net_spread := GREATEST(0, v_gross_spread - v_total_breaks);
            IF v_net_spread > 720 THEN
                v_rule_violations_count := v_rule_violations_count + 1;
                RETURN QUERY SELECT
                    false,
                    'V8_SPLIT_SHIFT_SPREAD'::text,
                    'Split-Shift Spread'::text,
                    'BLOCKING'::text,
                    format('Split-shift spread exceeds 12h (%sh net)', ROUND(v_net_spread / 60.0, 1))::text,
                    format('The engagements on %s span %s hours from first start to last end. Excluding %s minutes of meal and rest breaks that is %s hours of spread, over the 12-hour maximum for a split shift (ICC EBA cl. 39.2).',
                           to_char(v_shift_date, 'YYYY-MM-DD'),
                           ROUND(v_gross_spread / 60.0, 1),
                           v_total_breaks,
                           ROUND(v_net_spread / 60.0, 1)),
                    jsonb_build_object('gross_spread_minutes', v_gross_spread, 'net_spread_minutes', v_net_spread, 'break_minutes', v_total_breaks, 'limit_minutes', 720, 'date', v_shift_date);
            END IF;

            -- Rule 16: V8_SPLIT_SHIFT (WARNING: gap > 3h)
            IF NOT v_is_multi_hire AND v_day_shifts_count = 2 THEN
                SELECT ROUND(EXTRACT(EPOCH FROM (s2.start_dt - s1.end_dt)) / 60)::integer
                  INTO v_split_gap
                  FROM (SELECT end_dt FROM tmp_eval_shifts WHERE shift_date = v_shift_date ORDER BY start_dt LIMIT 1) s1,
                       (SELECT start_dt FROM tmp_eval_shifts WHERE shift_date = v_shift_date ORDER BY start_dt DESC LIMIT 1) s2;
                
                IF v_split_gap > 180 THEN
                    RETURN QUERY SELECT
                        true,
                        'V8_SPLIT_SHIFT'::text,
                        'Split Shift'::text,
                        'WARNING'::text,
                        format('Split shift gap exceeds 3 hours (%sh)', ROUND(v_split_gap / 60.0, 1))::text,
                        format('Where a day is worked in two parts, the gap between them should not exceed 3 hours (ICC EBA cl. 39.4). The gap on %s is %s hours.',
                               to_char(v_shift_date, 'YYYY-MM-DD'),
                               ROUND(v_split_gap / 60.0, 1)),
                        jsonb_build_object('gap_minutes', v_split_gap, 'max_gap_minutes', 180, 'date', v_shift_date);
                END IF;
            END IF;
        END IF;

        -- Rule 9: V8_CASUAL_SECURITY_SPREAD (Casual Event Security, gross > 12h, BLOCKING)
        IF v_contract_type = 'CASUAL' AND v_is_security_role THEN
            IF v_gross_spread > 720 THEN
                v_rule_violations_count := v_rule_violations_count + 1;
                RETURN QUERY SELECT
                    false,
                    'V8_CASUAL_SECURITY_SPREAD'::text,
                    'Casual Security Daily Spread'::text,
                    'BLOCKING'::text,
                    format('Security spread exceeds 12h (%sh)', ROUND(v_gross_spread / 60.0, 1))::text,
                    format('A casual Event Security Team Member working two shifts in one day may span no more than 12 hours gross (EBA Schedule 3 §5.3(g)). The engagements on %s span %s hours.',
                           to_char(v_shift_date, 'YYYY-MM-DD'),
                           ROUND(v_gross_spread / 60.0, 1)),
                    jsonb_build_object('gross_spread_minutes', v_gross_spread, 'limit_minutes', 720, 'date', v_shift_date);
            END IF;

            -- Rule 10: V8_CASUAL_SECURITY_ENGAGEMENT (>= 3h per engagement, BLOCKING)
            SELECT COUNT(*)
              INTO v_short_sec_shifts
              FROM tmp_eval_shifts
             WHERE shift_date = v_shift_date
               AND (ROUND(EXTRACT(EPOCH FROM (end_dt - start_dt)) / 60)::integer - unpaid_break_minutes) < 180;

            IF v_short_sec_shifts > 0 THEN
                v_rule_violations_count := v_rule_violations_count + 1;
                RETURN QUERY SELECT
                    false,
                    'V8_CASUAL_SECURITY_ENGAGEMENT'::text,
                    'Casual Security Two-Shift Engagement'::text,
                    'BLOCKING'::text,
                    'Each engagement must be at least 3h when working two shifts'::text,
                    format('Where a casual Event Security Team Member works two shifts in one day, each engagement must be no less than 3 hours (EBA Schedule 3 §5.3(g)). %s engagement(s) on %s fall short.',
                           v_short_sec_shifts,
                           to_char(v_shift_date, 'YYYY-MM-DD')),
                    jsonb_build_object('required_minutes', 180, 'short_shifts_count', v_short_sec_shifts, 'date', v_shift_date);
            END IF;
        END IF;

        -- Rule 11: V8_DAILY_MEAL_BREAK (total worked > 5h requires in-shift break >= 30m or gap >= 30m, BLOCKING)
        IF v_daily_net_mins > 300 THEN
            SELECT GREATEST(
                COALESCE((SELECT MAX(CASE WHEN v_is_security_role THEN LEAST(paid_break_minutes, 60) ELSE unpaid_break_minutes END) FROM tmp_eval_shifts WHERE shift_date = v_shift_date), 0),
                COALESCE((
                    WITH day_s AS (
                        SELECT end_dt, LEAD(start_dt) OVER (ORDER BY start_dt) AS n_start
                          FROM tmp_eval_shifts WHERE shift_date = v_shift_date
                    )
                    SELECT MAX(ROUND(EXTRACT(EPOCH FROM (n_start - end_dt)) / 60)::integer)
                      FROM day_s WHERE n_start IS NOT NULL
                ), 0)
            ) INTO v_longest_daily_break;

            IF v_longest_daily_break < 30 THEN
                v_rule_violations_count := v_rule_violations_count + 1;
                RETURN QUERY SELECT
                    false,
                    'V8_DAILY_MEAL_BREAK'::text,
                    'Daily Meal Break'::text,
                    'BLOCKING'::text,
                    format('%sh worked on %s with no meal break', ROUND(v_daily_net_mins / 60.0, 1), to_char(v_shift_date, 'YYYY-MM-DD'))::text,
                    format('A Team Member who works more than 5 hours on any one day is entitled to a meal break of not less than 30 minutes (ICC EBA cl. 36.1). The %s engagements on %s total %s hours worked, and the longest break interval is %s minutes.',
                           v_day_shifts_count,
                           to_char(v_shift_date, 'YYYY-MM-DD'),
                           ROUND(v_daily_net_mins / 60.0, 1),
                           v_longest_daily_break),
                    jsonb_build_object('worked_minutes', v_daily_net_mins, 'longest_break_minutes', v_longest_daily_break, 'required_break_minutes', 30, 'date', v_shift_date);
            END IF;
        END IF;
    END IF;

    -- ── Rule 12: V8_20_IN_28 (BLOCKING) ──────────────────────────────────
    FOR v_other IN
        WITH distinct_days AS (
            SELECT DISTINCT shift_date AS worked_date FROM tmp_eval_shifts
        ),
        windows AS (
            SELECT (w_end::date - 27)::date AS w_start, w_end::date AS w_end
              FROM generate_series(v_shift_date, v_shift_date + 27, interval '1 day') AS w_end
        )
        SELECT w.w_start, w.w_end, COUNT(dd.worked_date) AS days_worked
          FROM windows w
          JOIN distinct_days dd ON dd.worked_date BETWEEN w.w_start AND w.w_end
         GROUP BY w.w_start, w.w_end
        HAVING COUNT(dd.worked_date) > 20
         ORDER BY COUNT(dd.worked_date) DESC
         LIMIT 1
    LOOP
        v_rule_violations_count := v_rule_violations_count + 1;
        RETURN QUERY SELECT
            false,
            'V8_20_IN_28'::text,
            '20 Days in 28 Limit'::text,
            'BLOCKING'::text,
            format('Worked %s days in 28-day window', v_other.days_worked)::text,
            format('Employee worked %s days between %s and %s. Max allowed is 20 days (ICC EBA cl. 35).',
                   v_other.days_worked,
                   to_char(v_other.w_start, 'YYYY-MM-DD'),
                   to_char(v_other.w_end, 'YYYY-MM-DD')),
            jsonb_build_object('window_worked', v_other.days_worked, 'limit', 20, 'window_start', v_other.w_start, 'window_end', v_other.w_end);
    END LOOP;

    -- ── Rule 13: V8_STREAK_LIMIT (Flexi-PT Only, BLOCKING) ───────────────
    IF v_contract_type = 'FLEXI_PART_TIME' THEN
        WITH distinct_days AS (
            SELECT DISTINCT shift_date AS d FROM tmp_eval_shifts
        ),
        streaks AS (
            SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::integer AS grp
              FROM distinct_days
        ),
        grouped_streaks AS (
            SELECT MIN(d) AS streak_start, MAX(d) AS streak_end, (MAX(d) - MIN(d) + 1)::integer AS streak_len
              FROM streaks
             GROUP BY grp
        )
        SELECT streak_start, streak_end, streak_len
          INTO v_streak_start, v_streak_end, v_streak_len
          FROM grouped_streaks
         WHERE v_shift_date BETWEEN streak_start AND streak_end
           AND streak_len > 10
         LIMIT 1;

        IF v_streak_len > 10 THEN
            v_rule_violations_count := v_rule_violations_count + 1;
            RETURN QUERY SELECT
                false,
                'V8_STREAK_LIMIT'::text,
                'Maximum Consecutive Days'::text,
                'BLOCKING'::text,
                format('%s consecutive working days', v_streak_len)::text,
                format('Employee worked %s days in a row (from %s to %s). Limit for Flexi-PT is 10 days (ICC EBA cl. 35.3(g)).',
                       v_streak_len,
                       to_char(v_streak_start, 'YYYY-MM-DD'),
                       to_char(v_streak_end, 'YYYY-MM-DD')),
                jsonb_build_object('streak_length', v_streak_len, 'limit', 10, 'streak_start', v_streak_start, 'streak_end', v_streak_end);
        END IF;
    END IF;

    -- ── Rule 14: V8_STUDENT_VISA_LIMIT (Student Visa Only, BLOCKING) ──────
    IF v_has_restricted_work_limit THEN
        FOR v_other IN
            WITH daily_hours AS (
                SELECT shift_date AS d,
                       SUM(GREATEST(0, ROUND(EXTRACT(EPOCH FROM (end_dt - start_dt)) / 60)::integer - unpaid_break_minutes)) / 60.0 AS net_hrs
                  FROM tmp_eval_shifts
                 GROUP BY shift_date
            ),
            windows AS (
                SELECT (w_end::date - 13)::date AS w_start, w_end::date AS w_end
                  FROM generate_series(v_shift_date, v_shift_date + 13, interval '1 day') AS w_end
            )
            SELECT w.w_start, w.w_end, SUM(dh.net_hrs) AS win_hours
              FROM windows w
              JOIN daily_hours dh ON dh.d BETWEEN w.w_start AND w.w_end
             GROUP BY w.w_start, w.w_end
            HAVING SUM(dh.net_hrs) > 48.0
             ORDER BY SUM(dh.net_hrs) DESC
             LIMIT 1
        LOOP
            v_rule_violations_count := v_rule_violations_count + 1;
            RETURN QUERY SELECT
                false,
                'V8_STUDENT_VISA_LIMIT'::text,
                'Student Visa 48h Limit'::text,
                'BLOCKING'::text,
                format('Exceeds 48h visa limit (%sh)', ROUND(v_other.win_hours, 1))::text,
                format('Employee has worked %sh in the 14-day window from %s to %s, exceeding the 48-hour student visa limit (visa condition 8105).',
                       ROUND(v_other.win_hours, 1),
                       to_char(v_other.w_start, 'YYYY-MM-DD'),
                       to_char(v_other.w_end, 'YYYY-MM-DD')),
                jsonb_build_object('total_hours', v_other.win_hours, 'limit', 48, 'window_start', v_other.w_start, 'window_end', v_other.w_end);
        END LOOP;
    END IF;

    -- ── Rule 15: V8_ORD_HOURS_AVG (BLOCKING) ──────────────────────────────
    v_cycle_days := v_ordinary_hours_cycle_weeks * 7;
    v_cycle_weekly_limit := CASE WHEN v_is_security_role AND v_contract_type = 'FULL_TIME' THEN 42.0 ELSE 38.0 END;
    v_cycle_total_limit := v_ordinary_hours_cycle_weeks * v_cycle_weekly_limit;
    
    v_cycle_idx := FLOOR((v_shift_date - v_ordinary_hours_cycle_anchor)::numeric / v_cycle_days)::integer;
    v_cycle_start := v_ordinary_hours_cycle_anchor + (v_cycle_idx * v_cycle_days);
    v_cycle_end := v_cycle_start + v_cycle_days - 1;

    SELECT COALESCE(SUM(GREATEST(0, ROUND(EXTRACT(EPOCH FROM (end_dt - start_dt)) / 60)::integer - unpaid_break_minutes)) / 60.0, 0)
      INTO v_cycle_worked_hours
      FROM tmp_eval_shifts
     WHERE shift_date BETWEEN v_cycle_start AND v_cycle_end;

    IF v_cycle_worked_hours > v_cycle_total_limit THEN
        v_rule_violations_count := v_rule_violations_count + 1;
        RETURN QUERY SELECT
            false,
            'V8_ORD_HOURS_AVG'::text,
            'Ordinary Hours Averaging'::text,
            'BLOCKING'::text,
            format('Exceeds %sh over the %s-week cycle', ROUND(v_cycle_total_limit, 0), v_ordinary_hours_cycle_weeks)::text,
            format('Employee worked %sh in the %s-day window from %s to %s — an average of %sh/week, over the %sh/week ordinary-hours ceiling (%s).',
                   ROUND(v_cycle_worked_hours, 1),
                   v_cycle_days,
                   to_char(v_cycle_start, 'YYYY-MM-DD'),
                   to_char(v_cycle_end, 'YYYY-MM-DD'),
                   ROUND(v_cycle_worked_hours / v_ordinary_hours_cycle_weeks, 1),
                   v_cycle_weekly_limit::text,
                   CASE WHEN v_is_security_role AND v_contract_type = 'FULL_TIME' THEN 'ICC EBA Schedule 3 §3' ELSE 'ICC EBA cl. 35' END),
            jsonb_build_object('total_hours', v_cycle_worked_hours, 'limit', v_cycle_total_limit, 'average', v_cycle_worked_hours / v_ordinary_hours_cycle_weeks, 'window_days', v_cycle_days, 'cycle_start', v_cycle_start, 'cycle_end', v_cycle_end);
    END IF;

    -- Return passing row if no blocking/warning hits occurred
    IF v_rule_violations_count = 0 THEN
        RETURN QUERY SELECT
            true,
            NULL::text,
            NULL::text,
            NULL::text,
            'Passed'::text,
            'All EBA compliance checks passed.'::text,
            '{}'::jsonb;
    END IF;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.eba_check_assignment(uuid, uuid, date, time, time, integer, uuid) TO authenticated, service_role;


-- ── Gateway Mutation Hardening (_apply_shift_op_write) ─────────────────────
CREATE OR REPLACE FUNCTION public._apply_shift_op_write(
    p_shift_id uuid,
    p_op text,
    p_payload jsonb,
    p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cur            RECORD;
  v_winner         uuid;
  v_emp            uuid;
  v_swap           public.shift_swaps%ROWTYPE;
  v_edit_state     text;
  v_new_emp        uuid;
  v_do_assign      boolean := false;
  v_do_unassign    boolean := false;
  v_assign_src     text;
  v_breach_rule    text;
  v_breach_details text;
BEGIN
  SELECT * INTO v_cur FROM public.shifts WHERE id = p_shift_id;

  IF p_op = 'assign' THEN
    v_emp := NULLIF(p_payload->>'employee_id', '')::uuid;
    IF v_emp IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'MISSING_EMPLOYEE_ID');
    END IF;

    -- Concurrency Contract: Lock employee identity before running checks
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_emp::text));

    -- Full EBA compliance check (blocking tier)
    SELECT rule_id, details INTO v_breach_rule, v_breach_details
      FROM public.eba_check_assignment(p_shift_id, v_emp)
     WHERE tier = 'BLOCKING'
     LIMIT 1;

    IF v_breach_rule IS NOT NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
    END IF;

    UPDATE public.shifts SET
      assigned_employee_id = v_emp,
      assigned_at          = NOW(),
      assignment_status    = 'assigned'::public.shift_assignment_status,
      assignment_outcome   = CASE WHEN lifecycle_status = 'Published'
                                  THEN 'confirmed'::public.shift_assignment_outcome
                                  ELSE assignment_outcome END,
      confirmed_at         = CASE WHEN lifecycle_status = 'Published'
                                  THEN NOW() ELSE confirmed_at END,
      bidding_status       = CASE WHEN lifecycle_status = 'Published'
                                  THEN 'not_on_bidding'::public.shift_bidding_status
                                  ELSE bidding_status END,
      is_on_bidding        = CASE WHEN lifecycle_status = 'Published'
                                  THEN FALSE ELSE is_on_bidding END,
      last_modified_by     = p_actor,
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'unassign' THEN
    IF v_cur.assigned_employee_id IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'ALREADY_UNASSIGNED');
    END IF;

    UPDATE public.shifts SET
      assigned_employee_id = NULL,
      assigned_at          = NULL,
      assignment_status    = 'unassigned'::public.shift_assignment_status,
      assignment_outcome   = NULL,
      confirmed_at         = NULL,
      fulfillment_status   = 'none'::public.shift_fulfillment_status,
      last_modified_by     = p_actor,
      last_modified_reason = COALESCE(p_payload->>'reason', 'Unassigned via shift gateway'),
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'publish' THEN
    IF v_cur.assigned_employee_id IS NOT NULL THEN
      -- Concurrency Contract: Lock employee identity before running checks
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_cur.assigned_employee_id::text));

      -- Full EBA compliance validation before publishing assigned shift
      SELECT rule_id, details INTO v_breach_rule, v_breach_details
        FROM public.eba_check_assignment(p_shift_id, v_cur.assigned_employee_id)
       WHERE tier = 'BLOCKING'
       LIMIT 1;

      IF v_breach_rule IS NOT NULL THEN
        RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
      END IF;

      IF ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
            AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours' <= NOW() THEN
        -- Emergency window: confirm directly
        UPDATE public.shifts SET
          lifecycle_status       = 'Published'::public.shift_lifecycle,
          fulfillment_status     = 'scheduled'::public.shift_fulfillment_status,
          assignment_outcome     = 'confirmed'::public.shift_assignment_outcome,
          bidding_status         = 'not_on_bidding'::public.shift_bidding_status,
          is_on_bidding          = FALSE,
          confirmed_at           = NOW(),
          emergency_assigned_at  = NOW(),
          emergency_assigned_by  = p_actor,
          published_at           = NOW(),
          published_by_user_id   = p_actor,
          last_modified_by       = p_actor,
          updated_at             = NOW()
        WHERE id = p_shift_id;
      ELSE
        INSERT INTO public.shift_offers (shift_id, employee_id, status)
        VALUES (p_shift_id, v_cur.assigned_employee_id, 'Pending')
        ON CONFLICT (shift_id, employee_id) DO NOTHING;

        UPDATE public.shifts SET
          lifecycle_status     = 'Published'::public.shift_lifecycle,
          fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
          assignment_outcome   = 'offered'::public.shift_assignment_outcome,
          published_at         = NOW(),
          published_by_user_id = p_actor,
          last_modified_by     = p_actor,
          updated_at           = NOW()
        WHERE id = p_shift_id;
      END IF;
    ELSE
      IF ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
            AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours' <= NOW() THEN
        RETURN jsonb_build_object('applied', false, 'note', 'PUBLISH_TOO_LATE');
      END IF;

      UPDATE public.shifts SET
        lifecycle_status     = 'Published'::public.shift_lifecycle,
        fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
        bidding_status       = 'on_bidding'::public.shift_bidding_status,
        published_at         = NOW(),
        published_by_user_id = p_actor,
        is_on_bidding        = TRUE,
        bidding_enabled      = TRUE,
        bidding_open_at      = NOW(),
        bidding_close_at     = ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
                                  AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours',
        last_modified_by     = p_actor,
        updated_at           = NOW()
      WHERE id = p_shift_id;
    END IF;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'unpublish' THEN
    IF v_cur.trading_status IN ('TradeRequested', 'TradeAccepted') THEN
      UPDATE public.shift_swaps SET
        status = 'CANCELLED',
        updated_at = NOW()
      WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
        AND status IN ('OPEN', 'MANAGER_PENDING', 'OFFER_SELECTED');

      UPDATE public.shifts SET
        trading_status = 'NoTrade'::public.shift_trading,
        trade_requested_at = NULL,
        last_modified_by = p_actor,
        updated_at = NOW()
      WHERE id IN (
        SELECT CASE WHEN requester_shift_id = p_shift_id THEN target_shift_id ELSE requester_shift_id END
        FROM public.shift_swaps
        WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
      ) AND id <> p_shift_id;

      UPDATE public.swap_requests SET
        status = 'cancelled',
        updated_at = NOW()
      WHERE (original_shift_id = p_shift_id OR offered_shift_id = p_shift_id)
        AND status IN ('pending_employee', 'pending_manager');

      UPDATE public.shifts SET
        trading_status = 'NoTrade'::public.shift_trading,
        trade_requested_at = NULL,
        last_modified_by = p_actor,
        updated_at = NOW()
      WHERE id IN (
        SELECT CASE WHEN original_shift_id = p_shift_id THEN offered_shift_id ELSE original_shift_id END
        FROM public.swap_requests
        WHERE (original_shift_id = p_shift_id OR offered_shift_id = p_shift_id)
      ) AND id <> p_shift_id;

      UPDATE public.shifts SET
        trading_status = 'NoTrade'::public.shift_trading,
        trade_requested_at = NULL
      WHERE id = p_shift_id;
    END IF;

    IF v_cur.assigned_employee_id IS NOT NULL THEN
      UPDATE public.shifts SET
        lifecycle_status   = 'Draft'::public.shift_lifecycle,
        assignment_outcome = NULL,
        bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
        is_on_bidding      = FALSE,
        fulfillment_status = 'none'::public.shift_fulfillment_status,
        last_modified_by   = p_actor,
        updated_at         = NOW()
      WHERE id = p_shift_id;
    ELSE
      UPDATE public.shifts SET
        lifecycle_status   = 'Draft'::public.shift_lifecycle,
        bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
        is_on_bidding      = FALSE,
        fulfillment_status = 'none'::public.shift_fulfillment_status,
        last_modified_by   = p_actor,
        updated_at         = NOW()
      WHERE id = p_shift_id;
    END IF;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'select_winner' THEN
    v_winner := COALESCE(NULLIF(p_payload->>'winner_id', ''), NULLIF(p_payload->>'employee_id', ''))::uuid;
    IF v_winner IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'MISSING_WINNER_ID');
    END IF;

    -- Concurrency Contract: Lock employee identity before running checks
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_winner::text));

    -- Full EBA compliance validation
    SELECT rule_id, details INTO v_breach_rule, v_breach_details
      FROM public.eba_check_assignment(p_shift_id, v_winner)
     WHERE tier = 'BLOCKING'
     LIMIT 1;

    IF v_breach_rule IS NOT NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
    END IF;

    UPDATE public.shift_bids SET status = 'accepted', updated_at = NOW()
    WHERE shift_id = p_shift_id AND employee_id = v_winner;

    UPDATE public.shift_bids SET status = 'rejected', updated_at = NOW()
    WHERE shift_id = p_shift_id AND employee_id <> v_winner
      AND status = 'pending';

    UPDATE public.shifts SET
      assigned_employee_id = v_winner,
      assigned_at          = NOW(),
      assignment_status    = 'assigned'::public.shift_assignment_status,
      assignment_outcome   = 'confirmed'::public.shift_assignment_outcome,
      bidding_status       = 'not_on_bidding'::public.shift_bidding_status,
      is_on_bidding        = FALSE,
      fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
      confirmed_at         = NOW(),
      last_modified_by     = p_actor,
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'edit' THEN
    IF NOT (p_payload ?| ARRAY[
      'start_time','end_time','shift_date','break_minutes','paid_break_minutes',
      'unpaid_break_minutes','break_start','break_end','notes','role_id','sub_department_id',
      'remuneration_level','group_type','sub_group_name','display_order',
      'shift_group_id','shift_subgroup_id','timezone','is_training',
      'assigned_employee_id','assignment_source','required_skills','required_licenses','event_ids'
    ]) THEN
      RETURN jsonb_build_object('applied', false, 'note', 'NO_EDITABLE_FIELDS');
    END IF;

    IF p_payload ? 'assigned_employee_id' THEN
      v_edit_state := public.get_shift_fsm_state(
        v_cur.lifecycle_status, v_cur.assignment_status, v_cur.assignment_outcome,
        v_cur.trading_status, v_cur.is_cancelled, v_cur.bidding_status);
      v_new_emp := NULLIF(p_payload->>'assigned_employee_id', '')::uuid;

      IF v_new_emp IS NOT NULL
         AND v_new_emp IS DISTINCT FROM v_cur.assigned_employee_id
         AND public.fsm_op_is_legal(v_edit_state, 'assign') THEN
        v_do_assign  := true;
        v_assign_src := COALESCE(NULLIF(p_payload->>'assignment_source', ''), 'manual');
      ELSIF v_new_emp IS NULL
         AND v_cur.assigned_employee_id IS NOT NULL
         AND public.fsm_op_is_legal(v_edit_state, 'unassign') THEN
        v_do_unassign := true;
      END IF;
    END IF;

    -- Concurrency Contract & Compliance checks on edit:
    IF v_do_assign THEN
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_new_emp::text));

      SELECT rule_id, details INTO v_breach_rule, v_breach_details
        FROM public.eba_check_assignment(
          p_shift_id,
          v_new_emp,
          COALESCE(NULLIF(p_payload->>'shift_date','')::date, v_cur.shift_date),
          COALESCE(NULLIF(p_payload->>'start_time','')::time, v_cur.start_time),
          COALESCE(NULLIF(p_payload->>'end_time','')::time, v_cur.end_time),
          COALESCE((p_payload->>'unpaid_break_minutes')::int, v_cur.unpaid_break_minutes),
          COALESCE(NULLIF(p_payload->>'role_id','')::uuid, v_cur.role_id)
        )
       WHERE tier = 'BLOCKING'
       LIMIT 1;

      IF v_breach_rule IS NOT NULL THEN
        RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
      END IF;
    ELSIF v_cur.assigned_employee_id IS NOT NULL AND NOT v_do_unassign AND (
      p_payload ? 'start_time' OR p_payload ? 'end_time' OR p_payload ? 'shift_date' OR
      p_payload ? 'role_id' OR p_payload ? 'unpaid_break_minutes'
    ) THEN
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_cur.assigned_employee_id::text));

      SELECT rule_id, details INTO v_breach_rule, v_breach_details
        FROM public.eba_check_assignment(
          p_shift_id,
          v_cur.assigned_employee_id,
          COALESCE(NULLIF(p_payload->>'shift_date','')::date, v_cur.shift_date),
          COALESCE(NULLIF(p_payload->>'start_time','')::time, v_cur.start_time),
          COALESCE(NULLIF(p_payload->>'end_time','')::time, v_cur.end_time),
          COALESCE((p_payload->>'unpaid_break_minutes')::int, v_cur.unpaid_break_minutes),
          COALESCE(NULLIF(p_payload->>'role_id','')::uuid, v_cur.role_id)
        )
       WHERE tier = 'BLOCKING'
       LIMIT 1;

      IF v_breach_rule IS NOT NULL THEN
        RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
      END IF;
    END IF;

    UPDATE public.shifts SET
      start_time            = COALESCE(NULLIF(p_payload->>'start_time','')::time, start_time),
      end_time              = COALESCE(NULLIF(p_payload->>'end_time','')::time, end_time),
      shift_date            = COALESCE(NULLIF(p_payload->>'shift_date','')::date, shift_date),
      paid_break_minutes    = COALESCE((p_payload->>'paid_break_minutes')::int, paid_break_minutes),
      unpaid_break_minutes  = COALESCE((p_payload->>'unpaid_break_minutes')::int, unpaid_break_minutes),
      break_start           = CASE WHEN p_payload ? 'break_start' THEN NULLIF(p_payload->>'break_start', '')::time ELSE break_start END,
      break_end             = CASE WHEN p_payload ? 'break_end' THEN NULLIF(p_payload->>'break_end', '')::time ELSE break_end END,
      break_minutes         = COALESCE((p_payload->>'paid_break_minutes')::int, paid_break_minutes)
                            + COALESCE((p_payload->>'unpaid_break_minutes')::int, unpaid_break_minutes),
      notes                 = CASE WHEN p_payload ? 'notes' THEN p_payload->>'notes' ELSE notes END,
      role_id               = COALESCE(NULLIF(p_payload->>'role_id','')::uuid, role_id),
      sub_department_id     = COALESCE(NULLIF(p_payload->>'sub_department_id','')::uuid, sub_department_id),
      remuneration_level    = COALESCE(NULLIF(p_payload->>'remuneration_level','')::smallint, remuneration_level),
      shift_group_id        = COALESCE(NULLIF(p_payload->>'shift_group_id','')::uuid, shift_group_id),
      roster_subgroup_id    = COALESCE(NULLIF(p_payload->>'shift_subgroup_id','')::uuid, roster_subgroup_id),
      group_type            = COALESCE(NULLIF(p_payload->>'group_type','')::template_group_type, group_type),
      sub_group_name        = CASE WHEN p_payload ? 'sub_group_name' THEN p_payload->>'sub_group_name' ELSE sub_group_name END,
      display_order         = COALESCE((p_payload->>'display_order')::int, display_order),
      timezone              = COALESCE(NULLIF(p_payload->>'timezone',''), timezone),
      is_training            = COALESCE((p_payload->>'is_training')::boolean, is_training),
      required_skills       = CASE WHEN p_payload ? 'required_skills' THEN COALESCE(p_payload->'required_skills', '[]'::jsonb) ELSE required_skills END,
      required_licenses     = CASE WHEN p_payload ? 'required_licenses' THEN COALESCE(p_payload->'required_licenses', '[]'::jsonb) ELSE required_licenses END,
      event_ids             = CASE WHEN p_payload ? 'event_ids' THEN COALESCE(p_payload->'event_ids', '[]'::jsonb) ELSE event_ids END,
      assigned_employee_id  = CASE WHEN v_do_assign   THEN v_new_emp
                                   WHEN v_do_unassign THEN NULL
                                   ELSE assigned_employee_id END,
      assigned_at           = CASE WHEN v_do_assign   THEN NOW()
                                   WHEN v_do_unassign THEN NULL
                                   ELSE assigned_at END,
      assignment_status     = CASE WHEN v_do_assign   THEN 'assigned'::public.shift_assignment_status
                                   WHEN v_do_unassign THEN 'unassigned'::public.shift_assignment_status
                                   ELSE assignment_status END,
      assignment_source     = CASE WHEN v_do_assign   THEN v_assign_src
                                   WHEN v_do_unassign THEN NULL
                                   ELSE assignment_source END,
      assignment_outcome    = CASE WHEN v_do_unassign THEN NULL ELSE assignment_outcome END,
      confirmed_at          = CASE WHEN v_do_unassign THEN NULL ELSE confirmed_at END,
      fulfillment_status    = CASE WHEN v_do_unassign THEN 'none'::public.shift_fulfillment_status
                                   ELSE fulfillment_status END,
      last_modified_by      = p_actor,
      last_modified_reason  = COALESCE(p_payload->>'reason', last_modified_reason),
      updated_at            = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'delete' THEN
    RETURN jsonb_build_object('applied', false, 'note', 'USE_SM_DELETE_SHIFT');

  ELSIF p_op = 'approve_trade' THEN
    IF COALESCE((p_payload->>'compliance_ok')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object('applied', false, 'note', 'COMPLIANCE_NOT_CONFIRMED');
    END IF;

    SELECT * INTO v_swap
    FROM public.shift_swaps
    WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
      AND status = 'MANAGER_PENDING'
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('applied', false, 'note', 'NO_MANAGER_PENDING_SWAP');
    END IF;

    IF v_swap.target_id IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'UNRESOLVED_SWAP_TARGET');
    END IF;

    -- Concurrency Contract: Multi-Employee Lock Ordering (Deadlock Prevention)
    -- Advisory locks MUST be acquired in ascending lexicographical UUID order: LEAST then GREATEST
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || LEAST(v_swap.requester_id, v_swap.target_id)::text));
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || GREATEST(v_swap.requester_id, v_swap.target_id)::text));

    PERFORM public.sm_approve_peer_swap(
      v_swap.requester_shift_id, v_swap.target_shift_id,
      v_swap.requester_id, v_swap.target_id);

    UPDATE public.shift_swaps SET
      status            = 'APPROVED'::public.swap_request_status,
      manager_approved  = TRUE,
      approved_by       = p_actor,
      approved_at       = NOW(),
      status_changed_at = NOW(),
      updated_at        = NOW()
    WHERE id = v_swap.id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'reject_trade' THEN
    SELECT * INTO v_swap
    FROM public.shift_swaps
    WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
      AND status = 'MANAGER_PENDING'
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('applied', false, 'note', 'NO_MANAGER_PENDING_SWAP');
    END IF;

    UPDATE public.shift_swaps SET
      status            = 'REJECTED'::public.swap_request_status,
      reason            = COALESCE(NULLIF(p_payload->>'reason',''), 'Rejected by manager'),
      rejection_reason  = COALESCE(NULLIF(p_payload->>'reason',''), 'Rejected by manager'),
      status_changed_at = NOW(),
      updated_at        = NOW()
    WHERE id = v_swap.id AND status = 'MANAGER_PENDING';

    UPDATE public.shifts SET
      trading_status     = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL,
      last_modified_by   = p_actor,
      updated_at         = NOW()
    WHERE id IN (
      SELECT CASE WHEN requester_shift_id = p_shift_id THEN target_shift_id ELSE requester_shift_id END
      FROM public.shift_swaps
      WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
    ) AND id <> p_shift_id;

    UPDATE public.shifts SET
      trading_status = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);
  ELSE
    RETURN jsonb_build_object('applied', false, 'note', 'UNSUPPORTED_OP');
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._apply_shift_op_write(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._apply_shift_op_write(uuid, text, jsonb, uuid) TO service_role;
