-- Applied separately after `get_advisors` flagged the trigger function as
-- `authenticated`-executable over /rest/v1/rpc. Folded back into
-- 20260809000100 as well, so a fresh baseline never has the gap.
REVOKE ALL ON FUNCTION public.trg_availability_rule_closes_request()
    FROM PUBLIC, anon, authenticated;
