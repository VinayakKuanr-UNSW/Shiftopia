-- Shift break window: WHEN the meal break is taken, not just how long it is.
--
-- A shift carried its breaks as two totals, `unpaid_break_minutes` and
-- `paid_break_minutes`. Pay depends on where the unpaid meal break sits:
--   * cl 7.11 / cl 43 — the night rate is paid on ordinary hours WORKED between
--     10pm and 6am;
--   * cl 41 — Saturday, Sunday and public-holiday loadings are paid on the hours
--     worked ON that day, so a break near midnight moves hours between days.
-- With only a total, both pay engines laid the worked minutes out as one block
-- from `start_time` — the break at the very end — which mis-prices a shift whose
-- break falls anywhere else, and leaves no record to settle a dispute over when
-- it was taken. `break_start` / `break_end` record the rostered meal break.
--
-- Semantics, from this migration on:
--   * the window IS the meal break (cl 36.1; Sch 3 §3.2 / §5.3 for security,
--     where it is paid);
--   * `unpaid_break_minutes` equals the window length, or 0 where the meal break
--     is paid (security) — the database cannot resolve the role, so it accepts
--     either and the app's shape layer decides which;
--   * `paid_break_minutes` is the rest pauses (cl 37) ONLY. Security used to
--     fold its paid meal break into this field alongside the pauses; the window
--     now carries it, so the field holds one fact.
-- Rest pauses keep no time of day: they are paid, so where they fall cannot
-- change pay (user decision 2026-10-25).
--
-- Every shift was deleted beforehand (dev database, user decision 2026-10-25),
-- so `shifts` validates trivially. The 29 template rows were kept; the template
-- constraint is NOT VALID so those rows stay, and every row saved from now on
-- must carry a window when it needs one. Template apply skips an instance that
-- lacks one, with the reason, rather than failing the whole application.

-- ── 1. Predicates ────────────────────────────────────────────────────────────

-- Minutes from the shift's start to a time of day, across midnight: a 23:00
-- start and a 01:00 break is 120, not -1320.
CREATE OR REPLACE FUNCTION public.shift_minutes_after_start(p_start time, p_t time)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path TO 'pg_catalog'
AS $$
    SELECT ((((EXTRACT(EPOCH FROM (p_t - p_start)) / 60)::int) % 1440) + 1440) % 1440
$$;

-- What is wrong with a shift's break window, or NULL when nothing is. ONE
-- predicate, used by the CHECK on both tables AND by template apply's skip, so
-- what apply skips and what the table refuses cannot drift apart.
CREATE OR REPLACE FUNCTION public.shift_break_window_breach(
    p_start_time   time,
    p_end_time     time,
    p_unpaid_break integer,
    p_break_start  time,
    p_break_end    time
)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public'
AS $$
    SELECT CASE
        WHEN p_start_time IS NULL OR p_end_time IS NULL THEN NULL
        WHEN (p_break_start IS NULL) <> (p_break_end IS NULL)
            THEN 'A meal break needs both a start and an end time.'
        WHEN p_break_start IS NULL AND COALESCE(p_unpaid_break, 0) > 0
            THEN 'An unpaid break needs its start and end time — pay depends on when it is taken.'
        WHEN p_break_start IS NULL AND public.shift_net_minutes(p_start_time, p_end_time, 0) > 300
            THEN 'A shift longer than 5 hours needs a meal break of 30 to 60 minutes, with its start and end time (EBA cl 36.1).'
        WHEN p_break_start IS NULL THEN NULL
        WHEN public.shift_minutes_after_start(p_start_time, p_break_start) = 0
          OR public.shift_minutes_after_start(p_start_time, p_break_end)
             <= public.shift_minutes_after_start(p_start_time, p_break_start)
          OR public.shift_minutes_after_start(p_start_time, p_break_end)
             >= public.shift_net_minutes(p_start_time, p_end_time, 0)
            THEN 'The meal break must start after the shift starts and end before it finishes.'
        WHEN public.shift_minutes_after_start(p_start_time, p_break_end)
             - public.shift_minutes_after_start(p_start_time, p_break_start) NOT BETWEEN 30 AND 60
            THEN 'A meal break must be 30 to 60 minutes long (EBA cl 36.1).'
        WHEN COALESCE(p_unpaid_break, 0) NOT IN (
                0,
                public.shift_minutes_after_start(p_start_time, p_break_end)
                - public.shift_minutes_after_start(p_start_time, p_break_start))
            THEN 'The unpaid break must equal the meal-break window, or be 0 where the meal break is paid.'
    END
$$;

-- ── 2. Columns ───────────────────────────────────────────────────────────────

ALTER TABLE public.shifts
    ADD COLUMN break_start time,
    ADD COLUMN break_end   time;
COMMENT ON COLUMN public.shifts.break_start IS
    'Rostered meal-break start (cl 36.1). Resolved against start_time across midnight. Pay and cl 36.2 timing read it.';
COMMENT ON COLUMN public.shifts.break_end IS
    'Rostered meal-break end. unpaid_break_minutes equals the window, or 0 where the meal break is paid (security).';

ALTER TABLE public.template_shifts
    ADD COLUMN break_start time,
    ADD COLUMN break_end   time;

-- ── 3. Constraints ───────────────────────────────────────────────────────────

-- Superseded: ">5h ⇒ unpaid + paid ≥ 30" let a rest pause count as the meal
-- break and said nothing about where it sat. The window predicate replaces it.
ALTER TABLE public.shifts DROP CONSTRAINT shifts_shape_meal_break;

ALTER TABLE public.shifts ADD CONSTRAINT shifts_shape_break_window CHECK (
    public.shift_break_window_breach(start_time, end_time, unpaid_break_minutes, break_start, break_end) IS NULL
);

ALTER TABLE public.template_shifts ADD CONSTRAINT template_shifts_break_window CHECK (
    public.shift_break_window_breach(start_time, end_time, unpaid_break_minutes, break_start, break_end) IS NULL
) NOT VALID;

-- ── 4. Live write paths ──────────────────────────────────────────────────────
-- Each live function is patched in place from its own catalogue definition, so
-- nothing else in it (authz guards, audit, locking) can be lost by retyping it.
-- A snippet that does not occur exactly once aborts the migration.

CREATE FUNCTION pg_temp.patch_fn(p_fn regprocedure, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_def text := pg_get_functiondef(p_fn);
    v_n   int;
BEGIN
    v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'patch_fn %: expected the snippet exactly once, found % — %', p_fn, v_n, left(p_old, 90);
    END IF;
    EXECUTE replace(v_def, p_old, p_new);
END;
$$;

-- sm_create_shift — the create path.
SELECT pg_temp.patch_fn('public.sm_create_shift(jsonb,uuid)',
$o$paid_break_minutes, unpaid_break_minutes, break_minutes, timezone,$o$,
$n$paid_break_minutes, unpaid_break_minutes, break_minutes, break_start, break_end, timezone,$n$);

SELECT pg_temp.patch_fn('public.sm_create_shift(jsonb,uuid)',
$o$COALESCE((p_shift_data->>'break_minutes')::integer, 0),$o$,
$n$COALESCE((p_shift_data->>'break_minutes')::integer, 0),
        NULLIF(p_shift_data->>'break_start', '')::time,
        NULLIF(p_shift_data->>'break_end', '')::time,$n$);

-- _apply_shift_op_write — the gateway edit. CASE, not COALESCE: shortening a
-- shift under five hours has to be able to clear its break.
SELECT pg_temp.patch_fn('public._apply_shift_op_write(uuid,text,jsonb,uuid)',
$o$'unpaid_break_minutes','notes','role_id'$o$,
$n$'unpaid_break_minutes','break_start','break_end','notes','role_id'$n$);

SELECT pg_temp.patch_fn('public._apply_shift_op_write(uuid,text,jsonb,uuid)',
$o$unpaid_break_minutes  = COALESCE((p_payload->>'unpaid_break_minutes')::int, unpaid_break_minutes),$o$,
$n$unpaid_break_minutes  = COALESCE((p_payload->>'unpaid_break_minutes')::int, unpaid_break_minutes),
      break_start           = CASE WHEN p_payload ? 'break_start' THEN NULLIF(p_payload->>'break_start', '')::time ELSE break_start END,
      break_end             = CASE WHEN p_payload ? 'break_end' THEN NULLIF(p_payload->>'break_end', '')::time ELSE break_end END,$n$);

-- sm_apply_shift_op — the audit diff records a moved break like any other edit.
SELECT pg_temp.patch_fn('public.sm_apply_shift_op(uuid,integer,text,jsonb,uuid)',
$o$    IF v_pre.notes IS DISTINCT FROM v_cur.notes THEN$o$,
$n$    IF v_pre.break_start IS DISTINCT FROM v_cur.break_start THEN
      v_changes := v_changes || jsonb_build_object('break_start',
        jsonb_build_object('old', to_jsonb(v_pre.break_start), 'new', to_jsonb(v_cur.break_start)));
    END IF;
    IF v_pre.break_end IS DISTINCT FROM v_cur.break_end THEN
      v_changes := v_changes || jsonb_build_object('break_end',
        jsonb_build_object('old', to_jsonb(v_pre.break_end), 'new', to_jsonb(v_cur.break_end)));
    END IF;
    IF v_pre.notes IS DISTINCT FROM v_cur.notes THEN$n$);

-- apply_template_to_date_range_v2 — carry the window, and skip an instance whose
-- window the table would refuse (same predicate) instead of aborting the batch.
SELECT pg_temp.patch_fn('public.apply_template_to_date_range_v2(uuid,date,date,uuid,text,uuid,uuid,boolean)',
$o$    v_ts record;$o$,
$n$    v_ts record;
    v_breach_window text;$n$);

SELECT pg_temp.patch_fn('public.apply_template_to_date_range_v2(uuid,date,date,uuid,text,uuid,uuid,boolean)',
$o$v_breach := public.shift_day_typed_shortfall($o$,
$n$v_breach_window := public.shift_break_window_breach(
                                v_ts.start_time, v_ts.end_time, COALESCE(v_ts.unpaid_break_minutes, 0),
                                v_ts.break_start, v_ts.break_end);
                            v_breach := public.shift_day_typed_shortfall($n$);

SELECT pg_temp.patch_fn('public.apply_template_to_date_range_v2(uuid,date,date,uuid,text,uuid,uuid,boolean)',
$o$IF v_breach IS NOT NULL THEN$o$,
$n$v_breach := COALESCE(v_breach_window, v_breach);
                            IF v_breach IS NOT NULL THEN$n$);

SELECT pg_temp.patch_fn('public.apply_template_to_date_range_v2(uuid,date,date,uuid,text,uuid,uuid,boolean)',
$o$paid_break_minutes, unpaid_break_minutes,$o$,
$n$paid_break_minutes, unpaid_break_minutes, break_start, break_end,$n$);

SELECT pg_temp.patch_fn('public.apply_template_to_date_range_v2(uuid,date,date,uuid,text,uuid,uuid,boolean)',
$o$COALESCE(v_ts.paid_break_minutes, 0), COALESCE(v_ts.unpaid_break_minutes, 0),$o$,
$n$COALESCE(v_ts.paid_break_minutes, 0), COALESCE(v_ts.unpaid_break_minutes, 0), v_ts.break_start, v_ts.break_end,$n$);

-- clone_roster_subgroup_v2 — a cloned shift keeps its break where it was.
SELECT pg_temp.patch_fn('public.clone_roster_subgroup_v2(uuid,uuid,uuid,text,text,text,date,date,boolean)',
$o$s.paid_break_minutes,$o$,
$n$s.paid_break_minutes, s.break_start, s.break_end,$n$);

SELECT pg_temp.patch_fn('public.clone_roster_subgroup_v2(uuid,uuid,uuid,text,text,text,date,date,boolean)',
$o$paid_break_minutes,
                    is_training,$o$,
$n$paid_break_minutes, break_start, break_end,
                    is_training,$n$);

-- save_template_full — both the update and the insert branch.
SELECT pg_temp.patch_fn('public.save_template_full(uuid,integer,text,text,jsonb,uuid)',
$o$unpaid_break_minutes = COALESCE((v_shift->>'unpaidBreakDuration')::integer, 0),$o$,
$n$unpaid_break_minutes = COALESCE((v_shift->>'unpaidBreakDuration')::integer, 0),
                                break_start = NULLIF(v_shift->>'breakStart', '')::time,
                                break_end = NULLIF(v_shift->>'breakEnd', '')::time,$n$);

SELECT pg_temp.patch_fn('public.save_template_full(uuid,integer,text,text,jsonb,uuid)',
$o$unpaid_break_minutes,
                                required_skills,$o$,
$n$unpaid_break_minutes,
                                break_start,
                                break_end,
                                required_skills,$n$);

SELECT pg_temp.patch_fn('public.save_template_full(uuid,integer,text,text,jsonb,uuid)',
$o$COALESCE((v_shift->>'unpaidBreakDuration')::integer, 0),
                                COALESCE($o$,
$n$COALESCE((v_shift->>'unpaidBreakDuration')::integer, 0),
                                NULLIF(v_shift->>'breakStart', '')::time,
                                NULLIF(v_shift->>'breakEnd', '')::time,
                                COALESCE($n$);

-- v_template_full — the template editor reads the window back. CREATE OR
-- REPLACE VIEW drops security_invoker, so it is set again explicitly.
DO $$
DECLARE
    v_def text := pg_get_viewdef('public.v_template_full'::regclass, true);
    v_old text := $o$'unpaidBreakDuration', COALESCE(s.unpaid_break_minutes, 0), $o$;
    v_n   int;
BEGIN
    v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'v_template_full: expected the snippet exactly once, found %', v_n;
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW public.v_template_full AS '
        || replace(v_def, v_old, v_old
            || $n$'breakStart', to_char(s.break_start::interval, 'HH24:MI'::text), 'breakEnd', to_char(s.break_end::interval, 'HH24:MI'::text), $n$);
    ALTER VIEW public.v_template_full SET (security_invoker = true);
END $$;
