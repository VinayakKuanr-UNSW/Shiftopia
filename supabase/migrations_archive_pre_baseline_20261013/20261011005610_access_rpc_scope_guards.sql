-- ============================================================================
-- Access matrix, step 2b: the shift RPCs check the PLACE, not just a level.
--
-- These SECURITY DEFINER functions bypass RLS, and each authorised the caller
-- by level alone — "holds gamma or above somewhere", or is_admin() /
-- is_manager_or_above(), which are the same scope-free test plus the retired
-- legacy flag. A sub-department manager could therefore assign, publish,
-- delete or trade any shift in the system through the RPC layer, whatever the
-- table policies said. Each now asks user_has_action_in_scope for the action
-- the operation performs, over the shift's own organization / department /
-- sub-department (decision 1: a manager acts inside their own patch).
--
--   sm_apply_shift_op        op → action, checked on the shift before the write
--                            and on its destination after, so an edit cannot
--                            move a shift somewhere the caller does not manage
--   sm_bulk_assign(_atomic)  every shift in the batch needs shift.assign
--   sm_delete_shift / sm_bulk_delete_shifts   shift.delete per shift
--   sm_accept_trade / sm_cancel_swap_request / sm_create_swap_request
--                            the requester (or assignee) may act on their own
--                            swap; anyone else needs swap.approve over its shift
--   sm_finalize_planning_request   shift.assign over the request's shift
--   aa_user_manages_org      dropped is_admin(), which tested the CALLER while
--                            the function asks about p_user
--
-- Bodies are patched in place from pg_get_functiondef (never from an older
-- migration file — that would drop the 20261005 guards). Each pattern must
-- match exactly once or the migration aborts.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.patch(p_fn regprocedure, p_pattern text, p_replacement text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE d text; n int;
BEGIN
    d := pg_get_functiondef(p_fn);
    SELECT count(*) INTO n FROM regexp_matches(d, p_pattern, 'g');
    IF n <> 1 THEN
        RAISE EXCEPTION '%: pattern matched % times, expected 1: %', p_fn, n, p_pattern;
    END IF;
    EXECUTE regexp_replace(d, p_pattern, p_replacement);
END $$;

-- ACLs must survive CREATE OR REPLACE untouched; compared at the end.
CREATE TEMP TABLE _acl_before ON COMMIT DROP AS
SELECT p.oid, p.proacl::text AS acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('sm_apply_shift_op', 'sm_bulk_assign', 'sm_bulk_assign_atomic', 'sm_delete_shift',
                     'sm_bulk_delete_shifts', 'sm_accept_trade', 'sm_cancel_swap_request',
                     'sm_create_swap_request', 'sm_finalize_planning_request', 'aa_user_manages_org');

-- ── sm_apply_shift_op ───────────────────────────────────────────────────────
-- Pre-gate keeps "some managerial certificate" as a cheap first refusal, minus
-- the legacy flag inside is_admin().
SELECT pg_temp.patch('public.sm_apply_shift_op(uuid,integer,text,jsonb,uuid)',
    'IF v_caller IS NOT NULL AND NOT \(\s+public\.is_admin\(\)\s+OR EXISTS',
    'IF v_caller IS NOT NULL AND NOT (
       EXISTS');

SELECT pg_temp.patch('public.sm_apply_shift_op(uuid,integer,text,jsonb,uuid)',
    'ELSIF public\.is_admin\(\)\s+OR EXISTS',
    'ELSIF EXISTS');

SELECT pg_temp.patch('public.sm_apply_shift_op(uuid,integer,text,jsonb,uuid)',
    '(IF NOT FOUND THEN\s+RETURN jsonb_build_object\(''ok'', false, ''code'', ''GONE''\);\s+END IF;)',
    '\1

  -- scope guard (20261011 access matrix): the caller must hold this op''s
  -- action over THIS shift''s place, not merely a manager level somewhere.
  IF v_caller IS NOT NULL AND NOT public.user_has_action_in_scope(
       CASE p_op
         WHEN ''publish''       THEN ''shift.publish''
         WHEN ''unpublish''     THEN ''shift.publish''
         WHEN ''delete''        THEN ''shift.delete''
         WHEN ''assign''        THEN ''shift.assign''
         WHEN ''unassign''      THEN ''shift.assign''
         WHEN ''select_winner'' THEN ''bid.assign''
         WHEN ''approve_trade'' THEN ''swap.approve''
         WHEN ''reject_trade''  THEN ''swap.approve''
         WHEN ''create''        THEN ''shift.create''
         ELSE ''shift.edit''
       END,
       v_pre.organization_id, v_pre.department_id, v_pre.sub_department_id) THEN
    RETURN jsonb_build_object(''ok'', false, ''code'', ''FORBIDDEN'');
  END IF;');

SELECT pg_temp.patch('public.sm_apply_shift_op(uuid,integer,text,jsonb,uuid)',
    '(SELECT \* INTO v_cur FROM public\.shifts WHERE id = p_shift_id;)',
    '\1

  -- scope guard, destination (20261011 access matrix): an edit that moves the
  -- shift to another place needs the same authority there. Raising undoes the
  -- write.
  IF v_caller IS NOT NULL
     AND (v_cur.organization_id, v_cur.department_id, v_cur.sub_department_id)
         IS DISTINCT FROM (v_pre.organization_id, v_pre.department_id, v_pre.sub_department_id)
     AND NOT public.user_has_action_in_scope(''shift.edit'', v_cur.organization_id, v_cur.department_id, v_cur.sub_department_id) THEN
    RAISE EXCEPTION ''Not authorised: shift.edit is not granted to you where this shift is moving''
      USING ERRCODE = ''42501'';
  END IF;');

-- ── sm_bulk_assign ──────────────────────────────────────────────────────────
SELECT pg_temp.patch('public.sm_bulk_assign(uuid[],uuid,uuid)',
    'public\.is_manager_or_above\(\)\s+OR public\.is_admin\(\)\s+OR (EXISTS \(\s+SELECT 1 FROM public\.app_access_certificates c\s+WHERE c\.user_id = v_caller\s+AND c\.is_active = true\s+AND c\.access_level IN \(''gamma'', ''delta'', ''epsilon'', ''zeta''\)\s+\))',
    '(\1
       -- scope guard (20261011 access matrix): every shift in the batch must
       -- be one the caller may assign in its own place.
       AND NOT EXISTS (
            SELECT 1 FROM public.shifts s
             WHERE s.id = ANY (COALESCE(p_shift_ids, ''{}''))
               AND NOT public.user_has_action_in_scope(''shift.assign'', s.organization_id, s.department_id, s.sub_department_id)))');

-- ── sm_bulk_assign_atomic ───────────────────────────────────────────────────
SELECT pg_temp.patch('public.sm_bulk_assign_atomic(jsonb,uuid,uuid)',
    'public\.is_manager_or_above\(\)\s+OR public\.is_admin\(\)\s+OR (EXISTS \(\s+SELECT 1 FROM public\.app_access_certificates c\s+WHERE c\.user_id = v_caller\s+AND c\.is_active = true\s+AND c\.access_level IN \(''gamma'', ''delta'', ''epsilon'', ''zeta''\)\s+\))',
    '(\1
           -- scope guard (20261011 access matrix): every shift in every pair
           -- must be one the caller may assign in its own place.
           AND NOT EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(COALESCE(p_assignments, ''[]''::jsonb)) AS pr(v),
                       jsonb_array_elements_text(COALESCE(pr.v->''shift_ids'', ''[]''::jsonb)) AS e(id)
                  JOIN public.shifts s ON s.id = e.id::uuid
                 WHERE NOT public.user_has_action_in_scope(''shift.assign'', s.organization_id, s.department_id, s.sub_department_id)))');

-- ── sm_delete_shift / sm_bulk_delete_shifts ─────────────────────────────────
-- _can_manage_shifts() was "gamma or above anywhere, or no JWT". The
-- replacement keeps the no-JWT system path (sm_request_is_system) and checks
-- shift.delete over each shift's own place.
SELECT pg_temp.patch('public.sm_delete_shift(uuid,uuid,text,integer)',
    'IF NOT public\._can_manage_shifts\(\) THEN',
    'IF NOT public.sm_request_is_system() AND (auth.uid() IS NULL OR EXISTS (
       -- scope guard (20261011 access matrix)
       SELECT 1 FROM public.shifts s
        WHERE s.id = p_shift_id
          AND NOT public.user_has_action_in_scope(''shift.delete'', s.organization_id, s.department_id, s.sub_department_id))) THEN');

SELECT pg_temp.patch('public.sm_bulk_delete_shifts(uuid[],uuid,text)',
    'IF NOT public\._can_manage_shifts\(\) THEN',
    'IF NOT public.sm_request_is_system() AND (auth.uid() IS NULL OR EXISTS (
       -- scope guard (20261011 access matrix): every shift in the batch
       SELECT 1 FROM public.shifts s
        WHERE s.id = ANY (COALESCE(p_shift_ids, ''{}''))
          AND NOT public.user_has_action_in_scope(''shift.delete'', s.organization_id, s.department_id, s.sub_department_id))) THEN');

-- ── swaps ───────────────────────────────────────────────────────────────────
SELECT pg_temp.patch('public.sm_accept_trade(uuid,uuid,uuid,uuid,jsonb)',
    'AND NOT public\.is_admin\(\) THEN',
    'AND NOT public.can_act_on_shift(''swap.approve'', v_swap.requester_shift_id) THEN');

SELECT pg_temp.patch('public.sm_cancel_swap_request(uuid)',
    'AND NOT public\.is_admin\(\) THEN',
    'AND NOT public.can_act_on_shift(''swap.approve'', v_swap.requester_shift_id) THEN');

SELECT pg_temp.patch('public.sm_create_swap_request(uuid,uuid,text)',
    'AND NOT public\.is_admin\(\) THEN',
    'AND NOT public.can_act_on_shift(''swap.approve'', v_shift.id) THEN');

-- ── planning requests ───────────────────────────────────────────────────────
SELECT pg_temp.patch('public.sm_finalize_planning_request(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)',
    'IF NOT \(public\.is_manager_or_above\(\) OR public\.is_admin\(\)\) THEN',
    'IF NOT public.can_act_on_shift(''shift.assign'',
           (SELECT pr.shift_id FROM public.planning_requests pr WHERE pr.id = p_request_id)) THEN');

-- ── aa_user_manages_org ─────────────────────────────────────────────────────
SELECT pg_temp.patch('public.aa_user_manages_org(uuid,uuid)',
    'public\.is_admin\(\) OR ',
    '');

-- ── Verify ──────────────────────────────────────────────────────────────────
DO $verify$
DECLARE v_failures text := ''; r record;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS fn, p.proacl::text AS acl, b.acl AS acl_before, pg_get_functiondef(p.oid) AS d
          FROM pg_proc p JOIN _acl_before b ON b.oid = p.oid
    LOOP
        IF r.acl IS DISTINCT FROM r.acl_before THEN
            v_failures := v_failures || format('%s ACL changed ; ', r.fn);
        END IF;
        IF r.d ~ '(is_admin|is_manager_or_above|_can_manage_shifts)\(\)' THEN
            v_failures := v_failures || format('%s still calls a scope-free helper ; ', r.fn);
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname IN ('sm_apply_shift_op', 'sm_bulk_assign', 'sm_bulk_assign_atomic',
               'sm_delete_shift', 'sm_bulk_delete_shifts')
           AND pg_get_functiondef(p.oid) ~ 'scope guard \(20261011 access matrix\)') <> 5 THEN
        v_failures := v_failures || 'a shift RPC is missing its scope guard ; ';
    END IF;
    IF pg_get_functiondef('public.sm_apply_shift_op(uuid,integer,text,jsonb,uuid)'::regprocedure) !~ 'authz guard|scope guard, destination' THEN
        v_failures := v_failures || 'sm_apply_shift_op lost a guard ; ';
    END IF;
    IF v_failures <> '' THEN
        RAISE EXCEPTION 'access matrix step 2b verification failed: %', v_failures;
    END IF;
END
$verify$;
