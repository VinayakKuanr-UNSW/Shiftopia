-- Access certificates and the places they name.
--
-- A gamma or delta certificate names a department or sub-department (an epsilon, alpha
-- or beta one, the organization). Deleting or retiring that place used to either fail
-- on a bare foreign-key error (delete) or leave a live grant on a place that no longer
-- runs (retire, is_active = false). Now:
--
--   * Deleting or retiring an organization, department or sub-department is REFUSED
--     while an ACTIVE certificate is scoped to it, with a message that names the place
--     and who holds access there. Changing someone's access stays a deliberate, audited
--     act on the Users page (zeta), never a side effect of reshaping the organization.
--   * REVOKED certificates no longer block a delete: they go with the place (ON DELETE
--     CASCADE). Their history stays — access_certificate_events keeps the full row,
--     before and after, and records the removal as 'deleted'.
--   * Access cannot be granted, or re-activated, in a retired place.

-- ── 1. The guard ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.place_keep_access_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_kind  text := CASE TG_TABLE_NAME WHEN 'organizations' THEN 'organization'
                                       WHEN 'departments'   THEN 'department'
                                       ELSE 'sub-department' END;
    v_verb  text := CASE TG_OP WHEN 'DELETE' THEN 'delete' ELSE 'retire' END;
    v_count int;
    v_who   text;
BEGIN
    -- Only removing a place, or retiring it (active → inactive), can strand a grant.
    IF TG_OP = 'UPDATE' AND NOT (OLD.is_active AND NOT NEW.is_active) THEN
        RETURN NEW;
    END IF;

    SELECT count(*),
           string_agg(holder, ', ' ORDER BY rn) FILTER (WHERE rn <= 3)
      INTO v_count, v_who
      FROM (
        SELECT ac.access_level::text || ' — '
               || COALESCE(NULLIF(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
                           p.email, ac.user_id::text) AS holder,
               row_number() OVER (ORDER BY ac.access_level DESC, ac.created_at) AS rn
          FROM public.app_access_certificates ac
          LEFT JOIN public.profiles p ON p.id = ac.user_id
         WHERE ac.is_active
           AND CASE TG_TABLE_NAME
                 WHEN 'organizations' THEN ac.organization_id = OLD.id
                 WHEN 'departments'   THEN ac.department_id = OLD.id
                 ELSE ac.sub_department_id = OLD.id
               END
      ) scoped;

    IF v_count > 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = CASE TG_OP WHEN 'DELETE' THEN '23503' ELSE '23514' END,
            MESSAGE = format('Cannot %s %s "%s": %s active access certificate%s %s scoped to it (%s%s). Revoke or re-scope %s on the Users page first.',
                             v_verb, v_kind, OLD.name, v_count,
                             CASE WHEN v_count = 1 THEN '' ELSE 's' END,
                             CASE WHEN v_count = 1 THEN 'is' ELSE 'are' END,
                             v_who,
                             CASE WHEN v_count > 3 THEN format(', and %s more', v_count - 3) ELSE '' END,
                             CASE WHEN v_count = 1 THEN 'it' ELSE 'them' END),
            HINT = 'Revoked certificates do not block this.';
    END IF;

    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
-- A trigger function, not an API: nobody calls it directly.
REVOKE ALL ON FUNCTION public.place_keep_access_scope() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_organizations_keep_access_scope
    BEFORE DELETE OR UPDATE OF is_active ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.place_keep_access_scope();
CREATE TRIGGER trg_departments_keep_access_scope
    BEFORE DELETE OR UPDATE OF is_active ON public.departments
    FOR EACH ROW EXECUTE FUNCTION public.place_keep_access_scope();
CREATE TRIGGER trg_sub_departments_keep_access_scope
    BEFORE DELETE OR UPDATE OF is_active ON public.sub_departments
    FOR EACH ROW EXECUTE FUNCTION public.place_keep_access_scope();

-- ── 2. Revoked certificates go with their place ──────────────────────────────
-- The guard above runs first, so only revoked certificates can reach these cascades.
ALTER TABLE public.app_access_certificates
    DROP CONSTRAINT app_access_certificates_organization_id_fkey,
    ADD CONSTRAINT app_access_certificates_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
    DROP CONSTRAINT app_access_certificates_department_id_fkey,
    ADD CONSTRAINT app_access_certificates_department_id_fkey
        FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE,
    DROP CONSTRAINT app_access_certificates_sub_department_id_fkey,
    ADD CONSTRAINT app_access_certificates_sub_department_id_fkey
        FOREIGN KEY (sub_department_id) REFERENCES public.sub_departments(id) ON DELETE CASCADE;

-- ── 3. No access granted in a retired place ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_certificate_on_change()
 RETURNS trigger
 LANGUAGE plpgsql
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

    IF NEW.certificate_type = 'X' AND NEW.is_active = true AND EXISTS (
        SELECT 1 FROM app_access_certificates
         WHERE user_id = NEW.user_id
           AND certificate_type = 'X'
           AND is_active = true
           AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
        RAISE EXCEPTION 'User already has an active Type X certificate. Only one is allowed: it covers every sub-department they are contracted to.';
    END IF;

    IF NEW.certificate_type = 'X' AND NEW.access_level > 'beta' THEN
        RAISE EXCEPTION 'Type X certificates must have alpha or beta level.';
    END IF;

    IF NEW.certificate_type = 'Y' AND NEW.access_level < 'gamma' THEN
        RAISE EXCEPTION 'Type Y certificates must be gamma or above.';
    END IF;

    IF NEW.is_active AND (
           EXISTS (SELECT 1 FROM organizations   WHERE id = NEW.organization_id   AND NOT is_active)
        OR EXISTS (SELECT 1 FROM departments     WHERE id = NEW.department_id     AND NOT is_active)
        OR EXISTS (SELECT 1 FROM sub_departments WHERE id = NEW.sub_department_id AND NOT is_active)) THEN
        RAISE EXCEPTION 'Access cannot be granted in a retired organization, department or sub-department.'
            USING ERRCODE = '23514';
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
