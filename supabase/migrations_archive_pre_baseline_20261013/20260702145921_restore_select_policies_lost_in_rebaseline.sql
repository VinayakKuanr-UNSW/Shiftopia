-- Restore SELECT policies dropped by the 2026-07-02 re-baseline.
--
-- The consolidated baseline regenerated on this branch omitted several
-- general-read RLS policies that existed in the previously committed
-- baseline. After the DB was reset from the new baseline, authenticated
-- users could no longer read:
--   * public.shifts  (only swap-scoped SELECT policies survived → empty roster UI)
--   * public.events                 (zero SELECT policies)
--   * public.roster_template_batches (zero SELECT policies)
--   * public.shift_events           (managers lost read access to others' events)
--
-- Definitions below are verbatim from the last committed baseline
-- (supabase/migrations/20251015000000_baseline_schema.sql @ b217f98).

-- ── shifts ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "shifts_select_bidding" ON "public"."shifts";
CREATE POLICY "shifts_select_bidding" ON "public"."shifts" FOR SELECT TO "authenticated" USING ((("bidding_status" = ANY (ARRAY['on_bidding'::"public"."shift_bidding_status", 'on_bidding_normal'::"public"."shift_bidding_status", 'on_bidding_urgent'::"public"."shift_bidding_status"])) AND (EXISTS ( SELECT 1
   FROM "public"."user_contracts"
  WHERE (("user_contracts"."user_id" = "auth"."uid"()) AND ("user_contracts"."status" = 'Active'::"text") AND ("user_contracts"."organization_id" = "shifts"."organization_id"))))));

DROP POLICY IF EXISTS "shifts_select_managers" ON "public"."shifts";
CREATE POLICY "shifts_select_managers" ON "public"."shifts" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."user_contracts" "uc"
  WHERE (("uc"."user_id" = "auth"."uid"()) AND ("uc"."status" = 'Active'::"text") AND ("uc"."access_level" = ANY (ARRAY['gamma'::"public"."access_level", 'delta'::"public"."access_level", 'epsilon'::"public"."access_level", 'zeta'::"public"."access_level"])) AND ((("uc"."access_level" = 'epsilon'::"public"."access_level") AND ("uc"."organization_id" = "shifts"."organization_id")) OR (("uc"."access_level" = 'delta'::"public"."access_level") AND ("uc"."organization_id" = "shifts"."organization_id") AND ("uc"."department_id" = "shifts"."department_id")) OR ("uc"."sub_department_id" = "shifts"."sub_department_id") OR (("uc"."department_id" = "shifts"."department_id") AND ("uc"."sub_department_id" IS NULL)) OR (("uc"."organization_id" = "shifts"."organization_id") AND ("uc"."department_id" IS NULL) AND ("uc"."sub_department_id" IS NULL)))))) OR (EXISTS ( SELECT 1
   FROM "public"."app_access_certificates" "ac"
  WHERE (("ac"."user_id" = "auth"."uid"()) AND ("ac"."is_active" = true) AND ("ac"."access_level" = ANY (ARRAY['gamma'::"public"."access_level", 'delta'::"public"."access_level", 'epsilon'::"public"."access_level", 'zeta'::"public"."access_level"])) AND (("ac"."access_level" = 'zeta'::"public"."access_level") OR (("ac"."access_level" = 'epsilon'::"public"."access_level") AND ("ac"."organization_id" = "shifts"."organization_id")) OR (("ac"."access_level" = 'delta'::"public"."access_level") AND ("ac"."organization_id" = "shifts"."organization_id") AND ("ac"."department_id" = "shifts"."department_id")) OR ("ac"."sub_department_id" = "shifts"."sub_department_id"))))) OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."legacy_system_role" = ANY (ARRAY['admin'::"public"."system_role", 'manager'::"public"."system_role"])))))));

DROP POLICY IF EXISTS "shifts_select_rbac" ON "public"."shifts";
CREATE POLICY "shifts_select_rbac" ON "public"."shifts" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM ("public"."app_access_certificates" "ac"
     JOIN "public"."rbac_permissions" "rp" ON (("rp"."access_level" = "ac"."access_level")))
  WHERE (("ac"."user_id" = "auth"."uid"()) AND ("ac"."is_active" = true) AND ("rp"."action_code" = 'shift.view'::"text") AND (("ac"."access_level" = 'zeta'::"public"."access_level") OR (("ac"."organization_id" = "shifts"."organization_id") AND (("rp"."scope" = 'ORG'::"public"."rbac_scope") OR (("rp"."scope" = 'DEPT'::"public"."rbac_scope") AND ("ac"."department_id" = "shifts"."department_id")) OR (("rp"."scope" = 'SUB_DEPT'::"public"."rbac_scope") AND ("ac"."sub_department_id" = "shifts"."sub_department_id")))))))) OR (EXISTS ( SELECT 1
   FROM ("public"."user_contracts" "uc"
     JOIN "public"."rbac_permissions" "rp" ON (("rp"."access_level" = "uc"."access_level")))
  WHERE (("uc"."user_id" = "auth"."uid"()) AND ("uc"."status" = 'Active'::"text") AND ("rp"."action_code" = 'shift.view'::"text") AND ("uc"."organization_id" = "shifts"."organization_id") AND (("rp"."scope" = 'ORG'::"public"."rbac_scope") OR (("rp"."scope" = 'DEPT'::"public"."rbac_scope") AND ("uc"."department_id" = "shifts"."department_id")) OR (("rp"."scope" = 'SUB_DEPT'::"public"."rbac_scope") AND ("uc"."sub_department_id" = "shifts"."sub_department_id")))))) OR ((("assigned_employee_id" = "auth"."uid"()) OR ("last_rejected_by" = "auth"."uid"())) AND (EXISTS ( SELECT 1
   FROM "public"."user_contracts"
  WHERE (("user_contracts"."user_id" = "auth"."uid"()) AND ("user_contracts"."status" = 'Active'::"text")))))));

-- ── events ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "events_select_org_scoped" ON "public"."events";
CREATE POLICY "events_select_org_scoped" ON "public"."events" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("organization_id" IS NULL) OR ("organization_id" IN ( SELECT "uc"."organization_id"
   FROM "public"."user_contracts" "uc"
  WHERE ("uc"."user_id" = ( SELECT ( SELECT "auth"."uid"() AS "uid") AS "uid"))))));

-- ── roster_template_batches ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view batches in their organization" ON "public"."roster_template_batches";
CREATE POLICY "Users can view batches in their organization" ON "public"."roster_template_batches" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."roster_templates" "rt"
     JOIN "public"."user_contracts" "uc" ON (("uc"."organization_id" = "rt"."organization_id")))
  WHERE (("rt"."id" = "roster_template_batches"."template_id") AND ("uc"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));

-- ── shift_events ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Managers can view all shift events" ON "public"."shift_events";
CREATE POLICY "Managers can view all shift events" ON "public"."shift_events" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."user_contracts"
  WHERE (("user_contracts"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_contracts"."access_level" = ANY (ARRAY['alpha'::"public"."access_level", 'beta'::"public"."access_level", 'gamma'::"public"."access_level", 'delta'::"public"."access_level", 'epsilon'::"public"."access_level", 'zeta'::"public"."access_level"])) AND ("user_contracts"."status" = 'Active'::"text")))) OR "public"."user_has_delta_access"(( SELECT "auth"."uid"() AS "uid"))));
