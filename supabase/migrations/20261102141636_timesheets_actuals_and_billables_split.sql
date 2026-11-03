-- ============================================================================
-- Migration: 20261102141636_timesheets_actuals_and_billables_split.sql
-- Purpose:
--   Strict 3-table separation of Roster Schedule, Attendance Actuals, and
--   Payroll / Manager Verification:
--     1. public.shifts      — Pure schedule & roster lifecycle (drops
--                             actual_start, actual_end, attendance_status).
--     2. public.timesheets  — Pure ground-truth attendance actuals (clock_in,
--                             clock_out, arrival_track, departure_track,
--                             generated is_no_show; drops all manager/billable,
--                             break, length, and work_date columns).
--     3. public.billables   — Unified manager verification + payroll & billing
--                             table (merges shift_payroll_records,
--                             gross_pay_records, and manager columns from
--                             timesheets).
--   Also retires:
--     - public.attendance_records, public.shift_payroll_records,
--       public.gross_pay_records
--     - public.shift_attendance_status enum
--     - Auto-clockout logic (public.sm_handle_auto_clock_out + step 7 of
--       public.process_shift_timers), replaced by ±7.5m grace tracks and
--       start+0m / end+0m -> 'missing' tracks.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Create Arrival & Departure Track Enums
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'attendance_arrival_track'
  ) THEN
    CREATE TYPE public.attendance_arrival_track AS ENUM (
      'early_in',
      'on_time',
      'late_in',
      'missing'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'attendance_departure_track'
  ) THEN
    CREATE TYPE public.attendance_departure_track AS ENUM (
      'early_out',
      'on_time',
      'late_out',
      'missing'
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Create public.billables (Manager Verification + Payroll & Billing)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billables (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id                  uuid NOT NULL UNIQUE REFERENCES public.shifts(id) ON DELETE CASCADE,
  timesheet_id              uuid UNIQUE REFERENCES public.timesheets(id) ON DELETE SET NULL,
  employee_id               uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pay_period_id             uuid REFERENCES public.pay_periods(id) ON DELETE SET NULL,

  -- Billable Timing & Breaks (manual manager overrides; NULL side snaps from timesheets)
  billable_start            time without time zone,
  billable_end              time without time zone,
  break_start               time without time zone,
  break_end                 time without time zone,
  unpaid_break_minutes      integer NOT NULL DEFAULT 0,
  paid_break_minutes        integer NOT NULL DEFAULT 0,
  gross_length_minutes      integer,
  net_length_minutes        integer,
  hours_source              text,

  -- Manager Verification & Governance
  status                    public.timesheet_status NOT NULL DEFAULT 'draft',
  submitted_at              timestamptz,
  approved_by               uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at               timestamptz,
  rejected_reason           text,
  arrival_variance_reason   text,
  departure_variance_reason text,
  notes                     text,

  -- Payroll & Billing Ledger (merged from shift_payroll_records + gross_pay_records)
  rate_level                smallint,
  employment_basis          text,
  base_rate                 numeric(10, 4),
  ordinary_hours            numeric(8, 4),
  overtime_hours            numeric(8, 4),
  penalty_amount            numeric(12, 2),
  allowance_amount          numeric(12, 2),
  gross_pay                 numeric(12, 2),
  lines                     jsonb NOT NULL DEFAULT '[]'::jsonb,
  payroll_exported          boolean NOT NULL DEFAULT false,
  payroll_exported_at       timestamptz,
  payroll_exported_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Optimistic Concurrency & Audit
  version                   integer NOT NULL DEFAULT 1,
  edit_count                integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT billables_unpaid_break_nonneg CHECK (unpaid_break_minutes >= 0),
  CONSTRAINT billables_paid_break_nonneg CHECK (paid_break_minutes >= 0),
  CONSTRAINT billables_hours_source_check CHECK (
    hours_source IS NULL OR hours_source IN ('adjusted', 'actual', 'scheduled_fallback', 'no_show')
  ),
  CONSTRAINT billables_break_window CHECK (
    (break_start IS NULL AND break_end IS NULL)
    OR (
      break_start IS NOT NULL
      AND break_end IS NOT NULL
      AND public.shift_minutes_after_start(break_start, break_end) >= 30
      AND public.shift_minutes_after_start(break_start, break_end) <= 60
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_billables_employee_id
  ON public.billables (employee_id);
CREATE INDEX IF NOT EXISTS idx_billables_org_status
  ON public.billables (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_billables_pay_period_id
  ON public.billables (pay_period_id)
  WHERE pay_period_id IS NOT NULL;

ALTER TABLE public.billables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billables FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billables TO authenticated, service_role;

DROP POLICY IF EXISTS billables_self_select ON public.billables;
CREATE POLICY billables_self_select ON public.billables
  FOR SELECT
  USING (employee_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS billables_manager_select ON public.billables;
CREATE POLICY billables_manager_select ON public.billables
  FOR SELECT
  USING (
    public.can_act_on_timesheet('timesheet.view', shift_id, employee_id)
    OR public.can_act_on_shift('payroll.view', shift_id)
  );

DROP POLICY IF EXISTS billables_manager_write ON public.billables;
CREATE POLICY billables_manager_write ON public.billables
  FOR ALL
  USING (public.can_act_on_timesheet('timesheet.approve', shift_id, employee_id))
  WITH CHECK (public.can_act_on_timesheet('timesheet.approve', shift_id, employee_id));

DROP POLICY IF EXISTS billables_service_role_all ON public.billables;
CREATE POLICY billables_service_role_all ON public.billables
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- ----------------------------------------------------------------------------
-- 3. Backfill Existing Manager / Payroll Data into public.billables
--    and Existing Shift Punches into public.timesheets
-- ----------------------------------------------------------------------------

-- 3a. Migrate any legacy punches stored only on shifts into timesheets first
INSERT INTO public.timesheets (
  shift_id,
  profile_id,
  employee_id,
  work_date,
  clock_in,
  clock_out,
  status
)
SELECT
  s.id,
  s.assigned_employee_id,
  s.assigned_employee_id,
  s.shift_date,
  COALESCE(s.actual_start, s.start_at, now()),
  s.actual_end,
  CASE WHEN s.attendance_status = 'no_show' THEN 'no_show'::public.timesheet_status ELSE 'draft'::public.timesheet_status END
FROM public.shifts s
WHERE s.assigned_employee_id IS NOT NULL
  AND (
    s.actual_start IS NOT NULL
    OR s.actual_end IS NOT NULL
    OR s.attendance_status IN ('checked_in', 'late', 'no_show', 'auto_clock_out')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.timesheets t WHERE t.shift_id = s.id
  );

-- 3b. Backfill billables from existing timesheets + shift_payroll_records
INSERT INTO public.billables (
  shift_id,
  timesheet_id,
  employee_id,
  organization_id,
  billable_start,
  billable_end,
  break_start,
  break_end,
  unpaid_break_minutes,
  paid_break_minutes,
  status,
  submitted_at,
  approved_by,
  approved_at,
  rejected_reason,
  arrival_variance_reason,
  departure_variance_reason,
  notes,
  payroll_exported,
  payroll_exported_at,
  payroll_exported_by,
  version,
  edit_count,
  created_at,
  updated_at
)
SELECT
  t.shift_id,
  t.id,
  COALESCE(t.employee_id, t.profile_id, s.assigned_employee_id),
  s.organization_id,
  t.start_time,
  t.end_time,
  COALESCE(t.actual_break_start, s.break_start),
  COALESCE(t.actual_break_end, s.break_end),
  COALESCE(t.unpaid_break_minutes, s.unpaid_break_minutes, 0),
  COALESCE(t.paid_break_minutes, s.paid_break_minutes, 0),
  COALESCE(t.status, 'draft'::public.timesheet_status),
  t.submitted_at,
  t.approved_by,
  t.approved_at,
  t.rejected_reason,
  t.arrival_variance_reason,
  t.departure_variance_reason,
  t.notes,
  COALESCE(spr.payroll_exported, false),
  spr.payroll_exported_at,
  spr.payroll_exported_by,
  COALESCE(t.version, 1),
  COALESCE(t.edit_count, 0),
  COALESCE(t.created_at, now()),
  COALESCE(t.updated_at, now())
FROM public.timesheets t
JOIN public.shifts s ON s.id = t.shift_id
LEFT JOIN public.shift_payroll_records spr ON spr.shift_id = s.id
WHERE COALESCE(t.employee_id, t.profile_id, s.assigned_employee_id) IS NOT NULL
ON CONFLICT (shift_id) DO NOTHING;

-- 3c. Backfill any exported shift_payroll_records rows without timesheets
INSERT INTO public.billables (
  shift_id,
  employee_id,
  organization_id,
  break_start,
  break_end,
  unpaid_break_minutes,
  paid_break_minutes,
  status,
  payroll_exported,
  payroll_exported_at,
  payroll_exported_by,
  created_at,
  updated_at
)
SELECT
  spr.shift_id,
  s.assigned_employee_id,
  s.organization_id,
  s.break_start,
  s.break_end,
  COALESCE(s.unpaid_break_minutes, 0),
  COALESCE(s.paid_break_minutes, 0),
  'draft'::public.timesheet_status,
  COALESCE(spr.payroll_exported, false),
  spr.payroll_exported_at,
  spr.payroll_exported_by,
  COALESCE(spr.created_at, now()),
  COALESCE(spr.updated_at, now())
FROM public.shift_payroll_records spr
JOIN public.shifts s ON s.id = spr.shift_id
WHERE s.assigned_employee_id IS NOT NULL
  AND spr.payroll_exported = true
ON CONFLICT (shift_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. Drop Legacy Triggers on shifts & timesheets + Replace Dependent View
--    (MUST happen before dropping columns from timesheets and shifts)
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_sync_payroll_record ON public.shifts;
DROP FUNCTION IF EXISTS public._sync_payroll_record();
DROP FUNCTION IF EXISTS public.sm_handle_auto_clock_out();

DROP TRIGGER IF EXISTS after_timesheet_decision ON public.timesheets;
DROP TRIGGER IF EXISTS trg_capture_timesheet_event ON public.timesheets;
DROP TRIGGER IF EXISTS trg_enforce_timesheet_review_gate ON public.timesheets;
DROP TRIGGER IF EXISTS trg_sync_timesheet_actual_break ON public.timesheets;
DROP TRIGGER IF EXISTS trg_timesheet_edit_count ON public.timesheets;
DROP TRIGGER IF EXISTS trg_timesheet_version_bump ON public.timesheets;
DROP TRIGGER IF EXISTS trg_toil_timesheet_delete ON public.timesheets;
DROP TRIGGER IF EXISTS trg_toil_timesheet_insert ON public.timesheets;
DROP TRIGGER IF EXISTS trg_toil_timesheet_update ON public.timesheets;

DROP FUNCTION IF EXISTS public.trg_timesheet_decision();
DROP FUNCTION IF EXISTS public.fn_capture_timesheet_event();
DROP FUNCTION IF EXISTS public.enforce_timesheet_review_gate();
DROP FUNCTION IF EXISTS public.fn_sync_timesheet_actual_break();
DROP FUNCTION IF EXISTS public.fn_timesheet_edit_count();
DROP FUNCTION IF EXISTS public.fn_timesheet_version_bump();
DROP FUNCTION IF EXISTS internal.trg_toil_timesheet();

-- Recreate v_shift_assignment_episodes using timesheets (punches) + billables (overrides)
CREATE OR REPLACE VIEW public.v_shift_assignment_episodes AS
WITH late_cancel_threshold AS (
  SELECT '24:00:00'::interval AS val
),
ordered_events AS (
  SELECT
    se.id AS event_id,
    se.shift_id,
    se.employee_id,
    se.event_type,
    se.event_time,
    se.metadata,
    row_number() OVER (PARTITION BY se.shift_id ORDER BY se.event_time, se.id) AS rn
  FROM public.shift_events se
  WHERE se.employee_id IS NOT NULL
),
classified AS (
  SELECT
    oe.event_id,
    oe.shift_id,
    oe.employee_id,
    oe.event_type,
    oe.event_time,
    oe.metadata,
    oe.rn,
    oe.event_type = ANY (ARRAY[
      'ASSIGNED'::public.shift_event_type,
      'OFFERED'::public.shift_event_type,
      'EMERGENCY_ASSIGNED'::public.shift_event_type,
      'SWAPPED_IN'::public.shift_event_type
    ]) AS is_opening_type,
    oe.event_type = ANY (ARRAY[
      'REJECTED'::public.shift_event_type,
      'IGNORED'::public.shift_event_type,
      'CANCELLED'::public.shift_event_type,
      'LATE_CANCELLED'::public.shift_event_type,
      'SWAPPED_OUT'::public.shift_event_type,
      'NO_SHOW'::public.shift_event_type,
      'UNASSIGNED'::public.shift_event_type
    ]) AS is_closing_type
  FROM ordered_events oe
),
boundary_events AS (
  SELECT
    c.shift_id,
    c.event_id,
    c.event_time,
    c.employee_id,
    c.is_opening_type,
    lag(c.is_closing_type) OVER w AS prev_boundary_was_closing,
    lag(c.employee_id) OVER w AS prev_boundary_employee
  FROM classified c
  WHERE c.is_opening_type OR c.is_closing_type
  WINDOW w AS (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id)
),
boundary_starts AS (
  SELECT
    be.shift_id,
    be.event_id,
    CASE
      WHEN be.is_opening_type AND (
        be.prev_boundary_employee IS NULL
        OR be.prev_boundary_was_closing
        OR be.employee_id IS DISTINCT FROM be.prev_boundary_employee
      ) THEN 1
      ELSE 0
    END AS starts_new_episode
  FROM boundary_events be
),
episode_assigned AS (
  SELECT
    c.event_id,
    c.shift_id,
    c.employee_id,
    c.event_type,
    c.event_time,
    c.metadata,
    c.rn,
    c.is_opening_type,
    c.is_closing_type,
    sum(COALESCE(bs.starts_new_episode, 0)) OVER (
      PARTITION BY c.shift_id
      ORDER BY c.event_time, c.event_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS episode_seq
  FROM classified c
  LEFT JOIN boundary_starts bs
    ON bs.shift_id = c.shift_id AND bs.event_id = c.event_id
),
episode_agg AS (
  SELECT
    ea.shift_id,
    ea.episode_seq,
    (array_agg(ea.employee_id ORDER BY ea.event_time, ea.event_id))[1] AS employee_id,
    min(ea.event_time) AS opened_at,
    min(ea.event_time) FILTER (
      WHERE ea.event_type = ANY (ARRAY[
        'ACCEPTED'::public.shift_event_type,
        'EMERGENCY_ASSIGNED'::public.shift_event_type,
        'SWAPPED_IN'::public.shift_event_type
      ])
    ) AS became_active_at,
    bool_or(ea.event_type = 'OFFERED'::public.shift_event_type) AS had_offer,
    bool_or(ea.event_type = 'ACCEPTED'::public.shift_event_type) AS had_accept,
    bool_or(ea.event_type = 'ASSIGNED'::public.shift_event_type) AS had_assign,
    bool_or(ea.event_type = 'EMERGENCY_ASSIGNED'::public.shift_event_type) AS had_emergency,
    bool_or(ea.event_type = 'SWAPPED_IN'::public.shift_event_type) AS had_swap_in,
    bool_or(ea.event_type = 'CHECKED_IN'::public.shift_event_type) AS had_checked_in,
    bool_or(ea.event_type = 'LATE_IN'::public.shift_event_type) AS had_late_in_event,
    bool_or(ea.event_type = 'EARLY_OUT'::public.shift_event_type) AS had_early_out_event,
    (array_agg(ea.event_type ORDER BY ea.event_time DESC, ea.event_id DESC) FILTER (
      WHERE ea.event_type = ANY (ARRAY[
        'REJECTED'::public.shift_event_type,
        'IGNORED'::public.shift_event_type,
        'CANCELLED'::public.shift_event_type,
        'LATE_CANCELLED'::public.shift_event_type,
        'SWAPPED_OUT'::public.shift_event_type,
        'NO_SHOW'::public.shift_event_type,
        'UNASSIGNED'::public.shift_event_type
      ])
    ))[1] AS closing_event_type,
    (array_agg(ea.event_time ORDER BY ea.event_time DESC, ea.event_id DESC) FILTER (
      WHERE ea.event_type = ANY (ARRAY[
        'REJECTED'::public.shift_event_type,
        'IGNORED'::public.shift_event_type,
        'CANCELLED'::public.shift_event_type,
        'LATE_CANCELLED'::public.shift_event_type,
        'SWAPPED_OUT'::public.shift_event_type,
        'NO_SHOW'::public.shift_event_type,
        'UNASSIGNED'::public.shift_event_type
      ])
    ))[1] AS closing_event_time
  FROM episode_assigned ea
  WHERE ea.episode_seq > 0
  GROUP BY ea.shift_id, ea.episode_seq
),
episode_with_shift AS (
  SELECT
    ep.shift_id,
    ep.episode_seq,
    ep.employee_id,
    ep.opened_at,
    ep.became_active_at,
    ep.had_offer,
    ep.had_accept,
    ep.had_assign,
    ep.had_emergency,
    ep.had_swap_in,
    ep.had_checked_in,
    ep.had_late_in_event,
    ep.had_early_out_event,
    ep.closing_event_type,
    ep.closing_event_time,
    max(ep.episode_seq) OVER (PARTITION BY ep.shift_id) AS max_episode_seq,
    s.shift_date,
    s.organization_id,
    s.department_id,
    s.sub_department_id,
    s.lifecycle_status,
    s.start_at AS scheduled_start,
    s.end_at AS scheduled_end,
    lct.val AS late_cancel_threshold
  FROM episode_agg ep
  JOIN public.shifts s ON s.id = ep.shift_id
  CROSS JOIN late_cancel_threshold lct
),
episode_final AS (
  SELECT
    ews.shift_id,
    ews.episode_seq,
    ews.employee_id,
    ews.opened_at,
    ews.became_active_at,
    ews.closing_event_time AS closed_at,
    CASE
      WHEN ews.had_emergency THEN 'EMERGENCY_ASSIGNED'::text
      WHEN ews.had_swap_in THEN 'SWAPPED_IN'::text
      WHEN ews.had_assign THEN 'ASSIGNED'::text
      WHEN ews.had_offer THEN 'OFFERED'::text
      ELSE 'ASSIGNED'::text
    END AS opening_event,
    CASE
      WHEN ews.closing_event_type = 'REJECTED'::public.shift_event_type THEN 'rejected'::text
      WHEN ews.closing_event_type = 'IGNORED'::public.shift_event_type THEN 'ignored'::text
      WHEN ews.closing_event_type = 'SWAPPED_OUT'::public.shift_event_type THEN 'swapped_out'::text
      WHEN ews.closing_event_type = 'NO_SHOW'::public.shift_event_type THEN 'no_show'::text
      WHEN ews.closing_event_type = 'UNASSIGNED'::public.shift_event_type THEN 'unassigned'::text
      WHEN ews.closing_event_type = ANY (ARRAY['CANCELLED'::public.shift_event_type, 'LATE_CANCELLED'::public.shift_event_type]) THEN
        CASE
          WHEN ews.scheduled_start IS NOT NULL
            AND ews.closing_event_time IS NOT NULL
            AND (ews.scheduled_start - ews.closing_event_time) <= ews.late_cancel_threshold
          THEN 'cancelled_late'::text
          ELSE 'cancelled_standard'::text
        END
      WHEN ews.closing_event_type IS NULL
        AND ews.lifecycle_status = 'Completed'::public.shift_lifecycle
        AND ews.episode_seq = ews.max_episode_seq
      THEN 'fulfilled'::text
      ELSE 'open'::text
    END AS terminal_outcome,
    ews.had_offer,
    ews.had_accept,
    ews.had_assign,
    ews.had_emergency,
    ews.had_swap_in,
    COALESCE(ews.had_checked_in, false) AS attended_from_events,
    COALESCE(ews.had_late_in_event, false) AS late_in_from_events,
    COALESCE(ews.had_early_out_event, false) AS early_out_from_events,
    ews.shift_date,
    ews.organization_id,
    ews.department_id,
    ews.sub_department_id,
    ews.scheduled_start,
    ews.scheduled_end,
    ews.lifecycle_status
  FROM episode_with_shift ews
),
ts_agg AS (
  SELECT
    s.id AS shift_id,
    COALESCE(ts.employee_id, b.employee_id) AS employee_id,
    min(ts.clock_in) AS clock_in,
    max(ts.clock_out) AS clock_out,
    min(COALESCE(
      ((s.shift_date + b.billable_start) AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney'::character varying)),
      ts.clock_in
    )) AS effective_clock_in,
    max(COALESCE(
      (CASE
        WHEN b.billable_end IS NOT NULL AND b.billable_end < COALESCE(b.billable_start, s.start_time)
          THEN s.shift_date + '1 day'::interval + b.billable_end::interval
        WHEN b.billable_end IS NOT NULL
          THEN s.shift_date + b.billable_end
        ELSE NULL
      END AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney'::character varying)),
      ts.clock_out
    )) AS effective_clock_out
  FROM public.shifts s
  LEFT JOIN public.timesheets ts ON ts.shift_id = s.id
  LEFT JOIN public.billables b ON b.shift_id = s.id
  WHERE ts.id IS NOT NULL OR b.id IS NOT NULL
  GROUP BY s.id, COALESCE(ts.employee_id, b.employee_id)
)
SELECT
  ef.shift_id,
  ef.episode_seq,
  ef.employee_id,
  ef.opened_at,
  ef.closed_at,
  ef.opening_event,
  ef.terminal_outcome,
  ef.had_offer,
  ef.had_accept,
  ef.had_assign,
  ef.had_emergency,
  ef.had_swap_in,
  ef.attended_from_events OR t.clock_in IS NOT NULL AS attended,
  ef.late_in_from_events OR (
    t.effective_clock_in IS NOT NULL
    AND ef.scheduled_start IS NOT NULL
    AND t.effective_clock_in > (ef.scheduled_start + '00:07:30'::interval)
  ) AS late_in,
  ef.early_out_from_events OR (
    t.effective_clock_out IS NOT NULL
    AND ef.scheduled_end IS NOT NULL
    AND t.effective_clock_out < (ef.scheduled_end - '00:07:30'::interval)
  ) AS early_out,
  ef.shift_date,
  ef.organization_id,
  ef.department_id,
  ef.sub_department_id,
  ef.became_active_at,
  ef.scheduled_start,
  t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
    AND t.effective_clock_in < (ef.scheduled_start - '00:07:30'::interval) AS early_in,
  t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
    AND t.effective_clock_out > (ef.scheduled_end + '00:07:30'::interval) AS late_out,
  t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
    AND t.effective_clock_in >= (ef.scheduled_start - '00:07:30'::interval)
    AND t.effective_clock_in <= (ef.scheduled_start + '00:07:30'::interval) AS on_time_in,
  t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
    AND t.effective_clock_out >= (ef.scheduled_end - '00:07:30'::interval)
    AND t.effective_clock_out <= (ef.scheduled_end + '00:07:30'::interval) AS on_time_out,
  false AS auto_clock_out
FROM episode_final ef
LEFT JOIN ts_agg t
  ON t.shift_id = ef.shift_id
  AND t.employee_id = ef.employee_id
  AND t.effective_clock_in >= ef.opened_at
  AND (ef.closed_at IS NULL OR t.effective_clock_in <= ef.closed_at);

-- ----------------------------------------------------------------------------
-- 5. Evolve public.timesheets to Pure Operational Actuals
-- ----------------------------------------------------------------------------

-- Drop old policies & constraints referencing retired timesheets columns
DROP POLICY IF EXISTS timesheets_manager_select ON public.timesheets;
DROP POLICY IF EXISTS timesheets_manager_write ON public.timesheets;
DROP POLICY IF EXISTS timesheets_member_delete ON public.timesheets;
DROP POLICY IF EXISTS timesheets_member_insert ON public.timesheets;
DROP POLICY IF EXISTS timesheets_member_update ON public.timesheets;
DROP POLICY IF EXISTS timesheets_self_select ON public.timesheets;

ALTER TABLE public.timesheets DROP CONSTRAINT IF EXISTS timesheets_actual_break_window;
ALTER TABLE public.timesheets DROP CONSTRAINT IF EXISTS timesheets_approved_by_fkey;
ALTER TABLE public.timesheets DROP CONSTRAINT IF EXISTS timesheets_break_minutes_check;
ALTER TABLE public.timesheets DROP CONSTRAINT IF EXISTS timesheets_profile_id_fkey;

-- Clean any orphan rows without shift_id and normalize employee_id
DELETE FROM public.timesheets WHERE shift_id IS NULL;
UPDATE public.timesheets t
SET employee_id = COALESCE(t.employee_id, t.profile_id, s.assigned_employee_id)
FROM public.shifts s
WHERE s.id = t.shift_id
  AND t.employee_id IS NULL;
DELETE FROM public.timesheets WHERE employee_id IS NULL;

-- Add new actuals columns
ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS arrival_track public.attendance_arrival_track,
  ADD COLUMN IF NOT EXISTS departure_track public.attendance_departure_track,
  ADD COLUMN IF NOT EXISTS is_no_show boolean NOT NULL GENERATED ALWAYS AS (
    COALESCE(
      arrival_track = 'missing'::public.attendance_arrival_track
      AND departure_track = 'missing'::public.attendance_departure_track,
      false
    )
  ) STORED,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'mobile_gps',
  ADD COLUMN IF NOT EXISTS worker_notes text;

UPDATE public.timesheets t
SET organization_id = s.organization_id
FROM public.shifts s
WHERE s.id = t.shift_id
  AND t.organization_id IS NULL;

-- Make clock_in nullable (rows created at start+0m for missing arrival have NULL clock_in)
ALTER TABLE public.timesheets
  ALTER COLUMN clock_in DROP NOT NULL,
  ALTER COLUMN clock_in DROP DEFAULT,
  ALTER COLUMN shift_id SET NOT NULL,
  ALTER COLUMN employee_id SET NOT NULL,
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.timesheets'::regclass
      AND conname = 'timesheets_employee_id_fkey'
  ) THEN
    ALTER TABLE public.timesheets
      ADD CONSTRAINT timesheets_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Surgically drop all manager/billable/break/length/work_date columns from timesheets
-- (Drop generated columns total_hours and net_hours first before their source columns)
ALTER TABLE public.timesheets
  DROP COLUMN IF EXISTS total_hours,
  DROP COLUMN IF EXISTS net_hours;

ALTER TABLE public.timesheets
  DROP COLUMN IF EXISTS profile_id,
  DROP COLUMN IF EXISTS assignment_id,
  DROP COLUMN IF EXISTS work_date,
  DROP COLUMN IF EXISTS start_time,
  DROP COLUMN IF EXISTS end_time,
  DROP COLUMN IF EXISTS break_minutes,
  DROP COLUMN IF EXISTS paid_break_minutes,
  DROP COLUMN IF EXISTS unpaid_break_minutes,
  DROP COLUMN IF EXISTS actual_break_start,
  DROP COLUMN IF EXISTS actual_break_end,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS submitted_at,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS rejected_reason,
  DROP COLUMN IF EXISTS arrival_variance_reason,
  DROP COLUMN IF EXISTS departure_variance_reason,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS edit_count;

CREATE INDEX IF NOT EXISTS idx_timesheets_org_id
  ON public.timesheets (organization_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_no_show
  ON public.timesheets (organization_id, employee_id)
  WHERE is_no_show = true;

ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheets FORCE ROW LEVEL SECURITY;

CREATE POLICY timesheets_self_select ON public.timesheets
  FOR SELECT
  USING (employee_id = (SELECT auth.uid()));

CREATE POLICY timesheets_manager_select ON public.timesheets
  FOR SELECT
  USING (
    public.can_act_on_timesheet('timesheet.view', shift_id, employee_id)
    OR public.can_act_on_shift('payroll.view', shift_id)
  );

CREATE POLICY timesheets_manager_write ON public.timesheets
  FOR ALL
  USING (public.can_act_on_timesheet('timesheet.approve', shift_id, employee_id))
  WITH CHECK (public.can_act_on_timesheet('timesheet.approve', shift_id, employee_id));

CREATE POLICY timesheets_service_role_all ON public.timesheets
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- Auto-fill organization_id / employee_id from shifts on BEFORE INSERT
CREATE OR REPLACE FUNCTION public.fn_timesheet_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_emp_id uuid;
BEGIN
  IF NEW.organization_id IS NULL OR NEW.employee_id IS NULL THEN
    SELECT s.organization_id, s.assigned_employee_id
      INTO v_org_id, v_emp_id
      FROM public.shifts s
     WHERE s.id = NEW.shift_id;
    NEW.organization_id := COALESCE(NEW.organization_id, v_org_id);
    NEW.employee_id     := COALESCE(NEW.employee_id, v_emp_id);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := COALESCE(NEW.updated_at, now());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_timesheet_defaults ON public.timesheets;
CREATE TRIGGER trg_timesheet_defaults
  BEFORE INSERT OR UPDATE ON public.timesheets
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_timesheet_defaults();

-- ----------------------------------------------------------------------------
-- 6. Rewrite RPCs, Triggers & Internal TOIL Functions
-- ----------------------------------------------------------------------------

-- 6a. _shift_delete_refusal (reads timesheets.clock_in instead of shifts.actual_start)
CREATE OR REPLACE FUNCTION public._shift_delete_refusal(p_shift public.shifts)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.timesheets t
      WHERE t.shift_id = p_shift.id AND t.clock_in IS NOT NULL
    )
      OR p_shift.lifecycle_status::text IN ('InProgress', 'Completed')
      THEN 'SHIFT_WORKED'
    WHEN (p_shift.shift_date || ' ' || p_shift.start_time)::timestamp AT TIME ZONE 'Australia/Sydney' <= now()
      THEN 'SHIFT_STARTED'
  END;
$function$;

-- 6b. is_shift_timesheet_reviewable (reads timesheets + shift end)
CREATE OR REPLACE FUNCTION public.is_shift_timesheet_reviewable(p_shift_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.shifts s
    LEFT JOIN public.timesheets t ON t.shift_id = s.id
    WHERE s.id = p_shift_id
      AND NOT s.is_cancelled
      AND s.lifecycle_status != 'Draft'::public.shift_lifecycle
      AND (
        t.clock_out IS NOT NULL
        OR t.is_no_show = true
        OR t.departure_track = 'missing'::public.attendance_departure_track
        OR s.assignment_outcome = 'no_show'::public.shift_assignment_outcome
        OR now() >= COALESCE(
          s.end_at,
          ((s.shift_date + s.end_time)
            + CASE WHEN s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0' END
          ) AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
        )
      )
  );
$function$;

-- 6c. Billables triggers: defaults/breaks/lengths, review gate, version bump, edit count, notifications, audit events
CREATE OR REPLACE FUNCTION public.fn_billable_defaults_and_lengths()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr', 'internal'
AS $function$
DECLARE
  v_shift        public.shifts%ROWTYPE;
  v_ts_id        uuid;
  v_clock_in     timestamptz;
  v_clock_out    timestamptz;
  v_meal_is_paid boolean;
  v_gross        integer;
  v_net          integer;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = NEW.shift_id;
  IF FOUND THEN
    NEW.organization_id := COALESCE(NEW.organization_id, v_shift.organization_id);
    NEW.employee_id     := COALESCE(NEW.employee_id, v_shift.assigned_employee_id);
    IF TG_OP = 'INSERT' THEN
      NEW.paid_break_minutes := COALESCE(NEW.paid_break_minutes, v_shift.paid_break_minutes, 0);
    END IF;
  END IF;

  SELECT t.id, t.clock_in, t.clock_out
    INTO v_ts_id, v_clock_in, v_clock_out
    FROM public.timesheets t
   WHERE t.shift_id = NEW.shift_id;

  IF NEW.timesheet_id IS NULL AND v_ts_id IS NOT NULL THEN
    NEW.timesheet_id := v_ts_id;
  END IF;

  -- Sync unpaid_break_minutes from break_start..break_end when both are supplied
  IF NEW.break_start IS NOT NULL AND NEW.break_end IS NOT NULL THEN
    v_meal_is_paid := EXISTS (
      SELECT 1
      FROM public.shifts s
      JOIN hr.roles r ON r.id = s.role_id
      WHERE s.id = NEW.shift_id AND r.name ILIKE '%security%'
    );

    NEW.unpaid_break_minutes := CASE
      WHEN v_meal_is_paid THEN 0
      ELSE public.shift_minutes_after_start(NEW.break_start, NEW.break_end)
    END;

    IF NEW.billable_start IS NOT NULL AND NEW.billable_end IS NOT NULL THEN
      IF public.shift_minutes_after_start(NEW.billable_start, NEW.break_start) >= public.shift_minutes_after_start(NEW.billable_start, NEW.break_end)
         OR public.shift_minutes_after_start(NEW.billable_start, NEW.break_end) > public.shift_net_minutes(NEW.billable_start, NEW.billable_end, 0) THEN
        RAISE EXCEPTION 'Meal break must fall within the billable window (% to %)', NEW.billable_start, NEW.billable_end
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- Compute gross_length_minutes, net_length_minutes, and hours_source
  IF NEW.status = 'no_show'::public.timesheet_status
     AND NEW.billable_start IS NULL
     AND NEW.billable_end IS NULL THEN
    NEW.gross_length_minutes := 0;
    NEW.net_length_minutes   := 0;
    NEW.hours_source         := 'no_show';
  ELSIF v_shift.id IS NOT NULL THEN
    v_gross := internal.toil_billable_net_minutes(
      NEW.billable_start, NEW.billable_end,
      v_clock_in, v_clock_out,
      v_shift.shift_date, v_shift.start_time, v_shift.end_time,
      0, 0
    );
    v_net := internal.toil_billable_net_minutes(
      NEW.billable_start, NEW.billable_end,
      v_clock_in, v_clock_out,
      v_shift.shift_date, v_shift.start_time, v_shift.end_time,
      NEW.unpaid_break_minutes, v_shift.unpaid_break_minutes
    );
    NEW.gross_length_minutes := v_gross;
    NEW.net_length_minutes   := v_net;
    IF v_net IS NOT NULL THEN
      NEW.hours_source := CASE
        WHEN NEW.billable_start IS NOT NULL OR NEW.billable_end IS NOT NULL THEN 'adjusted'
        ELSE 'actual'
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_billable_review_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_is_decision      boolean;
  v_is_billable_edit boolean;
  v_reviewable       boolean;
BEGIN
  -- Terminal payroll-export lock (except service_role or explicit un-export)
  IF TG_OP = 'UPDATE'
     AND OLD.payroll_exported = true
     AND NEW.payroll_exported = true
     AND COALESCE((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Billable record % has already been exported to payroll and cannot be modified.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  v_is_decision := NEW.status IN ('approved', 'rejected')
                   AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status);

  v_is_billable_edit := (
    TG_OP = 'UPDATE'
    AND (
      NEW.billable_start IS DISTINCT FROM OLD.billable_start
      OR NEW.billable_end IS DISTINCT FROM OLD.billable_end
    )
  ) OR (
    TG_OP = 'INSERT'
    AND (NEW.billable_start IS NOT NULL OR NEW.billable_end IS NOT NULL)
  );

  IF NOT (v_is_decision OR v_is_billable_edit) THEN
    RETURN NEW;
  END IF;

  v_reviewable := public.is_shift_timesheet_reviewable(NEW.shift_id);

  IF NOT v_reviewable THEN
    RAISE EXCEPTION
      'Timesheet review blocked: shift % has not reached a final attendance state.', NEW.shift_id
      USING ERRCODE = 'check_violation',
            HINT = 'Approve, reject, or edit billable times only after the employee clocks out, scheduled end passes, or the shift is a no-show.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_billable_edit_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF (
    NEW.billable_start       IS DISTINCT FROM OLD.billable_start
    OR NEW.billable_end      IS DISTINCT FROM OLD.billable_end
    OR NEW.break_start       IS DISTINCT FROM OLD.break_start
    OR NEW.break_end         IS DISTINCT FROM OLD.break_end
    OR NEW.paid_break_minutes IS DISTINCT FROM OLD.paid_break_minutes
    OR NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes
  ) THEN
    NEW.edit_count := COALESCE(OLD.edit_count, 0) + 1;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_billable_version_bump()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.version IS NOT DISTINCT FROM OLD.version THEN
    NEW.version := COALESCE(OLD.version, 1) + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_billable_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift_date date;
BEGIN
  IF NEW.employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.shift_date INTO v_shift_date
  FROM public.shifts s
  WHERE s.id = NEW.shift_id;

  IF v_shift_date IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    PERFORM public.notify_user(
      NEW.employee_id,
      'timesheet_approved',
      'Timesheet approved',
      'Your timesheet for the shift on '
        || TO_CHAR(v_shift_date, 'DD Mon YYYY')
        || ' has been approved',
      NEW.id,
      'timesheet',
      '/timesheet',
      'TIMESHEET_APPROVED_' || NEW.id::TEXT
    );
  ELSIF NEW.status = 'rejected' AND OLD.status <> 'rejected' THEN
    PERFORM public.notify_user(
      NEW.employee_id,
      'timesheet_rejected',
      'Timesheet needs revision',
      'Your timesheet for the shift on '
        || TO_CHAR(v_shift_date, 'DD Mon YYYY')
        || ' was rejected — please review and resubmit',
      NEW.id,
      'timesheet',
      '/timesheet',
      'TIMESHEET_REJECTED_' || NEW.id::TEXT
    );
  ELSIF NEW.status = OLD.status AND (
       NEW.billable_start       IS DISTINCT FROM OLD.billable_start
    OR NEW.billable_end         IS DISTINCT FROM OLD.billable_end
    OR NEW.paid_break_minutes   IS DISTINCT FROM OLD.paid_break_minutes
    OR NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes
  ) THEN
    PERFORM public.notify_user(
      NEW.employee_id,
      'timesheet_adjusted',
      'Timesheet adjusted',
      'A manager adjusted your billable time for the shift on '
        || TO_CHAR(v_shift_date, 'DD Mon YYYY'),
      NEW.id,
      'timesheet',
      '/timesheet',
      'TIMESHEET_ADJUSTED_' || NEW.id::TEXT || '_' || COALESCE(NEW.edit_count, 0)::TEXT
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_capture_billable_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.shift_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved')) THEN
    INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
    VALUES (
      NEW.shift_id,
      NEW.employee_id,
      COALESCE(NEW.approved_by, v_actor),
      'OP_APPLIED',
      clock_timestamp(),
      jsonb_build_object(
        'op', 'timesheet_finalize',
        'domain', 'payroll',
        'source', 'billables',
        'net_minutes', NEW.net_length_minutes
      ),
      'manager',
      'payroll'
    )
    ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
  ELSIF TG_OP = 'UPDATE'
        AND OLD.status IN ('submitted', 'approved')
        AND (
          NEW.billable_start IS DISTINCT FROM OLD.billable_start
          OR NEW.billable_end IS DISTINCT FROM OLD.billable_end
          OR NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes
        ) THEN
    INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
    VALUES (
      NEW.shift_id,
      NEW.employee_id,
      v_actor,
      'OP_APPLIED',
      clock_timestamp(),
      jsonb_build_object(
        'op', 'timesheet_adjust',
        'domain', 'payroll',
        'source', 'billables',
        'changes', jsonb_strip_nulls(jsonb_build_object(
          'billable_start',       CASE WHEN NEW.billable_start IS DISTINCT FROM OLD.billable_start THEN jsonb_build_object('old', OLD.billable_start, 'new', NEW.billable_start) END,
          'billable_end',         CASE WHEN NEW.billable_end IS DISTINCT FROM OLD.billable_end THEN jsonb_build_object('old', OLD.billable_end, 'new', NEW.billable_end) END,
          'unpaid_break_minutes', CASE WHEN NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes THEN jsonb_build_object('old', OLD.unpaid_break_minutes, 'new', NEW.unpaid_break_minutes) END
        ))
      ),
      'manager',
      'payroll'
    )
    ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_billable_review_gate ON public.billables;
CREATE TRIGGER trg_enforce_billable_review_gate
  BEFORE INSERT OR UPDATE ON public.billables
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_billable_review_gate();

DROP TRIGGER IF EXISTS trg_billable_defaults_and_lengths ON public.billables;
CREATE TRIGGER trg_billable_defaults_and_lengths
  BEFORE INSERT OR UPDATE ON public.billables
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_billable_defaults_and_lengths();

DROP TRIGGER IF EXISTS trg_billable_edit_count ON public.billables;
CREATE TRIGGER trg_billable_edit_count
  BEFORE UPDATE ON public.billables
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_billable_edit_count();

DROP TRIGGER IF EXISTS trg_billable_version_bump ON public.billables;
CREATE TRIGGER trg_billable_version_bump
  BEFORE UPDATE ON public.billables
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_billable_version_bump();

DROP TRIGGER IF EXISTS after_billable_decision ON public.billables;
CREATE TRIGGER after_billable_decision
  AFTER UPDATE ON public.billables
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_billable_decision();

DROP TRIGGER IF EXISTS trg_capture_billable_event ON public.billables;
CREATE TRIGGER trg_capture_billable_event
  AFTER INSERT OR UPDATE ON public.billables
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_capture_billable_event();

-- 6d. TOIL Accrual Functions & Triggers (wired to billables + timesheets)
CREATE OR REPLACE FUNCTION internal.toil_eligible_work(p_employee uuid, p_from date, p_to date)
 RETURNS TABLE(shift_id uuid, timesheet_id uuid, user_contract_id uuid, shift_date date, net_minutes integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'internal'
AS $function$
    SELECT s.id, b.id, s.user_contract_id, s.shift_date,
           internal.toil_billable_net_minutes(
               b.billable_start, b.billable_end, t.clock_in, t.clock_out,
               s.shift_date, s.start_time, s.end_time,
               b.unpaid_break_minutes, s.unpaid_break_minutes)
      FROM public.shifts s
      JOIN public.billables b ON b.shift_id = s.id
      LEFT JOIN public.timesheets t ON t.shift_id = s.id
     WHERE s.assigned_employee_id = p_employee
       AND s.shift_date BETWEEN p_from AND p_to
       AND NOT s.is_cancelled
       AND b.status = 'approved'
       AND s.user_contract_id IS NOT NULL
       AND internal.toil_contract_eligible(s.user_contract_id, s.shift_date);
$function$;

CREATE OR REPLACE FUNCTION internal.trg_toil_shift()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'internal'
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.billables b WHERE b.shift_id = NEW.id AND b.status = 'approved') THEN
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
$function$;

DROP TRIGGER IF EXISTS trg_toil_shift_change ON public.shifts;
CREATE TRIGGER trg_toil_shift_change
  AFTER UPDATE ON public.shifts
  FOR EACH ROW
  WHEN (
    (OLD.assigned_employee_id, OLD.shift_date, OLD.start_time, OLD.end_time, OLD.unpaid_break_minutes, OLD.is_cancelled, OLD.user_contract_id)
    IS DISTINCT FROM
    (NEW.assigned_employee_id, NEW.shift_date, NEW.start_time, NEW.end_time, NEW.unpaid_break_minutes, NEW.is_cancelled, NEW.user_contract_id)
  )
  EXECUTE FUNCTION internal.trg_toil_shift();

CREATE OR REPLACE FUNCTION internal.trg_toil_billable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'internal'
AS $function$
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
$function$;

DROP TRIGGER IF EXISTS trg_toil_billable_insert ON public.billables;
CREATE TRIGGER trg_toil_billable_insert
  AFTER INSERT ON public.billables
  FOR EACH ROW
  WHEN (NEW.status = 'approved'::public.timesheet_status)
  EXECUTE FUNCTION internal.trg_toil_billable();

DROP TRIGGER IF EXISTS trg_toil_billable_update ON public.billables;
CREATE TRIGGER trg_toil_billable_update
  AFTER UPDATE ON public.billables
  FOR EACH ROW
  WHEN (
    (OLD.status = 'approved'::public.timesheet_status OR NEW.status = 'approved'::public.timesheet_status)
    AND (OLD.status, OLD.billable_start, OLD.billable_end, OLD.unpaid_break_minutes, OLD.shift_id)
        IS DISTINCT FROM
        (NEW.status, NEW.billable_start, NEW.billable_end, NEW.unpaid_break_minutes, NEW.shift_id)
  )
  EXECUTE FUNCTION internal.trg_toil_billable();

DROP TRIGGER IF EXISTS trg_toil_billable_delete ON public.billables;
CREATE TRIGGER trg_toil_billable_delete
  AFTER DELETE ON public.billables
  FOR EACH ROW
  WHEN (OLD.status = 'approved'::public.timesheet_status)
  EXECUTE FUNCTION internal.trg_toil_billable();

CREATE OR REPLACE FUNCTION internal.trg_toil_timesheet_clock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'internal'
AS $function$
DECLARE
  v_shift_id uuid := COALESCE(NEW.shift_id, OLD.shift_id);
  v_emp      uuid;
  v_date     date;
BEGIN
  IF EXISTS (SELECT 1 FROM public.billables b WHERE b.shift_id = v_shift_id AND b.status = 'approved') THEN
    SELECT s.assigned_employee_id, s.shift_date INTO v_emp, v_date
      FROM public.shifts s WHERE s.id = v_shift_id;
    IF v_emp IS NOT NULL THEN
      PERFORM internal.toil_recompute(v_emp, v_date);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_toil_timesheet_clock_change ON public.timesheets;
CREATE TRIGGER trg_toil_timesheet_clock_change
  AFTER INSERT OR UPDATE OF clock_in, clock_out OR DELETE ON public.timesheets
  FOR EACH ROW
  EXECUTE FUNCTION internal.trg_toil_timesheet_clock();

-- 6e. Shift lifecycle cleanup trigger (unpublish / unassign / reassign before punch)
CREATE OR REPLACE FUNCTION public.fn_sync_timesheets_on_shift_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.lifecycle_status = 'Draft'::public.shift_lifecycle
     OR NEW.assigned_employee_id IS NULL
     OR NEW.is_cancelled = true THEN
    DELETE FROM public.timesheets
     WHERE shift_id = NEW.id
       AND clock_in IS NULL
       AND clock_out IS NULL;

    DELETE FROM public.billables
     WHERE shift_id = NEW.id
       AND status = 'draft'::public.timesheet_status
       AND payroll_exported = false
       AND billable_start IS NULL
       AND billable_end IS NULL;

  ELSIF NEW.assigned_employee_id IS DISTINCT FROM OLD.assigned_employee_id
        AND NEW.assigned_employee_id IS NOT NULL THEN
    UPDATE public.timesheets
       SET employee_id = NEW.assigned_employee_id,
           updated_at  = now()
     WHERE shift_id = NEW.id
       AND clock_in IS NULL;

    UPDATE public.billables
       SET employee_id = NEW.assigned_employee_id,
           updated_at  = now()
     WHERE shift_id = NEW.id
       AND status = 'draft'::public.timesheet_status
       AND payroll_exported = false;
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_timesheets_on_shift_change ON public.shifts;
CREATE TRIGGER trg_sync_timesheets_on_shift_change
  AFTER UPDATE OF lifecycle_status, assigned_employee_id, is_cancelled ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_timesheets_on_shift_change();

-- 6f. fn_capture_shift_event (pure schedule/lifecycle events; no actual_start or attendance_status)
CREATE OR REPLACE FUNCTION public.fn_capture_shift_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_from  text;
    v_to    text;
    v_actor uuid;
    v_auto  boolean;
    v_drop  boolean;
BEGIN
    IF current_setting('app.audit.via_gateway', true) = '1' THEN
        RETURN NEW;
    END IF;

    v_actor := auth.uid();
    v_auto  := COALESCE(current_setting('app.audit.actor', true), '') = 'autoscheduler';
    v_drop  := COALESCE(current_setting('app.audit.employee_drop', true), '') = '1';
    v_to := public.get_shift_fsm_state(NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome, NEW.trading_status, NEW.is_cancelled, NEW.bidding_status);
    IF (TG_OP = 'UPDATE') THEN
        v_from := public.get_shift_fsm_state(OLD.lifecycle_status, OLD.assignment_status, OLD.assignment_outcome, OLD.trading_status, OLD.is_cancelled, OLD.bidding_status);
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assigned_employee_id IS NOT NULL AND OLD.assigned_employee_id IS NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to)
                      || CASE WHEN v_auto THEN jsonb_build_object('source', 'autoscheduler') ELSE '{}'::jsonb END,
                    CASE WHEN v_auto THEN 'autoscheduler' ELSE NULL END);
        ELSIF (NEW.assigned_employee_id IS NULL AND OLD.assigned_employee_id IS NOT NULL AND NOT v_drop) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, OLD.assigned_employee_id, 'UNASSIGNED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    ELSIF (TG_OP = 'INSERT') THEN
        IF (NEW.assigned_employee_id IS NOT NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to)
                      || CASE WHEN v_auto THEN jsonb_build_object('source', 'autoscheduler') ELSE '{}'::jsonb END,
                    CASE WHEN v_auto THEN 'autoscheduler' ELSE NULL END);
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.fulfillment_status = 'offered' AND OLD.fulfillment_status IS DISTINCT FROM 'offered') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OFFERED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assignment_outcome = 'confirmed' AND OLD.assignment_outcome IS DISTINCT FROM 'confirmed') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ACCEPTED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        ELSIF (NEW.assignment_outcome = 'emergency_assigned' AND OLD.assignment_outcome IS DISTINCT FROM 'emergency_assigned') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Cancelled' AND OLD.lifecycle_status IS DISTINCT FROM 'Cancelled') THEN
            IF (NEW.start_at IS NOT NULL AND (NEW.start_at - now()) < interval '12 hours') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'LATE_CANCELLED', now(),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            END IF;

            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'CANCELLED', COALESCE(NEW.cancelled_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Published' AND OLD.lifecycle_status IS DISTINCT FROM 'Published'
            AND NOT (NEW.assignment_outcome = 'emergency_assigned'
                     AND OLD.assignment_outcome IS DISTINCT FROM NEW.assignment_outcome)) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', clock_timestamp(),
                jsonb_build_object('op', 'publish', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event'),
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Completed' AND OLD.lifecycle_status IS DISTINCT FROM 'Completed') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OP_APPLIED', clock_timestamp(),
                jsonb_build_object(
                    'op', 'complete',
                    'domain', 'lifecycle',
                    'from_state', v_from,
                    'to_state',   v_to,
                    'source', 'fn_capture_shift_event'
                ),
                'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'InProgress' AND OLD.lifecycle_status IS DISTINCT FROM 'InProgress') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', clock_timestamp(),
                jsonb_build_object('op', 'in_progress', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event'),
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'employee' END, 'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Draft' AND OLD.lifecycle_status = 'Published') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', clock_timestamp(),
                jsonb_build_object('op', 'unpublish', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event')
                  || CASE WHEN NEW.last_modified_reason IS NOT NULL
                          AND NEW.last_modified_reason IS DISTINCT FROM OLD.last_modified_reason
                          THEN jsonb_build_object('reason', NEW.last_modified_reason)
                          ELSE '{}'::jsonb END,
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- 6g. check_in_shift (writes ground-truth punch + ±7.5m arrival_track to public.timesheets)
CREATE OR REPLACE FUNCTION public.check_in_shift(
  p_shift_id uuid,
  p_lat double precision,
  p_lon double precision
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift           public.shifts%ROWTYPE;
  v_now             timestamptz := now();
  v_effective_start timestamptz;
  v_distance_m      double precision := 0;
  v_min_distance_m  double precision;
  v_arrival_track   public.attendance_arrival_track;
  v_legacy_status   text;
  v_loc             RECORD;
  v_any_location    boolean := false;
  v_inside          boolean := false;
  v_earth_radius    CONSTANT double precision := 6371000;
  v_lat1_rad        double precision;
  v_lat2_rad        double precision;
  v_dlat            double precision;
  v_dlon            double precision;
  v_a               double precision;
  v_dist            double precision;
  v_org             public.organizations%ROWTYPE;
  v_from_state      text;
  v_to_state        text;
BEGIN
  PERFORM public.sm_require_assignee_or(p_shift_id, NULL, 'shift.edit');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  IF v_shift.assigned_employee_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift has no assigned employee');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.timesheets t
    WHERE t.shift_id = p_shift_id AND t.clock_in IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked in for this shift');
  END IF;

  IF v_shift.start_at IS NOT NULL THEN
    v_effective_start := v_shift.start_at;
  ELSE
    v_effective_start := (
      v_shift.shift_date::text || ' ' || v_shift.start_time::text || ' ' || COALESCE(v_shift.timezone, 'Australia/Sydney')
    )::timestamptz;
  END IF;

  IF v_now < v_effective_start - INTERVAL '1 hour' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Clock-in window not open yet');
  END IF;

  IF v_now > v_effective_start + INTERVAL '750 minutes' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Clock-in window has closed (more than 12.5 hours after shift start)'
    );
  END IF;

  IF p_lat IS NULL OR p_lon IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'GPS location is required to clock in');
  END IF;

  v_min_distance_m := NULL;
  v_inside := false;
  FOR v_loc IN
    SELECT lat, lng, radius_m
    FROM public.allowed_locations
    WHERE org_id = v_shift.organization_id AND is_active = true
  LOOP
    v_any_location := true;
    v_lat1_rad := radians(v_loc.lat);
    v_lat2_rad := radians(p_lat);
    v_dlat     := radians(p_lat - v_loc.lat);
    v_dlon     := radians(p_lon - v_loc.lng);
    v_a        := sin(v_dlat / 2)^2 + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
    v_dist     := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));

    IF v_min_distance_m IS NULL OR v_dist < v_min_distance_m THEN
      v_min_distance_m := v_dist;
    END IF;
    IF v_dist <= v_loc.radius_m THEN
      v_inside     := true;
      v_distance_m := v_dist;
    END IF;
  END LOOP;

  IF v_any_location AND NOT v_inside THEN
    RETURN jsonb_build_object(
      'success',    false,
      'error',      'You are too far from any allowed location to clock in',
      'distance_m', round(COALESCE(v_min_distance_m, 0)::numeric, 1)
    );
  END IF;

  IF NOT v_any_location THEN
    SELECT * INTO v_org FROM public.organizations WHERE id = v_shift.organization_id;
    IF v_org.venue_lat IS NOT NULL AND v_org.venue_lon IS NOT NULL THEN
      v_lat1_rad := radians(v_org.venue_lat);
      v_lat2_rad := radians(p_lat);
      v_dlat     := radians(p_lat - v_org.venue_lat);
      v_dlon     := radians(p_lon - v_org.venue_lon);
      v_a        := sin(v_dlat / 2)^2 + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
      v_distance_m := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));
      IF v_distance_m > 100 THEN
        RETURN jsonb_build_object(
          'success',    false,
          'error',      'You are too far from the venue to clock in',
          'distance_m', round(v_distance_m::numeric, 1)
        );
      END IF;
    END IF;
  END IF;

  -- Grace threshold: ±7.5 minutes (7 minutes 30 seconds)
  IF v_now < v_effective_start - INTERVAL '7 minutes 30 seconds' THEN
    v_arrival_track := 'early_in';
  ELSIF v_now <= v_effective_start + INTERVAL '7 minutes 30 seconds' THEN
    v_arrival_track := 'on_time';
  ELSE
    v_arrival_track := 'late_in';
  END IF;

  v_legacy_status := CASE WHEN v_arrival_track = 'late_in' THEN 'late' ELSE 'checked_in' END;

  v_from_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  INSERT INTO public.timesheets (
    shift_id,
    employee_id,
    organization_id,
    clock_in,
    arrival_track,
    source
  ) VALUES (
    p_shift_id,
    v_shift.assigned_employee_id,
    v_shift.organization_id,
    v_now,
    v_arrival_track,
    'mobile_gps'
  )
  ON CONFLICT (shift_id) DO UPDATE SET
    employee_id     = EXCLUDED.employee_id,
    organization_id = EXCLUDED.organization_id,
    clock_in        = EXCLUDED.clock_in,
    arrival_track   = EXCLUDED.arrival_track,
    source          = EXCLUDED.source,
    updated_at      = v_now;

  UPDATE public.shifts SET
    lifecycle_status = CASE
      WHEN lifecycle_status = 'Published'::public.shift_lifecycle THEN 'InProgress'::public.shift_lifecycle
      ELSE lifecycle_status
    END,
    trading_status = 'NoTrade'::public.shift_trading,
    updated_at = v_now
  WHERE id = p_shift_id;

  v_to_state := public.get_shift_fsm_state(
    CASE WHEN v_shift.lifecycle_status = 'Published'::public.shift_lifecycle THEN 'InProgress'::public.shift_lifecycle ELSE v_shift.lifecycle_status END,
    v_shift.assignment_status,
    v_shift.assignment_outcome,
    'NoTrade'::public.shift_trading,
    v_shift.is_cancelled,
    v_shift.bidding_status
  );

  INSERT INTO public.shift_events (
    shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain
  ) VALUES (
    p_shift_id,
    v_shift.assigned_employee_id,
    auth.uid(),
    CASE WHEN v_arrival_track = 'late_in' THEN 'LATE_IN' ELSE 'CHECKED_IN' END::public.shift_event_type,
    v_now,
    jsonb_build_object(
      'from_state', v_from_state,
      'to_state', v_to_state,
      'arrival_track', v_arrival_track::text,
      'source', 'check_in_shift'
    ),
    'employee',
    'attendance'
  )
  ON CONFLICT (shift_id, employee_id, event_type, event_time) DO NOTHING;

  RETURN jsonb_build_object(
    'success',           true,
    'arrival_track',     v_arrival_track::text,
    'attendance_status', v_legacy_status,
    'clock_in',          v_now,
    'actual_start',      v_now,
    'distance_m',        round(v_distance_m::numeric, 1)
  );
END;
$function$;

-- 6h. sm_clock_out_shift (writes clock_out + ±7.5m departure_track to public.timesheets)
CREATE OR REPLACE FUNCTION public.sm_clock_out_shift(
  p_shift_id uuid,
  p_user_id uuid,
  p_lat double precision DEFAULT NULL::double precision,
  p_lon double precision DEFAULT NULL::double precision
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift           public.shifts%ROWTYPE;
  v_ts              public.timesheets%ROWTYPE;
  v_org             public.organizations%ROWTYPE;
  v_now             timestamptz := clock_timestamp();
  v_effective_end   timestamptz;
  v_departure_track public.attendance_departure_track;
  v_distance_m      double precision := 0;
  v_min_distance_m  double precision;
  v_loc             RECORD;
  v_any_location    boolean := false;
  v_inside          boolean := false;
  v_net_minutes     numeric;
  v_early_out       boolean;
  v_earth_radius    CONSTANT double precision := 6371000;
  v_lat1_rad        double precision;
  v_lat2_rad        double precision;
  v_dlat            double precision;
  v_dlon            double precision;
  v_a               double precision;
  v_dist            double precision;
  v_from_state      text;
  v_to_state        text;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT public.can_act_on_shift('timesheet.approve', p_shift_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to clock out on behalf of this employee');
  END IF;
  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift is not assigned to this employee');
  END IF;

  SELECT * INTO v_ts FROM public.timesheets WHERE shift_id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR v_ts.clock_in IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Must clock in before clocking out');
  END IF;

  IF v_ts.clock_out IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked out');
  END IF;

  IF p_lat IS NULL OR p_lon IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Location required to clock out');
  END IF;

  v_min_distance_m := NULL;
  v_inside := false;
  FOR v_loc IN
    SELECT lat, lng, radius_m
    FROM public.allowed_locations
    WHERE org_id = v_shift.organization_id AND is_active = true
  LOOP
    v_any_location := true;
    v_lat1_rad := radians(v_loc.lat);
    v_lat2_rad := radians(p_lat);
    v_dlat     := radians(p_lat - v_loc.lat);
    v_dlon     := radians(p_lon - v_loc.lng);
    v_a        := sin(v_dlat / 2)^2 + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
    v_dist     := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));

    IF v_min_distance_m IS NULL OR v_dist < v_min_distance_m THEN
      v_min_distance_m := v_dist;
    END IF;
    IF v_dist <= v_loc.radius_m THEN
      v_inside     := true;
      v_distance_m := v_dist;
    END IF;
  END LOOP;

  IF v_any_location AND NOT v_inside THEN
    RETURN jsonb_build_object(
      'success',    false,
      'error',      'You are too far from any allowed location to clock out',
      'distance_m', round(COALESCE(v_min_distance_m, 0)::numeric, 1)
    );
  END IF;

  IF NOT v_any_location THEN
    SELECT * INTO v_org FROM public.organizations WHERE id = v_shift.organization_id;
    IF FOUND AND v_org.venue_lat IS NOT NULL AND v_org.venue_lon IS NOT NULL THEN
      v_lat1_rad := radians(v_org.venue_lat);
      v_lat2_rad := radians(p_lat);
      v_dlat     := radians(p_lat - v_org.venue_lat);
      v_dlon     := radians(p_lon - v_org.venue_lon);
      v_a        := sin(v_dlat / 2)^2 + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
      v_distance_m := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));
      IF v_distance_m > 100 THEN
        RETURN jsonb_build_object(
          'success',    false,
          'error',      'You are too far from the venue to clock out',
          'distance_m', round(v_distance_m::numeric, 1)
        );
      END IF;
    END IF;
  END IF;

  IF v_shift.end_at IS NOT NULL THEN
    v_effective_end := v_shift.end_at;
  ELSE
    v_effective_end := (
      (v_shift.shift_date + v_shift.end_time)
      + CASE WHEN v_shift.end_time <= v_shift.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END
    ) AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney');
  END IF;

  -- Grace threshold: ±7.5 minutes (7 minutes 30 seconds)
  IF v_now < v_effective_end - INTERVAL '7 minutes 30 seconds' THEN
    v_departure_track := 'early_out';
  ELSIF v_now <= v_effective_end + INTERVAL '7 minutes 30 seconds' THEN
    v_departure_track := 'on_time';
  ELSE
    v_departure_track := 'late_out';
  END IF;

  v_early_out := (v_departure_track = 'early_out');
  v_net_minutes := EXTRACT(EPOCH FROM (v_now - v_ts.clock_in)) / 60.0;

  UPDATE public.timesheets SET
    clock_out       = v_now,
    departure_track = v_departure_track,
    updated_at      = v_now
  WHERE id = v_ts.id;

  v_from_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  UPDATE public.shifts SET
    lifecycle_status = 'Completed'::public.shift_lifecycle,
    updated_at       = v_now
  WHERE id = p_shift_id;

  -- Refresh billable lengths if a billables row already exists for this shift
  UPDATE public.billables SET
    timesheet_id = v_ts.id,
    updated_at   = v_now
  WHERE shift_id = p_shift_id
    AND payroll_exported = false;

  v_to_state := public.get_shift_fsm_state(
    'Completed'::public.shift_lifecycle, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  INSERT INTO public.shift_events (
    shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain
  ) VALUES (
    p_shift_id,
    v_shift.assigned_employee_id,
    p_user_id,
    CASE WHEN v_early_out THEN 'EARLY_OUT' ELSE 'OP_APPLIED' END::public.shift_event_type,
    v_now,
    jsonb_build_object(
      'op', 'clock_out',
      'domain', 'attendance',
      'departure', CASE
                     WHEN v_departure_track = 'early_out' THEN 'early'
                     WHEN v_departure_track = 'late_out' THEN 'late'
                     ELSE 'on_time'
                   END,
      'departure_track', v_departure_track::text,
      'net_minutes', round(v_net_minutes::numeric, 0),
      'from_state', v_from_state,
      'to_state',   v_to_state,
      'source', 'sm_clock_out_shift'
    ),
    'employee',
    'attendance'
  )
  ON CONFLICT (shift_id, employee_id, event_type, event_time) DO NOTHING;

  RETURN jsonb_build_object(
    'success',            true,
    'departure_track',    v_departure_track::text,
    'clock_out',          v_now,
    'actual_end',         v_now,
    'actual_net_minutes', round(v_net_minutes::numeric, 0),
    'early_out',          v_early_out,
    'distance_m',         round(v_distance_m::numeric, 1)
  );
END;
$function$;

-- 6i. process_shift_timers (start+0m -> missing arrival, end+0m -> missing departure / no_show; NO auto-clockout)
CREATE OR REPLACE FUNCTION public.process_shift_timers()
 RETURNS TABLE(operation text, affected integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count INT := 0;
    v_rec   RECORD;
BEGIN
    -- 1. Expire pending offers S3 -> S2
    FOR v_rec IN SELECT * FROM public.fn_process_offer_expirations() LOOP
        v_count := v_count + 1;
    END LOOP;
    IF v_count > 0 THEN operation := 'OFFER_EXPIRED'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 2. Bidding timeout S5/S6 -> S1
    WITH timed_out AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'Draft',
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            updated_at           = NOW(),
            last_modified_reason = 'Bidding timeout: T-4h passed, no winner — reverted to draft'
        WHERE lifecycle_status = 'Published'
          AND bidding_status IN (
              'on_bidding'::shift_bidding_status,
              'on_bidding_normal'::shift_bidding_status,
              'on_bidding_urgent'::shift_bidding_status
          )
          AND assignment_status = 'unassigned'
          AND (
              (start_at IS NOT NULL AND start_at < NOW() + INTERVAL '4 hours')
              OR
              (start_at IS NULL AND
               (shift_date::TEXT || ' ' || start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'Australia/Sydney')
               < NOW() + INTERVAL '4 hours')
          )
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM timed_out;
    IF v_count > 0 THEN operation := 'BIDDING_TIMEOUT'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 3. Auto-start S4/S7 -> S11/S12
    WITH started AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'InProgress',
            updated_at           = NOW(),
            last_modified_reason = 'Auto-started: scheduled start time reached'
        WHERE lifecycle_status = 'Published'
          AND assignment_outcome IN ('confirmed', 'emergency_assigned')
          AND (
              (start_at IS NOT NULL AND start_at <= NOW())
              OR
              (start_at IS NULL AND
               (shift_date::TEXT || ' ' || start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'Australia/Sydney')
               <= NOW())
          )
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM started;
    IF v_count > 0 THEN operation := 'AUTO_START'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 3b. Missing arrival at start + 0m (flips to on_time / late_in if employee punches in later)
    WITH missing_in AS (
        INSERT INTO public.timesheets (
            shift_id,
            employee_id,
            organization_id,
            arrival_track,
            source
        )
        SELECT
            s.id,
            s.assigned_employee_id,
            s.organization_id,
            'missing'::public.attendance_arrival_track,
            'system_timer'
        FROM public.shifts s
        WHERE s.lifecycle_status = 'InProgress'
          AND s.assigned_employee_id IS NOT NULL
          AND NOT s.is_cancelled
          AND (
              (s.start_at IS NOT NULL AND s.start_at <= NOW())
              OR
              (s.start_at IS NULL AND
               (s.shift_date::TEXT || ' ' || s.start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
               <= NOW())
          )
          AND (
              (s.end_at IS NOT NULL AND s.end_at > NOW())
              OR
              (s.end_at IS NULL AND
               ((s.shift_date + s.end_time)
                 + CASE WHEN s.end_time <= s.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
                   AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
               > NOW())
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.leave_requests lr
              WHERE lr.employee_id = s.assigned_employee_id
                AND lr.status = 'approved'
                AND s.shift_date BETWEEN lr.start_date::date AND lr.end_date::date
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.timesheets t
              WHERE t.shift_id = s.id AND t.arrival_track IS NOT NULL
          )
        ON CONFLICT (shift_id) DO UPDATE
          SET arrival_track = 'missing'::public.attendance_arrival_track,
              updated_at    = NOW()
        WHERE public.timesheets.clock_in IS NULL
          AND public.timesheets.arrival_track IS NULL
        RETURNING shift_id
    )
    SELECT COUNT(*) INTO v_count FROM missing_in;
    IF v_count > 0 THEN operation := 'MISSING_ARRIVAL'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 4. Auto-complete S11/S12 -> S13/S14 (for shifts without an open punch)
    WITH completed AS (
        UPDATE public.shifts s SET
            lifecycle_status     = 'Completed',
            updated_at           = NOW(),
            last_modified_reason = 'Auto-completed: scheduled end time reached'
        WHERE s.lifecycle_status = 'InProgress'
          AND (
              (s.end_at IS NOT NULL AND s.end_at <= NOW())
              OR
              (s.end_at IS NULL AND
               ((s.shift_date + s.end_time)
                 + CASE WHEN s.end_time <= s.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
                   AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
               <= NOW())
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.timesheets t
              WHERE t.shift_id = s.id
                AND t.clock_in IS NOT NULL
                AND t.clock_out IS NULL
          )
        RETURNING s.id
    )
    SELECT COUNT(*) INTO v_count FROM completed;
    IF v_count > 0 THEN operation := 'AUTO_COMPLETE'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 5. Expire in-flight swap requests S9/S10 -> S4 at T-4h (+ their child offers).
    WITH expired_swaps AS (
        UPDATE public.shift_swaps sw SET
            status     = 'EXPIRED',
            updated_at = NOW()
        FROM public.shifts rs
        WHERE rs.id = sw.requester_shift_id
          AND sw.status IN ('OPEN', 'MANAGER_PENDING', 'OFFER_SELECTED')
          AND (
              (sw.expires_at IS NOT NULL AND sw.expires_at < NOW())
              OR
              (rs.start_at IS NOT NULL AND rs.start_at < NOW() + INTERVAL '4 hours')
              OR
              (rs.start_at IS NULL AND
               (rs.shift_date::TEXT || ' ' || rs.start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(rs.timezone, 'Australia/Sydney')
               < NOW() + INTERVAL '4 hours')
          )
        RETURNING sw.id, sw.requester_shift_id, sw.target_shift_id
    ),
    expired_offers AS (
        UPDATE public.swap_offers so SET
            status     = 'EXPIRED',
            updated_at = NOW()
        FROM expired_swaps e
        WHERE so.swap_request_id = e.id
          AND so.status IN ('SUBMITTED', 'SELECTED')
        RETURNING so.id
    ),
    to_revert AS (
        SELECT DISTINCT ON (s.id)
               s.id,
               s.assigned_employee_id,
               public.get_shift_fsm_state(s.lifecycle_status, s.assignment_status, s.assignment_outcome, s.trading_status, s.is_cancelled, s.bidding_status) AS from_state,
               public.get_shift_fsm_state(s.lifecycle_status, s.assignment_status, s.assignment_outcome, 'NoTrade'::public.shift_trading, s.is_cancelled, s.bidding_status) AS to_state
        FROM public.shifts s
        JOIN expired_swaps e ON s.id IN (e.requester_shift_id, e.target_shift_id)
        WHERE s.trading_status IN ('TradeRequested', 'TradeAccepted')
    ),
    reverted AS (
        UPDATE public.shifts s SET
            trading_status       = 'NoTrade',
            trade_requested_at   = NULL,
            updated_at           = NOW(),
            last_modified_reason = 'Swap request expired: not concluded before T-4h — reverted to confirmed (S4)'
        FROM to_revert t
        WHERE s.id = t.id
        RETURNING s.id
    ),
    logged AS (
        INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role, domain)
        SELECT t.id, t.assigned_employee_id, 'OP_APPLIED', NOW(),
               jsonb_build_object('op', 'trade_expired', 'domain', 'trade',
                                  'from_state', t.from_state, 'to_state', t.to_state,
                                  'reason', 'Swap request expired: not concluded before T-4h — reverted to confirmed (S4)',
                                  'source', 'process_shift_timers'),
               'system', 'trade'
        FROM to_revert t
        ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM expired_swaps;
    IF v_count > 0 THEN operation := 'SWAP_EXPIRED'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 6. No-show at end + 0m: shift has ENDED and nobody clocked in (unless on approved leave).
    WITH eligible_no_shows AS (
        SELECT
            s.id AS shift_id,
            s.assigned_employee_id AS employee_id,
            s.organization_id,
            public.get_shift_fsm_state(
                s.lifecycle_status, s.assignment_status, s.assignment_outcome,
                s.trading_status, s.is_cancelled, s.bidding_status
            ) AS from_state
        FROM public.shifts s
        LEFT JOIN public.timesheets t ON t.shift_id = s.id
        WHERE s.lifecycle_status IN ('InProgress', 'Completed')
          AND s.assigned_employee_id IS NOT NULL
          AND NOT s.is_cancelled
          AND t.clock_in IS NULL
          AND t.clock_out IS NULL
          AND COALESCE(t.is_no_show, false) = false
          AND (
              (s.end_at IS NOT NULL AND s.end_at <= NOW())
              OR
              (s.end_at IS NULL AND
               ((s.shift_date + s.end_time)
                 + CASE WHEN s.end_time <= s.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
                   AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
               <= NOW())
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.leave_requests lr
              WHERE lr.employee_id = s.assigned_employee_id
                AND lr.status = 'approved'
                AND s.shift_date BETWEEN lr.start_date::date AND lr.end_date::date
          )
    ),
    upserted_ts AS (
        INSERT INTO public.timesheets (
            shift_id,
            employee_id,
            organization_id,
            arrival_track,
            departure_track,
            source
        )
        SELECT
            e.shift_id,
            e.employee_id,
            e.organization_id,
            'missing'::public.attendance_arrival_track,
            'missing'::public.attendance_departure_track,
            'system_timer'
        FROM eligible_no_shows e
        ON CONFLICT (shift_id) DO UPDATE
          SET arrival_track   = 'missing'::public.attendance_arrival_track,
              departure_track = 'missing'::public.attendance_departure_track,
              updated_at      = NOW()
        WHERE public.timesheets.clock_in IS NULL
          AND public.timesheets.clock_out IS NULL
        RETURNING shift_id, employee_id
    ),
    logged_no_shows AS (
        INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
        SELECT
            u.shift_id,
            u.employee_id,
            'NO_SHOW'::public.shift_event_type,
            NOW(),
            jsonb_build_object('from_state', e.from_state, 'to_state', e.from_state, 'source', 'process_shift_timers')
        FROM upserted_ts u
        JOIN eligible_no_shows e ON e.shift_id = u.shift_id
        ON CONFLICT (shift_id, employee_id, event_type, event_time) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM upserted_ts;
    IF v_count > 0 THEN operation := 'NO_SHOW'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 7. Missing departure at end + 0m: clocked in, scheduled end reached, no clock-out yet.
    --    (Auto-clockout is intentionally retired: clock_out remains NULL until worker punches out
    --    or manager supplies billable_end on public.billables.)
    WITH missing_out AS (
        UPDATE public.timesheets t SET
            departure_track = 'missing'::public.attendance_departure_track,
            updated_at      = NOW()
        FROM public.shifts s
        WHERE s.id = t.shift_id
          AND s.lifecycle_status IN ('InProgress', 'Completed')
          AND NOT s.is_cancelled
          AND t.clock_in IS NOT NULL
          AND t.clock_out IS NULL
          AND t.departure_track IS NULL
          AND (
              (s.end_at IS NOT NULL AND s.end_at <= NOW())
              OR
              (s.end_at IS NULL AND
               ((s.shift_date + s.end_time)
                 + CASE WHEN s.end_time <= s.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
                   AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
               <= NOW())
          )
        RETURNING t.shift_id
    )
    SELECT COUNT(*) INTO v_count FROM missing_out;
    IF v_count > 0 THEN operation := 'MISSING_DEPARTURE'; affected := v_count; RETURN NEXT; END IF;
END;
$function$;

-- 6j. Analytics, Planner Stats, Snapshots & User Purge Functions
CREATE OR REPLACE FUNCTION public.delete_user_entirely(user_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Users can only be deleted from the database, not from the app.';
  END IF;

  PERFORM set_config('app.shift_purge', 'user', true);
  DELETE FROM public.shifts WHERE assigned_employee_id = user_uuid;
  PERFORM set_config('app.shift_purge', '', true);
  UPDATE public.billables SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.billables SET payroll_exported_by = NULL WHERE payroll_exported_by = user_uuid;
  UPDATE public.rosters SET published_by = NULL, created_by = NULL WHERE published_by = user_uuid OR created_by = user_uuid;
  UPDATE public.availabilities SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.shift_swaps SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.leave_requests SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.roster_templates
     SET last_edited_by = NULL, published_by = NULL, created_by = NULL
   WHERE last_edited_by = user_uuid OR published_by = user_uuid OR created_by = user_uuid;
  UPDATE public.app_access_certificates SET created_by = NULL WHERE created_by = user_uuid;
  UPDATE public.roster_template_batches SET applied_by = NULL WHERE applied_by = user_uuid;
  UPDATE public.shift_bids SET reviewed_by = NULL WHERE reviewed_by = user_uuid;

  DELETE FROM public.cancellation_history WHERE employee_id = user_uuid;
  DELETE FROM public.billables WHERE employee_id = user_uuid;
  DELETE FROM public.timesheets WHERE employee_id = user_uuid;
  DELETE FROM public.autoschedule_assignments WHERE employee_id = user_uuid;
  DELETE FROM public.leave_requests WHERE employee_id = user_uuid;
  DELETE FROM public.app_access_certificates WHERE user_id = user_uuid;
  DELETE FROM public.user_contracts WHERE user_id = user_uuid;

  DELETE FROM public.profiles WHERE id = user_uuid;
  DELETE FROM auth.users WHERE id = user_uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_dept_insights_breakdown(
  p_start_date date,
  p_end_date date,
  p_org_ids uuid[] DEFAULT NULL::uuid[],
  p_dept_ids uuid[] DEFAULT NULL::uuid[],
  p_subdept_ids uuid[] DEFAULT NULL::uuid[]
)
 RETURNS TABLE(dept_id uuid, dept_name text, shifts_total integer, shifts_assigned integer, fill_rate numeric, no_show_count integer, emergency_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        s.department_id,
        d.name,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)::int,
        ROUND(CASE WHEN COUNT(*)=0 THEN 0 ELSE COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)::numeric/COUNT(*)*100 END,1),
        COUNT(*) FILTER (WHERE COALESCE(t.is_no_show, false) OR b.status = 'no_show' OR s.assignment_outcome = 'no_show')::int,
        COUNT(*) FILTER (WHERE s.assignment_outcome = 'emergency_assigned')::int
    FROM public.shifts s
    LEFT JOIN public.departments d ON d.id = s.department_id
    LEFT JOIN public.timesheets t ON t.shift_id = s.id
    LEFT JOIN public.billables b ON b.shift_id = s.id
    WHERE s.shift_date BETWEEN p_start_date AND p_end_date
      AND s.lifecycle_status != 'Draft'
      AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
      AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
      AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))
    GROUP BY s.department_id, d.name
    ORDER BY d.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_insights_summary(
  p_start_date date,
  p_end_date date,
  p_org_ids uuid[] DEFAULT NULL::uuid[],
  p_dept_ids uuid[] DEFAULT NULL::uuid[],
  p_subdept_ids uuid[] DEFAULT NULL::uuid[]
)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
    v_total       int; v_published   int; v_assigned    int;
    v_cancelled   int; v_completed   int; v_no_show     int;
    v_emergency   int; v_sched_hrs   numeric;
    v_comp_over   int;
BEGIN
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE s.lifecycle_status IN ('Published', 'InProgress', 'Completed')),
        COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL),
        COUNT(*) FILTER (WHERE s.is_cancelled = true),
        COUNT(*) FILTER (WHERE s.lifecycle_status = 'Completed'),
        COUNT(*) FILTER (WHERE COALESCE(t.is_no_show, false)
                            OR b.status = 'no_show'
                            OR s.assignment_outcome = 'no_show'),
        COUNT(*) FILTER (WHERE s.assignment_outcome = 'emergency_assigned'),
        COALESCE(SUM(COALESCE(s.net_length_minutes,0)::numeric / 60)
            FILTER (WHERE s.assigned_employee_id IS NOT NULL), 0)
    INTO
        v_total, v_published, v_assigned, v_cancelled,
        v_completed, v_no_show, v_emergency, v_sched_hrs
    FROM public.shifts s
    LEFT JOIN public.timesheets t ON t.shift_id = s.id
    LEFT JOIN public.billables b ON b.shift_id = s.id
    WHERE s.shift_date BETWEEN p_start_date AND p_end_date
      AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
      AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
      AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids));

    SELECT COUNT(*) INTO v_comp_over
    FROM public.shifts s
    JOIN public.shift_compliance_snapshots scs ON scs.shift_id = s.id
    WHERE scs.is_overridden = true
      AND s.shift_date BETWEEN p_start_date AND p_end_date
      AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
      AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
      AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids));

    RETURN json_build_object(
        'shifts_total',          COALESCE(v_total, 0),
        'shifts_published',      COALESCE(v_published, 0),
        'shifts_assigned',       COALESCE(v_assigned, 0),
        'shifts_unassigned',     GREATEST(0, COALESCE(v_total,0) - COALESCE(v_assigned,0) - COALESCE(v_cancelled,0)),
        'shifts_cancelled',      COALESCE(v_cancelled, 0),
        'shifts_completed',      COALESCE(v_completed, 0),
        'shifts_no_show',        COALESCE(v_no_show, 0),
        'shifts_emergency',      COALESCE(v_emergency, 0),
        'scheduled_hours',       COALESCE(v_sched_hrs, 0),
        'shift_fill_rate',       CASE WHEN COALESCE(v_total,0) = 0 THEN 0
                                      ELSE ROUND(v_assigned::numeric / v_total * 100, 1) END,
        'compliance_overrides',  COALESCE(v_comp_over, 0),
        'no_show_rate',          CASE WHEN COALESCE(v_assigned,0) = 0 THEN 0
                                      ELSE ROUND(v_no_show::numeric / v_assigned * 100, 1) END
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_metric_detailed_analysis(
  p_metric_id text,
  p_start_date date,
  p_end_date date,
  p_org_ids uuid[] DEFAULT NULL::uuid[],
  p_dept_ids uuid[] DEFAULT NULL::uuid[]
)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_current_val text;
    v_target_val text;
    v_trend text;
    v_summary text;
    v_details text;
    v_chart_data jsonb;
    v_recs text[];
    v_title text;
    v_chart_type text := 'line';
BEGIN
    v_recs := ARRAY['Review staff availability patterns', 'Analyze demand variance by day-of-week', 'Consider automated notifications for schedule changes'];

    IF p_metric_id = 'shift-fill-rate' THEN
        v_title := 'Shift Fill Rate Analysis';
        WITH daily AS (
            SELECT shift_date as d, COUNT(*) as t, COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL) as f
            FROM shifts WHERE shift_date BETWEEN p_start_date AND p_end_date AND lifecycle_status != 'Draft'
            AND (p_org_ids IS NULL OR organization_id = ANY(p_org_ids)) AND (p_dept_ids IS NULL OR department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(f::numeric/NULLIF(t,0)*100,1))) INTO v_chart_data FROM daily;

        SELECT ROUND(COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)::numeric/NULLIF(COUNT(*),0)*100,1)::text INTO v_current_val
        FROM shifts WHERE shift_date BETWEEN p_start_date AND p_end_date AND lifecycle_status != 'Draft'
        AND (p_org_ids IS NULL OR organization_id = ANY(p_org_ids)) AND (p_dept_ids IS NULL OR department_id = ANY(p_dept_ids));

        v_target_val := '95%';
        v_summary := 'Current fill rate is ' || COALESCE(v_current_val, '0') || '% across the selected period.';
        v_details := 'Shift fill rate tracks the percentage of published shifts that have an assigned employee. Falling below 90% typically indicates a recruitment need or a mismatch between staff availability and roster demand.';

    ELSIF p_metric_id = 'no-show-rate' THEN
        v_title := 'No-Show Rate Analysis';
        WITH daily AS (
            SELECT s.shift_date as d,
                   COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL) as a,
                   COUNT(*) FILTER (WHERE COALESCE(t.is_no_show, false) OR b.status = 'no_show' OR s.assignment_outcome = 'no_show') as n
            FROM shifts s
            LEFT JOIN timesheets t ON t.shift_id = s.id
            LEFT JOIN billables b ON b.shift_id = s.id
            WHERE s.shift_date BETWEEN p_start_date AND p_end_date
              AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
              AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(n::numeric/NULLIF(a,0)*100,1))) INTO v_chart_data FROM daily;

        SELECT ROUND(
          COUNT(*) FILTER (WHERE COALESCE(t.is_no_show, false) OR b.status = 'no_show' OR s.assignment_outcome = 'no_show')::numeric
          / NULLIF(COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL), 0) * 100, 1
        )::text INTO v_current_val
        FROM shifts s
        LEFT JOIN timesheets t ON t.shift_id = s.id
        LEFT JOIN billables b ON b.shift_id = s.id
        WHERE s.shift_date BETWEEN p_start_date AND p_end_date
          AND s.assigned_employee_id IS NOT NULL
          AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
          AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids));

        v_target_val := '<2%';
        v_summary := 'The average no-show rate is ' || COALESCE(v_current_val, '0') || '%.';
        v_details := 'A high no-show rate is a critical indicator of poor employee engagement or scheduling conflicts. Investigate specific departments or roles with recurring issues.';

    ELSIF p_metric_id = 'attendance-compliance-rate' THEN
        v_title := 'Attendance Compliance Analysis';
        WITH daily AS (
            SELECT s.shift_date AS d,
                   COUNT(*) FILTER (WHERE s.end_reason = 'worked') AS w,
                   COUNT(*) FILTER (WHERE s.end_reason = 'worked' AND NOT s.late_in AND NOT s.early_out) AS ok
            FROM assignment_snapshots s
            WHERE s.shift_date BETWEEN p_start_date AND p_end_date
              AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
              AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(ok::numeric/NULLIF(w,0)*100,1))) INTO v_chart_data FROM daily;
        SELECT ROUND(COUNT(*) FILTER (WHERE s.end_reason = 'worked' AND NOT s.late_in AND NOT s.early_out)::numeric
                     / NULLIF(COUNT(*) FILTER (WHERE s.end_reason = 'worked'),0) * 100, 1)::text
        INTO v_current_val
        FROM assignment_snapshots s
        WHERE s.shift_date BETWEEN p_start_date AND p_end_date
          AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
          AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids));
        v_target_val := '95%';
        v_summary := 'Attendance compliance is ' || COALESCE(v_current_val, '0') || '% across the selected period.';
        v_details := 'Counts shifts that were worked AND clocked in on time AND clocked out on time, over shifts worked. The grace window is 7.5 minutes either side of schedule.';
        v_recs := ARRAY['Check whether late starts cluster on particular shift times', 'Review sites with repeated missing clock-outs', 'Confirm rosters give enough travel time between venues'];

    ELSIF p_metric_id = 'cancellation-rate' THEN
        v_title := 'Cancellation Analysis';
        WITH weekly AS (
            SELECT date_trunc('week', s.shift_date::timestamp)::date AS d,
                   COUNT(*) AS held,
                   COUNT(*) FILTER (WHERE s.end_reason IN ('dropped_std','dropped_late')) AS c
            FROM assignment_snapshots s
            WHERE s.shift_date BETWEEN p_start_date AND p_end_date
              AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
              AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(c::numeric/NULLIF(held,0)*100,1))) INTO v_chart_data FROM weekly;
        SELECT ROUND(COUNT(*) FILTER (WHERE s.end_reason IN ('dropped_std','dropped_late'))::numeric
                     / NULLIF(COUNT(*),0) * 100, 1)::text
        INTO v_current_val
        FROM assignment_snapshots s
        WHERE s.shift_date BETWEEN p_start_date AND p_end_date
          AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
          AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids));
        v_target_val := '5%';
        v_summary := 'Cancellation rate is ' || COALESCE(v_current_val, '0') || '% of shifts held.';
        v_details := 'Shifts released by the person holding them, over all shifts held. Two kinds, split at 24 hours notice: standard above, critical at or below. 4 hours is a different line entirely - the urgent/emergent boundary, where exchange operations are blocked.';
        v_recs := ARRAY['Look at the reason distribution before the rate', 'Critical cancellations matter more than the total', 'Check whether one sub-department carries most of them'];
        v_chart_type := 'bar';

    ELSIF p_metric_id = 'open-shift-award-rate' THEN
        v_title := 'Open-Shift Award Analysis';
        WITH weekly AS (
            SELECT date_trunc('week', s.shift_date::timestamp)::date AS d,
                   COUNT(DISTINCT s.id) AS opened,
                   COUNT(DISTINCT sb.shift_id) FILTER (WHERE sb.status = 'accepted') AS won
            FROM shifts s
            LEFT JOIN shift_bids sb ON sb.shift_id = s.id
            WHERE s.shift_date BETWEEN p_start_date AND p_end_date
              AND s.bidding_status NOT IN ('not_on_bidding','bidding_closed_no_winner')
              AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
              AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(won::numeric/NULLIF(opened,0)*100,1))) INTO v_chart_data FROM weekly;
        SELECT ROUND(COUNT(DISTINCT sb.shift_id) FILTER (WHERE sb.status = 'accepted')::numeric
                     / NULLIF(COUNT(DISTINCT s.id),0) * 100, 1)::text
        INTO v_current_val
        FROM shifts s
        LEFT JOIN shift_bids sb ON sb.shift_id = s.id
        WHERE s.shift_date BETWEEN p_start_date AND p_end_date
          AND s.bidding_status NOT IN ('not_on_bidding','bidding_closed_no_winner')
          AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
          AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids));
        v_target_val := '80%';
        v_summary := 'Open-shift award rate is ' || COALESCE(v_current_val, '0') || '% across the selected period.';
        v_details := 'Open bidding shifts that ended with a winner selected. Distinct from bid win rate, which is winners over ALL bids placed and falls as competition per shift rises.';
        v_recs := ARRAY['Check shifts that expired without a single bid first', 'Compare bids per shift against award rate', 'Review whether urgent shifts are opening late'];
        v_chart_type := 'bar';

    ELSIF p_metric_id = 'swap-completion-rate' THEN
        v_title := 'Swap Completion Analysis';
        WITH weekly AS (
            SELECT date_trunc('week', s.shift_date::timestamp)::date AS d,
                   COUNT(sr.id) AS started,
                   COUNT(*) FILTER (WHERE sr.status = 'approved') AS done
            FROM shifts s
            JOIN swap_requests sr ON sr.original_shift_id = s.id
            WHERE s.shift_date BETWEEN p_start_date AND p_end_date
              AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
              AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(done::numeric/NULLIF(started,0)*100,1))) INTO v_chart_data FROM weekly;
        SELECT ROUND(COUNT(*) FILTER (WHERE sr.status = 'approved')::numeric / NULLIF(COUNT(sr.id),0) * 100, 1)::text
        INTO v_current_val
        FROM shifts s
        JOIN swap_requests sr ON sr.original_shift_id = s.id
        WHERE s.shift_date BETWEEN p_start_date AND p_end_date
          AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
          AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids));
        v_target_val := '75%';
        v_summary := 'Swap completion rate is ' || COALESCE(v_current_val, '0') || '% of swaps initiated.';
        v_details := 'Swaps that reached an approved completion, over swaps initiated. The shortfall splits into manager rejections, requester withdrawals and expiries, each pointing at a different fix.';
        v_recs := ARRAY['Find which stage the pipeline leaks at before acting', 'Expiries suggest nobody saw the request', 'Manager rejections suggest a compliance or cost block'];
        v_chart_type := 'bar';

    ELSE
        v_title := initcap(replace(p_metric_id, '-', ' '));
        v_current_val := '—';
        v_target_val := '—';
        v_summary := 'Detailed analysis for ' || v_title || ' is pending full database migration.';
        v_details := 'We are currently mapping historical events to this metric. Please check back as more data points are indexed.';
        v_chart_data := '[]'::jsonb;
    END IF;

    v_trend := 'stable';

    RETURN json_build_object(
        'title', v_title,
        'summary', v_summary,
        'details', v_details,
        'metrics', jsonb_build_object(
            'current', COALESCE(v_current_val, '0'),
            'target', COALESCE(v_target_val, '—'),
            'trend', v_trend
        ),
        'chartData', COALESCE(v_chart_data, '[]'::jsonb),
        'chartType', v_chart_type,
        'recommendations', v_recs
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_roster_planner_stats(
  p_organization_id uuid,
  p_start_date date,
  p_end_date date,
  p_department_ids uuid[] DEFAULT NULL::uuid[],
  p_sub_department_ids uuid[] DEFAULT NULL::uuid[]
)
 RETURNS TABLE(total_shifts integer, assigned_shifts integer, open_shifts integer, published_shifts integer, cancelled_shifts integer, total_net_minutes bigint, unique_employees integer, actual_net_minutes bigint, actual_shifts integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH scoped AS (
      SELECT
          s.*,
          CASE
              WHEN b.billable_start IS NOT NULL AND b.billable_end IS NOT NULL THEN
                  GREATEST(0, (EXTRACT(EPOCH FROM (
                      (s.shift_date + b.billable_end)
                        + CASE WHEN b.billable_end <= b.billable_start
                               THEN INTERVAL '1 day' ELSE INTERVAL '0' END
                        - (s.shift_date + b.billable_start)
                  )) / 60)::int - COALESCE(b.unpaid_break_minutes, s.unpaid_break_minutes, 0))
              WHEN t.clock_in IS NOT NULL AND t.clock_out IS NOT NULL THEN
                  GREATEST(0, (EXTRACT(EPOCH FROM (t.clock_out - t.clock_in)) / 60)::int
                              - COALESCE(b.unpaid_break_minutes, s.unpaid_break_minutes, 0))
              ELSE NULL
          END AS worked_minutes
      FROM public.shifts s
      LEFT JOIN public.timesheets t ON t.shift_id = s.id
      LEFT JOIN public.billables b ON b.shift_id = s.id
      WHERE s.organization_id = p_organization_id
        AND s.shift_date BETWEEN p_start_date AND p_end_date
        AND (p_department_ids IS NULL OR s.department_id = ANY(p_department_ids))
        AND (p_sub_department_ids IS NULL OR s.sub_department_id = ANY(p_sub_department_ids))
  )
  SELECT
      COUNT(*) FILTER (WHERE NOT is_cancelled)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NULL)::int,
      COUNT(*) FILTER (WHERE lifecycle_status IN ('Published','InProgress','Completed'))::int,
      COUNT(*) FILTER (WHERE is_cancelled)::int,
      COALESCE(SUM(net_length_minutes) FILTER (WHERE NOT is_cancelled), 0)::bigint,
      COUNT(DISTINCT assigned_employee_id) FILTER (WHERE NOT is_cancelled)::int,
      COALESCE(SUM(worked_minutes) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL), 0)::bigint,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL)::int
  FROM scoped;
$function$;

CREATE OR REPLACE FUNCTION public.sm_refresh_shift_snapshots(p_shift_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF p_shift_id IS NULL THEN
        RETURN;
    END IF;

    DELETE FROM public.assignment_snapshots WHERE shift_id = p_shift_id;

    INSERT INTO public.assignment_snapshots (
        shift_id, episode_seq, employee_id, source,
        became_active_at, ended_at, end_reason,
        attended, late_in, early_out, is_current,
        organization_id, department_id, sub_department_id,
        shift_date, scheduled_start, refreshed_at,
        early_in, late_out, on_time_in, on_time_out, auto_clock_out
    )
    WITH
    late_cancel_threshold AS (
        SELECT interval '4 hours' AS val
    ),
    ordered_events AS (
        SELECT
            se.id           AS event_id,
            se.shift_id,
            se.employee_id,
            se.event_type,
            se.event_time,
            se.metadata
        FROM public.shift_events se
        WHERE se.shift_id = p_shift_id
          AND se.employee_id IS NOT NULL
    ),
    classified AS (
        SELECT
            oe.*,
            (oe.event_type IN ('ASSIGNED','OFFERED','EMERGENCY_ASSIGNED','SWAPPED_IN')) AS is_opening_type,
            (oe.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                               'SWAPPED_OUT','NO_SHOW','UNASSIGNED'))                    AS is_closing_type
        FROM ordered_events oe
    ),
    boundary_events AS (
        SELECT
            c.shift_id,
            c.event_id,
            c.event_time,
            c.employee_id,
            c.is_opening_type,
            LAG(c.is_closing_type) OVER w AS prev_boundary_was_closing,
            LAG(c.employee_id)     OVER w AS prev_boundary_employee
        FROM classified c
        WHERE c.is_opening_type OR c.is_closing_type
        WINDOW w AS (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id)
    ),
    boundary_starts AS (
        SELECT
            be.shift_id,
            be.event_id,
            CASE
                WHEN be.is_opening_type AND (
                         be.prev_boundary_employee IS NULL
                      OR be.prev_boundary_was_closing
                      OR be.employee_id IS DISTINCT FROM be.prev_boundary_employee
                     )
                THEN 1 ELSE 0
            END AS starts_new_episode
        FROM boundary_events be
    ),
    episode_assigned AS (
        SELECT
            c.*,
            SUM(COALESCE(bs.starts_new_episode, 0))
                OVER (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS episode_seq
        FROM classified c
        LEFT JOIN boundary_starts bs
               ON bs.shift_id = c.shift_id AND bs.event_id = c.event_id
    ),
    episode_agg AS (
        SELECT
            ea.shift_id,
            ea.episode_seq,
            (ARRAY_AGG(ea.employee_id ORDER BY ea.event_time, ea.event_id))[1] AS employee_id,
            MIN(ea.event_time) AS opened_at,
            MIN(ea.event_time) FILTER (
                WHERE ea.event_type IN ('ACCEPTED','EMERGENCY_ASSIGNED','SWAPPED_IN')
            ) AS became_active_at,
            BOOL_OR(ea.event_type = 'OFFERED')              AS had_offer,
            BOOL_OR(ea.event_type = 'ACCEPTED')             AS had_accept,
            BOOL_OR(ea.event_type = 'ASSIGNED')             AS had_assign,
            BOOL_OR(ea.event_type = 'EMERGENCY_ASSIGNED')    AS had_emergency,
            BOOL_OR(ea.event_type = 'SWAPPED_IN')            AS had_swap_in,
            BOOL_OR(ea.event_type = 'CHECKED_IN')            AS had_checked_in,
            BOOL_OR(ea.event_type = 'LATE_IN')               AS had_late_in_event,
            BOOL_OR(ea.event_type = 'EARLY_OUT')             AS had_early_out_event,
            (ARRAY_AGG(ea.event_type ORDER BY ea.event_time DESC, ea.event_id DESC)
                FILTER (WHERE ea.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                                 'SWAPPED_OUT','NO_SHOW','UNASSIGNED')))[1]
                AS closing_event_type,
            (ARRAY_AGG(ea.event_time ORDER BY ea.event_time DESC, ea.event_id DESC)
                FILTER (WHERE ea.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                                 'SWAPPED_OUT','NO_SHOW','UNASSIGNED')))[1]
                AS closing_event_time
        FROM episode_assigned ea
        WHERE ea.episode_seq > 0
        GROUP BY ea.shift_id, ea.episode_seq
    ),
    episode_with_shift AS (
        SELECT
            ep.*,
            MAX(ep.episode_seq) OVER (PARTITION BY ep.shift_id) AS max_episode_seq,
            s.shift_date,
            s.organization_id,
            s.department_id,
            s.sub_department_id,
            s.lifecycle_status,
            s.start_at AS scheduled_start,
            s.end_at AS scheduled_end,
            lct.val AS late_cancel_threshold
        FROM episode_agg ep
        JOIN public.shifts s ON s.id = ep.shift_id
        CROSS JOIN late_cancel_threshold lct
    ),
    episode_final AS (
        SELECT
            ews.shift_id,
            ews.episode_seq,
            ews.employee_id,
            ews.opened_at,
            ews.became_active_at,
            ews.closing_event_time AS closed_at,
            CASE
                WHEN ews.closing_event_type = 'REJECTED'       THEN 'rejected'
                WHEN ews.closing_event_type = 'IGNORED'        THEN 'ignored'
                WHEN ews.closing_event_type = 'SWAPPED_OUT'    THEN 'swapped_out'
                WHEN ews.closing_event_type = 'NO_SHOW'        THEN 'no_show'
                WHEN ews.closing_event_type = 'UNASSIGNED'     THEN 'unassigned'
                WHEN ews.closing_event_type IN ('CANCELLED', 'LATE_CANCELLED') THEN
                    CASE
                        WHEN ews.scheduled_start IS NOT NULL
                             AND ews.closing_event_time IS NOT NULL
                             AND (ews.scheduled_start - ews.closing_event_time) <= ews.late_cancel_threshold
                        THEN 'cancelled_late'
                        ELSE 'cancelled_standard'
                    END
                WHEN ews.closing_event_type IS NULL
                     AND ews.lifecycle_status = 'Completed'
                     AND ews.episode_seq = ews.max_episode_seq THEN 'fulfilled'
                ELSE 'open'
            END AS terminal_outcome,
            ews.had_accept,
            ews.had_emergency,
            ews.had_swap_in,
            COALESCE(ews.had_checked_in, FALSE) AS attended_from_events,
            COALESCE(ews.had_late_in_event, FALSE) AS late_in_from_events,
            COALESCE(ews.had_early_out_event, FALSE) AS early_out_from_events,
            ews.shift_date,
            ews.organization_id,
            ews.department_id,
            ews.sub_department_id,
            ews.scheduled_start,
            ews.scheduled_end
        FROM episode_with_shift ews
    ),
    ts_agg AS (
        SELECT
            s.id AS shift_id,
            COALESCE(ts.employee_id, b.employee_id) AS employee_id,
            MIN(ts.clock_in)  AS clock_in,
            MAX(ts.clock_out) AS clock_out,
            MIN(
                COALESCE(
                    (s.shift_date + b.billable_start) AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney'),
                    ts.clock_in
                )
            ) AS effective_clock_in,
            MAX(
                COALESCE(
                    (CASE
                        WHEN b.billable_end IS NOT NULL AND b.billable_end < COALESCE(b.billable_start, s.start_time)
                            THEN s.shift_date + interval '1 day' + b.billable_end
                        WHEN b.billable_end IS NOT NULL
                            THEN s.shift_date + b.billable_end
                        ELSE NULL
                     END) AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney'),
                    ts.clock_out
                )
            ) AS effective_clock_out
        FROM public.shifts s
        LEFT JOIN public.timesheets ts ON ts.shift_id = s.id
        LEFT JOIN public.billables b ON b.shift_id = s.id
        WHERE s.id = p_shift_id
          AND (ts.id IS NOT NULL OR b.id IS NOT NULL)
        GROUP BY s.id, COALESCE(ts.employee_id, b.employee_id)
    ),
    episodes_for_shift AS (
        SELECT
            ef.shift_id,
            ef.episode_seq,
            ef.employee_id,
            ef.opened_at,
            ef.closed_at,
            ef.terminal_outcome,
            ef.had_accept,
            ef.had_emergency,
            ef.had_swap_in,
            (ef.attended_from_events OR t.clock_in IS NOT NULL) AS attended,
            (ef.late_in_from_events
                OR (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
                    AND t.effective_clock_in > ef.scheduled_start + interval '7.5 minutes')
            ) AS late_in,
            (ef.early_out_from_events
                OR (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
                    AND t.effective_clock_out < ef.scheduled_end - interval '7.5 minutes')
            ) AS early_out,
            ef.shift_date,
            ef.organization_id,
            ef.department_id,
            ef.sub_department_id,
            ef.became_active_at,
            ef.scheduled_start,
            (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
             AND t.effective_clock_in < ef.scheduled_start - interval '7.5 minutes'
            ) AS early_in,
            (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
             AND t.effective_clock_out > ef.scheduled_end + interval '7.5 minutes'
            ) AS late_out,
            (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
             AND t.effective_clock_in >= ef.scheduled_start - interval '7.5 minutes'
             AND t.effective_clock_in <= ef.scheduled_start + interval '7.5 minutes'
            ) AS on_time_in,
            (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
             AND t.effective_clock_out >= ef.scheduled_end - interval '7.5 minutes'
             AND t.effective_clock_out <= ef.scheduled_end + interval '7.5 minutes'
            ) AS on_time_out
        FROM episode_final ef
        LEFT JOIN ts_agg t
            ON t.shift_id = ef.shift_id
            AND t.employee_id = ef.employee_id
            AND t.effective_clock_in >= ef.opened_at
            AND (ef.closed_at IS NULL OR t.effective_clock_in <= ef.closed_at)
    )
    SELECT
        ep.shift_id,
        ep.episode_seq,
        ep.employee_id,
        CASE
            WHEN ep.had_emergency THEN 'emergency'
            WHEN ep.had_swap_in   THEN 'trade_approve'
            WHEN EXISTS (
                SELECT 1
                FROM public.shift_events se
                WHERE se.shift_id = ep.shift_id
                  AND se.event_type = 'ASSIGNED'
                  AND se.metadata->>'op' = 'select_winner'
                  AND se.event_time >= ep.opened_at
                  AND (ep.closed_at IS NULL OR se.event_time <= ep.closed_at)
            ) THEN 'bid_win'
            ELSE 'publish_confirm'
        END AS source,
        COALESCE(ep.became_active_at, ep.opened_at) AS became_active_at,
        ep.closed_at AS ended_at,
        CASE
            WHEN ep.terminal_outcome = 'fulfilled'          THEN 'worked'
            WHEN ep.terminal_outcome = 'cancelled_standard' THEN 'dropped_std'
            WHEN ep.terminal_outcome = 'cancelled_late'     THEN 'dropped_late'
            WHEN ep.terminal_outcome = 'no_show'            THEN 'no_show'
            WHEN ep.terminal_outcome = 'swapped_out'        THEN 'traded_out'
            WHEN ep.terminal_outcome = 'unassigned'         THEN 'reassigned'
            WHEN ep.terminal_outcome = 'open'
                 AND ep.episode_seq < MAX(ep.episode_seq) OVER (PARTITION BY ep.shift_id)
                                                             THEN 'reassigned'
            WHEN ep.terminal_outcome = 'open'               THEN NULL
            ELSE NULL
        END AS end_reason,
        ep.attended,
        ep.late_in,
        ep.early_out,
        (ep.terminal_outcome = 'open'
            AND ep.episode_seq = MAX(ep.episode_seq) OVER (PARTITION BY ep.shift_id))
                                                            AS is_current,
        ep.organization_id,
        ep.department_id,
        ep.sub_department_id,
        ep.shift_date,
        ep.scheduled_start,
        now() AS refreshed_at,
        ep.early_in,
        ep.late_out,
        ep.on_time_in,
        ep.on_time_out,
        false AS auto_clock_out
    FROM episodes_for_shift ep
    WHERE (ep.had_accept OR ep.had_emergency OR ep.had_swap_in);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 7. Surgically Drop Actuals from public.shifts & Retire Dead Tables / Enum
-- ----------------------------------------------------------------------------

ALTER TABLE public.shifts
  DROP COLUMN IF EXISTS actual_start,
  DROP COLUMN IF EXISTS actual_end,
  DROP COLUMN IF EXISTS attendance_status;

DROP TYPE IF EXISTS public.shift_attendance_status;

DROP TABLE IF EXISTS public.attendance_records CASCADE;
DROP TABLE IF EXISTS public.shift_payroll_records CASCADE;
DROP TABLE IF EXISTS public.gross_pay_records CASCADE;
