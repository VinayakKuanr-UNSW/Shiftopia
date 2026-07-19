-- ============================================================================
-- Harden SECURITY DEFINER-era functions with a fixed search_path
-- ============================================================================
-- Advisor: 10 x function_search_path_mutable. A function with a mutable
-- search_path lets a caller prepend a schema that shadows an unqualified
-- reference — a classic privilege-escalation vector for SECURITY DEFINER code.
--
-- We pin (not empty) to `pg_catalog, public, hr`: pg_catalog first prevents
-- shadowing of built-ins, and public+hr keep every existing unqualified object
-- reference resolvable, so behaviour is unchanged. Idempotent.
-- ----------------------------------------------------------------------------
ALTER FUNCTION public.create_planning_period(uuid, uuid, uuid[], date, date, uuid, boolean, boolean, boolean)
  SET search_path = pg_catalog, public, hr;
ALTER FUNCTION public.fn_seed_fixed_template_groups()
  SET search_path = pg_catalog, public, hr;
ALTER FUNCTION public.get_insights_summary(date, date, uuid[], uuid[], uuid[])
  SET search_path = pg_catalog, public, hr;
ALTER FUNCTION public.get_roster_summary(uuid, date, date, uuid[], uuid[])
  SET search_path = pg_catalog, public, hr;
ALTER FUNCTION public.resolve_audit_uuid_array(text, jsonb)
  SET search_path = pg_catalog, public, hr;
ALTER FUNCTION public.resolve_audit_uuid_name(text, uuid)
  SET search_path = pg_catalog, public, hr;
ALTER FUNCTION public.resolve_changes_jsonb(jsonb)
  SET search_path = pg_catalog, public, hr;
ALTER FUNCTION hr.seed_subdepartment_roles()
  SET search_path = pg_catalog, public, hr;
ALTER FUNCTION public.set_updated_at()
  SET search_path = pg_catalog, public, hr;
ALTER FUNCTION public.sm_finalize_planning_request(uuid, uuid, uuid, text, timestamptz, timestamptz)
  SET search_path = pg_catalog, public, hr;
