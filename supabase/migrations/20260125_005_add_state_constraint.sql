
-- Migration 005: Add VAlid State Combination Constraint (No Transaction Block)

ALTER TABLE shifts ADD CONSTRAINT valid_shift_state_combination CHECK (
  -- S1: Draft + Unassigned
  (lifecycle_status = 'Draft' AND assignment_status = 'unassigned' 
   AND assignment_outcome IS NULL AND bidding_status = 'not_on_bidding' AND trading_status = 'NoTrade')
  OR
  -- S2: Draft + Assigned + Pending
  (lifecycle_status = 'Draft' AND assignment_status = 'assigned' 
   AND assignment_outcome = 'pending' AND bidding_status = 'not_on_bidding' AND trading_status = 'NoTrade')
  OR
  -- S3: Published + Assigned + Offered
  (lifecycle_status = 'Published' AND assignment_status = 'assigned' 
   AND assignment_outcome = 'offered' AND bidding_status = 'not_on_bidding' AND trading_status = 'NoTrade')
  OR
  -- S4: Published + Assigned + Confirmed
  (lifecycle_status = 'Published' AND assignment_status = 'assigned' 
   AND assignment_outcome = 'confirmed' AND bidding_status = 'not_on_bidding' AND trading_status = 'NoTrade')
  OR
  -- S5: Published + Unassigned + OnBiddingNormal
  (lifecycle_status = 'Published' AND assignment_status = 'unassigned' 
   AND assignment_outcome IS NULL AND bidding_status = 'on_bidding_normal' AND trading_status = 'NoTrade')
  OR
  -- S6: Published + Unassigned + OnBiddingUrgent
  (lifecycle_status = 'Published' AND assignment_status = 'unassigned' 
   AND assignment_outcome IS NULL AND bidding_status = 'on_bidding_urgent' AND trading_status = 'NoTrade')
  OR
  -- S7: Published + Assigned + EmergencyAssigned
  (lifecycle_status = 'Published' AND assignment_status = 'assigned' 
   AND assignment_outcome = 'emergency_assigned' AND bidding_status = 'not_on_bidding' AND trading_status = 'NoTrade')
  OR
  -- S8: Published + Unassigned + BiddingClosedNoWinner
  (lifecycle_status = 'Published' AND assignment_status = 'unassigned' 
   AND assignment_outcome IS NULL AND bidding_status = 'bidding_closed_no_winner' AND trading_status = 'NoTrade')
  OR
  -- S9: Published + Confirmed + TradeRequested
  (lifecycle_status = 'Published' AND assignment_status = 'assigned' 
   AND assignment_outcome = 'confirmed' AND bidding_status = 'not_on_bidding' AND trading_status = 'TradeRequested')
  OR
  -- S10: Published + Confirmed + TradeAccepted
  (lifecycle_status = 'Published' AND assignment_status = 'assigned' 
   AND assignment_outcome = 'confirmed' AND bidding_status = 'not_on_bidding' AND trading_status = 'TradeAccepted')
  OR
  -- S11: InProgress + Assigned + Confirmed
  (lifecycle_status = 'InProgress' AND assignment_status = 'assigned' 
   AND assignment_outcome = 'confirmed' AND bidding_status = 'not_on_bidding' AND trading_status = 'NoTrade')
  OR
  -- S12: InProgress + Assigned + EmergencyAssigned
  (lifecycle_status = 'InProgress' AND assignment_status = 'assigned' 
   AND assignment_outcome = 'emergency_assigned' AND bidding_status = 'not_on_bidding' AND trading_status = 'NoTrade')
  OR
  -- S13: Completed + Assigned + Confirmed
  (lifecycle_status = 'Completed' AND assignment_status = 'assigned' 
   AND assignment_outcome = 'confirmed' AND bidding_status = 'not_on_bidding' AND trading_status = 'NoTrade')
  OR
  -- S14: Completed + Assigned + EmergencyAssigned
  (lifecycle_status = 'Completed' AND assignment_status = 'assigned' 
   AND assignment_outcome = 'emergency_assigned' AND bidding_status = 'not_on_bidding' AND trading_status = 'NoTrade')
  OR
  -- S15: Cancelled
  (lifecycle_status = 'Cancelled' AND bidding_status = 'not_on_bidding' AND trading_status = 'NoTrade'
   AND assignment_outcome IS NULL)
);

COMMENT ON CONSTRAINT valid_shift_state_combination ON shifts IS 
  'Enforces the 15 valid shift states (S1-S15) per state machine specification.';
