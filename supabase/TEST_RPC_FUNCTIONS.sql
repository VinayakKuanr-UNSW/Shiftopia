-- ============================================================
-- VERIFICATION TEST QUERIES
-- Phase 3: Testing Database RPC Functions
-- ============================================================

-- ============================================================
-- SETUP: Get Test Data
-- ============================================================

-- Find a future shift (for positive tests)
SELECT id, shift_date, start_time, status, assigned_employee_id
FROM shifts 
WHERE shift_date >= CURRENT_DATE
AND deleted_at IS NULL
LIMIT 5;

-- Find a past shift (for negative tests)
SELECT id, shift_date, start_time, status, assigned_employee_id
FROM shifts 
WHERE shift_date < CURRENT_DATE
AND deleted_at IS NULL
LIMIT 5;

-- Get an employee ID for testing
SELECT id, full_name, email
FROM profiles
LIMIT 5;

-- ============================================================
-- TEST 1: Helper Functions
-- ============================================================

-- Test get_shift_start_time (replace <shift-id>)
SELECT 
    id,
    shift_date,
    start_time,
    timezone,
    get_shift_start_time(id) as calculated_start
FROM shifts 
WHERE id = '<replace-with-shift-id>'::uuid;

-- Expected: calculated_start should be shift_date + start_time in Sydney timezone

-- Test has_shift_started on future shift
SELECT has_shift_started('<future-shift-id>'::uuid) as has_started;
-- Expected: false

-- Test has_shift_started on past shift
SELECT has_shift_started('<past-shift-id>'::uuid) as has_started;
-- Expected: true

-- ============================================================
-- TEST 2: assign_shift_rpc
-- ============================================================

-- POSITIVE TEST: Assign future shift
SELECT assign_shift_rpc(
    '<future-shift-id>'::uuid,
    '<employee-id>'::uuid
);
-- Expected: {"success": true, "message": "Shift assigned successfully"}

-- Verify assignment worked
SELECT id, assigned_employee_id, status, assignment_status_text
FROM shifts 
WHERE id = '<future-shift-id>'::uuid;
-- Expected: assigned_employee_id = employee-id, status = 'assigned'

-- NEGATIVE TEST: Assign past shift (should fail)
SELECT assign_shift_rpc(
    '<past-shift-id>'::uuid,
    '<employee-id>'::uuid
);
-- Expected: ERROR: Cannot assign shift after it has started

-- TEST: Unassign shift
SELECT assign_shift_rpc(
    '<future-shift-id>'::uuid,
    NULL
);
-- Expected: {"success": true, "message": "Shift unassigned successfully"}

-- ============================================================
-- TEST 3: bid_on_shift_rpc
-- ============================================================

-- Setup: Find an open bidding shift
SELECT id, shift_date, start_time, bidding_enabled, is_on_bidding, bidding_end_at
FROM shifts
WHERE bidding_enabled = TRUE
AND is_on_bidding = TRUE
AND shift_date >= CURRENT_DATE
LIMIT 3;

-- POSITIVE TEST: Place bid on open shift
SELECT bid_on_shift_rpc(
    '<open-bidding-shift-id>'::uuid,
    '<employee-id>'::uuid,
    1
);
-- Expected: {"success": true, "bid_id": "...", "message": "Bid placed successfully"}

-- Verify bid created
SELECT id, shift_id, employee_id, status, priority
FROM shift_bids
WHERE shift_id = '<open-bidding-shift-id>'::uuid
AND employee_id = '<employee-id>'::uuid;

-- NEGATIVE TEST: Duplicate bid (should fail)
SELECT bid_on_shift_rpc(
    '<open-bidding-shift-id>'::uuid,
    '<employee-id>'::uuid,
    1
);
-- Expected: ERROR: You already have an active bid on this shift

-- NEGATIVE TEST: Bid on started shift (should fail)
SELECT bid_on_shift_rpc(
    '<past-shift-id>'::uuid,
    '<employee-id>'::uuid,
    1
);
-- Expected: ERROR: Cannot bid on shift after it has started

-- ============================================================
-- TEST 4: withdraw_bid_rpc
-- ============================================================

-- Setup: Get a bid ID from previous test
SELECT id, shift_id, employee_id, status
FROM shift_bids
WHERE employee_id = '<employee-id>'::uuid
AND status = 'pending'
LIMIT 1;

-- POSITIVE TEST: Withdraw pending bid
SELECT withdraw_bid_rpc(
    '<bid-id>'::uuid,
    '<employee-id>'::uuid
);
-- Expected: {"success": true, "message": "Bid withdrawn successfully"}

-- Verify withdrawal
SELECT id, status
FROM shift_bids
WHERE id = '<bid-id>'::uuid;
-- Expected: status = 'withdrawn'

-- ============================================================
-- TEST 5: create_swap_rpc
-- ============================================================

-- Setup: Find a shift assigned to employee
SELECT id, shift_date, start_time, assigned_employee_id
FROM shifts
WHERE assigned_employee_id = '<employee-id>'::uuid
AND shift_date >= CURRENT_DATE
AND deleted_at IS NULL
LIMIT 3;

-- POSITIVE TEST: Create swap request
SELECT create_swap_rpc(
    '<assigned-shift-id>'::uuid,
    '<employee-id>'::uuid,
    'swap',
    'Need to switch this shift'
);
-- Expected: {"success": true, "swap_id": "...", "message": "Swap request created successfully"}

-- Verify swap created
SELECT id, requester_id, requester_shift_id, status, swap_type, reason
FROM shift_swaps
WHERE requester_shift_id = '<assigned-shift-id>'::uuid;

-- Verify shift flag set
SELECT id, is_trade_requested
FROM shifts
WHERE id = '<assigned-shift-id>'::uuid;
-- Expected: is_trade_requested = true

-- NEGATIVE TEST: Duplicate swap (should fail)
SELECT create_swap_rpc(
    '<assigned-shift-id>'::uuid,
    '<employee-id>'::uuid,
    'swap',
    'Another reason'
);
-- Expected: ERROR: This shift already has a pending swap request

-- NEGATIVE TEST: Swap on past shift (should fail)
SELECT create_swap_rpc(
    '<past-shift-id-assigned-to-employee>'::uuid,
    '<employee-id>'::uuid,
    'swap',
    'Test'
);
-- Expected: ERROR: Cannot create swap request after shift has started

-- ============================================================
-- TEST 6: cancel_swap_rpc
-- ============================================================

-- Setup: Get swap ID from previous test
SELECT id, requester_id, status
FROM shift_swaps
WHERE requester_id = '<employee-id>'::uuid
AND status = 'pending'
LIMIT 1;

-- POSITIVE TEST: Cancel swap
SELECT cancel_swap_rpc(
    '<swap-id>'::uuid,
    '<employee-id>'::uuid
);
-- Expected: {"success": true, "message": "Swap request cancelled successfully"}

-- Verify cancellation
SELECT id, status
FROM shift_swaps
WHERE id = '<swap-id>'::uuid;
-- Expected: status = 'cancelled'

-- Verify shift flag reset
SELECT id, is_trade_requested
FROM shifts
WHERE id = '<assigned-shift-id>'::uuid;
-- Expected: is_trade_requested = false

-- ============================================================
-- TEST 7: admin_delete_shift_rpc
-- ============================================================

-- Setup: Get user ID with admin role
SELECT id, full_name, system_role
FROM profiles
WHERE system_role = 'admin'
LIMIT 1;

-- POSITIVE TEST: Admin deletes shift (even started one)
SELECT admin_delete_shift_rpc(
    '<any-shift-id>'::uuid,
    '<admin-id>'::uuid
);
-- Expected: {"success": true, "message": "Shift deleted successfully"}

-- Verify soft delete
SELECT id, deleted_at
FROM shifts
WHERE id = '<any-shift-id>'::uuid;
-- Expected: deleted_at IS NOT NULL

-- NEGATIVE TEST: Non-admin tries to delete
SELECT admin_delete_shift_rpc(
    '<another-shift-id>'::uuid,
    '<regular-employee-id>'::uuid
);
-- Expected: ERROR: Only admins can delete shifts

-- ============================================================
-- TEST 8: Timezone Verification
-- ============================================================

-- Test: Cancel a shift and verify bidding window timezone
-- First, create a test shift for tomorrow at 6:00 AM
-- Then cancel it using cancel_shift_v2
-- Check bidding_end_at

SELECT 
    id,
    shift_date,
    start_time,
    bidding_end_at,
    bidding_end_at AT TIME ZONE 'Australia/Sydney' as closes_sydney_time,
    get_shift_start_time(id) as shift_start_sydney
FROM shifts 
WHERE bidding_enabled = TRUE
AND bidding_end_at IS NOT NULL
LIMIT 3;

-- Expected: closes_sydney_time should be exactly 4 hours before shift_start_sydney

-- ============================================================
-- CLEANUP (Optional)
-- ============================================================

-- Remove test bids
-- DELETE FROM shift_bids WHERE employee_id = '<employee-id>';

-- Remove test swaps
-- DELETE FROM shift_swaps WHERE requester_id = '<employee-id>';

-- ============================================================
-- SUCCESS CRITERIA
-- ============================================================

/*
ALL TESTS SHOULD PASS IF:

✅ Helper functions return correct Sydney times
✅ assign_shift_rpc blocks started shifts
✅ bid_on_shift_rpc validates properly
✅ withdraw_bid_rpc validates ownership
✅ create_swap_rpc blocks started shifts
✅ cancel_swap_rpc validates ownership
✅ admin_delete_shift_rpc enforces admin-only
✅ Timezone calculations are correct
*/
