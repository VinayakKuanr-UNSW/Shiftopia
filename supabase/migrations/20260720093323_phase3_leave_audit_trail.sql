-- =============================================================================
-- Phase 3 (Med) — Leave audit trail.
--
-- Leave approvals/rejections/cancellations were never captured anywhere
-- (shift_events is shift-scoped). This adds a dedicated append-only audit table
-- written only by a SECURITY DEFINER trigger, with the same cert-scoped read
-- model as leave_requests (self + manager). Clients can SELECT (row-scoped) but
-- never write directly.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."leave_request_events" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "leave_request_id" uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  "employee_id"      uuid NOT NULL,           -- leave owner (drives RLS scoping)
  "event_type"       text NOT NULL,
  "actor_id"         uuid,                    -- who caused the transition
  "old_status"       text,
  "new_status"       text,
  "reason"           text,
  "metadata"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "leave_event_type_check" CHECK (
    event_type IN ('created','approved','rejected','cancelled','status_changed')
  )
);

CREATE INDEX IF NOT EXISTS "idx_leave_request_events_request"  ON "public"."leave_request_events" ("leave_request_id");
CREATE INDEX IF NOT EXISTS "idx_leave_request_events_employee" ON "public"."leave_request_events" ("employee_id");

-- ── Capture trigger (definer; the only writer) ──────────────────────────────
CREATE OR REPLACE FUNCTION "public"."fn_capture_leave_event"()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_event text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.leave_request_events (leave_request_id, employee_id, event_type, actor_id, old_status, new_status, reason)
    VALUES (NEW.id, NEW.employee_id, 'created', auth.uid(), NULL, NEW.status, NEW.reason);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_event := CASE NEW.status
      WHEN 'approved'  THEN 'approved'
      WHEN 'rejected'  THEN 'rejected'
      WHEN 'cancelled' THEN 'cancelled'
      ELSE 'status_changed'
    END;
    INSERT INTO public.leave_request_events (leave_request_id, employee_id, event_type, actor_id, old_status, new_status, reason)
    VALUES (NEW.id, NEW.employee_id, v_event, COALESCE(NEW.approved_by, auth.uid()), OLD.status, NEW.status,
            COALESCE(NEW.rejection_reason, NEW.reason));
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS "trg_capture_leave_event" ON "public"."leave_requests";
CREATE TRIGGER "trg_capture_leave_event"
  AFTER INSERT OR UPDATE ON "public"."leave_requests"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_capture_leave_event"();

-- ── RLS: self + cert-scoped manager read; no client writes ──────────────────
ALTER TABLE "public"."leave_request_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_events_self_select" ON "public"."leave_request_events"
  FOR SELECT USING ("employee_id" = ( SELECT auth.uid() ));

CREATE POLICY "leave_events_manager_select" ON "public"."leave_request_events"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.app_access_certificates aac
      JOIN hr.user_contracts target_uc ON target_uc.user_id = leave_request_events.employee_id
      WHERE aac.user_id = ( SELECT auth.uid() ) AND aac.is_active = true
        AND (
          (aac.access_level = 'zeta') OR
          (aac.access_level = 'epsilon' AND aac.organization_id = target_uc.organization_id) OR
          (aac.access_level = 'delta'   AND aac.organization_id = target_uc.organization_id AND aac.department_id = target_uc.department_id) OR
          (aac.access_level = 'gamma'   AND aac.organization_id = target_uc.organization_id AND aac.department_id = target_uc.department_id AND aac.sub_department_id = target_uc.sub_department_id)
        )
    )
  );

CREATE POLICY "leave_events_service_all" ON "public"."leave_request_events"
  FOR ALL USING (( SELECT auth.role() ) = 'service_role');

-- Grants: authenticated may only SELECT (RLS-scoped); writes only via the
-- definer trigger. Never anon (cf. the Supabase default-privilege gotcha).
REVOKE ALL ON "public"."leave_request_events" FROM "anon", "authenticated";
GRANT SELECT ON "public"."leave_request_events" TO "authenticated";
GRANT ALL ON "public"."leave_request_events" TO "service_role";
