-- `baseline_ft_patterns.created_by` was never written, so it was always NULL.
--
-- It cannot be filled by the client. `saveBaselinePatterns` writes with an
-- UPSERT, and a payload carrying `created_by` would overwrite it on every
-- subsequent edit — turning "who created this line" into "who touched it last",
-- which is what `updated_by` already records.
--
-- A DEFAULT is exactly the right mechanism: it applies on INSERT and is skipped
-- on the ON CONFLICT UPDATE path, so the original author survives every later
-- edit. `auth.uid()` resolves to the authenticated caller, which is who the RLS
-- policies already gate on.

begin;

alter table public.baseline_ft_patterns
    alter column created_by set default auth.uid();

comment on column public.baseline_ft_patterns.created_by is
    'Set by DEFAULT auth.uid() on insert. NOT written by the client: the upsert '
    'path would overwrite it on every edit. Use updated_by for who touched it last.';

commit;
