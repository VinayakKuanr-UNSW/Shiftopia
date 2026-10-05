-- Leave balances may go negative — leave in advance, decided by the manager.
--
-- DECISION (2026-09-30): no floor. An employee may request more than their
-- balance and a manager may approve it; both are warned, the manager decides,
-- and the ledger shows the deficit rather than losing it.
--
-- TWO THINGS STOOD IN THE WAY, AND BOTH HAD TO GO TOGETHER:
--   1. `deduct_leave_balance_on_approval()` wrote
--      `GREATEST(0, balance_hours - requested_hours)`, so an overdraw was
--      silently floored — the shortfall recorded nowhere.
--   2. `leave_balances.non_negative_balance CHECK (balance_hours >= 0)`.
--      Removing only the floor would have turned every overdrawn approval
--      into a failed UPDATE (the approval itself rolled back with it).
--
-- The function body below is the LIVE production definition
-- (pg_get_functiondef, 2026-09-30) with only the floor removed. It already
-- carries the cl 55.1 / 58.2 election routing from
-- 20260828100000_leave_election_cl55_cl58 — the older body in
-- 20260710120000_leave_module does not, and must not be copied from.
--
-- `accrued_hours` / `used_hours` keep their non-negative CHECKs: those are
-- counters, and the restore branch still floors `used_hours` at 0.
--
-- FDV: `accrue_leave_balances()` resets fdv to 76h at each employment
-- anniversary, so an fdv overdraw is cleared then — cl 46.2, "does not
-- accumulate from year to year".

ALTER TABLE public.leave_balances DROP CONSTRAINT IF EXISTS non_negative_balance;

CREATE OR REPLACE FUNCTION public.deduct_leave_balance_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  target_type text;
  old_status  text;
BEGIN
  target_type := CASE
    WHEN NEW.leave_type = 'carer' THEN 'personal'
    WHEN NEW.leave_type IN ('religious_cultural', 'gender_affirmation') THEN
      CASE WHEN NEW.election_mode = 'annual' THEN 'annual' ELSE NULL END
    ELSE NEW.leave_type
  END;

  -- Nothing to move: unpaid leave, an unrecorded election, or a per-occasion
  -- type that was never balance-tracked. Guessing would move real hours out of
  -- somebody's annual leave on an assumption.
  IF target_type IS NULL THEN
    RETURN NEW;
  END IF;

  old_status := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END;

  -- No floor: a balance below zero is leave taken in advance, and must show.
  IF NEW.status = 'approved' AND (old_status IS DISTINCT FROM 'approved') THEN
    UPDATE leave_balances
    SET
      balance_hours = balance_hours - COALESCE(NEW.requested_hours, 0),
      used_hours = used_hours + COALESCE(NEW.requested_hours, 0),
      updated_at = now()
    WHERE employee_id = NEW.employee_id
      AND leave_type = target_type;
  END IF;

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
$function$;

-- Trigger-only. Live ACL before this migration: postgres + service_role.
-- Revoked LAST, because CREATE OR REPLACE can re-grant.
REVOKE EXECUTE ON FUNCTION public.deduct_leave_balance_on_approval() FROM PUBLIC, anon, authenticated;
