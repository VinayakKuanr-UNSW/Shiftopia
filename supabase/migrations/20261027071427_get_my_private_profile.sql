-- The caller's own contact data (Settings > Profile). First half of hiding
-- phone / date of birth / emergency contacts from other users; the column
-- REVOKE follows once the frontend that stops selecting `*` is deployed
-- (SQL in docs/handover/2026-10-27-donut-fork-salvage-ledger.md).
CREATE FUNCTION public.get_my_private_profile()
RETURNS TABLE (phone text, date_of_birth date, emergency_contact_name text, emergency_contact_phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT p.phone, p.date_of_birth, p.emergency_contact_name, p.emergency_contact_phone
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_private_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_private_profile() TO authenticated;
