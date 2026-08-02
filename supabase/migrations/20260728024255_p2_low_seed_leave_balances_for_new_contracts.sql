-- ─────────────────────────────────────────────────────────────────────────────
-- Backfilled into version control 2026-08-02 from the PRODUCTION migration
-- ledger (supabase_migrations.schema_migrations @ version 20260728024255).
--
-- This migration was applied DIRECTLY to prod via the Supabase MCP during the
-- 2026-07-27/28 security & payroll audit and had no committed source file until
-- now. It is ALREADY APPLIED in prod — do not re-run against production.
-- Context: docs/investigations/2026-08-02_migration-reconciliation.md
-- ─────────────────────────────────────────────────────────────────────────────

-- Audit L-11 (and a broader gap it surfaced): the ONLY thing that ever seeded
-- leave_balances rows was a one-time migration backfill
-- (20260710120000_leave_module.sql §7), which gave every non-casual profile
-- the GENERAL 152h annual / 76h personal rate — including the one Full-Time
-- Security employee, who should have started at 210h/84h (Schedule 3 §8.2/
-- §8.3). Nightly accrual has been correctly using the Security-specific rate
-- ever since (accrue_leave_balances() already branches correctly), so only
-- the OPENING seed was wrong. Worse: since that one-time backfill was the
-- ONLY seeding mechanism, any employee hired since 2026-07-10 would get NO
-- leave_balances rows at all (accrue_leave_balances() only UPDATEs existing
-- rows) — no live trigger ever picked this up for new hires. This migration
-- adds that missing trigger, using the same role-aware logic, and corrects
-- the one already-misseeded Security employee's balance.

CREATE OR REPLACE FUNCTION public.seed_leave_balances_for_new_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'hr'
AS $$
DECLARE
  v_is_casual boolean;
  v_is_ft_security boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'Active' THEN
    RETURN NEW;
  END IF;

  v_is_casual := LOWER(COALESCE(NEW.employment_status::text, '')) LIKE '%casual%';
  v_is_ft_security := LOWER(COALESCE(NEW.employment_status::text, '')) LIKE '%full%'
    AND EXISTS (SELECT 1 FROM hr.roles r WHERE r.id = NEW.role_id AND r.name ILIKE '%security%');

  -- FDV (cl 46 / NES Div 11) is paid for ALL employment types, including casuals.
  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'fdv', 76.0, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  IF v_is_casual THEN
    RETURN NEW; -- casuals accrue no annual/personal/religious/gender-affirmation balance.
  END IF;

  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'annual', CASE WHEN v_is_ft_security THEN 210.0 ELSE 152.0 END, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'personal', CASE WHEN v_is_ft_security THEN 84.0 ELSE 76.0 END, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'religious_cultural', 38.0, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'gender_affirmation', 76.0, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'seed_leave_balances_for_new_contract swallowed (contract=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_leave_balances ON hr.user_contracts;
CREATE TRIGGER trg_seed_leave_balances
  AFTER INSERT OR UPDATE OF status ON hr.user_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_leave_balances_for_new_contract();

-- One-time correction for the already-misseeded Full-Time Security employee:
-- their opening seed was 152/76 (general) instead of 210/84 (Security); all
-- accrual SINCE the seed has correctly used the Security rate, so the fix is
-- a flat offset (+58h annual, +8h personal), not a full recompute.
UPDATE leave_balances lb
SET balance_hours = balance_hours + 58.0,
    accrued_hours = accrued_hours + 58.0,
    updated_at = now()
FROM hr.user_contracts uc
JOIN hr.roles r ON r.id = uc.role_id
WHERE lb.employee_id = uc.user_id
  AND uc.status = 'Active'
  AND lb.leave_type = 'annual'
  AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
  AND r.name ILIKE '%security%'
  AND lb.balance_hours < 200; -- guard: only touch rows still at/near the general-rate seed

UPDATE leave_balances lb
SET balance_hours = balance_hours + 8.0,
    accrued_hours = accrued_hours + 8.0,
    updated_at = now()
FROM hr.user_contracts uc
JOIN hr.roles r ON r.id = uc.role_id
WHERE lb.employee_id = uc.user_id
  AND uc.status = 'Active'
  AND lb.leave_type = 'personal'
  AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
  AND r.name ILIKE '%security%'
  AND lb.balance_hours < 83; -- guard: only touch rows still at/near the general-rate seed
