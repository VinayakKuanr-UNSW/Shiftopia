-- Restore the v_group_all_participants view.
--
-- This view was part of the pre-baseline schema but was dropped during the
-- baseline reconciliation (20251015000000_baseline_schema.sql references it in
-- the broadcast-message → notifications trigger but never (re)creates it).
-- Its absence caused:
--   • frontend 404s (broadcastGroupQueries.getForEmployee → .from('v_group_all_participants'))
--   • a broken broadcast_channels insert trigger (INSERT ... FROM v_group_all_participants)
--
-- Definition is faithful to the original: explicit group_participants rows
-- UNION hierarchy-derived membership from active user_contracts.

CREATE OR REPLACE VIEW "public"."v_group_all_participants" AS
 SELECT "group_participants"."group_id",
    "group_participants"."employee_id",
    "group_participants"."role",
    true AS "is_explicit"
   FROM "public"."group_participants"
UNION
 SELECT "bg"."id" AS "group_id",
    "uc"."user_id" AS "employee_id",
    'member'::"text" AS "role",
    false AS "is_explicit"
   FROM ("public"."broadcast_groups" "bg"
     JOIN "public"."user_contracts" "uc" ON (("uc"."status" = 'Active'::"text")))
  WHERE ((NOT (EXISTS ( SELECT 1
           FROM "public"."group_participants" "gp"
          WHERE (("gp"."group_id" = "bg"."id") AND ("gp"."employee_id" = "uc"."user_id")))))
    AND ((("bg"."sub_department_id" IS NOT NULL) AND ("uc"."sub_department_id" = "bg"."sub_department_id"))
      OR (("bg"."sub_department_id" IS NULL) AND ("bg"."department_id" IS NOT NULL) AND ("uc"."department_id" = "bg"."department_id"))
      OR (("bg"."sub_department_id" IS NULL) AND ("bg"."department_id" IS NULL) AND ("bg"."organization_id" IS NOT NULL) AND ("uc"."organization_id" = "bg"."organization_id"))));

ALTER VIEW "public"."v_group_all_participants" OWNER TO "postgres";

GRANT ALL ON TABLE "public"."v_group_all_participants" TO "anon";
GRANT ALL ON TABLE "public"."v_group_all_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."v_group_all_participants" TO "service_role";
