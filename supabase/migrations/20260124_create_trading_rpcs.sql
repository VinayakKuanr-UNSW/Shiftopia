-- Migration: Implement Trading System RPCs
-- Description: Adds request_trade, accept_trade, and approve_trade functions 
-- to handle Shift Trading state transitions (S4 -> S9 -> S10 -> S4).

BEGIN;

-- 1. Request Trade (S4 -> S9)
-- An assigned employee requests to trade their shift.
CREATE OR REPLACE FUNCTION public.request_trade(p_shift_id uuid, p_target_employee_id uuid DEFAULT NULL, p_actor_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_shift RECORD;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN RAISE EXCEPTION 'Shift not found'; END IF;
    
    -- Validate Owner
    IF v_shift.assigned_employee_id != p_actor_id THEN
        RAISE EXCEPTION 'You can only trade your own shifts';
    END IF;
    
    -- Validate State (Must be S4 Confirmed)
    IF v_shift.assignment_outcome != 'confirmed' THEN
        RAISE EXCEPTION 'Only confirmed shifts can be traded';
    END IF;
    
    -- Create Trade Request
    INSERT INTO trade_requests (
        shift_id, requesting_employee_id, target_employee_id, status
    ) VALUES (
        p_shift_id, p_actor_id, p_target_employee_id, 'pending'
    );
    
    -- Update Shift Flag
    UPDATE shifts 
    SET is_trade_requested = TRUE 
    WHERE id = p_shift_id;
    
    RETURN jsonb_build_object('success', true, 'status', 'trade_requested');
END;
$function$;

-- 2. Accept Trade (S9 -> S10)
-- A target employee accepts the open trade request.
CREATE OR REPLACE FUNCTION public.accept_trade(p_trade_request_id uuid, p_actor_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_trade RECORD;
BEGIN
    SELECT * INTO v_trade FROM trade_requests WHERE id = p_trade_request_id FOR UPDATE;
    
    IF v_trade IS NULL THEN RAISE EXCEPTION 'Trade request not found'; END IF;
    
    -- Validate Target (if specified)
    IF v_trade.target_employee_id IS NOT NULL AND v_trade.target_employee_id != p_actor_id THEN
        RAISE EXCEPTION 'This trade is not for you';
    END IF;
    
    -- Update Request
    UPDATE trade_requests 
    SET 
        status = 'target_accepted',
        target_employee_id = p_actor_id, -- Lock in the acceptor
        target_accepted_at = NOW()
    WHERE id = p_trade_request_id;
    
    -- Shift state remains S9 (TradeRequested) until Manager Approval
    -- But logically it is now S10 (TradeAccepted)
    
    RETURN jsonb_build_object('success', true, 'status', 'target_accepted');
END;
$function$;

-- 3. Approve Trade (S10 -> S4)
-- Manager approves the trade -> Swap Assignments -> Reset to S4.
CREATE OR REPLACE FUNCTION public.approve_trade(p_trade_request_id uuid, p_actor_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_trade RECORD;
    v_shift RECORD;
BEGIN
    SELECT * INTO v_trade FROM trade_requests WHERE id = p_trade_request_id FOR UPDATE;
    SELECT * INTO v_shift FROM shifts WHERE id = v_trade.shift_id FOR UPDATE;
    
    -- Execute Swap
    UPDATE shifts
    SET 
        assigned_employee_id = v_trade.target_employee_id,
        assignment_outcome = 'confirmed', -- Ensure S4
        is_trade_requested = FALSE, -- Clear flag
        updated_at = NOW()
    WHERE id = v_shift.id;
    
    -- Close Request
    UPDATE trade_requests
    SET 
        status = 'manager_approved',
        manager_approved_at = NOW(),
        approved_by = p_actor_id
    WHERE id = p_trade_request_id;
    
    RETURN jsonb_build_object('success', true, 'new_assignee', v_trade.target_employee_id);
END;
$function$;

COMMIT;
