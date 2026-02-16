
-- Migration 012: Helper function to get Shift State ID (Fixed Enums)

CREATE OR REPLACE FUNCTION get_shift_state_id(
  p_lifecycle shift_lifecycle,
  p_assignment shift_assignment_status,
  p_outcome shift_assignment_outcome,
  p_bidding shift_bidding_status,
  p_trading shift_trading
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE
    -- S1: Draft + Unassigned
    WHEN p_lifecycle = 'Draft' AND p_assignment = 'unassigned' 
         AND p_outcome IS NULL AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade' 
         THEN 'S1'
    -- S2: Draft + Assigned + Pending
    WHEN p_lifecycle = 'Draft' AND p_assignment = 'assigned' 
         AND p_outcome = 'pending' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade' 
         THEN 'S2'
    -- S3: Published + Assigned + Offered
    WHEN p_lifecycle = 'Published' AND p_assignment = 'assigned' 
         AND p_outcome = 'offered' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade' 
         THEN 'S3'
    -- S4: Published + Assigned + Confirmed
    WHEN p_lifecycle = 'Published' AND p_assignment = 'assigned' 
         AND p_outcome = 'confirmed' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade' 
         THEN 'S4'
    -- S5: Published + Unassigned + OnBiddingNormal
    WHEN p_lifecycle = 'Published' AND p_assignment = 'unassigned' 
         AND p_outcome IS NULL AND p_bidding = 'on_bidding_normal' AND p_trading = 'NoTrade' 
         THEN 'S5'
    -- S6: Published + Unassigned + OnBiddingUrgent
    WHEN p_lifecycle = 'Published' AND p_assignment = 'unassigned' 
         AND p_outcome IS NULL AND p_bidding = 'on_bidding_urgent' AND p_trading = 'NoTrade' 
         THEN 'S6'
    -- S7: Published + Assigned + EmergencyAssigned
    WHEN p_lifecycle = 'Published' AND p_assignment = 'assigned' 
         AND p_outcome = 'emergency_assigned' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade' 
         THEN 'S7'
    -- S8: Published + Unassigned + BiddingClosedNoWinner
    WHEN p_lifecycle = 'Published' AND p_assignment = 'unassigned' 
         AND p_outcome IS NULL AND p_bidding = 'bidding_closed_no_winner' AND p_trading = 'NoTrade' 
         THEN 'S8'
    -- S9: Published + Confirmed + TradeRequested
    WHEN p_lifecycle = 'Published' AND p_assignment = 'assigned' 
         AND p_outcome = 'confirmed' AND p_bidding = 'not_on_bidding' AND p_trading = 'TradeRequested' 
         THEN 'S9'
    -- S10: Published + Confirmed + TradeAccepted
    WHEN p_lifecycle = 'Published' AND p_assignment = 'assigned' 
         AND p_outcome = 'confirmed' AND p_bidding = 'not_on_bidding' AND p_trading = 'TradeAccepted' 
         THEN 'S10'
    -- S11: InProgress + Assigned + Confirmed
    WHEN p_lifecycle = 'InProgress' AND p_assignment = 'assigned' 
         AND p_outcome = 'confirmed' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade' 
         THEN 'S11'
    -- S12: InProgress + Assigned + EmergencyAssigned
    WHEN p_lifecycle = 'InProgress' AND p_assignment = 'assigned' 
         AND p_outcome = 'emergency_assigned' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade' 
         THEN 'S12'
    -- S13: Completed + Assigned + Confirmed
    WHEN p_lifecycle = 'Completed' AND p_assignment = 'assigned' 
         AND p_outcome = 'confirmed' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade' 
         THEN 'S13'
    -- S14: Completed + Assigned + EmergencyAssigned
    WHEN p_lifecycle = 'Completed' AND p_assignment = 'assigned' 
         AND p_outcome = 'emergency_assigned' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade' 
         THEN 'S14'
    -- S15: Cancelled
    WHEN p_lifecycle = 'Cancelled' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade' 
         AND p_outcome IS NULL 
         THEN 'S15'
    ELSE 'INVALID'
  END;
END;
$$;

-- View to show all shifts with their state ID
CREATE OR REPLACE VIEW shifts_with_state AS
SELECT 
  s.*,
  get_shift_state_id(
    s.lifecycle_status, 
    s.assignment_status, 
    s.assignment_outcome, 
    s.bidding_status, 
    s.trading_status
  ) as state_id
FROM shifts s;
