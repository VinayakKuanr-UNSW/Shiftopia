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
  
  -- Annual leave accrual (permanents only)
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
    AND lb.as_of_date < CURRENT_DATE;

  -- Personal/sick leave accrual (permanents only)
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
    AND lb.as_of_date < CURRENT_DATE;

  -- FDV leave (Upfront 10 days, resets on anniversary)
  -- If CURRENT_DATE is >= the anniversary date for this year, and as_of_date < anniversary date, reset it.
  -- Simpler: FDV doesn't accrue daily. It resets to 10 days (76h) on contract start_date anniversary.
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
    AND EXTRACT(month FROM uc.start_date) = EXTRACT(month FROM CURRENT_DATE)
    AND EXTRACT(day FROM uc.start_date) = EXTRACT(day FROM CURRENT_DATE)
    AND lb.as_of_date < CURRENT_DATE;

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
BEGIN
  -- Carer's leave deducts from personal leave balance
  target_type := CASE WHEN NEW.leave_type = 'carer' THEN 'personal' ELSE NEW.leave_type END;

  -- Only fire when status changes to 'approved'
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    UPDATE leave_balances
    SET
      balance_hours = GREATEST(0, balance_hours - COALESCE(NEW.requested_hours, 0)),
      used_hours = used_hours + COALESCE(NEW.requested_hours, 0),
      updated_at = now()
    WHERE employee_id = NEW.employee_id
      AND leave_type = target_type;
  END IF;

  -- Restore balance if approval is revoked (status changes FROM 'approved')
  IF OLD.status = 'approved' AND NEW.status != 'approved' THEN
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
  AFTER UPDATE ON leave_requests
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
CREATE POLICY leave_requests_self_insert
  ON leave_requests FOR INSERT
  WITH CHECK (employee_id = auth.uid());

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
INSERT INTO leave_balances (employee_id, leave_type, balance_hours, as_of_date)
SELECT id, 'annual', 152.0, CURRENT_DATE FROM profiles WHERE employment_type IN ('full_time', 'part_time')
ON CONFLICT DO NOTHING;

INSERT INTO leave_balances (employee_id, leave_type, balance_hours, as_of_date)
SELECT id, 'personal', 76.0, CURRENT_DATE FROM profiles WHERE employment_type IN ('full_time', 'part_time')
ON CONFLICT DO NOTHING;

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
