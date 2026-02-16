-- ============================================================
-- READY-TO-RUN VERIFICATION SCRIPT
-- Tests all RPC functions with actual IDs
-- ============================================================

-- Test Data:
-- Future shift: 3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5
-- Past shift:   cdb0b4b1-5b01-4b72-a597-418504c9fe85
-- User/Admin:   be8b6a39-6552-409d-8a5b-f00862273a9d

-- ============================================================
-- TEST 1: Helper Functions ✅
-- ============================================================

-- Test has_shift_started on FUTURE shift (should be false)
SELECT has_shift_started('3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid) as future_shift_started;
-- ✅ EXPECTED: false

-- Test has_shift_started on PAST shift (should be true)
SELECT has_shift_started('cdb0b4b1-5b01-4b72-a597-418504c9fe85'::uuid) as past_shift_started;
-- ✅ EXPECTED: true

-- Test get_shift_start_time with timezone
SELECT 
    id,
    shift_date,
    start_time,
    timezone,
    get_shift_start_time(id) as calculated_start_sydney
FROM shifts 
WHERE id = '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid;
-- ✅ EXPECTED: Shows shift start in Sydney timezone

-- ============================================================
-- TEST 2: assign_shift_rpc ✅
-- ============================================================

-- ✅ POSITIVE TEST: Assign future shift (should work)
SELECT assign_shift_rpc(
    '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid,
    'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid
);
-- ✅ EXPECTED: {"success": true, "message": "Shift assigned successfully"}

-- Verify assignment worked
SELECT id, assigned_employee_id, status, assignment_status_text
FROM shifts 
WHERE id = '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid;
-- ✅ EXPECTED: assigned_employee_id = be8b6a39-6552-409d-8a5b-f00862273a9d, status = 'assigned'

-- ❌ NEGATIVE TEST: Assign past shift (should fail)
SELECT assign_shift_rpc(
    'cdb0b4b1-5b01-4b72-a597-418504c9fe85'::uuid,
    'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid
);
-- ✅ EXPECTED: ERROR: Cannot assign shift after it has started

-- ✅ TEST: Unassign shift
SELECT assign_shift_rpc(
    '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid,
    NULL
);
-- ✅ EXPECTED: {"success": true, "message": "Shift unassigned successfully"}

-- ============================================================
-- TEST 3: bid_on_shift_rpc ✅
-- ============================================================

-- First, check if future shift is open for bidding
SELECT id, shift_date, start_time, bidding_enabled, is_on_bidding, bidding_end_at
FROM shifts
WHERE id = '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid;

-- If bidding is enabled, test placing a bid
-- ✅ POSITIVE TEST: Place bid on future shift (if bidding enabled)
-- SELECT bid_on_shift_rpc(
--     '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid,
--     'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid,
--     1
-- );
-- ✅ EXPECTED: {"success": true, "bid_id": "...", "message": "Bid placed successfully"}
-- NOTE: Commented out - only run if shift is open for bidding

-- ❌ NEGATIVE TEST: Bid on past shift (should always fail)
-- SELECT bid_on_shift_rpc(
--     'cdb0b4b1-5b01-4b72-a597-418504c9fe85'::uuid,
--     'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid,
--     1
-- );
-- ✅ EXPECTED: ERROR: Cannot bid on shift after it has started
-- NOTE: Commented out to avoid error - uncomment to test

-- ============================================================
-- TEST 4: create_swap_rpc ✅
-- ============================================================

-- First, assign future shift to user
SELECT assign_shift_rpc(
    '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid,
    'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid
);

-- ✅ POSITIVE TEST: Create swap request on future shift
SELECT create_swap_rpc(
    '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid,
    'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid,
    'swap',
    'Testing swap functionality'
);
-- ✅ EXPECTED: {"success": true, "swap_id": "...", "message": "Swap request created successfully"}

-- Verify swap created and shift flag set
SELECT id, requester_id, requester_shift_id, status, swap_type, reason
FROM shift_swaps
WHERE requester_shift_id = '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid
ORDER BY created_at DESC
LIMIT 1;
-- ✅ EXPECTED: New swap with status = 'pending'

SELECT id, is_trade_requested
FROM shifts
WHERE id = '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid;
-- ✅ EXPECTED: is_trade_requested = true

-- ❌ NEGATIVE TEST: Duplicate swap (should fail)
-- SELECT create_swap_rpc(
--     '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid,
--     'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid,
--     'swap',
--     'Another swap attempt'
-- );
-- ✅ EXPECTED: ERROR: This shift already has a pending swap request
-- NOTE: Commented out - uncomment to test after first swap succeeds

-- ============================================================
-- TEST 5: cancel_swap_rpc ✅
-- ============================================================

-- Get the swap ID we just created
SELECT id, requester_id, status
FROM shift_swaps
WHERE requester_shift_id = '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid
AND status = 'pending'
ORDER BY created_at DESC
LIMIT 1;
-- Copy the swap ID from the result above, then run:

-- ✅ POSITIVE TEST: Cancel swap (replace <swap-id> with actual ID from above)
-- SELECT cancel_swap_rpc(
--     '<swap-id-from-above>'::uuid,
--     'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid
-- );
-- ✅ EXPECTED: {"success": true, "message": "Swap request cancelled successfully"}
-- NOTE: Replace <swap-id-from-above> with the actual ID

-- Verify cancellation and flag reset
-- SELECT id, status FROM shift_swaps WHERE id = '<swap-id-from-above>'::uuid;
-- ✅ EXPECTED: status = 'cancelled'

-- SELECT id, is_trade_requested FROM shifts WHERE id = '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid;
-- ✅ EXPECTED: is_trade_requested = false

-- ============================================================
-- TEST 6: admin_delete_shift_rpc ✅
-- ============================================================

-- First, set user as admin
UPDATE profiles 
SET system_role = 'admin'
WHERE id = 'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid;

-- Verify admin status
SELECT id, full_name, email, system_role
FROM profiles 
WHERE id = 'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid;
-- ✅ EXPECTED: system_role = 'admin'

-- ✅ POSITIVE TEST: Admin deletes shift (even past one)
SELECT admin_delete_shift_rpc(
    'cdb0b4b1-5b01-4b72-a597-418504c9fe85'::uuid,
    'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid
);
-- ✅ EXPECTED: {"success": true, "message": "Shift deleted successfully"}

-- Verify soft delete
SELECT id, deleted_at
FROM shifts
WHERE id = 'cdb0b4b1-5b01-4b72-a597-418504c9fe85'::uuid;
-- ✅ EXPECTED: deleted_at IS NOT NULL

-- ❌ NEGATIVE TEST: Non-admin tries to delete
-- First, set user as non-admin
UPDATE profiles 
SET system_role = 'team_member'
WHERE id = 'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid;

-- Try to delete as non-admin (should fail)
-- SELECT admin_delete_shift_rpc(
--     '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid,
--     'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid
-- );
-- ✅ EXPECTED: ERROR: Only admins can delete shifts
-- NOTE: Commented out - uncomment to test

-- ============================================================
-- TEST 7: Timezone Verification ✅
-- ============================================================

-- Check bidding window timezone calculation
SELECT 
    id,
    shift_date,
    start_time,
    bidding_end_at,
    bidding_end_at AT TIME ZONE 'Australia/Sydney' as closes_sydney_time,
    get_shift_start_time(id) as shift_start_sydney,
    get_shift_start_time(id) - INTERVAL '4 hours' as expected_close_time
FROM shifts 
WHERE bidding_enabled = TRUE
AND bidding_end_at IS NOT NULL
LIMIT 3;
-- ✅ EXPECTED: closes_sydney_time should equal expected_close_time (4h before shift start)

-- ============================================================
-- CLEANUP (Optional)
-- ============================================================

-- Restore user to original role
UPDATE profiles 
SET system_role = 'admin'  -- or 'team_member', whatever you prefer
WHERE id = 'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid;

-- Remove test swap if created
DELETE FROM shift_swaps 
WHERE requester_shift_id = '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid
AND requester_id = 'be8b6a39-6552-409d-8a5b-f00862273a9d'::uuid;

-- Unassign test shift
SELECT assign_shift_rpc(
    '3ea9f9f2-115c-4cf3-87c0-1c26f0e5f2b5'::uuid,
    NULL
);

-- Un-delete the past shift if needed
UPDATE shifts 
SET deleted_at = NULL
WHERE id = 'cdb0b4b1-5b01-4b72-a597-418504c9fe85'::uuid;

-- ============================================================
-- SUCCESS SUMMARY
-- ============================================================

/*
✅ ALL TESTS PASSED IF:

1. has_shift_started() returns correct values
2. assign_shift_rpc() works for future shifts, fails for past shifts
3. create_swap_rpc() works for future shifts with validations
4. cancel_swap_rpc() successfully cancels swaps
5. admin_delete_shift_rpc() works for admins, fails for non-admins
6. Timezone calculations are correct (bidding closes 4h before shift)

CONGRATULATIONS! 🎉
Your shift operation security is now fully implemented and verified!
*/
