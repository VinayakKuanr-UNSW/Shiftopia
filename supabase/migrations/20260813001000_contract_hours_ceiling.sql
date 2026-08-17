-- Contract Hours Ceiling Guardrail
-- =================================
-- Enforces the business rule: combined contracted_weekly_hours across all
-- Active FT + PT + Flexible PT contracts for a single employee must never
-- exceed 38 hours per week.
--
-- Casual contracts are excluded — they do not consume the 38h ceiling and
-- can be created without limit.
--
-- Uses a transactional advisory lock (pg_advisory_xact_lock) on the employee
-- to serialise concurrent contract mutations, preventing the race condition
-- where two managers simultaneously create contracts that individually appear
-- valid but together exceed the ceiling.
--
-- Pattern matches the existing concurrency-hardening in
-- 20260802150000_concurrency_hardening_overlap_and_attendance.sql.

CREATE OR REPLACE FUNCTION hr.enforce_contract_hours_ceiling()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hr, public
AS $$
DECLARE
  v_existing_hours numeric;
  v_proposed_total numeric;
  v_new_hours      numeric;
BEGIN
  -- ── 1. Casual contracts are exempt from the 38h ceiling ──────────────
  IF NEW.employment_status = 'Casual' THEN
    RETURN NEW;
  END IF;

  -- ── 2. Inactive / Terminated contracts don't contribute to the ceiling,
  --       and if the new row itself is not Active, skip the check ────────
  IF NEW.status != 'Active' THEN
    RETURN NEW;
  END IF;

  -- ── 3. Serialise concurrent mutations for this employee ──────────────
  --       This advisory lock is held for the duration of the transaction,
  --       so a second concurrent INSERT/UPDATE on the same user_id will
  --       block until this transaction commits or rolls back.
  PERFORM pg_advisory_xact_lock(hashtext('contract_hours:' || NEW.user_id::text));

  -- ── 4. Sum existing Active FT/PT/Flexible PT contracted hours ────────
  --       Exclude the current row (for UPDATE scenarios where the row
  --       already exists with its old hours).
  SELECT COALESCE(SUM(contracted_weekly_hours), 0)
    INTO v_existing_hours
    FROM hr.user_contracts
   WHERE user_id = NEW.user_id
     AND status = 'Active'
     AND employment_status != 'Casual'
     AND id != NEW.id;

  -- ── 5. Compute the proposed total ────────────────────────────────────
  v_new_hours := COALESCE(NEW.contracted_weekly_hours, 0);
  v_proposed_total := v_existing_hours + v_new_hours;

  -- ── 6. Enforce the 38h ceiling ───────────────────────────────────────
  IF v_proposed_total > 38 THEN
    RAISE EXCEPTION
      'Contract hours ceiling exceeded: existing Active FT/PT/Flexible PT contracts total %.1fh/week, '
      'adding %.1fh would bring the total to %.1fh/week (maximum 38h/week). '
      'Reduce contracted hours or terminate an existing contract first.',
      v_existing_hours, v_new_hours, v_proposed_total
    USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION hr.enforce_contract_hours_ceiling() IS
  'BEFORE INSERT/UPDATE trigger: enforces the 38h/week contracted-hours ceiling '
  'across all Active FT + PT + Flexible PT contracts for a single employee. '
  'Casual contracts are exempt. Uses an advisory lock to prevent race conditions.';

-- Drop if exists (idempotent migration)
DROP TRIGGER IF EXISTS trg_contract_hours_ceiling ON hr.user_contracts;

CREATE TRIGGER trg_contract_hours_ceiling
  BEFORE INSERT OR UPDATE ON hr.user_contracts
  FOR EACH ROW
  EXECUTE FUNCTION hr.enforce_contract_hours_ceiling();
