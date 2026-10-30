-- TOIL — time off in lieu, for SALARIED class-1 contracts only.
--
-- WHO EARNS IT. A shift earns TOIL when the contract it is linked to
-- (shifts.user_contract_id) is Full-Time, Part-Time or Flexible Part-Time AND
-- is paid by salary on the shift's date (hr.contract_pay_terms_on).
--   • The ICC Sydney EBA 2025 has NO time-off-in-lieu clause. cl 42.1 makes
--     time beyond the roster overtime, cl 42.2 prices it at 150% then 200%,
--     and cl 42.4 says it is PAID at the next pay date. Sch 3 §4.2 says the same
--     for Full-Time Security. So an EBA-level or annualised-security contract
--     never earns TOIL — the pay engine already pays its overtime.
--   • Salaried staff are outside the EBA (cl 2.2). For them TOIL is the
--     compensation for extra hours (user decision 2026-10-08), so it accrues
--     automatically. Casual (class 2) hours never count.
--
-- HOW IT IS EARNED (user decisions 2026-10-10):
--   daily    per employee per day, over APPROVED timesheets on eligible
--            shifts: billable net − 7.6h, never below zero. Several eligible
--            shifts on one day are added together first.
--   weekly   per ISO week (Mon–Sun): billable net beyond contracted weekly
--            hours, less what the daily rule already gave that week. Approved
--            leave and weekday public holidays lower the week's required hours.
--            This catches a sixth-day shift the daily rule cannot see.
--   Billable net is the same rule Gross Pay prices from (billable-time.ts):
--   manager-entered time, else the clock snapped to 15 minutes, minus the
--   unpaid break. Salaried shifts get no minimum-engagement floor.
--
-- USING IT. Leave type 'toil' on leave_requests. A request may not exceed what
-- is available (balance − other pending TOIL) and approval may not exceed the
-- balance: TOIL cannot be taken before it is earned — unlike annual and
-- personal leave, which may go negative (decision 2026-09-30).
--
-- EXPIRY AND PAYOUT (modern-award TOIL model, hour for hour):
--   • Each day's / week's TOIL must be taken within 6 months; whatever is left
--     of it is then paid out (`expiry_payout`). Taking TOIL uses up the oldest
--     hours first, so expiry knows what is left of each.
--   • The employee may ask for a payout at any time (`payout`) — no approval
--     step: the employer must pay on request.
--   • When the person no longer holds an eligible contract, the whole balance
--     is paid out (`termination_payout`).
--   Gross Pay prices payouts at the salary's hourly equivalent.
--
-- THE LEDGER IS APPEND-ONLY. A changed timesheet is corrected by a further
-- entry, never by editing one. Contract and leave links are ON DELETE RESTRICT:
-- deleting a sub-department cascades to its contracts, and that must not
-- silently erase pay records (Fair Work Regulations keep them for 7 years).

-- ── 1. The ledger ───────────────────────────────────────────────────────────
CREATE TABLE public.toil_ledger (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    user_contract_id     uuid        NOT NULL REFERENCES hr.user_contracts(id) ON DELETE RESTRICT,
    entry_type           text        NOT NULL,
    minutes              integer     NOT NULL,
    -- The day the entry counts from: the work date (accrual), the Sunday that
    -- ends the week (weekly_topup), the leave's first day (taken), or the day
    -- it was paid or adjusted.
    effective_date       date        NOT NULL,
    leave_request_id     uuid        REFERENCES public.leave_requests(id) ON DELETE RESTRICT,
    source_timesheet_ids uuid[]      NOT NULL DEFAULT '{}',
    -- accrual / weekly_topup: what the target was computed from, for audit.
    worked_minutes       integer,
    threshold_minutes    integer,
    reason               text,
    created_by           uuid        DEFAULT auth.uid(),
    created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT toil_ledger_entry_type_valid CHECK (entry_type IN (
        'accrual', 'weekly_topup', 'taken', 'taken_reversal',
        'payout', 'expiry_payout', 'termination_payout', 'adjustment')),
    CONSTRAINT toil_ledger_minutes_nonzero CHECK (minutes <> 0),
    CONSTRAINT toil_ledger_sign CHECK (
        (entry_type IN ('taken', 'payout', 'expiry_payout', 'termination_payout') AND minutes < 0)
        OR (entry_type = 'taken_reversal' AND minutes > 0)
        OR entry_type IN ('accrual', 'weekly_topup', 'adjustment')),
    CONSTRAINT toil_ledger_leave_link CHECK (
        (entry_type IN ('taken', 'taken_reversal')) = (leave_request_id IS NOT NULL)),
    CONSTRAINT toil_ledger_adjustment_reason CHECK (
        entry_type <> 'adjustment' OR length(btrim(coalesce(reason, ''))) > 0)
);

COMMENT ON TABLE public.toil_ledger IS
    'Time off in lieu, salaried class-1 contracts only (EBA overtime is paid, cl 42). Append-only; minutes are signed. See migration header.';

CREATE INDEX toil_ledger_employee_date_idx ON public.toil_ledger (employee_id, effective_date);
CREATE INDEX toil_ledger_employee_type_idx ON public.toil_ledger (employee_id, entry_type, effective_date);
CREATE INDEX toil_ledger_leave_request_idx ON public.toil_ledger (leave_request_id) WHERE leave_request_id IS NOT NULL;
CREATE INDEX toil_ledger_contract_idx      ON public.toil_ledger (user_contract_id);
CREATE INDEX toil_ledger_source_ts_idx     ON public.toil_ledger USING gin (source_timesheet_ids);

CREATE OR REPLACE FUNCTION internal.trg_toil_ledger_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = 'insufficient_privilege',
        MESSAGE = 'toil_ledger is append-only: correct an entry with a further entry.';
END;
$$;

CREATE TRIGGER trg_toil_ledger_append_only
    BEFORE UPDATE OR DELETE ON public.toil_ledger
    FOR EACH ROW EXECUTE FUNCTION internal.trg_toil_ledger_append_only();
CREATE TRIGGER trg_toil_ledger_no_truncate
    BEFORE TRUNCATE ON public.toil_ledger
    FOR EACH STATEMENT EXECUTE FUNCTION internal.trg_toil_ledger_append_only();

-- ── 2. Small helpers ────────────────────────────────────────────────────────

-- One writer per employee at a time: every ledger write takes this first.
CREATE OR REPLACE FUNCTION internal.toil_lock(p_employee uuid)
RETURNS void
LANGUAGE sql
SET search_path TO 'pg_catalog'
AS $$ SELECT pg_advisory_xact_lock(hashtextextended('toil:' || p_employee::text, 0)); $$;

-- "3.5h" — minutes as hours for messages.
CREATE OR REPLACE FUNCTION internal.toil_fmt(p_minutes integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$ SELECT to_char(round(coalesce(p_minutes, 0) / 60.0, 2), 'FM9999990.0#') || 'h'; $$;

CREATE OR REPLACE FUNCTION internal.toil_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog'
AS $$ SELECT (now() AT TIME ZONE 'Australia/Sydney')::date; $$;

-- Is this contract one that earns TOIL on this date? Class 1 + salary.
CREATE OR REPLACE FUNCTION internal.toil_contract_eligible(p_contract uuid, p_on date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'hr'
AS $$
DECLARE
    v_status text;
    v_basis  text;
    v_terms  hr.contract_pay_terms;
BEGIN
    IF p_contract IS NULL THEN
        RETURN false;
    END IF;
    SELECT uc.employment_status::text, uc.pay_basis
      INTO v_status, v_basis
      FROM hr.user_contracts uc
     WHERE uc.id = p_contract;
    IF NOT FOUND OR v_status IS NULL
       OR v_status NOT IN ('Full-Time', 'Part-Time', 'Flexible Part-Time') THEN
        RETURN false;
    END IF;
    -- Pay terms are effective-dated: a shift is judged on the terms in force
    -- on its date, not today's.
    v_terms := hr.contract_pay_terms_on(p_contract, p_on);
    RETURN coalesce(v_terms.pay_basis, v_basis) = 'salary';
END;
$$;

-- The eligible contract a person holds on a date (active, in force), or NULL.
-- Full-Time first, then the most contracted hours.
CREATE OR REPLACE FUNCTION internal.toil_active_eligible_contract(p_employee uuid, p_on date)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'hr', 'internal'
AS $$
    SELECT uc.id
      FROM hr.user_contracts uc
     WHERE uc.user_id = p_employee
       AND uc.status = 'Active'
       AND (uc.start_date IS NULL OR uc.start_date <= p_on)
       AND (uc.end_date IS NULL OR uc.end_date >= p_on)
       AND internal.toil_contract_eligible(uc.id, p_on)
     ORDER BY (uc.employment_status::text = 'Full-Time') DESC,
              uc.contracted_weekly_hours DESC NULLS LAST,
              uc.id
     LIMIT 1;
$$;

-- The contract a person's most recent ledger entry was booked against.
CREATE OR REPLACE FUNCTION internal.toil_ledger_contract(p_employee uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
    SELECT tl.user_contract_id
      FROM public.toil_ledger tl
     WHERE tl.employee_id = p_employee
     ORDER BY tl.created_at DESC, tl.id DESC
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION internal.toil_balance(p_employee uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
    SELECT coalesce(sum(tl.minutes), 0)::integer
      FROM public.toil_ledger tl
     WHERE tl.employee_id = p_employee;
$$;

-- Minutes reserved by PENDING TOIL requests (optionally excluding one).
CREATE OR REPLACE FUNCTION internal.toil_held(p_employee uuid, p_exclude uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
    SELECT coalesce(sum(round(coalesce(lr.requested_hours, 0) * 60)), 0)::integer
      FROM public.leave_requests lr
     WHERE lr.employee_id = p_employee
       AND lr.leave_type = 'toil'
       AND lr.status = 'pending'
       AND (p_exclude IS NULL OR lr.id <> p_exclude);
$$;

-- What is left of each earned lot, oldest used first (FIFO), and when it
-- expires. A lot is one day's accrual or one week's top-up (corrections net
-- into the lot they correct) or one positive adjustment date.
CREATE OR REPLACE FUNCTION internal.toil_lots(p_employee uuid)
RETURNS TABLE (lot_date date, earned integer, remaining integer, expires_on date)
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
    WITH lots AS (
        SELECT tl.effective_date AS lot_date, sum(tl.minutes)::integer AS earned
          FROM public.toil_ledger tl
         WHERE tl.employee_id = p_employee
           AND (tl.entry_type IN ('accrual', 'weekly_topup')
                OR (tl.entry_type = 'adjustment' AND tl.minutes > 0))
         GROUP BY tl.effective_date
        HAVING sum(tl.minutes) > 0
    ),
    consumed AS (
        SELECT coalesce(-sum(tl.minutes), 0)::integer AS d
          FROM public.toil_ledger tl
         WHERE tl.employee_id = p_employee
           AND (tl.entry_type IN ('taken', 'taken_reversal', 'payout', 'expiry_payout', 'termination_payout')
                OR (tl.entry_type = 'adjustment' AND tl.minutes < 0))
    ),
    cum AS (
        SELECT l.lot_date, l.earned,
               sum(l.earned) OVER (ORDER BY l.lot_date ROWS UNBOUNDED PRECEDING) AS c
          FROM lots l
    )
    SELECT cum.lot_date,
           cum.earned,
           greatest(0, least(cum.earned, cum.c - (SELECT d FROM consumed)))::integer,
           (cum.lot_date + interval '6 months')::date
      FROM cum
     ORDER BY cum.lot_date;
$$;

-- ── 3. Billable net — SQL port of timesheets/domain/billable-time.ts ─────────
-- Pinned to the TypeScript by src/modules/toil/__tests__/billable-net-parity.test.ts.

-- A clock instant as minute-of-day, Sydney wall clock, snapped to the nearest
-- 15 minutes (seconds count; 23:53 wraps to 00:00) — `snapToQuarterHour`.
CREATE OR REPLACE FUNCTION internal.toil_snap_minute_of_day(p_ts timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog'
AS $$
    SELECT CASE WHEN p_ts IS NULL THEN NULL ELSE
        ((extract(hour FROM l)::integer * 60
          + (round((extract(minute FROM l)::numeric
                    + floor(extract(second FROM l))::numeric / 60) / 15) * 15)::integer) % 1440)
    END
    FROM (SELECT p_ts AT TIME ZONE 'Australia/Sydney' AS l) x;
$$;

-- `resolveBillableSide` ×2 + `calculateNetMinutes`. NULL when either side is
-- not resolvable (not finished, or a missing punch with no manual time).
-- Break = timesheet's, else the shift's, else 0 (as Gross Pay reads it).
CREATE OR REPLACE FUNCTION internal.toil_billable_net_minutes(
    p_manual_start       time,
    p_manual_end         time,
    p_actual_start       timestamptz,
    p_actual_end         timestamptz,
    p_shift_date         date,
    p_sched_start        time,
    p_sched_end          time,
    p_ts_unpaid_break    integer,
    p_shift_unpaid_break integer,
    p_now                timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'internal'
AS $$
DECLARE
    v_finished    boolean;
    v_sched_start timestamptz;
    v_sched_end   timestamptz;
    v_start       integer;
    v_end         integer;
    v_diff        integer;
BEGIN
    -- `isShiftFinished`: a clock-out always means finished; otherwise once the
    -- scheduled end has passed (an end at/before the start is the next day).
    IF p_actual_end IS NOT NULL THEN
        v_finished := true;
    ELSIF p_sched_end IS NULL OR p_shift_date IS NULL THEN
        v_finished := false;
    ELSE
        v_sched_start := (p_shift_date + coalesce(p_sched_start, time '00:00')) AT TIME ZONE 'Australia/Sydney';
        v_sched_end   := (p_shift_date + p_sched_end) AT TIME ZONE 'Australia/Sydney';
        IF v_sched_end <= v_sched_start THEN
            v_sched_end := v_sched_end + interval '1 day';
        END IF;
        v_finished := p_now >= v_sched_end;
    END IF;

    v_start := CASE
        WHEN p_manual_start IS NOT NULL
            THEN extract(hour FROM p_manual_start)::integer * 60 + extract(minute FROM p_manual_start)::integer
        WHEN v_finished THEN internal.toil_snap_minute_of_day(p_actual_start)
    END;
    v_end := CASE
        WHEN p_manual_end IS NOT NULL
            THEN extract(hour FROM p_manual_end)::integer * 60 + extract(minute FROM p_manual_end)::integer
        WHEN v_finished THEN internal.toil_snap_minute_of_day(p_actual_end)
    END;
    IF v_start IS NULL OR v_end IS NULL THEN
        RETURN NULL;
    END IF;

    -- Midnight crossing from the sign of the RESOLVED times, never a stored flag.
    v_diff := v_end - v_start;
    IF v_diff < 0 THEN
        v_diff := v_diff + 1440;
    END IF;
    RETURN greatest(0, v_diff - coalesce(p_ts_unpaid_break, p_shift_unpaid_break, 0));
END;
$$;

-- ── 4. Accrual ──────────────────────────────────────────────────────────────

-- Approved, eligible worked minutes for one employee over a date range,
-- per shift. The single definition both rules read.
CREATE OR REPLACE FUNCTION internal.toil_eligible_work(p_employee uuid, p_from date, p_to date)
RETURNS TABLE (shift_id uuid, timesheet_id uuid, user_contract_id uuid, shift_date date, net_minutes integer)
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public', 'internal'
AS $$
    SELECT s.id, t.id, s.user_contract_id, s.shift_date,
           internal.toil_billable_net_minutes(
               t.start_time, t.end_time, s.actual_start, s.actual_end,
               s.shift_date, s.start_time, s.end_time,
               t.unpaid_break_minutes, s.unpaid_break_minutes)
      FROM public.shifts s
      JOIN public.timesheets t ON t.shift_id = s.id
     WHERE s.assigned_employee_id = p_employee
       AND s.shift_date BETWEEN p_from AND p_to
       AND s.deleted_at IS NULL
       AND NOT s.is_cancelled
       AND t.status = 'approved'
       AND s.user_contract_id IS NOT NULL
       AND internal.toil_contract_eligible(s.user_contract_id, s.shift_date);
$$;

-- Daily rule: billable net over 7.6h on one day.
CREATE OR REPLACE FUNCTION internal.toil_recompute_day(p_employee uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'internal'
AS $$
DECLARE
    c_threshold constant integer := 456;  -- 7.6h
    v_worked   integer;
    v_ids      uuid[];
    v_contract uuid;
    v_target   integer;
    v_booked   integer;
BEGIN
    PERFORM internal.toil_lock(p_employee);

    SELECT coalesce(sum(w.net_minutes), 0)::integer,
           coalesce(array_agg(w.timesheet_id ORDER BY w.timesheet_id) FILTER (WHERE w.net_minutes IS NOT NULL), '{}')
      INTO v_worked, v_ids
      FROM internal.toil_eligible_work(p_employee, p_date, p_date) w;

    SELECT w.user_contract_id INTO v_contract
      FROM internal.toil_eligible_work(p_employee, p_date, p_date) w
     WHERE w.net_minutes IS NOT NULL
     GROUP BY w.user_contract_id
     ORDER BY sum(w.net_minutes) DESC, w.user_contract_id
     LIMIT 1;

    v_target := greatest(0, v_worked - c_threshold);

    SELECT coalesce(sum(tl.minutes), 0)::integer INTO v_booked
      FROM public.toil_ledger tl
     WHERE tl.employee_id = p_employee
       AND tl.entry_type = 'accrual'
       AND tl.effective_date = p_date;

    IF v_target = v_booked THEN
        RETURN;
    END IF;
    IF v_contract IS NULL THEN
        -- Nothing eligible any more: correct against the contract it was booked on.
        SELECT tl.user_contract_id INTO v_contract
          FROM public.toil_ledger tl
         WHERE tl.employee_id = p_employee AND tl.entry_type = 'accrual' AND tl.effective_date = p_date
         ORDER BY tl.created_at DESC, tl.id DESC
         LIMIT 1;
    END IF;

    INSERT INTO public.toil_ledger (
        employee_id, user_contract_id, entry_type, minutes, effective_date,
        source_timesheet_ids, worked_minutes, threshold_minutes, reason)
    VALUES (
        p_employee, v_contract, 'accrual', v_target - v_booked, p_date,
        v_ids, v_worked, c_threshold,
        CASE WHEN v_booked <> 0 THEN 'Recalculated after a timesheet change' END);
END;
$$;

-- Hours a week's required total is lowered by: approved leave (any type — a
-- person is not required to work hours they are on leave for) and weekday
-- public holidays not already covered by leave. Leave hours are spread over
-- the request's weekdays (all days if it has none).
CREATE OR REPLACE FUNCTION internal.toil_absence_credit_minutes(p_employee uuid, p_week_start date, p_daily_minutes integer)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_week_end   date := p_week_start + 6;
    v_leave      numeric := 0;
    v_ph         integer := 0;
    v_leave_days date[] := '{}';
    r            record;
    v_s          date;
    v_e          date;
    v_weekdays   integer;
    v_alldays    integer;
    v_in_week    integer;
BEGIN
    FOR r IN
        SELECT lr.start_date, lr.end_date, lr.requested_hours
          FROM public.leave_requests lr
         WHERE lr.employee_id = p_employee
           AND lr.status = 'approved'
           AND (lr.start_date AT TIME ZONE 'UTC')::date <= v_week_end
           AND (lr.end_date AT TIME ZONE 'UTC')::date >= p_week_start
    LOOP
        v_s := (r.start_date AT TIME ZONE 'UTC')::date;
        v_e := (r.end_date AT TIME ZONE 'UTC')::date;
        SELECT count(*) FILTER (WHERE extract(isodow FROM d) < 6), count(*)
          INTO v_weekdays, v_alldays
          FROM generate_series(v_s, v_e, interval '1 day') d;
        SELECT count(*) FILTER (WHERE v_weekdays = 0 OR extract(isodow FROM d) < 6)
          INTO v_in_week
          FROM generate_series(greatest(v_s, p_week_start), least(v_e, v_week_end), interval '1 day') d;
        IF coalesce(v_alldays, 0) > 0 THEN
            v_leave := v_leave + coalesce(r.requested_hours, 0) * 60 * v_in_week
                       / CASE WHEN v_weekdays > 0 THEN v_weekdays ELSE v_alldays END;
        END IF;
        v_leave_days := v_leave_days || ARRAY(
            SELECT d::date FROM generate_series(greatest(v_s, p_week_start), least(v_e, v_week_end), interval '1 day') d);
    END LOOP;

    SELECT count(DISTINCT ph.holiday_date) INTO v_ph
      FROM public.public_holidays ph
     WHERE ph.holiday_date BETWEEN p_week_start AND v_week_end
       AND extract(isodow FROM ph.holiday_date) < 6
       AND NOT (ph.holiday_date = ANY (v_leave_days));

    RETURN round(v_leave)::integer + v_ph * coalesce(p_daily_minutes, 0);
END;
$$;

-- Weekly rule: hours beyond contracted weekly hours, less the week's daily TOIL.
CREATE OR REPLACE FUNCTION internal.toil_recompute_week(p_employee uuid, p_any date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'hr', 'internal'
AS $$
DECLARE
    v_ws         date := date_trunc('week', p_any)::date;
    v_we         date := date_trunc('week', p_any)::date + 6;
    v_worked     integer;
    v_ids        uuid[];
    v_contract   uuid;
    v_contracted integer;
    v_no_hours   boolean;
    v_threshold  integer;
    v_daily      integer;
    v_target     integer;
    v_booked     integer;
BEGIN
    PERFORM internal.toil_lock(p_employee);

    SELECT coalesce(sum(w.net_minutes), 0)::integer,
           coalesce(array_agg(w.timesheet_id ORDER BY w.timesheet_id) FILTER (WHERE w.net_minutes IS NOT NULL), '{}')
      INTO v_worked, v_ids
      FROM internal.toil_eligible_work(p_employee, v_ws, v_we) w;

    WITH per_contract AS (
        SELECT w.user_contract_id, sum(w.net_minutes) AS net
          FROM internal.toil_eligible_work(p_employee, v_ws, v_we) w
         WHERE w.net_minutes IS NOT NULL
         GROUP BY w.user_contract_id
    )
    SELECT (SELECT pc.user_contract_id FROM per_contract pc ORDER BY pc.net DESC, pc.user_contract_id LIMIT 1),
           -- Full-Time is 38h by definition (cl 12.2(b)); Part-Time is contracted.
           sum(CASE WHEN uc.employment_status::text = 'Full-Time' THEN 2280
                    ELSE round(coalesce(uc.contracted_weekly_hours, 0) * 60)::integer END)::integer,
           bool_or(uc.employment_status::text <> 'Full-Time' AND coalesce(uc.contracted_weekly_hours, 0) <= 0)
      INTO v_contract, v_contracted, v_no_hours
      FROM per_contract pc
      JOIN hr.user_contracts uc ON uc.id = pc.user_contract_id;

    IF v_contract IS NULL OR coalesce(v_no_hours, false) THEN
        -- No eligible work, or a part-time contract with no hours to measure
        -- against: no weekly top-up rather than a guess.
        v_target := 0;
        v_threshold := NULL;
    ELSE
        v_threshold := greatest(0, v_contracted
            - internal.toil_absence_credit_minutes(p_employee, v_ws, v_contracted / 5));
        SELECT coalesce(sum(tl.minutes), 0)::integer INTO v_daily
          FROM public.toil_ledger tl
         WHERE tl.employee_id = p_employee
           AND tl.entry_type = 'accrual'
           AND tl.effective_date BETWEEN v_ws AND v_we;
        v_target := greatest(0, (v_worked - v_threshold) - v_daily);
    END IF;

    SELECT coalesce(sum(tl.minutes), 0)::integer INTO v_booked
      FROM public.toil_ledger tl
     WHERE tl.employee_id = p_employee
       AND tl.entry_type = 'weekly_topup'
       AND tl.effective_date = v_we;

    IF v_target = v_booked THEN
        RETURN;
    END IF;
    IF v_contract IS NULL THEN
        SELECT tl.user_contract_id INTO v_contract
          FROM public.toil_ledger tl
         WHERE tl.employee_id = p_employee AND tl.entry_type = 'weekly_topup' AND tl.effective_date = v_we
         ORDER BY tl.created_at DESC, tl.id DESC
         LIMIT 1;
    END IF;

    INSERT INTO public.toil_ledger (
        employee_id, user_contract_id, entry_type, minutes, effective_date,
        source_timesheet_ids, worked_minutes, threshold_minutes, reason)
    VALUES (
        p_employee, v_contract, 'weekly_topup', v_target - v_booked, v_we,
        v_ids, v_worked, v_threshold,
        CASE WHEN v_booked <> 0 THEN 'Recalculated after a timesheet or leave change' END);
END;
$$;

CREATE OR REPLACE FUNCTION internal.toil_recompute(p_employee uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'internal'
AS $$
BEGIN
    IF p_employee IS NULL OR p_date IS NULL THEN
        RETURN;
    END IF;
    -- Day first: the weekly rule subtracts what the daily rule gave.
    PERFORM internal.toil_recompute_day(p_employee, p_date);
    PERFORM internal.toil_recompute_week(p_employee, p_date);
END;
$$;

-- ── 5. Triggers that keep accrual current ───────────────────────────────────
-- In the database, not the app: approval has several writers (single and bulk
-- approve, the leftover sm_timesheet_auto_decide RPC), and a rule enforced in
-- one caller is skipped by the rest.

CREATE OR REPLACE FUNCTION internal.trg_toil_timesheet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'internal'
AS $$
DECLARE
    v_emp_old  uuid;
    v_date_old date;
    v_emp_new  uuid;
    v_date_new date;
    r          record;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        SELECT s.assigned_employee_id, s.shift_date INTO v_emp_old, v_date_old
          FROM public.shifts s WHERE s.id = OLD.shift_id;
        IF v_emp_old IS NOT NULL THEN
            PERFORM internal.toil_recompute(v_emp_old, v_date_old);
        END IF;
        -- The shift is gone (cascade) or was handed to someone else: re-run
        -- every day this timesheet fed.
        FOR r IN
            SELECT DISTINCT tl.employee_id, tl.effective_date
              FROM public.toil_ledger tl
             WHERE tl.entry_type = 'accrual'
               AND OLD.id = ANY (tl.source_timesheet_ids)
               AND (tl.employee_id, tl.effective_date) IS DISTINCT FROM (v_emp_old, v_date_old)
        LOOP
            PERFORM internal.toil_recompute(r.employee_id, r.effective_date);
        END LOOP;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT s.assigned_employee_id, s.shift_date INTO v_emp_new, v_date_new
          FROM public.shifts s WHERE s.id = NEW.shift_id;
        IF v_emp_new IS NOT NULL
           AND (v_emp_new, v_date_new) IS DISTINCT FROM (v_emp_old, v_date_old) THEN
            PERFORM internal.toil_recompute(v_emp_new, v_date_new);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_toil_timesheet_insert
    AFTER INSERT ON public.timesheets
    FOR EACH ROW
    WHEN (NEW.status = 'approved')
    EXECUTE FUNCTION internal.trg_toil_timesheet();

CREATE TRIGGER trg_toil_timesheet_update
    AFTER UPDATE ON public.timesheets
    FOR EACH ROW
    WHEN ((OLD.status = 'approved' OR NEW.status = 'approved')
          AND (OLD.status IS DISTINCT FROM NEW.status
               OR OLD.start_time IS DISTINCT FROM NEW.start_time
               OR OLD.end_time IS DISTINCT FROM NEW.end_time
               OR OLD.unpaid_break_minutes IS DISTINCT FROM NEW.unpaid_break_minutes
               OR OLD.shift_id IS DISTINCT FROM NEW.shift_id))
    EXECUTE FUNCTION internal.trg_toil_timesheet();

CREATE TRIGGER trg_toil_timesheet_delete
    AFTER DELETE ON public.timesheets
    FOR EACH ROW
    WHEN (OLD.status = 'approved')
    EXECUTE FUNCTION internal.trg_toil_timesheet();

-- A shift fact the billable net or the eligibility depends on changed under an
-- approved timesheet.
CREATE OR REPLACE FUNCTION internal.trg_toil_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'internal'
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.timesheets t WHERE t.shift_id = NEW.id AND t.status = 'approved') THEN
        RETURN NULL;
    END IF;
    IF OLD.assigned_employee_id IS NOT NULL THEN
        PERFORM internal.toil_recompute(OLD.assigned_employee_id, OLD.shift_date);
    END IF;
    IF NEW.assigned_employee_id IS NOT NULL
       AND (NEW.assigned_employee_id, NEW.shift_date) IS DISTINCT FROM (OLD.assigned_employee_id, OLD.shift_date) THEN
        PERFORM internal.toil_recompute(NEW.assigned_employee_id, NEW.shift_date);
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_toil_shift_change
    AFTER UPDATE ON public.shifts
    FOR EACH ROW
    WHEN (OLD.actual_start IS DISTINCT FROM NEW.actual_start
          OR OLD.actual_end IS DISTINCT FROM NEW.actual_end
          OR OLD.unpaid_break_minutes IS DISTINCT FROM NEW.unpaid_break_minutes
          OR OLD.user_contract_id IS DISTINCT FROM NEW.user_contract_id
          OR OLD.assigned_employee_id IS DISTINCT FROM NEW.assigned_employee_id
          OR OLD.shift_date IS DISTINCT FROM NEW.shift_date
          OR OLD.start_time IS DISTINCT FROM NEW.start_time
          OR OLD.end_time IS DISTINCT FROM NEW.end_time
          OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
          OR OLD.is_cancelled IS DISTINCT FROM NEW.is_cancelled)
    EXECUTE FUNCTION internal.trg_toil_shift();

-- ── 6. Taking TOIL (leave_type = 'toil') ────────────────────────────────────

-- Keep the 'taken' entries for one request equal to what it should draw:
-- −hours while approved, 0 otherwise. Revoke, reject and hour edits all land
-- as a correcting entry.
CREATE OR REPLACE FUNCTION internal.toil_sync_leave(p_request uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'internal'
AS $$
DECLARE
    r          record;
    v_start    date;
    v_target   integer;
    v_booked   integer;
    v_delta    integer;
    v_contract uuid;
BEGIN
    SELECT * INTO r FROM public.leave_requests WHERE id = p_request;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    PERFORM internal.toil_lock(r.employee_id);
    v_start  := (r.start_date AT TIME ZONE 'UTC')::date;
    v_target := CASE WHEN r.leave_type = 'toil' AND r.status = 'approved'
                     THEN -round(coalesce(r.requested_hours, 0) * 60)::integer ELSE 0 END;
    SELECT coalesce(sum(tl.minutes), 0)::integer INTO v_booked
      FROM public.toil_ledger tl WHERE tl.leave_request_id = p_request;
    v_delta := v_target - v_booked;
    IF v_delta = 0 THEN
        RETURN;
    END IF;

    v_contract := coalesce(
        internal.toil_active_eligible_contract(r.employee_id, v_start),
        (SELECT tl.user_contract_id FROM public.toil_ledger tl
          WHERE tl.leave_request_id = p_request ORDER BY tl.created_at DESC, tl.id DESC LIMIT 1),
        internal.toil_ledger_contract(r.employee_id));
    IF v_contract IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'check_violation',
            MESSAGE = 'Time in lieu can only be taken against a salaried contract.';
    END IF;

    INSERT INTO public.toil_ledger (
        employee_id, user_contract_id, entry_type, minutes, effective_date, leave_request_id, reason)
    VALUES (
        r.employee_id, v_contract,
        CASE WHEN v_delta < 0 THEN 'taken' ELSE 'taken_reversal' END,
        v_delta, v_start, p_request,
        CASE WHEN v_delta > 0 THEN
            CASE r.status
                WHEN 'cancelled' THEN 'Leave revoked or withdrawn'
                WHEN 'rejected'  THEN 'Leave rejected'
                ELSE 'Requested hours changed'
            END
        END);
END;
$$;

-- Refuse a TOIL request that is not backed by a salaried contract or by
-- earned hours. BEFORE, so the request never exists in an invalid state.
CREATE OR REPLACE FUNCTION internal.trg_toil_leave_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'internal'
AS $$
DECLARE
    v_minutes integer;
    v_start   date;
    v_balance integer;
    v_held    integer;
BEGIN
    IF NEW.leave_type IS DISTINCT FROM 'toil' OR NEW.status NOT IN ('pending', 'approved') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.leave_type = NEW.leave_type
       AND OLD.status = NEW.status
       AND OLD.requested_hours IS NOT DISTINCT FROM NEW.requested_hours
       AND OLD.start_date IS NOT DISTINCT FROM NEW.start_date THEN
        RETURN NEW;
    END IF;

    v_minutes := round(coalesce(NEW.requested_hours, 0) * 60)::integer;
    IF v_minutes <= 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'check_violation',
            MESSAGE = 'Enter how many hours of time in lieu to take.';
    END IF;

    v_start := (NEW.start_date AT TIME ZONE 'UTC')::date;
    PERFORM internal.toil_lock(NEW.employee_id);

    IF internal.toil_active_eligible_contract(NEW.employee_id, v_start) IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'check_violation',
            MESSAGE = 'Time in lieu is only available on a salaried full-time or part-time contract.',
            HINT    = 'Overtime on an EBA contract is paid (ICC EBA cl 42.2), not taken as time off.';
    END IF;

    v_balance := internal.toil_balance(NEW.employee_id);
    IF NEW.status = 'approved' THEN
        -- Whatever this request already drew (hours edited after approval) is
        -- back in the pool for the check.
        v_balance := v_balance - coalesce(
            (SELECT sum(tl.minutes) FROM public.toil_ledger tl WHERE tl.leave_request_id = NEW.id), 0);
        IF v_minutes > v_balance THEN
            RAISE EXCEPTION USING
                ERRCODE = 'check_violation',
                MESSAGE = format('Only %s of time in lieu is left; %s is requested. Time in lieu cannot be taken before it is earned.',
                                 internal.toil_fmt(greatest(v_balance, 0)), internal.toil_fmt(v_minutes));
        END IF;
    ELSE
        v_held := internal.toil_held(NEW.employee_id, NEW.id);
        IF v_minutes > v_balance - v_held THEN
            RAISE EXCEPTION USING
                ERRCODE = 'check_violation',
                MESSAGE = format('Only %s of time in lieu is available (%s balance, %s held by other requests); %s is requested.',
                                 internal.toil_fmt(greatest(v_balance - v_held, 0)), internal.toil_fmt(v_balance),
                                 internal.toil_fmt(v_held), internal.toil_fmt(v_minutes));
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_toil_leave_guard
    BEFORE INSERT OR UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION internal.trg_toil_leave_guard();

-- After a leave change: book TOIL taken, and re-run the weekly top-ups of the
-- weeks the leave touches (leave lowers a week's required hours).
CREATE OR REPLACE FUNCTION internal.trg_toil_leave_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'hr', 'internal'
AS $$
DECLARE
    v_weeks date[] := '{}';
    w       date;
BEGIN
    IF NEW.leave_type = 'toil' OR (TG_OP = 'UPDATE' AND OLD.leave_type = 'toil') THEN
        PERFORM internal.toil_sync_leave(NEW.id);
    END IF;

    IF NOT (NEW.status = 'approved' OR (TG_OP = 'UPDATE' AND OLD.status = 'approved')) THEN
        RETURN NULL;
    END IF;
    -- Only people TOIL can apply to.
    IF NOT EXISTS (SELECT 1 FROM hr.user_contracts uc WHERE uc.user_id = NEW.employee_id AND uc.pay_basis = 'salary')
       AND NOT EXISTS (SELECT 1 FROM public.toil_ledger tl WHERE tl.employee_id = NEW.employee_id) THEN
        RETURN NULL;
    END IF;

    v_weeks := ARRAY(
        SELECT DISTINCT date_trunc('week', g)::date
          FROM generate_series((NEW.start_date AT TIME ZONE 'UTC')::date,
                               (NEW.end_date AT TIME ZONE 'UTC')::date, interval '1 day') g);
    IF TG_OP = 'UPDATE' THEN
        v_weeks := v_weeks || ARRAY(
            SELECT DISTINCT date_trunc('week', g)::date
              FROM generate_series((OLD.start_date AT TIME ZONE 'UTC')::date,
                                   (OLD.end_date AT TIME ZONE 'UTC')::date, interval '1 day') g);
    END IF;
    FOR w IN SELECT DISTINCT x FROM unnest(v_weeks) x LOOP
        PERFORM internal.toil_recompute_week(NEW.employee_id, w);
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_toil_leave_sync
    AFTER INSERT OR UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION internal.trg_toil_leave_sync();

-- ── 7. Access ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION internal.toil_can_view(p_employee uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'hr'
AS $$
    SELECT public.sm_request_is_system()
        OR p_employee = auth.uid()
        OR EXISTS (
            SELECT 1 FROM hr.user_contracts uc
             WHERE uc.user_id = p_employee
               AND (public.user_has_action_in_scope('leave.view', uc.organization_id, uc.department_id, uc.sub_department_id)
                    OR public.user_has_action_in_scope('timesheet.approve', uc.organization_id, uc.department_id, uc.sub_department_id)));
$$;

-- Payouts on someone's behalf and adjustments: leave approvers in scope, and
-- never for themselves.
CREATE OR REPLACE FUNCTION internal.toil_can_manage(p_employee uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'hr'
AS $$
    SELECT public.sm_request_is_system()
        OR (p_employee IS DISTINCT FROM auth.uid()
            AND EXISTS (
                SELECT 1 FROM hr.user_contracts uc
                 WHERE uc.user_id = p_employee
                   AND public.user_has_action_in_scope('leave.approve', uc.organization_id, uc.department_id, uc.sub_department_id)));
$$;

ALTER TABLE public.toil_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY toil_ledger_self_select ON public.toil_ledger
    FOR SELECT TO authenticated
    USING (toil_ledger.employee_id = (SELECT auth.uid()));

CREATE POLICY toil_ledger_scope_select ON public.toil_ledger
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM hr.user_contracts target_uc
         WHERE target_uc.user_id = toil_ledger.employee_id
           AND (public.user_has_action_in_scope('leave.view', target_uc.organization_id, target_uc.department_id, target_uc.sub_department_id)
                OR public.user_has_action_in_scope('timesheet.approve', target_uc.organization_id, target_uc.department_id, target_uc.sub_department_id))));

-- No INSERT / UPDATE / DELETE policy: the guarded functions below are the only writers.
REVOKE ALL ON public.toil_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.toil_ledger TO authenticated;

-- ── 8. API ──────────────────────────────────────────────────────────────────

-- Each person's position, for those the caller may see (others are skipped).
CREATE OR REPLACE FUNCTION public.get_toil_balances(p_employee_ids uuid[])
RETURNS TABLE (
    employee_id         uuid,
    eligible            boolean,
    balance_minutes     integer,
    held_minutes        integer,
    earned_minutes      integer,
    taken_minutes       integer,
    paid_out_minutes    integer,
    next_expiry_date    date,
    next_expiry_minutes integer,
    has_history         boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'internal'
AS $$
#variable_conflict use_column
DECLARE
    v_today date := internal.toil_today();
    e       uuid;
BEGIN
    FOREACH e IN ARRAY coalesce(p_employee_ids, '{}'::uuid[]) LOOP
        CONTINUE WHEN e IS NULL OR NOT internal.toil_can_view(e);
        employee_id := e;
        eligible := internal.toil_active_eligible_contract(e, v_today) IS NOT NULL;
        SELECT coalesce(sum(tl.minutes), 0)::integer,
               coalesce(sum(tl.minutes) FILTER (WHERE tl.entry_type IN ('accrual', 'weekly_topup')
                                                   OR (tl.entry_type = 'adjustment' AND tl.minutes > 0)), 0)::integer,
               coalesce(-sum(tl.minutes) FILTER (WHERE tl.entry_type IN ('taken', 'taken_reversal')), 0)::integer,
               coalesce(-sum(tl.minutes) FILTER (WHERE tl.entry_type IN ('payout', 'expiry_payout', 'termination_payout')), 0)::integer,
               count(*) > 0
          INTO balance_minutes, earned_minutes, taken_minutes, paid_out_minutes, has_history
          FROM public.toil_ledger tl
         WHERE tl.employee_id = e;
        held_minutes := internal.toil_held(e, NULL);
        next_expiry_date := NULL;
        next_expiry_minutes := NULL;
        SELECT l.expires_on, sum(l.remaining)::integer
          INTO next_expiry_date, next_expiry_minutes
          FROM internal.toil_lots(e) l
         WHERE l.remaining > 0
         GROUP BY l.expires_on
         ORDER BY l.expires_on
         LIMIT 1;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- What is left of each earned lot and when it expires.
CREATE OR REPLACE FUNCTION public.get_toil_lots(p_employee uuid)
RETURNS TABLE (lot_date date, earned_minutes integer, remaining_minutes integer, expires_on date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'internal'
AS $$
BEGIN
    IF NOT internal.toil_can_view(p_employee) THEN
        RAISE EXCEPTION 'Not authorised to view this person''s time in lieu' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT l.lot_date, l.earned, l.remaining, l.expires_on
          FROM internal.toil_lots(p_employee) l;
END;
$$;

-- Pay out unused TOIL. The employee may ask at any time and is paid in the
-- next pay run — there is no approval step, because the employer must pay on
-- request. A leave approver in scope may also pay out on their behalf.
CREATE OR REPLACE FUNCTION public.toil_request_payout(p_employee uuid, p_minutes integer, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'internal'
AS $$
DECLARE
    v_self     boolean := (auth.uid() IS NOT NULL AND auth.uid() = p_employee);
    v_today    date := internal.toil_today();
    v_balance  integer;
    v_held     integer;
    v_contract uuid;
    v_id       uuid;
BEGIN
    IF NOT (v_self OR internal.toil_can_manage(p_employee)) THEN
        RAISE EXCEPTION 'Not authorised to pay out this person''s time in lieu' USING ERRCODE = '42501';
    END IF;
    IF p_minutes IS NULL OR p_minutes <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'Enter how many hours to pay out.';
    END IF;

    PERFORM internal.toil_lock(p_employee);
    v_balance := internal.toil_balance(p_employee);
    v_held := internal.toil_held(p_employee, NULL);
    IF p_minutes > v_balance - v_held THEN
        RAISE EXCEPTION USING
            ERRCODE = 'check_violation',
            MESSAGE = format('Only %s can be paid out (%s balance, %s held by pending requests).',
                             internal.toil_fmt(greatest(v_balance - v_held, 0)),
                             internal.toil_fmt(v_balance), internal.toil_fmt(v_held));
    END IF;

    v_contract := coalesce(internal.toil_active_eligible_contract(p_employee, v_today),
                           internal.toil_ledger_contract(p_employee));
    IF v_contract IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'There is no time in lieu on record to pay out.';
    END IF;

    INSERT INTO public.toil_ledger (employee_id, user_contract_id, entry_type, minutes, effective_date, reason)
    VALUES (p_employee, v_contract, 'payout', -p_minutes, v_today,
            coalesce(nullif(btrim(p_note), ''),
                     CASE WHEN v_self THEN 'Paid out at the employee''s request' ELSE 'Paid out by a manager' END))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- A manual correction, with a reason. Never takes the balance below zero.
CREATE OR REPLACE FUNCTION public.toil_adjust(p_employee uuid, p_minutes integer, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'internal'
AS $$
DECLARE
    v_today    date := internal.toil_today();
    v_balance  integer;
    v_contract uuid;
    v_id       uuid;
BEGIN
    IF NOT internal.toil_can_manage(p_employee) THEN
        RAISE EXCEPTION 'Not authorised to adjust this person''s time in lieu' USING ERRCODE = '42501';
    END IF;
    IF p_minutes IS NULL OR p_minutes = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'Enter the hours to add or remove.';
    END IF;
    IF length(btrim(coalesce(p_reason, ''))) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'Say why the balance is being adjusted.';
    END IF;

    PERFORM internal.toil_lock(p_employee);
    v_balance := internal.toil_balance(p_employee);
    IF v_balance + p_minutes < 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'check_violation',
            MESSAGE = format('That would take the balance below zero (it is %s).', internal.toil_fmt(v_balance));
    END IF;

    v_contract := coalesce(internal.toil_active_eligible_contract(p_employee, v_today),
                           internal.toil_ledger_contract(p_employee));
    IF v_contract IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'check_violation',
            MESSAGE = 'Time in lieu applies only to a salaried full-time or part-time contract.';
    END IF;

    INSERT INTO public.toil_ledger (employee_id, user_contract_id, entry_type, minutes, effective_date, reason)
    VALUES (p_employee, v_contract, 'adjustment', p_minutes, v_today, btrim(p_reason))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- Nightly: pay out TOIL not taken within 6 months, and the whole balance of
-- anyone who no longer holds an eligible contract. Returns entries written.
CREATE OR REPLACE FUNCTION public.toil_process_expiries()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'internal'
AS $$
DECLARE
    v_today    date := internal.toil_today();
    v_written  integer := 0;
    v_balance  integer;
    v_expired  integer;
    v_contract uuid;
    e          uuid;
BEGIN
    FOR e IN SELECT DISTINCT tl.employee_id FROM public.toil_ledger tl LOOP
        PERFORM internal.toil_lock(e);
        v_balance := internal.toil_balance(e);
        CONTINUE WHEN v_balance <= 0;

        IF internal.toil_active_eligible_contract(e, v_today) IS NULL THEN
            v_contract := internal.toil_ledger_contract(e);
            INSERT INTO public.toil_ledger (employee_id, user_contract_id, entry_type, minutes, effective_date, reason)
            VALUES (e, v_contract, 'termination_payout', -v_balance, v_today,
                    'No current salaried contract — remaining balance paid out');
            v_written := v_written + 1;
            CONTINUE;
        END IF;

        SELECT coalesce(sum(l.remaining), 0)::integer INTO v_expired
          FROM internal.toil_lots(e) l
         WHERE l.expires_on <= v_today;
        IF v_expired > 0 THEN
            INSERT INTO public.toil_ledger (employee_id, user_contract_id, entry_type, minutes, effective_date, reason)
            VALUES (e, coalesce(internal.toil_active_eligible_contract(e, v_today), internal.toil_ledger_contract(e)),
                    'expiry_payout', -v_expired, v_today, 'Not taken within 6 months — paid out');
            v_written := v_written + 1;
        END IF;
    END LOOP;
    RETURN v_written;
END;
$$;

-- ── 9. Privileges ───────────────────────────────────────────────────────────
-- Supabase grants EXECUTE to anon and authenticated by default; revoking
-- PUBLIC alone is not enough.
REVOKE EXECUTE ON FUNCTION
    internal.trg_toil_ledger_append_only(),
    internal.toil_lock(uuid),
    internal.toil_fmt(integer),
    internal.toil_today(),
    internal.toil_contract_eligible(uuid, date),
    internal.toil_active_eligible_contract(uuid, date),
    internal.toil_ledger_contract(uuid),
    internal.toil_balance(uuid),
    internal.toil_held(uuid, uuid),
    internal.toil_lots(uuid),
    internal.toil_snap_minute_of_day(timestamptz),
    internal.toil_billable_net_minutes(time, time, timestamptz, timestamptz, date, time, time, integer, integer, timestamptz),
    internal.toil_eligible_work(uuid, date, date),
    internal.toil_recompute_day(uuid, date),
    internal.toil_absence_credit_minutes(uuid, date, integer),
    internal.toil_recompute_week(uuid, date),
    internal.toil_recompute(uuid, date),
    internal.trg_toil_timesheet(),
    internal.trg_toil_shift(),
    internal.toil_sync_leave(uuid),
    internal.trg_toil_leave_guard(),
    internal.trg_toil_leave_sync(),
    internal.toil_can_view(uuid),
    internal.toil_can_manage(uuid)
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION
    public.get_toil_balances(uuid[]),
    public.get_toil_lots(uuid),
    public.toil_request_payout(uuid, integer, text),
    public.toil_adjust(uuid, integer, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
    public.get_toil_balances(uuid[]),
    public.get_toil_lots(uuid),
    public.toil_request_payout(uuid, integer, text),
    public.toil_adjust(uuid, integer, text)
TO authenticated;

REVOKE EXECUTE ON FUNCTION public.toil_process_expiries() FROM PUBLIC, anon, authenticated;

-- ── 10. Nightly expiry ──────────────────────────────────────────────────────
-- 15:45 UTC = 01:45 AEST / 02:45 AEDT.
SELECT cron.schedule('toil_nightly_expiry', '45 15 * * *', $cron$SELECT public.toil_process_expiries()$cron$);
