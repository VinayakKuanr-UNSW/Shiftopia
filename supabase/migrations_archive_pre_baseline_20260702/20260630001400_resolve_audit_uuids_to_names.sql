-- Fix: Audit timeline shows raw UUIDs for role_id, remuneration_level_id, shift_group_id, roster_subgroup_id, and sub_department_id.
--
-- This migration adds:
--   1. resolve_audit_uuid_name(field text, id uuid) -> text
--      Looks up the human-readable name of the given UUID depending on the field.
--   2. resolve_changes_jsonb(changes jsonb) -> jsonb
--      Iterates over changes and resolves old/new UUID values to names.
--   3. Overrides get_shift_event_timeline(p_shift_id uuid) to use resolve_changes_jsonb
--      on the returned changes jsonb.
--
-- Idempotent & backward-compatible.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_audit_uuid_name(p_field text, p_uuid uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_name text;
BEGIN
    IF p_uuid IS NULL THEN
        RETURN NULL;
    END IF;

    CASE p_field
        WHEN 'role_id' THEN
            SELECT name INTO v_name FROM public.roles WHERE id = p_uuid;
        WHEN 'remuneration_level_id' THEN
            SELECT level_name INTO v_name FROM public.remuneration_levels WHERE id = p_uuid;
        WHEN 'shift_group_id' THEN
            SELECT name INTO v_name FROM public.roster_groups WHERE id = p_uuid;
        WHEN 'roster_subgroup_id' THEN
            SELECT name INTO v_name FROM public.roster_subgroups WHERE id = p_uuid;
        WHEN 'sub_department_id' THEN
            SELECT name INTO v_name FROM public.sub_departments WHERE id = p_uuid;
        ELSE
            v_name := NULL;
    END CASE;

    RETURN COALESCE(v_name, p_uuid::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_changes_jsonb(p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_key text;
    v_val jsonb;
    v_old text;
    v_new text;
    v_res jsonb := '{}'::jsonb;
BEGIN
    IF p_changes IS NULL THEN
        RETURN NULL;
    END IF;

    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_changes)
    LOOP
        IF v_key IN ('role_id', 'remuneration_level_id', 'shift_group_id', 'roster_subgroup_id', 'sub_department_id') THEN
            v_old := public.resolve_audit_uuid_name(v_key, (v_val->>'old')::uuid);
            v_new := public.resolve_audit_uuid_name(v_key, (v_val->>'new')::uuid);
            v_res := v_res || jsonb_build_object(v_key, jsonb_build_object('old', v_old, 'new', v_new));
        ELSE
            v_res := v_res || jsonb_build_object(v_key, v_val);
        END IF;
    END LOOP;

    RETURN v_res;
END;
$$;

-- 3. Update get_shift_event_timeline to return resolved changes
DROP FUNCTION IF EXISTS "public"."get_shift_event_timeline"("uuid");

CREATE OR REPLACE FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid")
RETURNS TABLE(
    "event_id"   "uuid",
    "event_time" timestamp with time zone,
    "domain"     "text",
    "event_type" "public"."shift_event_type",
    "op"         "text",
    "actor_id"   "uuid",
    "actor_role" "text",
    "actor_name" "text",
    "employee_id" "uuid",
    "assignee_name" "text",
    "from_state" "text",
    "to_state"   "text",
    "from_version" "text",
    "to_version" "text",
    "changes"    "jsonb",
    "reason"     "text",
    "creation_source"   "text",
    "assignment_source" "text"
)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NOT (
        EXISTS (
            SELECT 1
            FROM public.user_contracts uc
            WHERE uc.user_id = (SELECT auth.uid())
              AND uc.access_level = ANY (ARRAY[
                    'alpha'::public.access_level,
                    'beta'::public.access_level,
                    'gamma'::public.access_level,
                    'delta'::public.access_level,
                    'epsilon'::public.access_level,
                    'zeta'::public.access_level])
              AND uc.status = 'Active'
        )
        OR public.user_has_delta_access((SELECT auth.uid()))
        OR EXISTS (
            SELECT 1
            FROM public.shift_events se_auth
            WHERE se_auth.shift_id = p_shift_id
              AND se_auth.employee_id = (SELECT auth.uid())
        )
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        se.id                                       AS event_id,
        se.event_time                               AS event_time,
        COALESCE(se.domain, se.metadata->>'domain') AS domain,
        se.event_type                               AS event_type,
        se.metadata->>'op'                          AS op,
        se.actor_id                                 AS actor_id,
        se.actor_role                               AS actor_role,
        COALESCE(
            p.full_name,
            NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '')
        )                                           AS actor_name,
        se.employee_id                              AS employee_id,
        COALESCE(
            pe.full_name,
            NULLIF(TRIM(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), '')
        )                                           AS assignee_name,
        se.metadata->>'from_state'                  AS from_state,
        se.metadata->>'to_state'                    AS to_state,
        se.metadata->>'from_version'                AS from_version,
        se.metadata->>'to_version'                  AS to_version,
        public.resolve_changes_jsonb(se.metadata->'changes') AS changes,
        se.metadata->>'reason'                      AS reason,
        se.metadata->>'creation_source'             AS creation_source,
        se.metadata->>'assignment_source'           AS assignment_source
    FROM public.shift_events se
    LEFT JOIN public.shifts s ON s.id = se.shift_id
    LEFT JOIN public.profiles p ON p.id = COALESCE(
        se.actor_id,
        CASE
            WHEN se.actor_role = 'employee' THEN se.employee_id
            WHEN se.actor_role = 'manager' THEN s.last_modified_by
        END
    )
    LEFT JOIN public.profiles pe ON pe.id = se.employee_id
    WHERE se.shift_id = p_shift_id
    ORDER BY se.event_time ASC, se.created_at ASC;
END;
$$;

GRANT ALL ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") TO "service_role";
