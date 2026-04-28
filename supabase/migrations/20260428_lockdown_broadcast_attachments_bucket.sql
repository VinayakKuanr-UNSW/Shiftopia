-- ============================================================================
--  Lock down `broadcast-attachments` storage bucket
-- ============================================================================
--
--  Why
--    The Supabase security advisor (lint: public_bucket_allows_listing)
--    flagged this bucket as a public bucket with a broad authenticated SELECT
--    policy. For a public bucket, SELECT is what grants the `list` capability
--    on the storage API — direct URL access (`getPublicUrl`) does not need it.
--    Keeping the policy lets any authenticated user enumerate every file in
--    the bucket across all broadcasts and tenants.
--
--  Audited app usage (2026-04-28)
--    src/modules/broadcasts/api/broadcasts.commands.ts:
--      - .upload(...)            → covered by INSERT policy (untouched)
--      - .getPublicUrl(...)      → does not require SELECT policy
--      - .remove([path])         → covered by DELETE policy (untouched)
--    No `.list()` calls exist anywhere in src/.
--
--  Net effect
--    - Existing broadcast attachments stay reachable via their stored
--      `file_url` (publicUrl).
--    - Clients can still upload and delete their own attachments.
--    - Bucket-wide enumeration via the storage API is no longer possible.
--
--  Rollback
--    See the inverse statement at the bottom of this file.
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can view broadcast attachments"
    ON storage.objects;

-- ── Rollback (DO NOT include in deploy; here for reference only) ──────────────
-- CREATE POLICY "Authenticated users can view broadcast attachments"
--     ON storage.objects
--     FOR SELECT
--     TO authenticated
--     USING (bucket_id = 'broadcast-attachments');
