-- sm_approve_peer_swap: internal to the shift gateway only.
--
-- SECURITY DEFINER, no permission check, no check that a swap exists: it
-- overwrites assigned_employee_id on whatever shift ids it is handed. It was
-- executable by `authenticated`, so any signed-in user could reassign any
-- unstarted shift via /rpc/sm_approve_peer_swap.
--
-- The app never calls it directly. Its one caller is _apply_shift_op_write
-- (op 'approve_trade', reached through sm_apply_shift_op), which takes the
-- requester shift FOR UPDATE, checks its version and requires a
-- MANAGER_PENDING swap. That chain is SECURITY DEFINER and owned by postgres,
-- so it keeps EXECUTE after this revoke.
--
-- Test: supabase/tests/approve_peer_swap_internal_only.sql

REVOKE EXECUTE ON FUNCTION public.sm_approve_peer_swap(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
