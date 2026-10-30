-- =============================================================================
-- v_template_full: emit targetEmploymentType / targetRequiresFlexible /
-- remunerationLevelName for every template shift.
--
-- WHY
--   The editor reads templates exclusively through this view. Its per-shift
--   json_build_object never included the employment target, the flexible flag,
--   or the remuneration level name — columns that `template_shifts` has carried
--   (target_employment_type is NOT NULL, no default) since they were added.
--
--   Consequences, all observed on /templates:
--     * Every shift hydrated with targetEmploymentType = null, so the template
--       ShiftCard rendered its 'Full-Time' fallback — on templates that cannot
--       even hold FT rows (enforce_no_ft_template_shifts).
--     * Cloning a shift / sub-group / template copied that null, so the copy was
--       not a true copy: the INSERT branch of save_template_full has no prior
--       row to COALESCE against and hits the NOT NULL constraint.
--     * targetRequiresFlexible hydrated as false and save_template_full's UPDATE
--       branch only COALESCEs a NULL — an explicit false overwrote a stored true
--       on the next save, silently dropping Flexible Part-Time.
--
-- WHAT
--   CREATE OR REPLACE with the identical column list and body, adding three keys
--   to the shift object. View-level columns are unchanged, so existing grants
--   are retained; security_invoker is re-asserted explicitly.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_template_full
WITH (security_invoker = true)
AS
SELECT t.id,
    t.name,
    t.description,
    t.status,
    t.organization_id,
    t.published_month,
    t.published_at,
    t.published_by,
    t.start_date,
    t.end_date,
    t.created_by,
    t.last_edited_by,
    t.version,
    t.created_at,
    t.updated_at,
    t.is_base_template,
    t.department_id,
    t.sub_department_id,
    ( SELECT count(*) AS count
           FROM roster_template_batches rtb
          WHERE rtb.template_id = t.id) AS applied_count,
    COALESCE(( SELECT json_agg(json_build_object(
                'id', tg.id,
                'name', tg.name,
                'description', tg.description,
                'color', tg.color,
                'icon', tg.icon,
                'sortOrder', tg.sort_order,
                'subGroups', ( SELECT COALESCE(json_agg(json_build_object(
                        'id', tsg.id,
                        'name', tsg.name,
                        'description', tsg.description,
                        'sortOrder', tsg.sort_order,
                        'shifts', ( SELECT COALESCE(json_agg(json_build_object(
                                'id', s.id,
                                'name', COALESCE(s.name, s.role_name),
                                'roleId', s.role_id,
                                'roleName', s.role_name,
                                'remunerationLevelId', NULL::uuid,
                                'remunerationLevel', s.remuneration_level,
                                'remunerationLevelName', s.remuneration_level_name,
                                'startTime', to_char(s.start_time::interval, 'HH24:MI'::text),
                                'endTime', to_char(s.end_time::interval, 'HH24:MI'::text),
                                'paidBreakDuration', COALESCE(s.paid_break_minutes, 0),
                                'unpaidBreakDuration', COALESCE(s.unpaid_break_minutes, 0),
                                'skills', COALESCE(s.required_skills, ARRAY[]::text[]),
                                'licenses', COALESCE(s.required_licenses, ARRAY[]::text[]),
                                'siteTags', COALESCE(s.site_tags, ARRAY[]::text[]),
                                'eventTags', COALESCE(s.event_tags, ARRAY[]::text[]),
                                'notes', s.notes,
                                'assignedEmployeeId', s.assigned_employee_id,
                                'assignedEmployeeName', s.assigned_employee_name,
                                'netLength', s.net_length_hours,
                                'sortOrder', s.sort_order,
                                'dayOfWeek', s.day_of_week,
                                'targetEmploymentType', s.target_employment_type,
                                'targetRequiresFlexible', s.target_requires_flexible
                            ) ORDER BY s.sort_order, s.start_time), '[]'::json) AS "coalesce"
                           FROM template_shifts s
                          WHERE s.subgroup_id = tsg.id)
                    ) ORDER BY tsg.sort_order), '[]'::json) AS "coalesce"
                   FROM template_subgroups tsg
                  WHERE tsg.group_id = tg.id)
            ) ORDER BY tg.sort_order) AS json_agg
           FROM template_groups tg
          WHERE tg.template_id = t.id), '[]'::json) AS groups
   FROM roster_templates t;
