BEGIN;
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.profiles SET legacy_system_role = 'admin' WHERE id = 'a0000000-0000-4000-8000-000000000006';
DO $lt$
DECLARE r text; x uuid := 'a0000000-0000-4000-8000-000000000006';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := 'X(flag=admin, no cert): is_admin=' || public.is_admin() || ' mgr_or_above=' || public.is_manager_or_above()
     || ' delta_access=' || public.user_has_delta_access(x) || ' bcast_sys=' || public.is_broadcast_system_manager();
  BEGIN
    PERFORM public.sm_require_scope('shift.edit', '00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', '6fefad95-9cf9-468c-8724-424cc2f7b640');
    r := r || ' require_scope=PASS';
  EXCEPTION WHEN insufficient_privilege THEN r := r || ' require_scope=denied';
  END;
  BEGIN
    UPDATE public.profiles SET legacy_system_role = 'manager' WHERE id = x;
    r := r || ' change_own_flag=ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN r := r || ' change_own_flag=refused';
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-4000-8000-000000000005', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := r || ' | Z: bcast_sys=' || public.is_broadcast_system_manager();
  RESET ROLE;
  RAISE NOTICE '%', r;
END $lt$;
ROLLBACK;
