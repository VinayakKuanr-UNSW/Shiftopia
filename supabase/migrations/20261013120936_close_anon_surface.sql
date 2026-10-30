-- Close what the public anon key could reach (2026-10-13 review; pinned by
-- tests/integration/security/anon-surface.int.test.ts and storage.int.test.ts).
-- The anon key ships inside the web bundle: anything it can read, anyone can.
-- Tightening only — nothing here grants access.

-- 1. The venue event schedule (venueops_ml_features: times, attendance, rooms)
--    and the model coefficients were readable with the anon key, because the
--    ML service fell back to it. The ML service now requires the service-role
--    key (ml/*.py, docker-compose.yml). Signed-in reads keep their own policies
--    (authenticated_read_venueops_ml_features, authenticated_read_labor_correction_factors).
DROP POLICY IF EXISTS anon_read_venueops_ml_features ON public.venueops_ml_features;
DROP POLICY IF EXISTS "Allow anon select on labor_correction_factors" ON public.labor_correction_factors;

-- 2. The org structure, including the organisation's phone and email, was
--    world-readable through `public_read`. No signed-out screen reads it
--    (/login, /signup and /pending-access make no table calls; ThemeContext
--    reads branding only once an access scope exists). Signed-in users keep
--    their own SELECT policies.
DROP POLICY IF EXISTS public_read ON public.organizations;
DROP POLICY IF EXISTS public_read ON public.departments;
DROP POLICY IF EXISTS public_read ON public.sub_departments;

-- 3. Broadcast attachments. Any signed-in user could upload any file into this
--    PUBLIC bucket (free public file hosting) and delete anyone's attachment.
--    Mirror public.broadcast_attachments' own rules instead. Uploads land at
--    `<broadcast_id>/<timestamp>.<ext>` (broadcasts.commands.ts), so the first
--    folder names the broadcast.
DROP POLICY IF EXISTS "Authenticated users can upload broadcast attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete broadcast attachments" ON storage.objects;

CREATE POLICY "Broadcasters can upload broadcast attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'broadcast-attachments'
    AND (
      public.is_broadcast_system_manager()
      OR EXISTS (
        SELECT 1
          FROM public.broadcasts b
          JOIN public.broadcast_channels bc ON bc.id = b.channel_id
          JOIN public.group_participants gp ON gp.group_id = bc.group_id
         WHERE b.id::text = (storage.foldername(name))[1]
           AND gp.employee_id = (SELECT auth.uid())
           AND gp.role = ANY (ARRAY['admin', 'broadcaster'])
      )
    )
  );

CREATE POLICY "Broadcast admins can delete broadcast attachments" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'broadcast-attachments'
    AND (
      owner_id = (SELECT auth.uid())::text
      OR public.is_broadcast_system_manager()
      OR EXISTS (
        SELECT 1
          FROM public.broadcast_attachments ba
          JOIN public.broadcasts b ON b.id = ba.broadcast_id
          JOIN public.broadcast_channels bc ON bc.id = b.channel_id
          JOIN public.group_participants gp ON gp.group_id = bc.group_id
         WHERE ba.storage_path = objects.name
           AND gp.employee_id = (SELECT auth.uid())
           AND gp.role = 'admin'
      )
    )
  );

-- Storage deletes only rows the caller can also SELECT. With no SELECT policy
-- on this bucket, every delete — the app's included — removed nothing and
-- left the file publicly downloadable at its URL after "deletion". Let exactly
-- the people who may delete an object see it. (Public download by URL does not
-- go through these policies.)
CREATE POLICY "Broadcast admins can see broadcast attachment objects" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'broadcast-attachments'
    AND (
      owner_id = (SELECT auth.uid())::text
      OR public.is_broadcast_system_manager()
      OR EXISTS (
        SELECT 1
          FROM public.broadcast_attachments ba
          JOIN public.broadcasts b ON b.id = ba.broadcast_id
          JOIN public.broadcast_channels bc ON bc.id = b.channel_id
          JOIN public.group_participants gp ON gp.group_id = bc.group_id
         WHERE ba.storage_path = objects.name
           AND gp.employee_id = (SELECT auth.uid())
           AND gp.role = 'admin'
      )
    )
  );

-- 4. Defence in depth. Nothing signed-out writes (no public screen calls a
--    table), and no client role ever needs TRUNCATE / REFERENCES / TRIGGER /
--    MAINTAIN — PostgREST cannot even issue them. RLS stays the main barrier;
--    this stops it being the only one. Default privileges are trimmed too, or
--    every new table would hand them out again.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS rel
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'hr') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON %s FROM anon', r.rel);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON %s FROM authenticated', r.rel);
  END LOOP;
END
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA hr
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;
