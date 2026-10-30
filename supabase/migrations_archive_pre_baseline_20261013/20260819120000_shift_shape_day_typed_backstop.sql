-- Shift Shape Compliance — the DAY-TYPED backstop.
--
-- WHAT THE 2026-08-18 BACKSTOP COULD NOT CARRY, AND WHY THIS CAN
-- --------------------------------------------------------------
-- `20260818231137_shift_shape_check_backstop.sql` put eight of the twelve shape
-- rules into CHECK constraints and recorded, in its own header, the two it had
-- to leave out:
--
--     SHAPE_MIN_ENGAGEMENT_PH   cl 56.2's four hours needs the holiday calendar.
--     the Sunday tier           derivable from shift_date, but only meaningful
--                               alongside the PH tier it shares a rule with.
--
-- The blocker was never the rule. It was the MECHANISM: a CHECK constraint sees
-- one row and may only call immutable functions, so it cannot look a date up in
-- a table. A trigger can. `public_holidays` has been in production since
-- 2026-08-04 with an AU-NSW calendar, and nothing was reading it.
--
-- So the two rules move in, by the only means that can hold them, and the
-- backstop stops being deliberately incomplete.
--
-- WHY IT MATTERS MORE THAN THE OTHER TEN
-- --------------------------------------
-- Every other shape rule is decidable from the shift alone, which means the
-- application layer can decide it once, at creation, and be right forever.
-- These two are decided by WHICH DAY the shift falls on — so they are the only
-- two that a later change can invalidate without touching the shift at all.
-- Three production paths do exactly that:
--
--   * `sm_move_shift` re-dates a row and never asks. All 22 rows of the live
--     template library carry `day_of_week = NULL`, which the apply RPC reads as
--     EVERY day, so every template shift already lands on every Sunday and
--     every public holiday in whatever range a manager picks.
--   * `clone_roster_subgroup_v2` copies a subgroup across a date range with no
--     shape check of any kind.
--   * the assign command writes `start_time`/`end_time` with a raw table update.
--
-- The client gates added alongside this migration close all three. This closes
-- the ones nobody has written yet, plus psql, plus the eight other functions
-- that INSERT INTO shifts without passing through `sm_create_shift`.
--
-- STILL EQUAL-OR-LOOSER THAN THE APPLICATION LAYER
-- ------------------------------------------------
-- The principle from the CHECK backstop is unchanged and still governs: a
-- backstop that rejects a shift the application considers lawful is not a
-- safety net, it is an outage. What changed is how much the mechanism can see.
-- A trigger CAN resolve a role name, so Schedule 3's paid meal break is applied
-- exactly rather than approximated, and `is_training` and
-- `target_requires_flexible` are read straight off the row. On these two rules
-- the backstop is therefore EXACT, not loose — which is safe precisely because
-- there is no longer anything it has to guess.
--
-- THE ONE THING IT REFUSES TO GUESS: an uncovered year.
-- `public_holidays` ran to 2032-12-28. A date past the end of the calendar is
-- not a working day and not a public holiday — it is UNKNOWN, and the whole
-- reason this rule needed a table is that the last implementation to conflate
-- those two shipped a hardcoded 2026 list that silently classified all of 2027
-- as "no holidays" and reported zero public-holiday shifts forever. This one
-- RAISES instead, and the calendar is extended to 2040 below so that the raise
-- is unreachable in practice rather than merely unlikely.

-- ── 1. Extend the calendar to 2040 ──────────────────────────────────────────
-- Generated from the application's OWN `date-holidays` AU-NSW instance — the
-- same source as the 2024-2032 seed and the same one `core/lib/holidays.ts`
-- consults at runtime — so the two cannot disagree on day one. `type: 'public'`
-- only, matching `getYearIndex()`.
--
-- ON CONFLICT on `holiday_date`: the legacy table carries a single-column
-- UNIQUE on that alone in addition to the (date, jurisdiction) pair, so a
-- re-run is a no-op rather than a violation. Both `name` and the legacy
-- `holiday_name` are written; the latter is nullable but populated for every
-- existing row, and leaving new rows half-filled is how a column becomes
-- untrustworthy.
--
-- DISTINCT ON: two genuinely different holidays can fall on one date — Anzac
-- Day and Easter Sunday both land on 2038-04-25 — and the legacy single-column
-- UNIQUE on `holiday_date` cannot hold both. The table is consulted only for
-- "is this date a public holiday", never for which one, so collapsing them is
-- lossless for every reader. Ordered so the choice is deterministic across
-- re-runs rather than dependent on VALUES order.
INSERT INTO public.public_holidays (holiday_date, jurisdiction, name, holiday_name, applies_to_state, is_national)
SELECT DISTINCT ON (d) d, j, n, n, 'NSW', false
FROM (VALUES
    ('2033-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2033-01-03', 'AU-NSW', 'New Year''s Day'),
    ('2033-01-26', 'AU-NSW', 'Australia Day'),
    ('2033-04-15', 'AU-NSW', 'Good Friday'),
    ('2033-04-16', 'AU-NSW', 'Easter Saturday'),
    ('2033-04-17', 'AU-NSW', 'Easter Sunday'),
    ('2033-04-18', 'AU-NSW', 'Easter Monday'),
    ('2033-04-25', 'AU-NSW', 'Anzac Day'),
    ('2033-06-13', 'AU-NSW', 'King''s Birthday'),
    ('2033-10-03', 'AU-NSW', 'Labour Day'),
    ('2033-12-25', 'AU-NSW', 'Christmas Day'),
    ('2033-12-26', 'AU-NSW', 'Boxing Day'),
    ('2033-12-27', 'AU-NSW', 'Christmas Day (substitute day)'),
    ('2034-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2034-01-02', 'AU-NSW', 'New Year''s Day'),
    ('2034-01-26', 'AU-NSW', 'Australia Day'),
    ('2034-04-07', 'AU-NSW', 'Good Friday'),
    ('2034-04-08', 'AU-NSW', 'Easter Saturday'),
    ('2034-04-09', 'AU-NSW', 'Easter Sunday'),
    ('2034-04-10', 'AU-NSW', 'Easter Monday'),
    ('2034-04-25', 'AU-NSW', 'Anzac Day'),
    ('2034-06-12', 'AU-NSW', 'King''s Birthday'),
    ('2034-10-02', 'AU-NSW', 'Labour Day'),
    ('2034-12-25', 'AU-NSW', 'Christmas Day'),
    ('2034-12-26', 'AU-NSW', 'Boxing Day'),
    ('2035-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2035-01-26', 'AU-NSW', 'Australia Day'),
    ('2035-03-23', 'AU-NSW', 'Good Friday'),
    ('2035-03-24', 'AU-NSW', 'Easter Saturday'),
    ('2035-03-25', 'AU-NSW', 'Easter Sunday'),
    ('2035-03-26', 'AU-NSW', 'Easter Monday'),
    ('2035-04-25', 'AU-NSW', 'Anzac Day'),
    ('2035-06-11', 'AU-NSW', 'King''s Birthday'),
    ('2035-10-01', 'AU-NSW', 'Labour Day'),
    ('2035-12-25', 'AU-NSW', 'Christmas Day'),
    ('2035-12-26', 'AU-NSW', 'Boxing Day'),
    ('2036-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2036-01-28', 'AU-NSW', 'Australia Day'),
    ('2036-04-11', 'AU-NSW', 'Good Friday'),
    ('2036-04-12', 'AU-NSW', 'Easter Saturday'),
    ('2036-04-13', 'AU-NSW', 'Easter Sunday'),
    ('2036-04-14', 'AU-NSW', 'Easter Monday'),
    ('2036-04-25', 'AU-NSW', 'Anzac Day'),
    ('2036-06-09', 'AU-NSW', 'King''s Birthday'),
    ('2036-10-06', 'AU-NSW', 'Labour Day'),
    ('2036-12-25', 'AU-NSW', 'Christmas Day'),
    ('2036-12-26', 'AU-NSW', 'Boxing Day'),
    ('2037-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2037-01-26', 'AU-NSW', 'Australia Day'),
    ('2037-04-03', 'AU-NSW', 'Good Friday'),
    ('2037-04-04', 'AU-NSW', 'Easter Saturday'),
    ('2037-04-05', 'AU-NSW', 'Easter Sunday'),
    ('2037-04-06', 'AU-NSW', 'Easter Monday'),
    ('2037-04-25', 'AU-NSW', 'Anzac Day'),
    ('2037-04-27', 'AU-NSW', 'Anzac Day (substitute day)'),
    ('2037-06-08', 'AU-NSW', 'King''s Birthday'),
    ('2037-10-05', 'AU-NSW', 'Labour Day'),
    ('2037-12-25', 'AU-NSW', 'Christmas Day'),
    ('2037-12-26', 'AU-NSW', 'Boxing Day'),
    ('2037-12-28', 'AU-NSW', 'Boxing Day (substitute day)'),
    ('2038-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2038-01-26', 'AU-NSW', 'Australia Day'),
    ('2038-04-23', 'AU-NSW', 'Good Friday'),
    ('2038-04-24', 'AU-NSW', 'Easter Saturday'),
    ('2038-04-25', 'AU-NSW', 'Anzac Day'),
    ('2038-04-25', 'AU-NSW', 'Easter Sunday'),
    ('2038-04-26', 'AU-NSW', 'Easter Monday'),
    ('2038-04-26', 'AU-NSW', 'Anzac Day (substitute day)'),
    ('2038-06-14', 'AU-NSW', 'King''s Birthday'),
    ('2038-10-04', 'AU-NSW', 'Labour Day'),
    ('2038-12-25', 'AU-NSW', 'Christmas Day'),
    ('2038-12-26', 'AU-NSW', 'Boxing Day'),
    ('2038-12-27', 'AU-NSW', 'Christmas Day (substitute day)'),
    ('2038-12-28', 'AU-NSW', 'Boxing Day (substitute day)'),
    ('2039-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2039-01-03', 'AU-NSW', 'New Year''s Day'),
    ('2039-01-26', 'AU-NSW', 'Australia Day'),
    ('2039-04-08', 'AU-NSW', 'Good Friday'),
    ('2039-04-09', 'AU-NSW', 'Easter Saturday'),
    ('2039-04-10', 'AU-NSW', 'Easter Sunday'),
    ('2039-04-11', 'AU-NSW', 'Easter Monday'),
    ('2039-04-25', 'AU-NSW', 'Anzac Day'),
    ('2039-06-13', 'AU-NSW', 'King''s Birthday'),
    ('2039-10-03', 'AU-NSW', 'Labour Day'),
    ('2039-12-25', 'AU-NSW', 'Christmas Day'),
    ('2039-12-26', 'AU-NSW', 'Boxing Day'),
    ('2039-12-27', 'AU-NSW', 'Christmas Day (substitute day)'),
    ('2040-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2040-01-02', 'AU-NSW', 'New Year''s Day'),
    ('2040-01-26', 'AU-NSW', 'Australia Day'),
    ('2040-03-30', 'AU-NSW', 'Good Friday'),
    ('2040-03-31', 'AU-NSW', 'Easter Saturday'),
    ('2040-04-01', 'AU-NSW', 'Easter Sunday'),
    ('2040-04-02', 'AU-NSW', 'Easter Monday'),
    ('2040-04-25', 'AU-NSW', 'Anzac Day'),
    ('2040-06-11', 'AU-NSW', 'King''s Birthday'),
    ('2040-10-01', 'AU-NSW', 'Labour Day'),
    ('2040-12-25', 'AU-NSW', 'Christmas Day'),
    ('2040-12-26', 'AU-NSW', 'Boxing Day')
) AS v(d, j, n)
ORDER BY d, n
ON CONFLICT (holiday_date) DO NOTHING;

-- ── 2. Is this shift a Security role under EBA Schedule 3? ──────────────────
-- Sch 3 §1.1 makes the schedule prevail wherever it conflicts with the
-- Agreement, and it conflicts here: the security meal break is PAID (§3.2(a),
-- §5.3(a),(c)), so net working time equals gross and no unpaid break is
-- deducted. Getting this wrong would UNDERSTATE a security shift's length and
-- refuse a lawful four-hour public holiday engagement.
--
-- Name match, mirroring `compliance/security-role.ts` exactly — that module is
-- the owner of this fact and documents why a name is the only signal the schema
-- carries (there is no `is_security` column on `roles`; 24 of 200 production
-- roles match, with no false positives). `lower(name) LIKE '%security%'` is the
-- literal translation of `name.toLowerCase().includes('security')`.
--
-- STABLE, not IMMUTABLE: it reads a table. That is exactly why this logic could
-- not live in a CHECK constraint and needs a trigger.
CREATE OR REPLACE FUNCTION public.shift_is_security_role(p_role_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.id = p_role_id AND lower(r.name) LIKE '%security%'
    );
$$;

COMMENT ON FUNCTION public.shift_is_security_role(uuid) IS
    'True when a shift''s role is a Security role under EBA Schedule 3. Mirrors isSecurityRoleName() in src/modules/compliance/security-role.ts, which owns this definition.';

-- ── 3. How far the holiday calendar actually reaches ────────────────────────
-- Separated out so the horizon is queryable — a monitoring check can ask "how
-- many years of calendar are left?" without reproducing the query, and the
-- error message below can name the real boundary rather than a hardcoded year
-- that would drift the moment the seed is extended again.
CREATE OR REPLACE FUNCTION public.public_holiday_calendar_horizon(p_jurisdiction text DEFAULT 'AU-NSW')
RETURNS date
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public'
AS $$
    SELECT max(holiday_date) FROM public.public_holidays WHERE jurisdiction = p_jurisdiction;
$$;

COMMENT ON FUNCTION public.public_holiday_calendar_horizon(text) IS
    'Last date the seeded public holiday calendar covers. Past this, a date cannot be classified and the day-typed shape guard raises rather than assuming "not a holiday".';

-- ── 4. The rule itself ──────────────────────────────────────────────────────
-- Returns NULL when the shift is lawful on its day, or a human-readable breach
-- naming the clause. One function, two callers: the trigger below RAISES on a
-- non-null result, and `apply_template_to_date_range_v2` SKIPS the instance and
-- counts it. Having them share the predicate is the point — a template apply
-- that skipped on a different rule from the one the trigger enforces would
-- either abort halfway or write rows the trigger was supposed to stop.
--
-- FULL-TIME IS EXEMPT FROM BOTH LIMBS, and not by oversight:
--   * cl 56.2's four hours is already subsumed by SHAPE_FT_MIN_DAY's 7.6 hours,
--     which the CHECK backstop carries unconditionally.
--   * cl 12's engagement tiers do not apply to full-timers at all.
-- This mirrors `evaluate.ts`, where the PH rule tests
-- `target_employment_type !== 'FT'` and the tier table sits in the `else` limb
-- of the same branch.
CREATE OR REPLACE FUNCTION public.shift_day_typed_shortfall(
    p_shift_date               date,
    p_start_time               time,
    p_end_time                 time,
    p_unpaid_break_minutes     integer,
    p_target_employment_type   text,
    p_target_requires_flexible boolean,
    p_is_training              boolean,
    p_role_id                  uuid,
    p_jurisdiction             text DEFAULT 'AU-NSW'
) RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_is_security boolean;
    v_net         integer;
    v_is_ph       boolean;
    v_is_sunday   boolean;
    v_horizon     date;
BEGIN
    -- A shift with no times has no shape to judge. Same reading as the
    -- INCOMPLETE status in evaluate.ts: not a pass and not a failure.
    IF p_shift_date IS NULL OR p_start_time IS NULL OR p_end_time IS NULL THEN
        RETURN NULL;
    END IF;

    -- Neither limb binds full-time. See the header above.
    IF p_target_employment_type = 'FT' THEN
        RETURN NULL;
    END IF;

    v_is_ph := EXISTS (
        SELECT 1 FROM public.public_holidays ph
        WHERE ph.holiday_date = p_shift_date AND ph.jurisdiction = p_jurisdiction
    );

    -- An uncovered year is UNKNOWN, not "no holiday". Checked only when the
    -- answer would otherwise be a negative — a date that IS in the table is
    -- classified regardless of where the horizon sits.
    IF NOT v_is_ph THEN
        v_horizon := public.public_holiday_calendar_horizon(p_jurisdiction);
        IF v_horizon IS NULL OR p_shift_date > v_horizon THEN
            RAISE EXCEPTION
                'The % public holiday calendar only reaches %, so a shift on % cannot be classified. Extend public_holidays before rostering past the horizon — treating an uncovered date as "not a public holiday" is how cl 56.2 silently stopped applying to an entire year once before.',
                p_jurisdiction, COALESCE(v_horizon::text, '(empty)'), p_shift_date
                USING ERRCODE = '23514';
        END IF;
    END IF;

    v_is_sunday := EXTRACT(DOW FROM p_shift_date) = 0;

    IF NOT v_is_ph AND NOT v_is_sunday THEN
        RETURN NULL;
    END IF;

    -- Net working minutes. Schedule 3 makes the security meal break paid, so
    -- there is no unpaid break to deduct and net equals gross.
    v_is_security := public.shift_is_security_role(p_role_id);
    v_net := public.shift_net_minutes(
        p_start_time,
        p_end_time,
        CASE WHEN v_is_security THEN 0 ELSE COALESCE(p_unpaid_break_minutes, 0) END
    );

    -- cl 56.2 — four hours on a public holiday, for every Team Member.
    -- Independent of cl 12's tiers and stricter than all of them: it overrides
    -- even the two-hour training concession, which is why it is tested first
    -- and without reference to `p_is_training`.
    IF v_is_ph AND v_net < 240 THEN
        RETURN format(
            'SHAPE_MIN_ENGAGEMENT_PH: a shift on a public holiday must be at least 4 hours (ICC EBA cl 56.2); this one provides %s minutes of net working time.',
            v_net
        );
    END IF;

    -- The Sunday tier of cl 12.4(c)/12.5(c) — four hours.
    --
    -- Two employment situations reach a LOWER floor on a Sunday, and both are
    -- already carried by the CHECK backstop as date-blind minima, so neither is
    -- re-tested here:
    --   * plain part-time is a flat 3h with no exceptions (cl 12.3(e)), Sunday
    --     included — `shifts_shape_pt_min_engagement`.
    --   * a training engagement is 2h (cl 12.4(c)(b)/12.5(c)(b)), and the
    --     tier table in `requiredMinEngagementMinutes` returns it BEFORE it
    --     reaches the Sunday limb — `shifts_shape_min_engagement_floor`.
    -- Asserting four hours against either would make this backstop STRICTER
    -- than the application, which is the one thing it must never be.
    IF v_is_sunday
       AND NOT (p_target_employment_type = 'PT' AND NOT COALESCE(p_target_requires_flexible, false))
       AND NOT COALESCE(p_is_training, false)
       AND v_net < 240
    THEN
        RETURN format(
            'SHAPE_MIN_ENGAGEMENT: a Sunday engagement must be at least 4 hours (ICC EBA cl 12.4(c)/12.5(c)); this one provides %s minutes of net working time.',
            v_net
        );
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.shift_day_typed_shortfall(date, time, time, integer, text, boolean, boolean, uuid, text) IS
    'NULL when a shift satisfies the two DAY-TYPED shape rules (cl 56.2 public holiday, cl 12 Sunday tier), else the breach. Shared by trg_shift_shape_3_day_typed (which raises) and apply_template_to_date_range_v2 (which skips). Mirrors compliance/shape/evaluate.ts.';

-- ── 5. The guard ────────────────────────────────────────────────────────────
-- BEFORE INSERT OR UPDATE OF the shape inputs only. Two reasons that column
-- list matters:
--
--   * a shift assigned, published, clocked in or exported for payroll must not
--     be re-litigated on its shape — those updates touch none of these columns
--     and so never fire this;
--   * the list mirrors `TOUCHES_SHAPE` in `shiftsCommands.updateShift`, so the
--     client gate and the database agree on what "changing the shape" means.
--     `shift_date` is in both, which is the whole point: it was in the client
--     list already and `sm_move_shift` went round it.
--
-- Named `trg_shift_shape_3_day_typed` so it sorts AFTER
-- `trg_shift_employment_target_1_resolve`. Postgres fires row-level BEFORE
-- triggers in name order, and that one resolves `target_employment_type` from
-- the template row — reading it first would judge a template-stamped shift
-- against a NULL target.
CREATE OR REPLACE FUNCTION public.fn_shift_shape_day_typed_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE v_breach text;
BEGIN
    -- A soft-deleted or cancelled shift is a record, not a roster entry.
    -- Blocking an edit to one would make bad historical data unfixable.
    IF NEW.deleted_at IS NOT NULL OR COALESCE(NEW.is_cancelled, false) THEN
        RETURN NEW;
    END IF;

    v_breach := public.shift_day_typed_shortfall(
        NEW.shift_date,
        NEW.start_time,
        NEW.end_time,
        NEW.unpaid_break_minutes,
        NEW.target_employment_type,
        NEW.target_requires_flexible,
        NEW.is_training,
        NEW.role_id
    );

    IF v_breach IS NOT NULL THEN
        RAISE EXCEPTION '%', v_breach USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shift_shape_3_day_typed ON public.shifts;
CREATE TRIGGER trg_shift_shape_3_day_typed
    BEFORE INSERT OR UPDATE OF
        shift_date, start_time, end_time, unpaid_break_minutes,
        target_employment_type, target_requires_flexible, is_training, role_id
    ON public.shifts
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_shift_shape_day_typed_guard();

-- SAFETY. `shifts` holds 0 rows (verified against production 2026-08-19), so
-- nothing existing can be invalidated. Unlike the CHECK constraints this is not
-- retroactive in any case: a trigger judges writes, not rows already present,
-- so a future backfill of historical data would need its own decision rather
-- than being blocked by this.

-- Standing practice for new functions on this project: Supabase grants EXECUTE
-- to PUBLIC automatically, and 211 definer functions were once exposed that
-- way. None of these three is a definer function and none needs to be callable
-- by a client — the trigger invokes them internally, and the apply RPC that
-- also calls `shift_day_typed_shortfall` is SECURITY DEFINER and runs as owner.
--
-- `public_holiday_calendar_horizon` is the deliberate exception, kept available
-- to `authenticated` so a UI can warn a manager BEFORE they pick a date range
-- past the calendar rather than after the write fails. It returns one date from
-- a table of public holidays; there is nothing to leak.
REVOKE ALL ON FUNCTION public.shift_is_security_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shift_day_typed_shortfall(date, time, time, integer, text, boolean, boolean, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_shift_shape_day_typed_guard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_holiday_calendar_horizon(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_holiday_calendar_horizon(text) TO authenticated, service_role;
