-- ============================================================================
-- Phase 5 — the function layer's IN-lists become native enum comparisons.
--
-- Phases 1-4 emptied the POLICY layer. This is the function layer: five
-- functions each carrying a hand-maintained list of enum members where the type
-- system already provides the ordering. `access_level >= 'gamma'` is the whole
-- of `IN ('gamma','delta','epsilon','zeta')`.
--
-- Diff against post-phase-3: EMPTY.
--
-- ── TWO THINGS THE REWRITE TURNED UP ───────────────────────────────────────
--
-- `auth_can_manage_templates` NEVER CHECKED is_active. A deactivated
-- certificate still granted template management — the same offboarding hole
-- Phase 1 closed in the policy layer, hiding one level down. Moving it onto
-- `sm_cert_at_least`, which checks is_active, is therefore a deliberate
-- NARROWING as well as a consolidation. Zero certificates are inactive today,
-- so the diff stays empty and the fix lands before it can matter.
--
-- `auth_can_manage_certificates` tests `legacy_system_role = 'admin'` ONLY,
-- where its siblings test IN ('admin','manager'). Substituting
-- `sm_legacy_manager()` there would have admitted every legacy manager to
-- certificate administration — a widening, in the migration meant to tidy up.
-- The check is left inline and the self-test asserts the helper was NOT used,
-- because the tempting edit is the wrong one.
--
-- ── WHAT ELSE CHANGED, AND WHY IT IS THE SAME CHANGE ───────────────────────
--
-- `trg_bidding_expired_notification_fn` ranked managers with
-- `CASE access_level WHEN 'gamma' THEN 1 WHEN 'delta' THEN 2 ...` — a
-- reimplementation of the enum's own sort order, in a fourth place. `ORDER BY
-- access_level` ascending is that ranking, exactly.
--
-- `validate_certificate_on_change` is a shape check rather than an
-- authorization check, so no helper applies; its `NOT IN (gamma..zeta)` is
-- simply `< 'gamma'`, and the Type X branch's `NOT IN ('alpha','beta')` is
-- `> 'beta'`.
--
-- ── THREE LEFT, DELIBERATELY, AND THE REASON ───────────────────────────────
--
-- `sm_apply_shift_op` (10.9 kB), `sm_bulk_assign_atomic` (5.9 kB) and
-- `sm_bulk_assign` (2.7 kB) each guard on
--
--     is_manager_or_above() OR is_admin() OR EXISTS (cert IN (gamma..zeta))
--
-- The second and third disjuncts are SUBSUMED by the first:
-- is_manager_or_above() is `sm_legacy_manager() OR sm_cert_at_least('gamma')`;
-- is_admin() is the same legacy test with a HIGHER threshold; and the EXISTS is
-- `sm_cert_at_least('gamma')` for auth.uid() written out. Verified against
-- production for every one of the 107 profiles: `(a OR b OR c)` and `a` agree
-- everywhere.
--
-- So it is redundancy, not a defect — the guard is correct, just three times
-- longer than it needs to be. Rewriting a 10.9 kB function by transcription to
-- delete a provably-inert clause trades a real risk of a transcription error
-- for no behaviour change at all. Recorded here instead, so whoever next opens
-- those functions for a reason of their own can drop the clause in passing.
-- ============================================================================

-- 1. Certificates admin. Legacy check is `= 'admin'` ONLY — deliberately not
--    sm_legacy_manager(), which also admits 'manager'. certificate_type='Y' is
--    kept even though chk_level_matches_type makes it redundant for
--    epsilon/zeta; relying on that would couple this function to a CHECK.
CREATE OR REPLACE FUNCTION public.auth_can_manage_certificates()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF EXISTS (SELECT 1 FROM profiles
                WHERE id = auth.uid() AND legacy_system_role = 'admin') THEN
        RETURN TRUE;
    END IF;

    IF EXISTS (
        SELECT 1 FROM app_access_certificates
         WHERE user_id = auth.uid()
           AND access_level >= 'epsilon'
           AND certificate_type = 'Y'
           AND is_active = true
    ) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$function$;

-- 2. Templates. Gains the is_active test it never had — see the header.
CREATE OR REPLACE FUNCTION public.auth_can_manage_templates()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN public.sm_cert_at_least('gamma') OR public.sm_legacy_manager();
END;
$function$;

-- 3. Bidding-expired notification: ORDER BY the enum instead of a CASE ladder.
CREATE OR REPLACE FUNCTION public.trg_bidding_expired_notification_fn()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_manager_id UUID;
BEGIN
  IF NOT (
    OLD.bidding_status IN ('on_bidding_normal', 'on_bidding_urgent', 'on_bidding')
    AND NEW.bidding_status = 'not_on_bidding'
    AND NEW.lifecycle_status = 'Draft'
    AND OLD.assigned_employee_id IS NULL
  ) THEN RETURN NEW; END IF;

  -- Nearest manager first. app_access_certificates keys the manager by
  -- `user_id`, not `profile_id` (which does not exist) — referencing the wrong
  -- column once made every qualifying UPDATE on shifts fail.
  SELECT user_id INTO v_manager_id
  FROM   app_access_certificates
  WHERE  sub_department_id = NEW.sub_department_id
    AND  access_level >= 'gamma'
    AND  is_active = true
  ORDER  BY access_level
  LIMIT 1;

  IF v_manager_id IS NULL THEN RETURN NEW; END IF;

  PERFORM notify_user(
    v_manager_id,
    'bid_no_winner',
    'Bidding Closed — No Winner',
    format(
      'Shift on %s (start %s) expired with no bid winner. Use emergency assignment.',
      TO_CHAR(NEW.shift_date::date, 'DD Mon YYYY'),
      TO_CHAR(NEW.start_time::time, 'HH24:MI')
    ),
    '/management/bids',
    'shift',
    NEW.id::text
  );

  RETURN NEW;
END;
$function$;

-- 4. Employee-drop notification.
CREATE OR REPLACE FUNCTION public.trg_employee_drop_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_manager_id   UUID;
  v_dropper_name TEXT;
BEGIN
  IF (NEW.bidding_status::TEXT = 'on_bidding')
    AND (OLD.bidding_status IS DISTINCT FROM NEW.bidding_status)
    AND OLD.assigned_employee_id IS NOT NULL
    AND NEW.assigned_employee_id IS NULL
  THEN
    SELECT COALESCE(first_name || ' ' || last_name, email, 'An employee')
    INTO   v_dropper_name
    FROM   profiles
    WHERE  id = OLD.assigned_employee_id
    LIMIT  1;

    IF NEW.sub_department_id IS NOT NULL THEN
      SELECT user_id INTO v_manager_id
      FROM   app_access_certificates
      WHERE  sub_department_id = NEW.sub_department_id
        AND  access_level       = 'gamma'
        AND  is_active          = true
      LIMIT  1;
    END IF;

    IF v_manager_id IS NULL AND NEW.department_id IS NOT NULL THEN
      SELECT user_id INTO v_manager_id
      FROM   app_access_certificates
      WHERE  department_id    = NEW.department_id
        AND  access_level     >= 'delta'
        AND  is_active        = true
        AND  sub_department_id IS NULL
      LIMIT  1;
    END IF;

    IF v_manager_id IS NOT NULL THEN
      PERFORM notify_user(
        v_manager_id,
        'shift_dropped',
        'Shift dropped',
        v_dropper_name || ' dropped their shift on ' || NEW.shift_date || '. It has been re-listed for urgent bidding.',
        NEW.id,
        'shift',
        '/management/bids',
        'shift_dropped:' || NEW.id::TEXT || ':' || OLD.assigned_employee_id::TEXT
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 5. Certificate shape validation — not an authorization check, so no helper.
CREATE OR REPLACE FUNCTION public.validate_certificate_on_change()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_existing_y_count INTEGER;
BEGIN
    IF NEW.certificate_type = 'Y' AND NEW.is_active = true THEN
        SELECT COUNT(*) INTO v_existing_y_count
        FROM app_access_certificates
        WHERE user_id = NEW.user_id
          AND certificate_type = 'Y'
          AND is_active = true
          AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

        IF v_existing_y_count > 0 THEN
            RAISE EXCEPTION 'User already has an active Type Y certificate. Only one is allowed.';
        END IF;
    END IF;

    IF NEW.certificate_type = 'X' AND NEW.access_level > 'beta' THEN
        RAISE EXCEPTION 'Type X certificates must have alpha or beta level.';
    END IF;

    IF NEW.certificate_type = 'Y' AND NEW.access_level < 'gamma' THEN
        RAISE EXCEPTION 'Type Y certificates must be gamma or above.';
    END IF;

    IF NEW.department_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM departments
            WHERE id = NEW.department_id AND organization_id = NEW.organization_id
        ) THEN
            RAISE EXCEPTION 'Department does not belong to the specified organization.';
        END IF;
    END IF;

    IF NEW.sub_department_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM sub_departments
            WHERE id = NEW.sub_department_id AND department_id = NEW.department_id
        ) THEN
            RAISE EXCEPTION 'Sub-department does not belong to the specified department.';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

DO $selftest$
DECLARE v_failures text := ''; v_n int;
BEGIN
    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('auth_can_manage_certificates','auth_can_manage_templates',
                         'trg_bidding_expired_notification_fn','trg_employee_drop_notification',
                         'validate_certificate_on_change')
       AND p.prosrc ~ 'IN \(''(gamma|delta|epsilon|zeta)';
    IF v_n > 0 THEN
        v_failures := v_failures || format('(a) %s functions still carry an IN-list ; ', v_n);
    END IF;

    -- The tempting edit is the wrong one: this function must NOT gain 'manager'.
    IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname='auth_can_manage_certificates') ~ 'sm_legacy_manager' THEN
        v_failures := v_failures
            || '(b) auth_can_manage_certificates now admits legacy manager — that is a widening ; ';
    END IF;

    IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname='auth_can_manage_templates') !~ 'sm_cert_at_least' THEN
        v_failures := v_failures || '(c) auth_can_manage_templates did not move onto the helper ; ';
    END IF;

    -- If this ever fails, ORDER BY access_level silently reorders the manager
    -- lookup in (3) rather than preserving the CASE it replaced.
    IF NOT ('gamma'::public.access_level < 'delta'::public.access_level
            AND 'delta'::public.access_level < 'epsilon'::public.access_level
            AND 'epsilon'::public.access_level < 'zeta'::public.access_level) THEN
        v_failures := v_failures || '(d) enum order is not the ladder ; ';
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'rbac_phase5 selftest FAILED: %', v_failures;
    END IF;
    RAISE NOTICE 'rbac_phase5 selftest PASSED';
END
$selftest$;
