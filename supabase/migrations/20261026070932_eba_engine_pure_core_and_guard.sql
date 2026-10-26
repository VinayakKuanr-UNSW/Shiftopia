-- ============================================================================
-- EBA engine: pure rule core, a permission guard, and the V8 parity fixes
--
-- WHY
--   public.eba_check_assignment (20261025130000) was SECURITY DEFINER with no
--   caller check: any signed-in user could ask about any employee and read
--   back their shifts, leave, qualifications and visa condition. The rules now
--   live in `internal`, which clients cannot execute, and the public function
--   is a wrapper that first asks the question RLS and the edge function ask —
--   can_view_employee_schedule().
--
--   The rules are split from the table reads. internal.eba_evaluate(facts,
--   shifts) is a function of its arguments alone, so the parity suite
--   (src/modules/compliance/__tests__/eba-parity) drives it with the same
--   scenarios it hands V8, without seeding tables.
--
-- WHAT CHANGED AGAINST 20261025130000 (each found by comparing with V8)
--   * The meal break is the break window. Security's is paid (Sch 3 §3.2(a),
--     §5.3(a)), so its unpaid minutes are 0 and paid_break_minutes holds only
--     the cl 37 rest pauses — the engine read the meal break from
--     paid_break_minutes and would refuse a compliant security split day.
--   * Salaried engagements are outside the EBA (cl 2.2): the rest gap and the
--     split-shift spread are advisory when every engagement involved is
--     salaried, as in V8.
--   * An overnight shift works its finishing day too (20-in-28, flexi streak).
--   * Cancelled and soft-deleted shifts no longer count against anyone.
--   * The governing contract is the one auto_link_shift_to_contract links:
--     the shift's own link, else target > role > sub-department.
--   * Employment target with no contract for the role: any in-scope contract
--     may match, as fn_enforce_shift_employment_target accepts.
--   * Casual engagement cap: a training candidate is not counted, so it cannot
--     be refused for engagements it does not add.
--   * The split-shift gap warning reads every same-day pair, not only days of
--     exactly two shifts.
-- ============================================================================

-- ── The shift set, parsed once per rule ─────────────────────────────────────
CREATE OR REPLACE FUNCTION internal.eba_shifts(p_shifts jsonb)
RETURNS TABLE(
    id uuid, shift_date date, start_time time, end_time time,
    unpaid_break_minutes integer, paid_break_minutes integer, meal_break_minutes integer,
    is_training boolean, is_multi_hire boolean, is_salaried boolean, is_candidate boolean,
    start_dt timestamp, end_dt timestamp, gross_minutes integer, worked_minutes integer)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
    SELECT x.id, x.shift_date, x.start_time, x.end_time,
           COALESCE(x.unpaid_break_minutes, 0),
           COALESCE(x.paid_break_minutes, 0),
           COALESCE(x.meal_break_minutes, x.unpaid_break_minutes, 0),
           COALESCE(x.is_training, false),
           COALESCE(x.is_multi_hire, false),
           COALESCE(x.is_salaried, false),
           COALESCE(x.is_candidate, false),
           t.start_dt, t.end_dt, t.gross,
           GREATEST(0, t.gross - COALESCE(x.unpaid_break_minutes, 0))
      FROM jsonb_to_recordset(COALESCE(p_shifts, '[]'::jsonb)) AS x(
               id uuid, shift_date date, start_time time, end_time time,
               unpaid_break_minutes integer, paid_break_minutes integer, meal_break_minutes integer,
               is_training boolean, is_multi_hire boolean, is_salaried boolean, is_candidate boolean)
     CROSS JOIN LATERAL (
         SELECT x.shift_date + x.start_time AS start_dt,
                x.shift_date + x.end_time
                  + CASE WHEN x.end_time <= x.start_time THEN interval '1 day' ELSE interval '0' END AS end_dt
     ) d
     CROSS JOIN LATERAL (
         SELECT d.start_dt, d.end_dt, (EXTRACT(EPOCH FROM (d.end_dt - d.start_dt)) / 60)::integer AS gross
     ) t
     WHERE x.shift_date IS NOT NULL AND x.start_time IS NOT NULL AND x.end_time IS NOT NULL;
$function$;

-- ── The rules: a pure function of the facts and the shift set ───────────────
-- p_facts:  contract_type ('FULL_TIME'|'PART_TIME'|'FLEXI_PART_TIME'|'CASUAL'),
--           is_security, rest_gap_8h, student_visa, cycle_weeks, cycle_anchor.
-- p_shifts: the candidate (is_candidate = true) and the person's other shifts.
-- Every rule is scoped to the candidate: history is never re-flagged.
CREATE OR REPLACE FUNCTION internal.eba_evaluate(p_facts jsonb, p_shifts jsonb)
RETURNS TABLE(is_compliant boolean, rule_id text, rule_name text, tier text, summary text, details text, payload jsonb)
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_type      text    := COALESCE(NULLIF(p_facts->>'contract_type', ''), 'CASUAL');
    v_security  boolean := COALESCE((p_facts->>'is_security')::boolean, false);
    v_rest_8h   boolean := COALESCE((p_facts->>'rest_gap_8h')::boolean, false);
    v_visa      boolean := COALESCE((p_facts->>'student_visa')::boolean, false);
    v_anchor    date    := COALESCE(NULLIF(p_facts->>'cycle_anchor', '')::date, DATE '2024-01-01');
    v_ft_sec    boolean;
    v_weeks     integer;
    v_weekly    numeric;
    v_cand      record;
    v_day       record;
    v_win       record;
    v_mins      integer;
    v_cycle_start date;
    v_cycle_hours numeric;
BEGIN
    SELECT * INTO v_cand FROM internal.eba_shifts(p_shifts) s WHERE s.is_candidate ORDER BY s.start_dt LIMIT 1;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- V8_NO_OVERLAP
    RETURN QUERY
    SELECT false, 'V8_NO_OVERLAP'::text, 'No Overlap'::text, 'BLOCKING'::text,
           'Shift overlaps with an existing shift'::text,
           format('This shift overlaps with an existing shift on %s (%s–%s). One person cannot work two shifts at once.',
                  to_char(o.shift_date, 'YYYY-MM-DD'), to_char(o.start_time, 'HH24:MI'), to_char(o.end_time, 'HH24:MI')),
           jsonb_build_object('overlapping_shift_id', o.id, 'date', o.shift_date)
      FROM internal.eba_shifts(p_shifts) o
     WHERE NOT o.is_candidate
       AND o.start_dt < v_cand.end_dt
       AND v_cand.start_dt < o.end_dt;

    -- V8_MIN_REST_GAP — cl 40: cross-day pairs only; 8h by agreement (40.2) or multi-hire (40.3).
    RETURN QUERY
    WITH o AS (
        SELECT s.*,
               LEAD(s.start_dt)      OVER w AS n_start,
               LEAD(s.shift_date)    OVER w AS n_date,
               LEAD(s.is_multi_hire) OVER w AS n_multi,
               LEAD(s.is_candidate)  OVER w AS n_cand,
               LEAD(s.is_salaried)   OVER w AS n_salaried
          FROM internal.eba_shifts(p_shifts) s
        WINDOW w AS (ORDER BY s.start_dt, s.id)
    ), g AS (
        SELECT o.shift_date AS a_date, o.n_date AS b_date,
               (EXTRACT(EPOCH FROM (o.n_start - o.end_dt)) / 60)::integer AS gap,
               CASE WHEN o.is_multi_hire OR o.n_multi OR v_rest_8h THEN 480 ELSE 600 END AS req,
               (o.is_multi_hire OR o.n_multi) AS multi,
               (o.is_salaried AND o.n_salaried) AS advisory
          FROM o
         WHERE o.n_start IS NOT NULL
           AND o.n_date <> o.shift_date
           AND (o.is_candidate OR o.n_cand)
    )
    SELECT g.advisory, 'V8_MIN_REST_GAP'::text, 'Minimum Rest Gap'::text,
           CASE WHEN g.advisory THEN 'WARNING' ELSE 'BLOCKING' END,
           format('%sInsufficient rest between days (%sh)', CASE WHEN g.advisory THEN 'Advisory: ' ELSE '' END, round(g.gap / 60.0, 1)),
           format('Only %sh rest between the shift on %s and the shift on %s. Minimum required is %sh%s.%s',
                  round(g.gap / 60.0, 1), to_char(g.a_date, 'YYYY-MM-DD'), to_char(g.b_date, 'YYYY-MM-DD'),
                  g.req / 60,
                  CASE WHEN g.multi THEN ' (multi-hire engagement)'
                       WHEN g.req = 480 THEN ' (8h rest gap agreement)' ELSE '' END,
                  CASE WHEN g.advisory THEN ' Salaried staff are outside EBA cl 40; rest gap is advisory.' ELSE '' END),
           jsonb_build_object('gap_minutes', g.gap, 'required_minutes', g.req, 'date_a', g.a_date, 'date_b', g.b_date)
      FROM g
     WHERE g.gap >= 0 AND g.gap < g.req;

    -- V8_MAX_DAILY_HOURS — net of the unpaid meal break, keyed on start date.
    SELECT COALESCE(SUM(s.worked_minutes), 0) INTO v_mins
      FROM internal.eba_shifts(p_shifts) s WHERE s.shift_date = v_cand.shift_date;
    IF v_mins > 720 THEN
        RETURN QUERY SELECT false, 'V8_MAX_DAILY_HOURS'::text, 'Maximum Daily Hours'::text, 'BLOCKING'::text,
            'Exceeds 12h daily limit'::text,
            format('Employee worked %sh on %s, exceeding the 12h cap.', round(v_mins / 60.0, 1), to_char(v_cand.shift_date, 'YYYY-MM-DD')),
            jsonb_build_object('total_minutes', v_mins, 'limit_minutes', 720, 'date', v_cand.shift_date);
    END IF;

    -- V8_MAX_DAILY_ENGAGEMENTS — cl 35.4(f), casual only; training is exempt.
    IF v_type = 'CASUAL' AND NOT v_cand.is_training THEN
        SELECT COUNT(*) INTO v_mins
          FROM internal.eba_shifts(p_shifts) s WHERE s.shift_date = v_cand.shift_date AND NOT s.is_training;
        IF v_mins > 2 THEN
            RETURN QUERY SELECT false, 'V8_MAX_DAILY_ENGAGEMENTS'::text, 'Maximum Daily Engagements (Casual)'::text, 'BLOCKING'::text,
                format('Casual exceeds 2 engagements on %s (%s)', to_char(v_cand.shift_date, 'YYYY-MM-DD'), v_mins),
                format('A casual Team Member may work no more than 2 separate engagements on any one day (ICC EBA cl. 35.4(f)). This roster places %s non-training shifts on %s.',
                       v_mins, to_char(v_cand.shift_date, 'YYYY-MM-DD')),
                jsonb_build_object('engagement_count', v_mins, 'max_engagements', 2, 'date', v_cand.shift_date);
        END IF;
    END IF;

    -- ── Rules about a day worked in more than one part ──────────────────────
    SELECT COUNT(*)                                                         AS n,
           (EXTRACT(EPOCH FROM (MAX(s.end_dt) - MIN(s.start_dt))) / 60)::integer AS gross,
           SUM(s.meal_break_minutes + s.paid_break_minutes)                  AS breaks,
           SUM(GREATEST(0, s.gross_minutes - s.meal_break_minutes))          AS worked,
           MAX(s.meal_break_minutes)                                         AS longest_meal,
           bool_and(s.is_salaried)                                           AS all_salaried,
           COUNT(*) FILTER (WHERE s.worked_minutes < 180)                    AS short_n
      INTO v_day
      FROM internal.eba_shifts(p_shifts) s
     WHERE s.shift_date = v_cand.shift_date;

    IF v_day.n >= 2 THEN
        -- V8_SPLIT_SHIFT_SPREAD — cl 39.2: PT/flexi, 12h EXCLUDING meal and rest breaks.
        IF v_type IN ('PART_TIME', 'FLEXI_PART_TIME') AND v_day.gross - v_day.breaks > 720 THEN
            RETURN QUERY SELECT v_day.all_salaried, 'V8_SPLIT_SHIFT_SPREAD'::text, 'Split-Shift Spread'::text,
                CASE WHEN v_day.all_salaried THEN 'WARNING' ELSE 'BLOCKING' END,
                format('%sSplit-shift spread exceeds 12h (%sh net)', CASE WHEN v_day.all_salaried THEN 'Advisory: ' ELSE '' END,
                       round((v_day.gross - v_day.breaks) / 60.0, 1)),
                format('The engagements on %s span %s hours from first start to last end. Excluding %s minutes of meal and rest breaks that is %s hours of spread, over the 12-hour maximum for a split shift (ICC EBA cl. 39.2).%s',
                       to_char(v_cand.shift_date, 'YYYY-MM-DD'), round(v_day.gross / 60.0, 1), v_day.breaks,
                       round((v_day.gross - v_day.breaks) / 60.0, 1),
                       CASE WHEN v_day.all_salaried THEN ' Salaried staff are outside EBA cl 39; spread limit is advisory.' ELSE '' END),
                jsonb_build_object('gross_spread_minutes', v_day.gross, 'net_spread_minutes', v_day.gross - v_day.breaks,
                                   'break_minutes', v_day.breaks, 'limit_minutes', 720, 'date', v_cand.shift_date);
        END IF;

        -- V8_SPLIT_SHIFT (WARNING) — cl 39.4: a gap of more than 3h between the parts.
        IF v_type IN ('PART_TIME', 'FLEXI_PART_TIME') THEN
            RETURN QUERY
            WITH o AS (
                SELECT s.*,
                       LEAD(s.start_dt)      OVER w AS n_start,
                       LEAD(s.shift_date)    OVER w AS n_date,
                       LEAD(s.is_multi_hire) OVER w AS n_multi,
                       LEAD(s.is_candidate)  OVER w AS n_cand,
                       LEAD(s.is_salaried)   OVER w AS n_salaried
                  FROM internal.eba_shifts(p_shifts) s
                WINDOW w AS (ORDER BY s.start_dt, s.id)
            )
            SELECT true, 'V8_SPLIT_SHIFT'::text, 'Split Shift'::text, 'WARNING'::text,
                   format('Split shift gap exceeds 3 hours (%sh)', round(g.gap / 60.0, 1)),
                   format('Where a day is worked in two parts, the gap between them should not exceed 3 hours (ICC EBA cl. 39.4). The gap on %s is %s hours.',
                          to_char(o.shift_date, 'YYYY-MM-DD'), round(g.gap / 60.0, 1)),
                   jsonb_build_object('gap_minutes', g.gap, 'max_gap_minutes', 180, 'date', o.shift_date)
              FROM o
             CROSS JOIN LATERAL (SELECT (EXTRACT(EPOCH FROM (o.n_start - o.end_dt)) / 60)::integer AS gap) g
             WHERE o.n_start IS NOT NULL
               AND o.n_date = o.shift_date
               AND o.shift_date = v_cand.shift_date
               AND (o.is_candidate OR o.n_cand)
               AND NOT (o.is_multi_hire OR o.n_multi)
               AND NOT (o.is_salaried AND o.n_salaried)
               AND g.gap > 180;
        END IF;

        -- V8_CASUAL_SECURITY_SPREAD / _ENGAGEMENT — Sch 3 §5.3(g): 12h GROSS, each part ≥ 3h.
        IF v_type = 'CASUAL' AND v_security THEN
            IF v_day.gross > 720 THEN
                RETURN QUERY SELECT false, 'V8_CASUAL_SECURITY_SPREAD'::text, 'Casual Security Daily Spread'::text, 'BLOCKING'::text,
                    format('Security spread exceeds 12h (%sh)', round(v_day.gross / 60.0, 1)),
                    format('A casual Event Security Team Member working two shifts in one day may span no more than 12 hours gross (EBA Schedule 3 §5.3(g)). The engagements on %s span %s hours.',
                           to_char(v_cand.shift_date, 'YYYY-MM-DD'), round(v_day.gross / 60.0, 1)),
                    jsonb_build_object('gross_spread_minutes', v_day.gross, 'limit_minutes', 720, 'date', v_cand.shift_date);
            END IF;
            IF v_day.short_n > 0 THEN
                RETURN QUERY SELECT false, 'V8_CASUAL_SECURITY_ENGAGEMENT'::text, 'Casual Security Two-Shift Engagement'::text, 'BLOCKING'::text,
                    'Each engagement must be at least 3h when working two shifts'::text,
                    format('Where a casual Event Security Team Member works two shifts in one day, each engagement must be no less than 3 hours (EBA Schedule 3 §5.3(g)). %s engagement(s) on %s fall short.',
                           v_day.short_n, to_char(v_cand.shift_date, 'YYYY-MM-DD')),
                    jsonb_build_object('required_minutes', 180, 'short_shifts_count', v_day.short_n, 'date', v_cand.shift_date);
            END IF;
        END IF;

        -- V8_DAILY_MEAL_BREAK — cl 36.1 per DAY: more than 5h worked needs one
        -- unbroken 30-minute interval, inside an engagement or between two.
        IF v_day.worked > 300 THEN
            SELECT GREATEST(COALESCE(v_day.longest_meal, 0), COALESCE(MAX(gaps.gap), 0)) INTO v_mins
              FROM (SELECT (EXTRACT(EPOCH FROM (s.start_dt - LAG(s.end_dt) OVER (ORDER BY s.start_dt, s.id))) / 60)::integer AS gap
                      FROM internal.eba_shifts(p_shifts) s
                     WHERE s.shift_date = v_cand.shift_date) gaps;
            IF v_mins < 30 THEN
                RETURN QUERY SELECT false, 'V8_DAILY_MEAL_BREAK'::text, 'Daily Meal Break'::text, 'BLOCKING'::text,
                    format('%sh worked on %s with no meal break', round(v_day.worked / 60.0, 1), to_char(v_cand.shift_date, 'YYYY-MM-DD')),
                    format('A Team Member who works more than 5 hours on any one day is entitled to a %s meal break of not less than 30 minutes (%s). The %s engagements on %s total %s hours worked, and the longest break interval is %s minutes.',
                           CASE WHEN v_security THEN 'paid' ELSE 'unpaid' END,
                           CASE WHEN NOT v_security THEN 'ICC EBA cl. 36.1'
                                WHEN v_type = 'FULL_TIME' THEN 'EBA Sch 3 §3.2(a)' ELSE 'EBA Sch 3 §5.3(a)' END,
                           v_day.n, to_char(v_cand.shift_date, 'YYYY-MM-DD'), round(v_day.worked / 60.0, 1), v_mins),
                    jsonb_build_object('worked_minutes', v_day.worked, 'longest_break_minutes', v_mins,
                                       'required_break_minutes', 30, 'date', v_cand.shift_date);
            END IF;
        END IF;
    END IF;

    -- V8_20_IN_28 — cl 35.1(e): an overnight shift works its finishing day too.
    FOR v_win IN
        WITH days AS (
            SELECT DISTINCT v.d
              FROM internal.eba_shifts(p_shifts) s
             CROSS JOIN LATERAL (VALUES (s.shift_date),
                                        (CASE WHEN s.end_time <= s.start_time AND s.end_time <> TIME '00:00'
                                              THEN s.shift_date + 1 END)) v(d)
             WHERE v.d IS NOT NULL
        ), cand AS (
            SELECT v.d FROM (VALUES (v_cand.shift_date),
                                    (CASE WHEN v_cand.end_time <= v_cand.start_time AND v_cand.end_time <> TIME '00:00'
                                          THEN v_cand.shift_date + 1 END)) v(d)
             WHERE v.d IS NOT NULL
        )
        SELECT w.w_end - 27 AS w_start, w.w_end,
               (SELECT COUNT(*) FROM days WHERE days.d BETWEEN w.w_end - 27 AND w.w_end) AS worked
          FROM (SELECT g::date AS w_end FROM generate_series(v_cand.shift_date, v_cand.shift_date + 28, interval '1 day') g) w
         WHERE EXISTS (SELECT 1 FROM cand WHERE cand.d BETWEEN w.w_end - 27 AND w.w_end)
         ORDER BY 3 DESC, w.w_end
         LIMIT 1
    LOOP
        IF v_win.worked > 20 THEN
            RETURN QUERY SELECT false, 'V8_20_IN_28'::text, '20 Days in 28 Limit'::text, 'BLOCKING'::text,
                format('Worked %s days in 28-day window', v_win.worked),
                format('Employee worked %s days between %s and %s. Max allowed is 20 days (ICC EBA cl. 35).',
                       v_win.worked, to_char(v_win.w_start, 'YYYY-MM-DD'), to_char(v_win.w_end, 'YYYY-MM-DD')),
                jsonb_build_object('window_worked', v_win.worked, 'limit', 20, 'window_start', v_win.w_start, 'window_end', v_win.w_end);
        END IF;
    END LOOP;

    -- V8_STREAK_LIMIT — cl 35.3(g): flexible part-time, at most 10 consecutive days.
    IF v_type = 'FLEXI_PART_TIME' THEN
        FOR v_win IN
            WITH days AS (
                SELECT DISTINCT v.d
                  FROM internal.eba_shifts(p_shifts) s
                 CROSS JOIN LATERAL (VALUES (s.shift_date),
                                            (CASE WHEN s.end_time <= s.start_time AND s.end_time <> TIME '00:00'
                                                  THEN s.shift_date + 1 END)) v(d)
                 WHERE v.d IS NOT NULL
            ), runs AS (
                SELECT MIN(r.d) AS r_start, MAX(r.d) AS r_end, COUNT(*) AS len
                  FROM (SELECT days.d, days.d - (ROW_NUMBER() OVER (ORDER BY days.d))::integer AS grp FROM days) r
                 GROUP BY r.grp
            )
            SELECT * FROM runs
             WHERE v_cand.shift_date BETWEEN runs.r_start AND runs.r_end
               AND runs.len > 10
        LOOP
            RETURN QUERY SELECT false, 'V8_STREAK_LIMIT'::text, 'Maximum Consecutive Days'::text, 'BLOCKING'::text,
                format('%s consecutive working days', v_win.len),
                format('Employee worked %s days in a row (from %s to %s). Limit for Flexi-PT is 10 days (ICC EBA cl. 35.3(g)).',
                       v_win.len, to_char(v_win.r_start, 'YYYY-MM-DD'), to_char(v_win.r_end, 'YYYY-MM-DD')),
                jsonb_build_object('streak_length', v_win.len, 'limit', 10, 'streak_start', v_win.r_start, 'streak_end', v_win.r_end);
        END LOOP;
    END IF;

    -- V8_STUDENT_VISA_LIMIT — visa condition 8105: 48h per rolling fortnight.
    IF v_visa THEN
        FOR v_win IN
            SELECT w.w_end - 13 AS w_start, w.w_end, SUM(s.worked_minutes) / 60.0 AS hours
              FROM (SELECT g::date AS w_end FROM generate_series(v_cand.shift_date, v_cand.shift_date + 13, interval '1 day') g) w
              JOIN internal.eba_shifts(p_shifts) s ON s.shift_date BETWEEN w.w_end - 13 AND w.w_end
             GROUP BY w.w_end
            HAVING SUM(s.worked_minutes) / 60.0 > 48
             ORDER BY 3 DESC, w.w_end
             LIMIT 1
        LOOP
            RETURN QUERY SELECT false, 'V8_STUDENT_VISA_LIMIT'::text, 'Student Visa 48h Limit'::text, 'BLOCKING'::text,
                format('Exceeds 48h visa limit (%sh)', round(v_win.hours, 1)),
                format('Employee has worked %sh in the 14-day window from %s to %s, exceeding the 48-hour student visa limit (visa condition 8105).',
                       round(v_win.hours, 1), to_char(v_win.w_start, 'YYYY-MM-DD'), to_char(v_win.w_end, 'YYYY-MM-DD')),
                jsonb_build_object('total_hours', v_win.hours, 'limit', 48, 'window_start', v_win.w_start, 'window_end', v_win.w_end);
        END LOOP;
    END IF;

    -- V8_ORD_HOURS_AVG — cl 35.x(a): the declared, anchored cycle; FT security
    -- run Sch 3 §3.1's 42h over 8 weeks.
    v_ft_sec := v_security AND v_type = 'FULL_TIME';
    v_weeks  := CASE WHEN v_ft_sec THEN 8 ELSE COALESCE(NULLIF(p_facts->>'cycle_weeks', '')::integer, 4) END;
    v_weekly := CASE WHEN v_ft_sec THEN 42 ELSE 38 END;
    v_cycle_start := v_anchor + (floor((v_cand.shift_date - v_anchor)::numeric / (v_weeks * 7))::integer * v_weeks * 7);

    SELECT COALESCE(SUM(s.worked_minutes), 0) / 60.0 INTO v_cycle_hours
      FROM internal.eba_shifts(p_shifts) s
     WHERE s.shift_date BETWEEN v_cycle_start AND v_cycle_start + v_weeks * 7 - 1;

    IF v_cycle_hours > v_weeks * v_weekly THEN
        RETURN QUERY SELECT false, 'V8_ORD_HOURS_AVG'::text, 'Ordinary Hours Averaging'::text, 'BLOCKING'::text,
            format('Exceeds %sh over the %s-week cycle', v_weeks * v_weekly, v_weeks),
            format('Employee worked %sh in the %s-day window from %s to %s — an average of %sh/week, over the %sh/week ordinary-hours ceiling (%s).',
                   round(v_cycle_hours, 1), v_weeks * 7, to_char(v_cycle_start, 'YYYY-MM-DD'),
                   to_char(v_cycle_start + v_weeks * 7 - 1, 'YYYY-MM-DD'), round(v_cycle_hours / v_weeks, 1), v_weekly,
                   CASE WHEN v_ft_sec THEN 'ICC EBA Schedule 3 §3' ELSE 'ICC EBA cl. 35' END),
            jsonb_build_object('total_hours', v_cycle_hours, 'limit', v_weeks * v_weekly, 'average', v_cycle_hours / v_weeks,
                               'window_days', v_weeks * 7, 'cycle_start', v_cycle_start, 'cycle_end', v_cycle_start + v_weeks * 7 - 1);
    END IF;
END;
$function$;

-- ── The loader: reads the person and their shifts, then runs the rules ──────
CREATE OR REPLACE FUNCTION internal.eba_check_assignment(
    p_shift_id uuid,
    p_employee_id uuid,
    p_shift_date date DEFAULT NULL,
    p_start_time time DEFAULT NULL,
    p_end_time time DEFAULT NULL,
    p_unpaid_break_mins integer DEFAULT NULL,
    p_role_id uuid DEFAULT NULL)
RETURNS TABLE(is_compliant boolean, rule_id text, rule_name text, tier text, summary text, details text, payload jsonb)
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift        public.shifts%ROWTYPE;
    v_contract     hr.user_contracts%ROWTYPE;
    v_date         date;
    v_start        time;
    v_end          time;
    v_unpaid       integer;
    v_role         uuid;
    v_status       text;
    v_type         text;
    v_security     boolean;
    v_all_salaried boolean;
    v_facts        jsonb;
    v_shifts       jsonb;
    v_rows         integer := 0;
    v_n            integer;
    v_other        record;
    v_role_status  text;
    v_target_ok    boolean;
    v_held         text;
BEGIN
    IF p_employee_id IS NULL THEN
        RETURN QUERY SELECT true, NULL::text, NULL::text, NULL::text, 'No employee assigned'::text, 'Shift has no assigned employee.'::text, '{}'::jsonb;
        RETURN;
    END IF;

    IF p_shift_id IS NOT NULL THEN
        SELECT * INTO v_shift FROM public.shifts s WHERE s.id = p_shift_id;
    END IF;

    v_date   := COALESCE(p_shift_date, v_shift.shift_date);
    v_start  := COALESCE(p_start_time, v_shift.start_time);
    v_end    := COALESCE(p_end_time, v_shift.end_time);
    v_unpaid := COALESCE(p_unpaid_break_mins, v_shift.unpaid_break_minutes, 0);
    v_role   := COALESCE(p_role_id, v_shift.role_id);

    IF v_date IS NULL OR v_start IS NULL OR v_end IS NULL THEN
        RETURN QUERY SELECT true, NULL::text, NULL::text, NULL::text, 'Incomplete shift details'::text, 'Shift missing date or start/end time.'::text, '{}'::jsonb;
        RETURN;
    END IF;

    -- The governing contract: the shift's own link when it is this person's,
    -- else the one auto_link_shift_to_contract would link — in force on the
    -- day, in scope, ranked target > role > sub-department.
    SELECT uc.* INTO v_contract
      FROM hr.user_contracts uc
     WHERE uc.user_id = p_employee_id
       AND (uc.id = v_shift.user_contract_id
            OR (uc.start_date <= v_date
                AND (uc.end_date IS NULL OR uc.end_date >= v_date)
                AND (v_shift.sub_department_id IS NULL
                     OR uc.sub_department_id = v_shift.sub_department_id
                     OR uc.sub_department_id IS NULL)))
     ORDER BY (uc.id = v_shift.user_contract_id) IS TRUE DESC,
              (public.fn_normalize_employment_type(uc.employment_status::text)
                   IS NOT DISTINCT FROM v_shift.target_employment_type) DESC,
              (uc.role_id IS NOT DISTINCT FROM v_role) DESC,
              (uc.sub_department_id IS NOT DISTINCT FROM v_shift.sub_department_id) DESC,
              uc.remuneration_level DESC NULLS LAST,
              uc.id
     LIMIT 1;

    v_status := COALESCE(v_contract.employment_status::text,
                         (SELECT p.employment_type::text FROM public.profiles p WHERE p.id = p_employee_id));
    v_type := CASE WHEN lower(COALESCE(v_status, '')) LIKE 'flexible%' THEN 'FLEXI_PART_TIME'
                   WHEN lower(COALESCE(v_status, '')) LIKE 'full%'     THEN 'FULL_TIME'
                   WHEN lower(COALESCE(v_status, '')) LIKE 'part%'     THEN 'PART_TIME'
                   ELSE 'CASUAL' END;

    -- Person-wide, as V8 reads it: a Security role on any active contract.
    v_security := EXISTS (SELECT 1 FROM public.roles r WHERE r.id = v_role AND r.name ILIKE '%security%')
               OR EXISTS (SELECT 1 FROM hr.user_contracts uc JOIN public.roles r ON r.id = uc.role_id
                           WHERE uc.user_id = p_employee_id AND uc.status = 'Active' AND r.name ILIKE '%security%');

    -- The fallback for a shift that cannot be placed on one contract: salaried
    -- only when EVERY active contract is.
    SELECT COUNT(*) > 0 AND bool_and(COALESCE(uc.pay_basis = 'salary', false)) INTO v_all_salaried
      FROM hr.user_contracts uc WHERE uc.user_id = p_employee_id AND uc.status = 'Active';
    v_all_salaried := COALESCE(v_all_salaried, false);

    v_facts := jsonb_build_object(
        'contract_type', v_type,
        'is_security',   v_security,
        'rest_gap_8h',   COALESCE((SELECT p.rest_gap_agreement_8h FROM public.profiles p WHERE p.id = p_employee_id), false),
        'student_visa',  EXISTS (SELECT 1 FROM public.employee_licenses el
                                  WHERE el.employee_id = p_employee_id
                                    AND el.license_type = 'WorkRights'
                                    AND el.has_restricted_work_limit
                                    AND (el.expiration_date IS NULL OR el.expiration_date >= v_date)),
        'cycle_weeks',   v_contract.ordinary_hours_cycle_weeks,
        'cycle_anchor',  v_contract.ordinary_hours_cycle_anchor);

    SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_shifts FROM (
        SELECT s.id, s.shift_date, s.start_time, s.end_time,
               s.unpaid_break_minutes, s.paid_break_minutes,
               CASE WHEN s.break_start IS NOT NULL AND s.break_end IS NOT NULL
                    THEN public.shift_minutes_after_start(s.break_start, s.break_end)
                    ELSE s.unpaid_break_minutes END AS meal_break_minutes,
               COALESCE(s.is_training, false) AS is_training,
               COALESCE(uc.engagement_kind = 'multi_hire', false) AS is_multi_hire,
               COALESCE(uc.pay_basis = 'salary', v_all_salaried) AS is_salaried,
               false AS is_candidate
          FROM public.shifts s
          LEFT JOIN hr.user_contracts uc ON uc.id = s.user_contract_id AND uc.user_id = p_employee_id
         WHERE s.assigned_employee_id = p_employee_id
           AND s.id IS DISTINCT FROM p_shift_id
           AND s.deleted_at IS NULL
           AND NOT COALESCE(s.is_cancelled, false)
           AND s.lifecycle_status <> 'Cancelled'
           AND s.shift_date BETWEEN v_date - 56 AND v_date + 56
        UNION ALL
        SELECT p_shift_id, v_date, v_start, v_end, v_unpaid, COALESCE(v_shift.paid_break_minutes, 0),
               CASE WHEN v_shift.break_start IS NOT NULL AND v_shift.break_end IS NOT NULL
                    THEN public.shift_minutes_after_start(v_shift.break_start, v_shift.break_end)
                    ELSE v_unpaid END,
               COALESCE(v_shift.is_training, false),
               COALESCE(v_contract.engagement_kind = 'multi_hire', false),
               COALESCE(v_contract.pay_basis = 'salary', v_all_salaried),
               true
    ) x;

    -- V8_LEAVE_CONFLICT
    RETURN QUERY
    SELECT false, 'V8_LEAVE_CONFLICT'::text, 'Approved Leave'::text, 'BLOCKING'::text,
           'Employee is on approved leave'::text,
           format('This shift falls on %s, a day the employee has approved %s leave. Approved leave is a hard unavailability — unassign the leave or pick another employee.',
                  to_char(v_date, 'YYYY-MM-DD'), replace(lr.leave_type, '_', ' ')),
           jsonb_build_object('leave_type', lr.leave_type, 'date', v_date)
      FROM public.leave_requests lr
     WHERE lr.employee_id = p_employee_id
       AND lr.status = 'approved'
       AND v_date BETWEEN (lr.start_date AT TIME ZONE 'UTC')::date AND (lr.end_date AT TIME ZONE 'UTC')::date;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rows := v_rows + v_n;

    -- V8_QUALIFICATIONS / V8_QUALIFICATION_EXPIRED
    IF p_shift_id IS NOT NULL THEN
        FOR v_other IN
            WITH req AS (
                SELECT ss.skill_id FROM public.shift_skills ss WHERE ss.shift_id = p_shift_id
                UNION
                SELECT (jsonb_array_elements_text(v_shift.required_skills))::uuid
                 WHERE jsonb_typeof(v_shift.required_skills) = 'array'
            )
            SELECT req.skill_id, sk.name AS skill_name,
                   EXISTS (SELECT 1 FROM public.employee_skills es WHERE es.employee_id = p_employee_id AND es.skill_id = req.skill_id) AS is_held,
                   (SELECT MAX(es.expiration_date) FROM public.employee_skills es WHERE es.employee_id = p_employee_id AND es.skill_id = req.skill_id) AS expires
              FROM req JOIN public.skills sk ON sk.id = req.skill_id
        LOOP
            IF NOT v_other.is_held THEN
                v_rows := v_rows + 1;
                RETURN QUERY SELECT false, 'V8_QUALIFICATIONS'::text, 'Qualifications'::text, 'BLOCKING'::text,
                    'Missing required skill'::text,
                    format('Required skill "%s" not held by employee.', v_other.skill_name),
                    jsonb_build_object('skill_id', v_other.skill_id, 'skill_name', v_other.skill_name);
            ELSIF v_other.expires IS NOT NULL AND v_other.expires < v_date THEN
                v_rows := v_rows + 1;
                RETURN QUERY SELECT false, 'V8_QUALIFICATION_EXPIRED'::text, 'Expired Qualification'::text, 'BLOCKING'::text,
                    'Required skill expired before shift date'::text,
                    format('Skill "%s" expired on %s before shift date %s.', v_other.skill_name, to_char(v_other.expires, 'YYYY-MM-DD'), to_char(v_date, 'YYYY-MM-DD')),
                    jsonb_build_object('skill_id', v_other.skill_id, 'skill_name', v_other.skill_name, 'expiration_date', v_other.expires);
            END IF;
        END LOOP;

        FOR v_other IN
            WITH req AS (
                SELECT sl.license_id FROM public.shift_licenses sl WHERE sl.shift_id = p_shift_id AND COALESCE(sl.is_required, true)
                UNION
                SELECT (jsonb_array_elements_text(v_shift.required_licenses))::uuid
                 WHERE jsonb_typeof(v_shift.required_licenses) = 'array'
            )
            SELECT req.license_id, l.name AS license_name,
                   EXISTS (SELECT 1 FROM public.employee_licenses el WHERE el.employee_id = p_employee_id AND el.license_id = req.license_id) AS is_held,
                   (SELECT MAX(el.expiration_date) FROM public.employee_licenses el WHERE el.employee_id = p_employee_id AND el.license_id = req.license_id) AS expires
              FROM req JOIN public.licenses l ON l.id = req.license_id
        LOOP
            IF NOT v_other.is_held THEN
                v_rows := v_rows + 1;
                RETURN QUERY SELECT false, 'V8_QUALIFICATIONS'::text, 'Qualifications'::text, 'BLOCKING'::text,
                    'Missing required license'::text,
                    format('Required license "%s" not held by employee.', v_other.license_name),
                    jsonb_build_object('license_id', v_other.license_id, 'license_name', v_other.license_name);
            ELSIF v_other.expires IS NOT NULL AND v_other.expires < v_date THEN
                v_rows := v_rows + 1;
                RETURN QUERY SELECT false, 'V8_QUALIFICATION_EXPIRED'::text, 'Expired Qualification'::text, 'BLOCKING'::text,
                    'Required license expired before shift date'::text,
                    format('License "%s" expired on %s before shift date %s.', v_other.license_name, to_char(v_other.expires, 'YYYY-MM-DD'), to_char(v_date, 'YYYY-MM-DD')),
                    jsonb_build_object('license_id', v_other.license_id, 'license_name', v_other.license_name, 'expiration_date', v_other.expires);
            END IF;
        END LOOP;
    END IF;

    -- V8_EMPLOYMENT_TARGET — the scopes fn_enforce_shift_employment_target
    -- accepts: the contract for this role, else any in this sub-department.
    IF NULLIF(v_shift.target_employment_type, '') IS NOT NULL THEN
        SELECT uc.employment_status::text INTO v_role_status
          FROM hr.user_contracts uc
         WHERE uc.user_id = p_employee_id
           AND uc.status = 'Active'
           AND uc.role_id = v_role
           AND (v_shift.sub_department_id IS NULL OR uc.sub_department_id = v_shift.sub_department_id OR uc.sub_department_id IS NULL)
         ORDER BY (uc.sub_department_id IS NOT DISTINCT FROM v_shift.sub_department_id) DESC,
                  (uc.sub_department_id IS NOT NULL) DESC,
                  uc.id
         LIMIT 1;

        IF v_role_status IS NOT NULL THEN
            v_held := v_role_status;
            v_target_ok := public.fn_normalize_employment_type(v_role_status) = v_shift.target_employment_type
                       AND (NOT COALESCE(v_shift.target_requires_flexible, false) OR lower(btrim(v_role_status)) LIKE 'flexible%');
        ELSE
            SELECT string_agg(DISTINCT uc.employment_status::text, ', '),
                   COALESCE(bool_or(public.fn_normalize_employment_type(uc.employment_status::text) = v_shift.target_employment_type
                                    AND (NOT COALESCE(v_shift.target_requires_flexible, false)
                                         OR lower(btrim(uc.employment_status::text)) LIKE 'flexible%')), false)
              INTO v_held, v_target_ok
              FROM hr.user_contracts uc
             WHERE uc.user_id = p_employee_id
               AND uc.status = 'Active'
               AND (v_shift.sub_department_id IS NULL OR uc.sub_department_id = v_shift.sub_department_id OR uc.sub_department_id IS NULL);
        END IF;

        IF NOT v_target_ok THEN
            v_rows := v_rows + 1;
            RETURN QUERY SELECT false, 'V8_EMPLOYMENT_TARGET'::text, 'Employment Target'::text, 'BLOCKING'::text,
                CASE WHEN COALESCE(v_shift.target_requires_flexible, false) THEN 'Requires Flexible Part-Time' ELSE 'Employment target mismatch' END,
                format('This shift is for %s staff, but the employee holds %s for this %s.',
                       CASE WHEN COALESCE(v_shift.target_requires_flexible, false) THEN 'Flexible Part-Time' ELSE v_shift.target_employment_type END,
                       COALESCE(v_held, 'no active contract'),
                       CASE WHEN v_role_status IS NOT NULL THEN 'role' ELSE 'sub-department' END),
                jsonb_build_object('target_employment_type', v_shift.target_employment_type, 'employee_status', v_held);
        END IF;
    END IF;

    RETURN QUERY SELECT * FROM internal.eba_evaluate(v_facts, v_shifts);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rows := v_rows + v_n;

    IF v_rows = 0 THEN
        RETURN QUERY SELECT true, NULL::text, NULL::text, NULL::text, 'Passed'::text, 'All EBA compliance checks passed.'::text, '{}'::jsonb;
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION internal.eba_shifts(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.eba_evaluate(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.eba_check_assignment(uuid, uuid, date, time, time, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION internal.eba_shifts(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION internal.eba_evaluate(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION internal.eba_check_assignment(uuid, uuid, date, time, time, integer, uuid) TO service_role;

-- ── The public entry point: the same question RLS asks, then the rules ──────
CREATE OR REPLACE FUNCTION public.eba_check_assignment(
    p_shift_id uuid,
    p_employee_id uuid,
    p_shift_date date DEFAULT NULL,
    p_start_time time DEFAULT NULL,
    p_end_time time DEFAULT NULL,
    p_unpaid_break_mins integer DEFAULT NULL,
    p_role_id uuid DEFAULT NULL)
RETURNS TABLE(is_compliant boolean, rule_id text, rule_name text, tier text, summary text, details text, payload jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF p_employee_id IS NOT NULL
       AND NOT public.sm_request_is_system()
       AND NOT public.can_view_employee_schedule(p_employee_id) THEN
        RAISE EXCEPTION 'Not authorised to check this employee' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT * FROM internal.eba_check_assignment(
        p_shift_id, p_employee_id, p_shift_date, p_start_time, p_end_time, p_unpaid_break_mins, p_role_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.eba_check_assignment(uuid, uuid, date, time, time, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eba_check_assignment(uuid, uuid, date, time, time, integer, uuid) TO authenticated, service_role;

-- ── The gateway: the unguarded rules (it has already authorised the op), the
--    break window in the edit re-check, and the reason passed back ──────────
CREATE FUNCTION pg_temp.patch_fn(p_fn regprocedure, p_old text, p_new text, p_count int)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_def text := pg_get_functiondef(p_fn);
    v_n   int;
BEGIN
    v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
    IF v_n <> p_count THEN
        RAISE EXCEPTION 'patch_fn %: expected the snippet % time(s), found % — %', p_fn, p_count, v_n, left(p_old, 90);
    END IF;
    EXECUTE replace(v_def, p_old, p_new);
END;
$$;

SELECT pg_temp.patch_fn('public._apply_shift_op_write(uuid,text,jsonb,uuid)',
$o$FROM public.eba_check_assignment($o$,
$n$FROM internal.eba_check_assignment($n$, 5);

SELECT pg_temp.patch_fn('public._apply_shift_op_write(uuid,text,jsonb,uuid)',
$o$p_payload ? 'role_id' OR p_payload ? 'unpaid_break_minutes'$o$,
$n$p_payload ? 'role_id' OR p_payload ? 'unpaid_break_minutes' OR
      p_payload ? 'break_start' OR p_payload ? 'break_end'$n$, 1);

SELECT pg_temp.patch_fn('public.sm_apply_shift_op(uuid,integer,text,jsonb,uuid)',
$o$'note', v_write->>'note',$o$,
$n$'note', v_write->>'note',
      'rule_id', v_write->>'rule_id',
      'details', v_write->>'details',$n$, 1);
