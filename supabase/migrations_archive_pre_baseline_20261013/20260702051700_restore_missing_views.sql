-- Restore compat views dropped during the 2026-07-02 re-baseline but still
-- referenced by the app (broadcasts groups list / templates dropdown) and by
-- baseline triggers. Definitions taken verbatim from the pre-baseline archive,
-- except v_template_full: template_shifts.remuneration_level_id was dropped in
-- the HR cutover, so that JSON key is mapped to NULL::uuid (the app now uses the
-- integer remuneration_level).

-- ── v_broadcast_groups_with_stats ──────────────────────────────────────────
CREATE OR REPLACE VIEW "public"."v_broadcast_groups_with_stats" AS
 SELECT "g"."id",
    "g"."name",
    "g"."description",
    "g"."department_id",
    "g"."sub_department_id",
    "g"."organization_id",
    "g"."created_by",
    "g"."is_active",
    "g"."icon",
    "g"."color",
    "g"."created_at",
    "g"."updated_at",
    ( SELECT "count"(*) AS "count"
           FROM "public"."broadcast_channels" "c"
          WHERE (("c"."group_id" = "g"."id") AND ("c"."is_active" = true))) AS "channel_count",
    ( SELECT "count"(*) AS "count"
           FROM "public"."v_group_all_participants" "gap"
          WHERE ("gap"."group_id" = "g"."id")) AS "participant_count",
    COALESCE("sum"("c_stats"."active_broadcast_count"), (0)::numeric) AS "active_broadcast_count",
    COALESCE("sum"("c_stats"."total_broadcast_count"), (0)::numeric) AS "total_broadcast_count",
    "max"("c_stats"."last_broadcast_at") AS "last_broadcast_at"
   FROM ("public"."broadcast_groups" "g"
     LEFT JOIN "public"."v_channels_with_stats" "c_stats" ON (("c_stats"."group_id" = "g"."id")))
  GROUP BY "g"."id";

-- ── v_unread_broadcasts_by_group ───────────────────────────────────────────
CREATE OR REPLACE VIEW "public"."v_unread_broadcasts_by_group" AS
 SELECT "gap"."group_id",
    "gap"."employee_id",
    "count"(DISTINCT "b"."id") FILTER (WHERE ("brs"."read_at" IS NULL)) AS "unread_count",
    "bool_or"((("b"."priority" = 'urgent'::"text") AND ("brs"."read_at" IS NULL))) AS "has_urgent_unread",
    "bool_or"((("b"."requires_acknowledgement" = true) AND ("ba"."acknowledged_at" IS NULL))) AS "has_pending_ack"
   FROM (((("public"."v_group_all_participants" "gap"
     JOIN "public"."broadcast_channels" "c" ON (("c"."group_id" = "gap"."group_id")))
     JOIN "public"."broadcasts" "b" ON ((("b"."channel_id" = "c"."id") AND ("b"."is_archived" = false))))
     LEFT JOIN "public"."broadcast_read_status" "brs" ON ((("brs"."broadcast_id" = "b"."id") AND ("brs"."employee_id" = "gap"."employee_id"))))
     LEFT JOIN "public"."broadcast_acknowledgements" "ba" ON ((("ba"."broadcast_id" = "b"."id") AND ("ba"."employee_id" = "gap"."employee_id"))))
  GROUP BY "gap"."group_id", "gap"."employee_id";

-- ── v_template_full (remuneration_level_id → NULL::uuid) ───────────────────
CREATE OR REPLACE VIEW "public"."v_template_full" WITH ("security_invoker"='true') AS
 SELECT "id",
    "name",
    "description",
    "status",
    "organization_id",
    "published_month",
    "published_at",
    "published_by",
    "start_date",
    "end_date",
    "created_by",
    "last_edited_by",
    "version",
    "created_at",
    "updated_at",
    "is_base_template",
    "department_id",
    "sub_department_id",
    ( SELECT "count"(*) AS "count"
           FROM "public"."roster_template_batches" "rtb"
          WHERE ("rtb"."template_id" = "t"."id")) AS "applied_count",
    COALESCE(( SELECT "json_agg"("json_build_object"('id', "tg"."id", 'name', "tg"."name", 'description', "tg"."description", 'color', "tg"."color", 'icon', "tg"."icon", 'sortOrder', "tg"."sort_order", 'subGroups', ( SELECT COALESCE("json_agg"("json_build_object"('id', "tsg"."id", 'name', "tsg"."name", 'description', "tsg"."description", 'sortOrder', "tsg"."sort_order", 'shifts', ( SELECT COALESCE("json_agg"("json_build_object"('id', "s"."id", 'name', COALESCE("s"."name", "s"."role_name"), 'roleId', "s"."role_id", 'roleName', "s"."role_name", 'remunerationLevelId', NULL::"uuid", 'remunerationLevel', "s"."remuneration_level", 'startTime', "to_char"(("s"."start_time")::interval, 'HH24:MI'::"text"), 'endTime', "to_char"(("s"."end_time")::interval, 'HH24:MI'::"text"), 'paidBreakDuration', COALESCE("s"."paid_break_minutes", 0), 'unpaidBreakDuration', COALESCE("s"."unpaid_break_minutes", 0), 'skills', COALESCE("s"."required_skills", ARRAY[]::"text"[]), 'licenses', COALESCE("s"."required_licenses", ARRAY[]::"text"[]), 'siteTags', COALESCE("s"."site_tags", ARRAY[]::"text"[]), 'eventTags', COALESCE("s"."event_tags", ARRAY[]::"text"[]), 'notes', "s"."notes", 'assignedEmployeeId', "s"."assigned_employee_id", 'assignedEmployeeName', "s"."assigned_employee_name", 'netLength', "s"."net_length_hours", 'sortOrder', "s"."sort_order", 'dayOfWeek', "s"."day_of_week") ORDER BY "s"."sort_order", "s"."start_time"), '[]'::json) AS "coalesce"
                           FROM "public"."template_shifts" "s"
                          WHERE ("s"."subgroup_id" = "tsg"."id"))) ORDER BY "tsg"."sort_order"), '[]'::json) AS "coalesce"
                   FROM "public"."template_subgroups" "tsg"
                  WHERE ("tsg"."group_id" = "tg"."id"))) ORDER BY "tg"."sort_order") AS "json_agg"
           FROM "public"."template_groups" "tg"
          WHERE ("tg"."template_id" = "t"."id")), '[]'::json) AS "groups"
   FROM "public"."roster_templates" "t";

-- ── ownership + grants ─────────────────────────────────────────────────────
ALTER VIEW "public"."v_broadcast_groups_with_stats" OWNER TO "postgres";
GRANT ALL ON TABLE "public"."v_broadcast_groups_with_stats" TO "anon";
GRANT ALL ON TABLE "public"."v_broadcast_groups_with_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."v_broadcast_groups_with_stats" TO "service_role";
ALTER VIEW "public"."v_unread_broadcasts_by_group" OWNER TO "postgres";
GRANT ALL ON TABLE "public"."v_unread_broadcasts_by_group" TO "anon";
GRANT ALL ON TABLE "public"."v_unread_broadcasts_by_group" TO "authenticated";
GRANT ALL ON TABLE "public"."v_unread_broadcasts_by_group" TO "service_role";
ALTER VIEW "public"."v_template_full" OWNER TO "postgres";
GRANT ALL ON TABLE "public"."v_template_full" TO "anon";
GRANT ALL ON TABLE "public"."v_template_full" TO "authenticated";
GRANT ALL ON TABLE "public"."v_template_full" TO "service_role";
