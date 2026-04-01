-- ============================================================
-- FSM Migration Part 3: get_shift_fsm_state() function +
--                        rewrite validate_shift_state_invariants trigger function
-- Depends on Parts 1 & 2 being committed (no_show enum value + emergency_source column).
-- ============================================================


-- ============================================================
-- 1. get_shift_fsm_state()
--    Pure, IMMUTABLE function: given the five FSM input columns,
--    returns the canonical state label (S1–S15).
--    Priority order mirrors the TypeScript domain logic exactly.
-- ============================================================
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
  -- Priority 1: cancelled overrides everything else
  IF p_is_cancelled = true THEN
    RETURN 'S15';
  END IF;

  -- Priority 2: completed lifecycle
  IF p_lifecycle_status = 'Completed' THEN
    RETURN 'S13';
  END IF;

  -- Priority 3: in-progress lifecycle
  IF p_lifecycle_status = 'InProgress' THEN
    RETURN 'S11';
  END IF;

  -- Priority 4: published lifecycle — trading sub-states first, then assignment
  IF p_lifecycle_status = 'Published' THEN
    IF p_trading_status = 'TradeRequested' THEN
      RETURN 'S9';
    END IF;
    IF p_trading_status = 'TradeAccepted' THEN
      RETURN 'S10';
    END IF;
    IF p_assignment_status = 'assigned' AND p_assignment_outcome IS NULL THEN
      RETURN 'S3';
    END IF;
    IF p_assignment_status = 'assigned' AND p_assignment_outcome = 'confirmed' THEN
      RETURN 'S4';
    END IF;
    IF p_assignment_status = 'unassigned' THEN
      RETURN 'S5';
    END IF;
  END IF;

  -- Priority 5: draft lifecycle
  IF p_lifecycle_status = 'Draft' THEN
    IF p_assignment_status = 'assigned' THEN
      RETURN 'S2';
    ELSE
      RETURN 'S1';
    END IF;
  END IF;

  -- Priority 6: no branch matched — illegal combination
  RAISE EXCEPTION
    'get_shift_fsm_state: unrecognised state combination — lifecycle=% assignment=% outcome=% trading=% cancelled=%',
    p_lifecycle_status, p_assignment_status, p_assignment_outcome,
    p_trading_status, p_is_cancelled;
END;
$$;


-- ============================================================
-- 2. validate_shift_state_invariants() — BEFORE INSERT OR UPDATE
--    Uses get_shift_fsm_state to validate reachability, then
--    enforces explicit cross-field business rules.
--
--    NOTE: The trigger itself (trg_validate_shift_state_invariants)
--    is NOT recreated here — only the function body is replaced.
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_shift_state_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text;
BEGIN
  -- --------------------------------------------------------
  -- Short-circuit for cancelled shifts:
  -- A cancelled shift has no further field-level invariants.
  -- --------------------------------------------------------
  IF NEW.is_cancelled = true THEN
    -- Still validate that the FSM accepts this combination.
    BEGIN
      v_state := public.get_shift_fsm_state(
        NEW.lifecycle_status,
        NEW.assignment_status,
        NEW.assignment_outcome,
        NEW.trading_status,
        NEW.is_cancelled
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid shift state combination on shift % (cancelled path): %',
        NEW.id, SQLERRM;
    END;
    RETURN NEW;
  END IF;

  -- --------------------------------------------------------
  -- Validate FSM reachability for all non-cancelled shifts.
  -- --------------------------------------------------------
  BEGIN
    v_state := public.get_shift_fsm_state(
      NEW.lifecycle_status,
      NEW.assignment_status,
      NEW.assignment_outcome,
      NEW.trading_status,
      NEW.is_cancelled
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid shift state combination on shift %: %',
      NEW.id, SQLERRM;
  END;

  -- --------------------------------------------------------
  -- Cross-field rule 1:
  --   unassigned  →  assignment_outcome must be NULL
  -- --------------------------------------------------------
  IF NEW.assignment_status = 'unassigned' AND NEW.assignment_outcome IS NOT NULL THEN
    RAISE EXCEPTION
      'Shift %: assignment_outcome must be NULL when assignment_status is ''unassigned'' (got: %)',
      NEW.id, NEW.assignment_outcome;
  END IF;

  -- --------------------------------------------------------
  -- Cross-field rule 2:
  --   Completed / InProgress  →  assignment_status must be 'assigned'
  -- --------------------------------------------------------
  IF NEW.lifecycle_status IN ('Completed', 'InProgress')
     AND NEW.assignment_status != 'assigned' THEN
    RAISE EXCEPTION
      'Shift %: lifecycle_status ''%'' requires assignment_status = ''assigned'' (got: %)',
      NEW.id, NEW.lifecycle_status, NEW.assignment_status;
  END IF;

  -- --------------------------------------------------------
  -- Cross-field rule 3:
  --   Any active trading state  →  assignment_status must be 'assigned'
  -- --------------------------------------------------------
  IF NEW.trading_status != 'NoTrade' AND NEW.assignment_status != 'assigned' THEN
    RAISE EXCEPTION
      'Shift %: trading_status ''%'' requires assignment_status = ''assigned'' (got: %)',
      NEW.id, NEW.trading_status, NEW.assignment_status;
  END IF;

  RETURN NEW;
END;
$$;
