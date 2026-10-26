-- fn_sync_timesheet_actual_break is a SECURITY DEFINER trigger function, and it
-- kept the default EXECUTE for PUBLIC — the only definer function in the
-- database anon could reach (Supabase security advisor, 2026-10-26). A trigger
-- fires without an EXECUTE check, so revoking it changes nothing for the
-- trigger and closes /rest/v1/rpc/fn_sync_timesheet_actual_break.
REVOKE ALL ON FUNCTION public.fn_sync_timesheet_actual_break() FROM PUBLIC, anon, authenticated;
