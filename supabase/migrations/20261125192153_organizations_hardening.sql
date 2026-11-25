-- public.organizations: least-privilege grants, NOT NULL audit columns, domain
-- checks; and repoint the two hr.* foreign keys that still target the duplicate
-- hr.organizations to the canonical public.organizations.
--
-- public.* is the canonical org tree (decided 2026-11-25). hr.organizations is
-- a copy (same single row, same id) dropped by the follow-up migration once
-- the app no longer reads it. Its RLS policies are set by
-- tenant_isolation_foundation (members read, the organization's Administrator
-- writes, no in-app INSERT).
--
-- Every statement is re-runnable (DROP ... IF EXISTS before each ADD/CREATE).

-- ── 2. Grants ────────────────────────────────────────────────────────────────
-- anon held SELECT but no policy admits it, so it already read zero rows.
-- Every app read of this table happens after sign-in.
REVOKE ALL ON public.organizations FROM anon;

-- ── 3. NOT NULL ──────────────────────────────────────────────────────────────
-- is_active NULL would also slip past trg_organizations_keep_access_scope,
-- which only fires on `OLD.is_active AND NOT NEW.is_active`.
ALTER TABLE public.organizations
  ALTER COLUMN is_active  SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

-- ── 4. Domain checks ─────────────────────────────────────────────────────────
-- venue_lat/venue_lon feed the clock-in geofence (rosters/utils/gps.ts): both
-- or neither, and within WGS84 range.
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_venue_coords_valid,
  ADD  CONSTRAINT organizations_venue_coords_valid CHECK (
         (venue_lat IS NULL) = (venue_lon IS NULL)
     AND (venue_lat IS NULL OR venue_lat BETWEEN -90  AND 90)
     AND (venue_lon IS NULL OR venue_lon BETWEEN -180 AND 180)),
  DROP CONSTRAINT IF EXISTS organizations_branding_is_object,
  ADD  CONSTRAINT organizations_branding_is_object CHECK (
         branding IS NULL OR jsonb_typeof(branding) = 'object');

-- ── 5. hr.* foreign keys → public.organizations ──────────────────────────────
-- Same columns, same ON DELETE behaviour as before; only the target changes.
ALTER TABLE hr.departments
  DROP CONSTRAINT IF EXISTS departments_organization_id_fkey,
  ADD  CONSTRAINT departments_organization_id_fkey
       FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE hr.employees
  DROP CONSTRAINT IF EXISTS employees_organization_id_fkey,
  ADD  CONSTRAINT employees_organization_id_fkey
       FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;
