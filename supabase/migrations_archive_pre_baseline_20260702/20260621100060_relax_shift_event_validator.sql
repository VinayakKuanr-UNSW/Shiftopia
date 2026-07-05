-- Shift mutation gateway — validator tolerates subject-less audit rows.
--
-- fn_validate_shift_event guarantees a genuine subject-bound event names its worker.
-- The gateway's neutral 'OP_APPLIED' audit rows (publish / edit / approve_trade /
-- reject_trade, and delete of an unassigned shift) legitimately have NO subject, so
-- exempt them alongside the pre-existing 'UNASSIGNED' exemption. Every genuinely
-- subject-bound type (ASSIGNED, OFFERED, CHECKED_IN, CANCELLED of an assigned shift,
-- ...) stays strict — sm_apply_shift_op only emits CANCELLED when a worker is
-- attached, so cancellations still name their subject.
--
-- Runs AFTER 20260621100050 has committed 'OP_APPLIED' into the enum. Idempotent.

CREATE OR REPLACE FUNCTION public.fn_validate_shift_event() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
    IF NEW.employee_id IS NULL
       AND NEW.event_type NOT IN ('UNASSIGNED', 'OP_APPLIED') THEN
        RAISE EXCEPTION 'employee_id is required for event type %', NEW.event_type;
    END IF;
    RETURN NEW;
END;
$$;
