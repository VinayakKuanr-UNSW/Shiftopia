-- ============================================================================
-- Phase 6 — has_permission, the last reimplementation of the ladder.
--
-- Two overloads existed, with the IDENTICAL argument-name set
-- {_user_id, _target_sub_dept_id, _required_level}. PostgREST disambiguates
-- overloads by argument name, so an RPC call to `has_permission` resolved to
-- NEITHER (PGRST203) — the pair was mutually unreachable over the API while
-- both held EXECUTE for `authenticated`.
--
-- The enum overload had zero hard dependents, zero calling policies, zero
-- function bodies and zero client calls. Dropped. That also resolves the
-- ambiguity as a side effect.
--
-- The surviving text overload declared
--
--     _level_order CONSTANT TEXT[] := ARRAY['alpha','beta','gamma','delta','epsilon','zeta']
--
-- and compared levels with array_position — the access_level enum's own
-- declaration order, reimplemented as a text array, in the fifth and last
-- place. Verified equivalent over all 36 ordered level pairs before replacing
-- it with native `>=`.
--
-- ── THE CAST IS GUARDED, AND THAT IS THE WHOLE RISK OF THIS MIGRATION ──────
--
-- array_position returns NULL for unrecognised text, so the function returned
-- FALSE. A bare `lower(x)::access_level` RAISES 22P02 instead — and all three
-- callers are RLS policies on `shifts`, where an exception aborts the entire
-- statement. A deny would have become an error. The explicit NULL check stays
-- AHEAD of the zeta bypass for the same reason: without it a NULL level falls
-- through and a zeta holder gets TRUE where they previously got FALSE. Both
-- are asserted in the self-test, including the mixed-case 'Gamma' that all
-- three live callers actually pass.
--
-- Marked STABLE. It only reads tables and takes its subject as a parameter, so
-- it was never VOLATILE in fact; the planner could not cache it across the rows
-- of an RLS predicate.
--
-- ── WHAT IS DELIBERATELY LEFT ALONE ────────────────────────────────────────
--
-- The contract branch carries two catch-all disjuncts that the certificate
-- branch does not:
--
--     OR (uc.sub_department_id IS NULL AND uc.department_id = _target_dept_id)
--     OR (uc.department_id IS NULL AND uc.sub_department_id IS NULL
--         AND uc.organization_id = _target_org_id)
--
-- Neither tests access_level, so a NULL scope column is read as "unscoped,
-- therefore allow everything at this tier" — the exact opposite of what
-- user_has_action_in_scope reads it as, where a NULL yields NULL and denies.
-- That silently promotes a gamma contract to department- or organization-wide.
-- Zero gamma or delta grants exist in production, so it is latent.
--
-- It is left in because removing it is a BEHAVIOUR CHANGE, and mixing one into
-- a refactor is how a diff stops being evidence. Two related decisions belong
-- with it, not here: `rbac_permissions` has no gamma row for `shift.delete`,
-- so pointing shifts_delete_managers at the gate would revoke gamma's ability
-- to delete shifts; and the three `shifts` policies would need rewriting to
-- pass action codes instead of a level floor.
-- ============================================================================

-- Applied to production as 20260825044152. Definition below is the live one,
-- read back with pg_get_functiondef rather than retyped.

DROP FUNCTION IF EXISTS public.has_permission(uuid, public.access_level, uuid);

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _target_sub_dept_id uuid, _required_level text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  _target_dept_id UUID;
  _target_org_id  UUID;
  _required       public.access_level;
BEGIN
  IF _required_level IS NULL THEN
    RETURN FALSE;
  END IF;

  BEGIN
    _required := lower(_required_level)::public.access_level;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN FALSE;
  END;

  -- Zeta bypass.
  IF EXISTS (
    SELECT 1 FROM app_access_certificates
     WHERE user_id = _user_id AND access_level = 'zeta' AND is_active = true
  ) THEN
    RETURN TRUE;
  END IF;

  SELECT sd.department_id, d.organization_id
    INTO _target_dept_id, _target_org_id
    FROM sub_departments sd
    JOIN departments d ON d.id = sd.department_id
   WHERE sd.id = _target_sub_dept_id;

  IF _target_dept_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM user_contracts uc
     WHERE uc.user_id = _user_id
       AND uc.status = 'Active'
       AND uc.access_level >= _required
       AND (
            (uc.access_level = 'epsilon' AND uc.organization_id = _target_org_id)
         OR (uc.access_level = 'delta'   AND uc.organization_id = _target_org_id
             AND uc.department_id = _target_dept_id)
         OR (uc.sub_department_id = _target_sub_dept_id)
         -- These two read a NULL scope column as "unscoped, therefore allow
         -- everything at this tier", which is the opposite of what the gate
         -- reads it as. Preserved here; removing them is a behaviour change.
         OR (uc.sub_department_id IS NULL AND uc.department_id = _target_dept_id)
         OR (uc.department_id IS NULL AND uc.sub_department_id IS NULL
             AND uc.organization_id = _target_org_id)
       )
  ) OR EXISTS (
    SELECT 1 FROM app_access_certificates ac
     WHERE ac.user_id = _user_id
       AND ac.is_active = true
       AND ac.access_level >= _required
       AND (
            (ac.access_level = 'epsilon' AND ac.organization_id = _target_org_id)
         OR (ac.access_level = 'delta'   AND ac.organization_id = _target_org_id
             AND ac.department_id = _target_dept_id)
         OR (ac.sub_department_id = _target_sub_dept_id)
       )
  );
END;
$function$
;
