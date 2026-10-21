-- The 1-arg legacy overload (no authz guard, deletes started shifts) survived the
-- 20261017111129 rewrite, which only dropped (uuid, uuid). Two candidates made PostgREST
-- refuse every call with PGRST203, so Undo on a template application failed.
DROP FUNCTION IF EXISTS public.undo_template_batch(uuid);
