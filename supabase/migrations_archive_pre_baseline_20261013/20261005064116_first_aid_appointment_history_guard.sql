-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005064116, name first_aid_appointment_history_guard). Do not re-run
-- against production. Rollback-only dry-run beforehand, 9 probes: delete a
-- current appointment / move its start / end it 3 days back / edit an ended
-- one — all blocked; end yesterday, notes on an ended one, edit or delete a
-- future one, and the admin override — all allowed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- first_aid_appointments: the past is append-only.
--
-- Payroll (Gross Pay page), both TS cost engines and the SQL engine all read
-- appointments LIVE through `shifts.is_first_aid_duty`. Deleting or back-dating
-- a started appointment would therefore silently re-price shifts that have
-- already been worked and reported. This guard makes the elapsed part of an
-- appointment immutable:
--
--   * not yet started (effective_from > today) — free to edit or delete;
--   * in force       — may only be ENDED, and no earlier than yesterday
--                      (effective_to = yesterday stops it from today);
--                      start date, employee and organisation are fixed;
--   * already ended   — dates frozen; only notes may change.
--
-- "Today" is the Australia/Sydney date, the zone every roster date is in.
-- Back-dating on INSERT stays allowed: it can only ADD allowance to worked
-- shifts (paperwork lag), which is the safe direction.
--
-- Deliberate escape hatch for an administrator correcting a genuine data-entry
-- error from SQL:  SET LOCAL app.first_aid_history_override = 'on';
-- ─────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.fn_first_aid_appointment_history_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Australia/Sydney')::date;
BEGIN
  IF current_setting('app.first_aid_history_override', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.effective_from <= v_today THEN
      RAISE EXCEPTION 'This first-aid appointment has already started, so it cannot be deleted. End it instead.'
        USING ERRCODE = 'P0001',
              HINT = 'Set effective_to to the last day the appointment applies (yesterday at the earliest).';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE of an appointment that has started.
  IF OLD.effective_from <= v_today THEN
    IF NEW.effective_from  IS DISTINCT FROM OLD.effective_from
       OR NEW.employee_id     IS DISTINCT FROM OLD.employee_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'The start date, employee and organisation of a first-aid appointment that has started are fixed.'
        USING ERRCODE = 'P0001';
    END IF;

    IF OLD.effective_to IS NOT NULL AND OLD.effective_to < v_today THEN
      IF NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'This first-aid appointment has already ended; its dates can no longer change.'
          USING ERRCODE = 'P0001',
                HINT = 'Create a new appointment if the person is appointed again.';
      END IF;
    ELSIF NEW.effective_to IS NOT NULL AND NEW.effective_to < v_today - 1 THEN
      RAISE EXCEPTION 'A first-aid appointment cannot be ended before yesterday (%): that would re-price shifts already worked.', v_today - 1
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER first_aid_appointments_history_guard
  BEFORE UPDATE OR DELETE ON public.first_aid_appointments
  FOR EACH ROW EXECUTE FUNCTION public.fn_first_aid_appointment_history_guard();

REVOKE ALL ON FUNCTION public.fn_first_aid_appointment_history_guard() FROM PUBLIC, anon, authenticated;
