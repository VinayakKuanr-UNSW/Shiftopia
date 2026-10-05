-- =============================================================================
-- Migration: 20260821090200_revoke_generate_availability_slots_execute.sql
--
-- `generate_availability_slots()` is a SECURITY DEFINER TRIGGER function that
-- has carried `authenticated=X` since the baseline schema. get_advisors flags
-- it as `authenticated_security_definer_function_executable` — the same gap
-- 20260809000300 closed for trg_availability_rule_closes_request() and
-- 20260817120000 closed for trg_prevent_ft_availability_rule(): Supabase grants
-- EXECUTE on new functions to PUBLIC (hence anon) AND to authenticated, so
-- revoking PUBLIC alone leaves it reachable over /rest/v1/rpc.
--
-- Picked up here because 20260821090000 rewrote this function's body to carry
-- `sub_department_id`, and CREATE OR REPLACE preserves the existing ACL — so the
-- rewrite inherited the exposure rather than introducing it. Touching the
-- function is what made it ours to close.
--
-- SAFE FOR THE TRIGGER. A trigger fires in the table owner's context and does
-- not require the statement's caller to hold EXECUTE on the trigger function.
-- Direct RPC invocation was never useful anyway — PostgreSQL rejects a trigger
-- function called outside a trigger — so this removes reachability, not
-- capability. Verified below rather than assumed.
-- =============================================================================

REVOKE ALL ON FUNCTION public.generate_availability_slots()
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_acl  text;
  v_rule uuid;
  v_slots int;
  v_prof uuid;
  v_sd   uuid;
BEGIN
  SELECT array_to_string(p.proacl, ' | ') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'generate_availability_slots';

  IF v_acl LIKE '%anon=%' OR v_acl LIKE '%authenticated=%' THEN
    RAISE EXCEPTION 'revoke failed — generate_availability_slots is still reachable: %', v_acl
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The trigger must still materialise slots. Rolled back via a subtransaction.
  SELECT uc.user_id, uc.sub_department_id INTO v_prof, v_sd
    FROM hr.user_contracts uc
   WHERE uc.status = 'Active'
     AND LOWER(COALESCE(uc.employment_status::text,'')) NOT LIKE '%full%'
     AND uc.sub_department_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM hr.user_contracts o
                      WHERE o.user_id = uc.user_id AND o.status = 'Active'
                        AND LOWER(COALESCE(o.employment_status::text,'')) LIKE '%full%')
   LIMIT 1;

  IF v_prof IS NOT NULL THEN
    BEGIN
      INSERT INTO public.availability_rules
        (profile_id, start_date, start_time, end_time, repeat_type, repeat_days, sub_department_id)
      VALUES (v_prof, DATE '2027-03-01', '09:00', '17:00', 'weekly', ARRAY[1,3,5], v_sd)
      RETURNING id INTO v_rule;

      SELECT count(*) INTO v_slots FROM public.availability_slots WHERE rule_id = v_rule;

      IF v_slots = 0 THEN
        RAISE EXCEPTION 'revoke BROKE the trigger — a weekly rule materialised 0 slots'
          USING ERRCODE = 'data_exception';
      END IF;

      RAISE EXCEPTION 'rollback probe' USING ERRCODE = 'raise_exception';
    EXCEPTION
      WHEN raise_exception THEN NULL;
    END;
  END IF;

  RAISE LOG '[revoke] generate_availability_slots no longer reachable by anon/authenticated; trigger still materialises slots (% on the probe)', v_slots;
END $$;
