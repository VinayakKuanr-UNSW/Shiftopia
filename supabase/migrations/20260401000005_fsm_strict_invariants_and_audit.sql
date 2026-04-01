-- ============================================================
-- FSM Migration 5: Strict invariants + state audit table
--
-- 1. Strengthen validate_shift_state_invariants() with 4 new checks
-- 2. Create shift_state_audit table
-- 3. Add trg_shift_state_audit trigger (logs every FSM state change)
-- ============================================================


-- ============================================================
-- 1. Strengthen validate_shift_state_invariants()
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_shift_state_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text;
BEGIN
  -- --------------------------------------------------------
  -- Short-circuit for cancelled shifts.
  -- Verify FSM accepts it, then skip cross-field rules.
  -- --------------------------------------------------------
  IF NEW.is_cancelled = true THEN
    BEGIN
      v_state := public.get_shift_fsm_state(
        NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome,
        NEW.trading_status, NEW.is_cancelled
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid shift state combination on shift % (cancelled path): %', NEW.id, SQLERRM;
    END;
    RETURN NEW;
  END IF;

  -- --------------------------------------------------------
  -- FSM reachability check for all non-cancelled shifts.
  -- --------------------------------------------------------
  BEGIN
    v_state := public.get_shift_fsm_state(
      NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome,
      NEW.trading_status, NEW.is_cancelled
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid shift state combination on shift %: %', NEW.id, SQLERRM;
  END;

  -- --------------------------------------------------------
  -- Cross-field rule 1:
  --   unassigned → assignment_outcome must be NULL
  -- --------------------------------------------------------
  IF NEW.assignment_status = 'unassigned' AND NEW.assignment_outcome IS NOT NULL THEN
    RAISE EXCEPTION
      'Shift %: assignment_outcome must be NULL when assignment_status is ''unassigned'' (got: %)',
      NEW.id, NEW.assignment_outcome;
  END IF;

  -- --------------------------------------------------------
  -- Cross-field rule 2:
  --   Completed / InProgress → assignment_status must be 'assigned'
  -- --------------------------------------------------------
  IF NEW.lifecycle_status IN ('Completed', 'InProgress')
     AND NEW.assignment_status != 'assigned' THEN
    RAISE EXCEPTION
      'Shift %: lifecycle_status ''%'' requires assignment_status = ''assigned'' (got: %)',
      NEW.id, NEW.lifecycle_status, NEW.assignment_status;
  END IF;

  -- --------------------------------------------------------
  -- Cross-field rule 3:
  --   Any active trading state → assignment_status must be 'assigned'
  -- --------------------------------------------------------
  IF NEW.trading_status != 'NoTrade' AND NEW.assignment_status != 'assigned' THEN
    RAISE EXCEPTION
      'Shift %: trading_status ''%'' requires assignment_status = ''assigned'' (got: %)',
      NEW.id, NEW.trading_status, NEW.assignment_status;
  END IF;

  -- --------------------------------------------------------
  -- NEW — Rule 4:
  --   Published + assigned → assignment_outcome must be NULL (S3)
  --   or 'confirmed' (S4/S9/S10).
  --   'no_show' is only valid once the shift has started (InProgress/Completed).
  -- --------------------------------------------------------
  IF NEW.lifecycle_status = 'Published'
     AND NEW.assignment_status = 'assigned'
     AND NEW.assignment_outcome IS NOT NULL
     AND NEW.assignment_outcome != 'confirmed' THEN
    RAISE EXCEPTION
      'Shift %: assignment_outcome ''%'' is not valid for a Published+assigned shift (use ''confirmed'' or NULL)',
      NEW.id, NEW.assignment_outcome;
  END IF;

  -- --------------------------------------------------------
  -- NEW — Rule 5:
  --   Published + unassigned → must be in an active bidding state
  --   (not_on_bidding means the shift should be Draft, not Published).
  -- --------------------------------------------------------
  IF NEW.lifecycle_status = 'Published'
     AND NEW.assignment_status = 'unassigned'
     AND NEW.bidding_status = 'not_on_bidding' THEN
    RAISE EXCEPTION
      'Shift %: Published+unassigned shift must have an active bidding_status (got not_on_bidding). Unpublish first.',
      NEW.id;
  END IF;

  -- --------------------------------------------------------
  -- NEW — Rule 6:
  --   emergency_source is only valid on assigned shifts.
  -- --------------------------------------------------------
  IF NEW.emergency_source IS NOT NULL
     AND NEW.assignment_status != 'assigned' THEN
    RAISE EXCEPTION
      'Shift %: emergency_source can only be set on assigned shifts (assignment_status is ''%'')',
      NEW.id, NEW.assignment_status;
  END IF;

  RETURN NEW;
END;
$$;


-- ============================================================
-- 2. shift_state_audit table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shift_state_audit (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  shift_id    uuid        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  old_state   text,
  new_state   text        NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  changed_by  uuid,       -- auth.uid() at write time

  CONSTRAINT shift_state_audit_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_shift_state_audit_shift_id
  ON public.shift_state_audit (shift_id, changed_at DESC);

-- ============================================================
-- 3. Trigger function: log every FSM state transition
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_shift_state_audit_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_state text;
  v_new_state text;
BEGIN
  -- Derive old and new FSM states
  BEGIN
    v_old_state := public.get_shift_fsm_state(
      OLD.lifecycle_status, OLD.assignment_status, OLD.assignment_outcome,
      OLD.trading_status, OLD.is_cancelled
    );
  EXCEPTION WHEN OTHERS THEN
    v_old_state := 'UNKNOWN';
  END;

  BEGIN
    v_new_state := public.get_shift_fsm_state(
      NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome,
      NEW.trading_status, NEW.is_cancelled
    );
  EXCEPTION WHEN OTHERS THEN
    -- If new state is invalid the invariant trigger will catch it — skip logging
    RETURN NEW;
  END;

  -- Only log when the FSM state actually changes
  IF v_old_state IS DISTINCT FROM v_new_state THEN
    INSERT INTO public.shift_state_audit (shift_id, old_state, new_state, changed_by)
    VALUES (NEW.id, v_old_state, v_new_state, auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 4. Attach trigger (fires AFTER UPDATE so invariant check runs first)
-- ============================================================
DROP TRIGGER IF EXISTS trg_shift_state_audit ON public.shifts;
CREATE TRIGGER trg_shift_state_audit
  AFTER UPDATE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_shift_state_audit_fn();
