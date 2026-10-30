-- Shift Shape Compliance — a database backstop for the app-layer gate.
--
-- WHY THIS EXISTS
-- ---------------
-- The shape layer is enforced at two client gates (shiftsCommands.createShift /
-- .updateShift, and template save). Both are unavoidable for the application —
-- but neither is reachable from psql, from a SECURITY DEFINER RPC that writes
-- `shifts` directly, or from any future code path that forgets to call them.
-- Phase 4b found exactly that failure: the shape rules had ONE caller, so every
-- other creation path wrote unchecked. Moving the gate did not remove the class
-- of defect, it only reduced the number of doors.
--
-- DELIBERATELY WEAKER THAN THE APPLICATION LAYER
-- ----------------------------------------------
-- A CHECK constraint sees one row and nothing else. It cannot resolve a role
-- name (so it cannot tell a Security shift, whose meal break is PAID under
-- Sch 3 §3.2(a)/§5.3(a), from anyone else's) and it cannot know whether a date
-- is a public holiday (that calendar lives in a JS library, not a table). Where
-- it cannot see, it is written to ACCEPT.
--
-- That direction is the whole design. A backstop that rejects a shift the
-- application considers lawful is not a safety net — it is an outage, and one
-- whose only workaround is to stop using the application. Every predicate below
-- is therefore equal to or looser than `compliance/shape/evaluate.ts`, never
-- tighter. What it catches is the flagrant case: a 14-hour shift, a full-time
-- day of two hours, an eight-hour shift with no break at all.
--
-- WHAT IT DOES NOT CARRY, AND WHY
-- -------------------------------
--   SHAPE_MIN_ENGAGEMENT_PH   cl 56.2's four hours needs the holiday calendar.
--   the Sunday tier            derivable from shift_date, but only meaningful
--                              alongside the PH tier it shares a rule with;
--                              carrying half of a two-limbed rule would imply
--                              the other half is covered.
--   SHAPE_MEAL_BREAK (exact)  needs the role name to know which break field is
--                              the meal break. The loose form below accepts
--                              either field.
--   SHAPE_REST_PAUSE (exact)  same reason: for Security, `paid_break_minutes`
--                              pools the meal break with the cl 37 pauses, and
--                              only the application can separate them.
--
-- These stay in the application layer, which can see what a row cannot.
--
-- APPLIED TO PRODUCTION 2026-08-18 as version 20260818231137 (this filename).
-- The filename was renamed from 20260818000000 to match the version the apply
-- actually recorded in supabase_migrations.schema_migrations — a mismatch there
-- is what makes `supabase migration list` report drift that does not exist.
--
-- SAFETY
-- ------
-- `shifts` held 0 rows when this was written (verified against production
-- 2026-08-18), and all 22 rows of the live template library satisfy every
-- predicate, so no existing data can be invalidated. Each rule is a SEPARATE
-- named constraint so a violation names the clause it breached rather than
-- reporting one opaque composite failure.

-- No explicit BEGIN/COMMIT: the migration runner owns the transaction, and
-- 121 of the 125 migrations in this project leave it that way.

-- Net working minutes, from a single row. Overnight shifts wrap: an end_time at
-- or before start_time means the shift crosses midnight, so a day is added.
-- IMMUTABLE and STRICT: a CHECK constraint may only call immutable functions,
-- and a NULL input must yield NULL so the constraint passes rather than errors.
CREATE OR REPLACE FUNCTION public.shift_net_minutes(
    p_start_time    time,
    p_end_time      time,
    p_unpaid_break  integer
) RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $$
    SELECT CASE
        WHEN p_end_time <= p_start_time
            THEN (EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60)::int + 1440
        ELSE (EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60)::int
    END - COALESCE(p_unpaid_break, 0);
$$;

COMMENT ON FUNCTION public.shift_net_minutes(time, time, integer) IS
    'Net working minutes for one shift: gross span (wrapping past midnight) less the unpaid break. Mirrors the NET measure locked across the compliance layer on 2026-08-15.';

-- DELIBERATELY NOT REVOKED. This project's standing practice is to revoke
-- EXECUTE from PUBLIC/anon on new functions, because Supabase grants it
-- automatically and 211 definer functions were once exposed that way. This one
-- is the exception on purpose: it takes three scalars, touches no table, and
-- returns arithmetic, so there is nothing to leak — and it is called from CHECK
-- constraints on every INSERT into `shifts`. Revoking a function the constraint
-- machinery has to evaluate risks breaking every write to the table, which is a
-- far worse outcome than exposing a subtraction.

-- SHAPE_VALID_RANGE — a zero-length shift is degenerate, not a 24-hour one.
ALTER TABLE public.shifts
    ADD CONSTRAINT shifts_shape_valid_range
    CHECK (start_time IS NULL OR end_time IS NULL OR start_time <> end_time)
    NOT VALID;

-- SHAPE_BREAK_EXCEEDS_SHIFT — an unpaid break cannot consume the whole shift.
ALTER TABLE public.shifts
    ADD CONSTRAINT shifts_shape_break_within_shift
    CHECK (
        start_time IS NULL OR end_time IS NULL
        OR public.shift_net_minutes(start_time, end_time, COALESCE(unpaid_break_minutes, 0)) > 0
    )
    NOT VALID;

-- SHAPE_MAX_DURATION — 12 net hours (cl 35.1(d)/35.2(d)/35.3(d)/35.4(c)).
ALTER TABLE public.shifts
    ADD CONSTRAINT shifts_shape_max_duration
    CHECK (
        start_time IS NULL OR end_time IS NULL
        OR public.shift_net_minutes(start_time, end_time, COALESCE(unpaid_break_minutes, 0)) <= 720
    )
    NOT VALID;

-- SHAPE_FT_MIN_DAY — cl 35.1(c), 7.6 net ordinary hours on a full-time day.
ALTER TABLE public.shifts
    ADD CONSTRAINT shifts_shape_ft_min_day
    CHECK (
        target_employment_type <> 'FT'
        OR start_time IS NULL OR end_time IS NULL
        OR public.shift_net_minutes(start_time, end_time, COALESCE(unpaid_break_minutes, 0)) >= 456
    )
    NOT VALID;

-- SHAPE_MIN_ENGAGEMENT, plain part-time limb — cl 12.3(e) is a FLAT three
-- hours with no exceptions, so it needs neither the calendar nor the training
-- flag and can be carried exactly.
ALTER TABLE public.shifts
    ADD CONSTRAINT shifts_shape_pt_min_engagement
    CHECK (
        target_employment_type <> 'PT'
        OR target_requires_flexible
        OR start_time IS NULL OR end_time IS NULL
        OR public.shift_net_minutes(start_time, end_time, COALESCE(unpaid_break_minutes, 0)) >= 180
    )
    NOT VALID;

-- SHAPE_MIN_ENGAGEMENT, absolute floor — the shortest engagement anywhere in
-- cl 12 is the two-hour training concession (cl 12.4(c)(b)/12.5(c)(b)). Nothing
-- non-full-time may be shorter than that on any day, whatever the day type, so
-- this is the one tier that holds without the calendar.
ALTER TABLE public.shifts
    ADD CONSTRAINT shifts_shape_min_engagement_floor
    CHECK (
        target_employment_type = 'FT'
        OR start_time IS NULL OR end_time IS NULL
        OR public.shift_net_minutes(start_time, end_time, COALESCE(unpaid_break_minutes, 0)) >= 120
    )
    NOT VALID;

-- SHAPE_MEAL_BREAK (loose) — cl 36.1. More than five net hours requires thirty
-- minutes of break. EITHER field counts: only the application can tell whether
-- Schedule 3 makes this shift's meal break the paid one.
ALTER TABLE public.shifts
    ADD CONSTRAINT shifts_shape_meal_break
    CHECK (
        start_time IS NULL OR end_time IS NULL
        OR public.shift_net_minutes(start_time, end_time, COALESCE(unpaid_break_minutes, 0)) <= 300
        OR COALESCE(unpaid_break_minutes, 0) + COALESCE(paid_break_minutes, 0) >= 30
    )
    NOT VALID;

-- SHAPE_REST_PAUSE_1 / _2 (loose) — cl 37.1 and 37.2. Fifteen paid minutes
-- from four net hours, thirty from eight. Loose because for Security the paid
-- field also carries the meal break, which would make an exact test stricter
-- than the agreement.
ALTER TABLE public.shifts
    ADD CONSTRAINT shifts_shape_rest_pause
    CHECK (
        start_time IS NULL OR end_time IS NULL
        OR public.shift_net_minutes(start_time, end_time, COALESCE(unpaid_break_minutes, 0)) < 240
        OR COALESCE(paid_break_minutes, 0) >= CASE
            WHEN public.shift_net_minutes(start_time, end_time, COALESCE(unpaid_break_minutes, 0)) >= 480
                THEN 30
            ELSE 15
        END
    )
    NOT VALID;

-- Added NOT VALID, then validated explicitly. On an empty table this is
-- equivalent to adding them valid, but it keeps the two steps separable if this
-- is ever re-run against a table that has since been populated: VALIDATE takes
-- only a SHARE UPDATE EXCLUSIVE lock and can be retried after the offending
-- rows are corrected, where a plain ADD would fail the whole migration.
ALTER TABLE public.shifts VALIDATE CONSTRAINT shifts_shape_valid_range;
ALTER TABLE public.shifts VALIDATE CONSTRAINT shifts_shape_break_within_shift;
ALTER TABLE public.shifts VALIDATE CONSTRAINT shifts_shape_max_duration;
ALTER TABLE public.shifts VALIDATE CONSTRAINT shifts_shape_ft_min_day;
ALTER TABLE public.shifts VALIDATE CONSTRAINT shifts_shape_pt_min_engagement;
ALTER TABLE public.shifts VALIDATE CONSTRAINT shifts_shape_min_engagement_floor;
ALTER TABLE public.shifts VALIDATE CONSTRAINT shifts_shape_meal_break;
ALTER TABLE public.shifts VALIDATE CONSTRAINT shifts_shape_rest_pause;

