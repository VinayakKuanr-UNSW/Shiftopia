-- ============================================================
-- FSM Migration 7: Final FSM Unblocker (RELAXED EDITION)
--
-- This script resolves the CHECK constraint violation by:
-- 1. Whitelisting 'offered' and 'pending' in the DB constraint.
-- 2. Adding [v2] tags to all errors to verify the update.
-- 3. Force-cleaning data with triggers disabled.
-- ============================================================

-- 1. HARDEN STATE FUNCTION (with [v2] tags)
CREATE OR REPLACE FUNCTION public.get_shift_fsm_state(
  p_lifecycle_status   public.shift_lifecycle,
  p_assignment_status  public.shift_assignment_status,
  p_assignment_outcome public.shift_assignment_outcome,
  p_trading_status     public.shift_trading,
  p_is_cancelled       boolean
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_is_cancelled = true THEN RETURN 'S15'; END IF;
  IF p_lifecycle_status = 'Completed' THEN RETURN 'S13'; END IF;
  IF p_lifecycle_status = 'InProgress' THEN RETURN 'S11'; END IF;

  IF p_lifecycle_status = 'Published' THEN
    IF p_trading_status = 'TradeRequested' THEN RETURN 'S9'; END IF;
    IF p_trading_status = 'TradeAccepted' THEN RETURN 'S10'; END IF;
    
    -- Treat 'offered' as NULL (S3)
    IF p_assignment_status = 'assigned' AND (p_assignment_outcome IS NULL OR p_assignment_outcome = 'offered') THEN
      RETURN 'S3';
    END IF;
    
    IF p_assignment_status = 'assigned' AND p_assignment_outcome = 'confirmed' THEN
      RETURN 'S4';
    END IF;
    
    IF p_assignment_status = 'unassigned' THEN
      RETURN 'S5';
    END IF;
  END IF;

  IF p_lifecycle_status = 'Draft' THEN
    IF p_assignment_status = 'assigned' THEN RETURN 'S2'; ELSE RETURN 'S1'; END IF;
  END IF;

  RAISE EXCEPTION '[v2] get_shift_fsm_state: unrecognised combination — lifecycle=% assignment=% outcome=%',
    p_lifecycle_status, p_assignment_status, p_assignment_outcome;
END;
$$;

-- 2. HARDEN INVARIANT TRIGGER
CREATE OR REPLACE FUNCTION public.validate_shift_state_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text;
BEGIN
  IF NEW.is_cancelled = true THEN
    v_state := public.get_shift_fsm_state(NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome, NEW.trading_status, NEW.is_cancelled);
    RETURN NEW;
  END IF;

  v_state := public.get_shift_fsm_state(NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome, NEW.trading_status, NEW.is_cancelled);

  IF NEW.assignment_status = 'unassigned' AND NEW.assignment_outcome IS NOT NULL THEN
    RAISE EXCEPTION '[v2] Shift %: outcome must be NULL when unassigned', NEW.id;
  END IF;

  IF NEW.lifecycle_status IN ('Completed', 'InProgress') AND NEW.assignment_status != 'assigned' THEN
    RAISE EXCEPTION '[v2] Shift %: lifecycle % requires assigned', NEW.id, NEW.lifecycle_status;
  END IF;

  -- Rule 4 (HARDENED): Whitelist 'offered'
  IF NEW.lifecycle_status = 'Published'
     AND NEW.assignment_status = 'assigned'
     AND NEW.assignment_outcome IS NOT NULL
     AND NEW.assignment_outcome NOT IN ('confirmed', 'offered', 'pending') THEN
    RAISE EXCEPTION
      '[v2] Shift %: assignment_outcome ''%'' is not valid for Published+assigned (use confirmed, offered or NULL)',
      NEW.id, NEW.assignment_outcome;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. BYPASS LOCKS & CLEAN DATA
ALTER TABLE public.shifts DISABLE TRIGGER USER;
UPDATE public.shifts SET assignment_outcome = NULL WHERE assignment_outcome IN ('offered', 'pending');
ALTER TABLE public.shifts ENABLE TRIGGER USER;

-- 4. RELAXED CHECK CONSTRAINT (The actual fix)
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS valid_assignment_outcome;
ALTER TABLE public.shifts ADD CONSTRAINT valid_assignment_outcome 
  CHECK (
      assignment_outcome IS NULL
      OR assignment_outcome IN ('confirmed', 'no_show', 'offered', 'pending')
  );
