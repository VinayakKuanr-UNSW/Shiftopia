-- Drop the duplicate hr.organizations. public.organizations is canonical.
--
-- Apply only AFTER the frontend that reads public.organizations in
-- useReferenceData.ts is deployed; until then the contract wizard's
-- organization list reads hr.organizations.
--
-- Preconditions (checked 2026-11-25): no foreign key targets it once
-- 20261125112538_organizations_hardening has run, and no view or function
-- references it. No CASCADE, so anything added since fails this loudly.
DROP TABLE IF EXISTS hr.organizations;
