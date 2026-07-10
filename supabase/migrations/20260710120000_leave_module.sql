-- =============================================================================
-- Leave Module — balances table + leave_requests enhancements + RLS + triggers
--
-- AUTHORED, NOT APPLIED.
-- Review before applying: supabase db push --dry-run
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. leave_balances — per-employee, per-leave-type balance tracking
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_balances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  leave_type      text NOT NULL,
  balance_hours   numeric(8,2) NOT NULL DEFAULT 0,
  accrued_hours   numeric(8,2) NOT NULL DEFAULT 0,
  used_hours      numeric(8,2) NOT NULL DEFAULT 0,
  as_of_date      date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),

  UNIQUE (employee_id, leave_type),

  CONSTRAINT valid_leave_type CHECK (
    leave_type IN (
      'annual', 'personal', 'carer', 'compassionate', 'parental',
      'long_service', 'jury_duty', 'fdv', 'supporting_carer',
      'community_service', 'unpaid'
    )
  ),
  CONSTRAINT non_negative_balance CHECK (balance_hours >= 0),
  CONSTRAINT non_negative_accrued CHECK (accrued_hours >= 0),
  CONSTRAINT non_negative_used CHECK (used_hours >= 0)
);

-- Index for employee lookups
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee
  ON leave_balances (employee_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Enhance leave_requests with structured columns
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leave_requests' AND column_name = 'requested_hours') THEN
    ALTER TABLE leave_requests ADD COLUMN requested_hours numeric(8,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leave_requests' AND column_name = 'certificate_url') THEN
    ALTER TABLE leave_requests ADD COLUMN certificate_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leave_requests' AND column_name = 'rejection_reason') THEN
    ALTER TABLE leave_requests ADD COLUMN rejection_reason text;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Accrual function — contract-based daily pro-rata continuous accrual
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accrue_leave_balances()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- We loop through all active user_contracts to accrue day-by-day to handle gaps.
  -- But for a simple cron, updating by the number of elapsed days since as_of_date is better.
  --
  -- Accrual bases (non-casual only):
  --   * Standard permanents .... contracted_weekly_hours (default 38)
  --   * Flexible part-time ..... trailing 12-week average of actually-worked hours
  --                              (cl 12.4(b): no guaranteed weekly hours, so contracted
  --                              hours would over-accrue); falls back to
  --                              COALESCE(contracted_weekly_hours, 0) with no shift history
  --   * Full-time Security ..... EBA Schedule 3 §8.2/8.3: 5 weeks (210h) annual and
  --                              84h personal per year (identified via
  --                              hr.user_contracts.role_id → hr.roles.name ILIKE '%security%')

  -- Annual leave accrual (standard permanents: not casual, not flex-PT, not FT Security)
  -- 4 weeks per year. Accrual = (contracted_weekly_hours * 4 / 365) * days_elapsed
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 4.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 4.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'annual'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%casual%'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%flex%'
    AND NOT (
      LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
      AND EXISTS (
        SELECT 1 FROM hr.roles r
        WHERE r.id = uc.role_id AND r.name ILIKE '%security%'
      )
    )
    AND lb.as_of_date < CURRENT_DATE;

  -- Personal/sick leave accrual (standard permanents: not casual, not flex-PT, not FT Security)
  -- 10 days per year. Accrual = (contracted_weekly_hours * 2 / 365) * days_elapsed
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 2.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 2.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'personal'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%casual%'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%flex%'
    AND NOT (
      LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
      AND EXISTS (
        SELECT 1 FROM hr.roles r
        WHERE r.id = uc.role_id AND r.name ILIKE '%security%'
      )
    )
    AND lb.as_of_date < CURRENT_DATE;

  -- Flexible part-time annual + personal accrual (cl 12.4(b))
  -- Basis = trailing 12-week (84-day) average of actually-worked weekly hours;
  -- falls back to COALESCE(contracted_weekly_hours, 0) when there is no shift history.
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((wk.weekly_hours * 4.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    accrued_hours = accrued_hours + ((wk.weekly_hours * 4.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN COUNT(s.id) > 0
               THEN SUM(COALESCE(s.net_length_minutes, s.scheduled_length_minutes, 0)) / 60.0 / 12.0
             ELSE COALESCE(uc.contracted_weekly_hours, 0.0)
           END AS weekly_hours
    FROM shifts s
    WHERE s.assigned_employee_id = uc.user_id
      AND s.shift_date >= CURRENT_DATE - 84
      AND s.shift_date < CURRENT_DATE
      AND s.lifecycle_status <> 'Cancelled'
      AND s.deleted_at IS NULL
  ) wk ON true
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'annual'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%flex%'
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((wk.weekly_hours * 2.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    accrued_hours = accrued_hours + ((wk.weekly_hours * 2.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN COUNT(s.id) > 0
               THEN SUM(COALESCE(s.net_length_minutes, s.scheduled_length_minutes, 0)) / 60.0 / 12.0
             ELSE COALESCE(uc.contracted_weekly_hours, 0.0)
           END AS weekly_hours
    FROM shifts s
    WHERE s.assigned_employee_id = uc.user_id
      AND s.shift_date >= CURRENT_DATE - 84
      AND s.shift_date < CURRENT_DATE
      AND s.lifecycle_status <> 'Cancelled'
      AND s.deleted_at IS NULL
  ) wk ON true
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'personal'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%flex%'
    AND lb.as_of_date < CURRENT_DATE;

  -- Full-time Security annual leave accrual (EBA Schedule 3 §8.2)
  -- 5 weeks per year. Accrual = (contracted_weekly_hours * 5 / 365) * days_elapsed
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 5.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 5.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  JOIN hr.roles r ON r.id = uc.role_id
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'annual'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
    AND r.name ILIKE '%security%'
    AND lb.as_of_date < CURRENT_DATE;

  -- Full-time Security personal leave accrual (EBA Schedule 3 §8.3)
  -- 84 hours per year, pro-rata on contracted hours (38h FT → 84h/yr).
  -- Accrual = (contracted_weekly_hours * 84 / 38 / 365) * days_elapsed
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 84.0 / 38.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 84.0 / 38.0 / 365.0) * (CURRENT_DATE - lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  JOIN hr.roles r ON r.id = uc.role_id
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'personal'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
    AND r.name ILIKE '%security%'
    AND lb.as_of_date < CURRENT_DATE;

  -- FDV leave (Upfront 10 days, resets on anniversary)
  -- FDV doesn't accrue daily. It resets to 10 days (76h) on each contract
  -- start_date anniversary. Robust catch-up form: compute the most recent
  -- anniversary on-or-before today and reset when the balance row hasn't been
  -- touched since then — so a cron miss on the exact day (or a Feb-29 start
  -- date in a non-leap year) still resets on the next run.
  UPDATE leave_balances lb
  SET
    balance_hours = 76.0,
    accrued_hours = accrued_hours + GREATEST(0, 76.0 - balance_hours),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'fdv'
    AND uc.start_date <= CURRENT_DATE
    AND lb.as_of_date < (
      uc.start_date
      + (EXTRACT(year FROM age(CURRENT_DATE, uc.start_date))::int * interval '1 year')
    )::date;

END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Balance deduction trigger — fires on leave_requests status → 'approved'
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION deduct_leave_balance_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_type text;
  old_status  text;
BEGIN
  -- Carer's leave deducts from personal leave balance
  target_type := CASE WHEN NEW.leave_type = 'carer' THEN 'personal' ELSE NEW.leave_type END;

  -- F2: TG_OP-aware — on INSERT there is no OLD row, so treat prior status as
  -- absent. This closes the hole where a row inserted directly with
  -- status='approved' (e.g. by service_role) would never deduct the balance.
  old_status := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END;

  -- Fire when status becomes 'approved' (INSERT as approved, or UPDATE → approved)
  IF NEW.status = 'approved' AND (old_status IS DISTINCT FROM 'approved') THEN
    UPDATE leave_balances
    SET
      balance_hours = GREATEST(0, balance_hours - COALESCE(NEW.requested_hours, 0)),
      used_hours = used_hours + COALESCE(NEW.requested_hours, 0),
      updated_at = now()
    WHERE employee_id = NEW.employee_id
      AND leave_type = target_type;
  END IF;

  -- Restore balance if approval is revoked (status changes FROM 'approved').
  -- UPDATE only — an INSERT has no prior approval to revoke.
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.status != 'approved' THEN
    UPDATE leave_balances
    SET
      balance_hours = balance_hours + COALESCE(OLD.requested_hours, 0),
      used_hours = GREATEST(0, used_hours - COALESCE(OLD.requested_hours, 0)),
      updated_at = now()
    WHERE employee_id = OLD.employee_id
      AND leave_type = target_type;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leave_balance_deduction ON leave_requests;
CREATE TRIGGER trg_leave_balance_deduction
  AFTER INSERT OR UPDATE ON leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION deduct_leave_balance_on_approval();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS policies (Cert-based)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY leave_balances_self_select
  ON leave_balances FOR SELECT
  USING (employee_id = auth.uid());

CREATE POLICY leave_balances_manager_select
  ON leave_balances FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_access_certificates aac
      JOIN hr.user_contracts target_uc ON target_uc.user_id = leave_balances.employee_id
      WHERE aac.user_id = auth.uid()
        AND aac.is_active = true
        AND (
          (aac.access_level = 'zeta') OR
          (aac.access_level = 'epsilon' AND aac.organization_id = target_uc.organization_id) OR
          (aac.access_level = 'delta' AND aac.organization_id = target_uc.organization_id AND aac.department_id = target_uc.department_id) OR
          (aac.access_level = 'gamma' AND aac.organization_id = target_uc.organization_id AND aac.department_id = target_uc.department_id AND aac.sub_department_id = target_uc.sub_department_id)
        )
    )
  );

CREATE POLICY leave_balances_service_all
  ON leave_balances FOR ALL
  USING (auth.role() = 'service_role');

-- leave_requests RLS
-- F2: employees may only insert their OWN requests in 'pending' state with no
-- approver set — prevents self-approval by inserting status='approved' directly.
CREATE POLICY leave_requests_self_insert
  ON leave_requests FOR INSERT
  WITH CHECK (
    employee_id = auth.uid()
    AND status = 'pending'
    AND approved_by IS NULL
  );

CREATE POLICY leave_requests_self_select
  ON leave_requests FOR SELECT
  USING (employee_id = auth.uid());

CREATE POLICY leave_requests_self_cancel
  ON leave_requests FOR UPDATE
  USING (employee_id = auth.uid() AND status = 'pending')
  WITH CHECK (status = 'cancelled');

CREATE POLICY leave_requests_manager_select
  ON leave_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_access_certificates aac
      JOIN hr.user_contracts target_uc ON target_uc.user_id = leave_requests.employee_id
      WHERE aac.user_id = auth.uid()
        AND aac.is_active = true
        AND (
          (aac.access_level = 'zeta') OR
          (aac.access_level = 'epsilon' AND aac.organization_id = target_uc.organization_id) OR
          (aac.access_level = 'delta' AND aac.organization_id = target_uc.organization_id AND aac.department_id = target_uc.department_id) OR
          (aac.access_level = 'gamma' AND aac.organization_id = target_uc.organization_id AND aac.department_id = target_uc.department_id AND aac.sub_department_id = target_uc.sub_department_id)
        )
    )
  );

CREATE POLICY leave_requests_manager_update
  ON leave_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM app_access_certificates aac
      JOIN hr.user_contracts target_uc ON target_uc.user_id = leave_requests.employee_id
      WHERE aac.user_id = auth.uid()
        AND aac.is_active = true
        AND (
          (aac.access_level = 'zeta') OR
          (aac.access_level = 'epsilon' AND aac.organization_id = target_uc.organization_id) OR
          (aac.access_level = 'delta' AND aac.organization_id = target_uc.organization_id AND aac.department_id = target_uc.department_id) OR
          (aac.access_level = 'gamma' AND aac.organization_id = target_uc.organization_id AND aac.department_id = target_uc.department_id AND aac.sub_department_id = target_uc.sub_department_id)
        )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. updated_at trigger for leave_balances
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_leave_balances_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leave_balances_updated_at ON leave_balances;
CREATE TRIGGER trg_leave_balances_updated_at
  BEFORE UPDATE ON leave_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_leave_balances_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Seed Data for initial balances
-- ─────────────────────────────────────────────────────────────────────────────
-- F4a: annual/personal seeds cover every NON-CASUAL profile (EBA cl 12.4(f):
-- flexible part-time get pro-rata annual/personal/LSL too). profiles.employment_type
-- is the public.employment_type enum with mixed-case values ('full_time',
-- 'Full-Time', 'casual', 'Casual', 'contractual', ...), so match case-insensitively
-- on the text cast rather than enumerating literals.
INSERT INTO leave_balances (employee_id, leave_type, balance_hours, as_of_date)
SELECT id, 'annual', 152.0, CURRENT_DATE FROM profiles
WHERE employment_type IS NOT NULL AND LOWER(employment_type::text) NOT LIKE '%casual%'
ON CONFLICT DO NOTHING;

INSERT INTO leave_balances (employee_id, leave_type, balance_hours, as_of_date)
SELECT id, 'personal', 76.0, CURRENT_DATE FROM profiles
WHERE employment_type IS NOT NULL AND LOWER(employment_type::text) NOT LIKE '%casual%'
ON CONFLICT DO NOTHING;

-- FDV covers ALL profiles — casuals are entitled to paid FDV leave.

INSERT INTO leave_balances (employee_id, leave_type, balance_hours, as_of_date)
SELECT id, 'fdv', 76.0, CURRENT_DATE FROM profiles
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Cron Job for nightly accrual
-- ─────────────────────────────────────────────────────────────────────────────
-- pg_cron extension needs to be enabled in Supabase dashboard
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Delete if exists
    PERFORM cron.unschedule('nightly_leave_accrual');
    -- Schedule to run at 2 AM every day
    PERFORM cron.schedule('nightly_leave_accrual', '0 2 * * *', 'SELECT accrue_leave_balances()');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. employee_leave_days — one row per employee per approved-leave calendar day
-- ─────────────────────────────────────────────────────────────────────────────
-- The single absence primitive consumed by the auto-scheduler payload builder
-- and the V8 compliance leave-conflict rule: "is employee X on approved leave
-- on date D?" becomes a simple equality join against this view.
-- security_invoker so the caller's leave_requests RLS applies (self-select +
-- cert-based manager policies above). leave_requests.start_date/end_date are
-- timestamptz, hence the ::date casts.
CREATE OR REPLACE VIEW employee_leave_days
WITH (security_invoker = true) AS
SELECT lr.employee_id,
       d::date AS leave_date,
       lr.id   AS request_id,
       lr.leave_type
FROM leave_requests lr,
     LATERAL generate_series(lr.start_date::date, lr.end_date::date, interval '1 day') AS d
WHERE lr.status = 'approved';

GRANT SELECT ON employee_leave_days TO authenticated;
