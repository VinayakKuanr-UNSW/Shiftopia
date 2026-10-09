-- Drop the three pay-rate placeholders the previous app build needed.
--
-- 20261009014655 kept `NULL AS custom_hourly_rate` on public.user_contracts, and
-- 20261009033120 put NULL-only hourly_rate_min/max back on hr.remuneration_levels,
-- because the build deployed before 2026-10-09 still SELECTed them and one
-- unknown name rejects a whole PostgREST select. The build that stopped reading
-- them (PR #22) is now live, so they go.
--
-- public.remuneration_levels has no dependents: drop it, drop the columns,
-- recreate it.
--
-- public.user_contracts cannot lose a column through CREATE OR REPLACE, and
-- DROP VIEW takes its dependents with it: three broadcast views and seven RLS
-- policies (four on shifts). They are recreated below, verbatim from
-- pg_get_viewdef / pg_policy, in the same transaction. A before/after
-- fingerprint of every policy on those four tables and of the views' ACLs and
-- options matched (see the memory note pay-basis-eba-coverage-decisions).
--
-- Grants: a view created in public auto-grants anon. user_contracts and
-- remuneration_levels never granted anon, so both revoke it again. The three
-- broadcast views always granted anon; they keep that.

-- ── remuneration_levels ──────────────────────────────────────────────────────
DROP VIEW public.remuneration_levels;

ALTER TABLE hr.remuneration_levels
    DROP CONSTRAINT remuneration_levels_money_placeholders_null,
    DROP COLUMN hourly_rate_min,
    DROP COLUMN hourly_rate_max;

CREATE VIEW public.remuneration_levels WITH (security_invoker = on) AS
 SELECT level_number,
    level_name,
    description
   FROM hr.remuneration_levels;

REVOKE ALL ON public.remuneration_levels FROM PUBLIC, anon;
GRANT ALL ON public.remuneration_levels TO authenticated, service_role;

-- ── user_contracts ───────────────────────────────────────────────────────────
DROP VIEW public.user_contracts CASCADE;

CREATE VIEW public.user_contracts WITH (security_invoker = on) AS
 SELECT id,
    user_id,
    organization_id,
    department_id,
    sub_department_id,
    role_id,
    status,
    start_date,
    end_date,
    notes,
    created_at,
    updated_at,
    created_by,
    access_level,
    employment_status,
    contracted_weekly_hours,
    is_apprentice,
    apprentice_type,
    apprentice_year,
    has_completed_year_12,
    is_trainee,
    trainee_category,
    trainee_level,
    trainee_exit_year,
    trainee_years_out,
    trainee_aqf_level,
    trainee_year,
    is_training_on_job,
    prefers_sba_loading,
    is_sws,
    sws_capacity_percentage,
    is_sws_trial,
    sws_trial_start_date,
    annual_guaranteed_hours,
    remuneration_level,
    ordinary_span_start,
    ordinary_span_end,
    ordinary_days,
    position_id,
    ordinary_hours_cycle_weeks,
    ordinary_hours_cycle_anchor,
    pay_basis,
    eba_exclusion_reason,
    annual_salary,
    engagement_kind,
    multi_hire_request_ref
   FROM hr.user_contracts;

REVOKE ALL ON public.user_contracts FROM PUBLIC, anon;
GRANT ALL ON public.user_contracts TO authenticated, service_role;

-- ── dependents dropped by the CASCADE ────────────────────────────────────────
CREATE VIEW public.v_group_all_participants WITH (security_invoker = on) AS
 SELECT group_participants.group_id,
    group_participants.employee_id,
    group_participants.role,
    true AS is_explicit
   FROM group_participants
UNION
 SELECT bg.id AS group_id,
    uc.user_id AS employee_id,
    'member'::text AS role,
    false AS is_explicit
   FROM broadcast_groups bg
     JOIN user_contracts uc ON uc.status = 'Active'::text
  WHERE NOT (EXISTS ( SELECT 1
           FROM group_participants gp
          WHERE gp.group_id = bg.id AND gp.employee_id = uc.user_id)) AND (bg.sub_department_id IS NOT NULL AND uc.sub_department_id = bg.sub_department_id OR bg.sub_department_id IS NULL AND bg.department_id IS NOT NULL AND uc.department_id = bg.department_id OR bg.sub_department_id IS NULL AND bg.department_id IS NULL AND bg.organization_id IS NOT NULL AND uc.organization_id = bg.organization_id);

CREATE VIEW public.v_broadcast_groups_with_stats WITH (security_invoker = on) AS
 SELECT g.id,
    g.name,
    g.description,
    g.department_id,
    g.sub_department_id,
    g.organization_id,
    g.created_by,
    g.is_active,
    g.icon,
    g.color,
    g.created_at,
    g.updated_at,
    ( SELECT count(*) AS count
           FROM broadcast_channels c
          WHERE c.group_id = g.id AND c.is_active = true) AS channel_count,
    ( SELECT count(*) AS count
           FROM v_group_all_participants gap
          WHERE gap.group_id = g.id) AS participant_count,
    COALESCE(sum(c_stats.active_broadcast_count), 0::numeric) AS active_broadcast_count,
    COALESCE(sum(c_stats.total_broadcast_count), 0::numeric) AS total_broadcast_count,
    max(c_stats.last_broadcast_at) AS last_broadcast_at
   FROM broadcast_groups g
     LEFT JOIN v_channels_with_stats c_stats ON c_stats.group_id = g.id
  GROUP BY g.id;

CREATE VIEW public.v_unread_broadcasts_by_group WITH (security_invoker = on) AS
 SELECT gap.group_id,
    gap.employee_id,
    count(DISTINCT b.id) FILTER (WHERE brs.read_at IS NULL) AS unread_count,
    bool_or(b.priority = 'urgent'::text AND brs.read_at IS NULL) AS has_urgent_unread,
    bool_or(b.requires_acknowledgement = true AND ba.acknowledged_at IS NULL) AS has_pending_ack
   FROM v_group_all_participants gap
     JOIN broadcast_channels c ON c.group_id = gap.group_id
     JOIN broadcasts b ON b.channel_id = c.id AND b.is_archived = false
     LEFT JOIN broadcast_read_status brs ON brs.broadcast_id = b.id AND brs.employee_id = gap.employee_id
     LEFT JOIN broadcast_acknowledgements ba ON ba.broadcast_id = b.id AND ba.employee_id = gap.employee_id
  GROUP BY gap.group_id, gap.employee_id;

GRANT ALL ON public.v_group_all_participants, public.v_broadcast_groups_with_stats,
             public.v_unread_broadcasts_by_group
    TO anon, authenticated, service_role;

-- ── RLS policies dropped by the CASCADE ──────────────────────────────────────
CREATE POLICY events_select_org_scoped ON public.events
    AS PERMISSIVE FOR SELECT TO authenticated
    USING ((is_admin() OR (organization_id IS NULL) OR (organization_id IN ( SELECT uc.organization_id
   FROM user_contracts uc
  WHERE (uc.user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid))))));

CREATE POLICY first_aid_appointments_select ON public.first_aid_appointments
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (((employee_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_contracts uc
  WHERE ((uc.user_id = ( SELECT auth.uid() AS uid)) AND (uc.status = 'Active'::text) AND (uc.organization_id = first_aid_appointments.organization_id)))) OR user_has_action_in_scope('contract.view'::text, organization_id, NULL::uuid, NULL::uuid)));

CREATE POLICY "Users can view batches in their organization" ON public.roster_template_batches
    AS PERMISSIVE FOR SELECT TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM (roster_templates rt
     JOIN user_contracts uc ON ((uc.organization_id = rt.organization_id)))
  WHERE ((rt.id = roster_template_batches.template_id) AND (uc.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY shifts_select_bidding ON public.shifts
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (((bidding_status = ANY (ARRAY['on_bidding'::shift_bidding_status, 'on_bidding_normal'::shift_bidding_status, 'on_bidding_urgent'::shift_bidding_status])) AND (EXISTS ( SELECT 1
   FROM user_contracts
  WHERE ((user_contracts.user_id = ( SELECT auth.uid() AS uid)) AND (user_contracts.status = 'Active'::text) AND (user_contracts.organization_id = shifts.organization_id))))));

CREATE POLICY shifts_select_offered_swaps ON public.shifts
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (((EXISTS ( SELECT 1
   FROM shift_swaps
  WHERE ((shift_swaps.target_shift_id = shifts.id) AND (shift_swaps.status = ANY (ARRAY['OPEN'::swap_request_status, 'MANAGER_PENDING'::swap_request_status]))))) AND (EXISTS ( SELECT 1
   FROM user_contracts uc
  WHERE ((uc.user_id = ( SELECT auth.uid() AS uid)) AND (uc.status = 'Active'::text) AND (uc.organization_id = shifts.organization_id))))));

CREATE POLICY shifts_select_open_swaps ON public.shifts
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (((EXISTS ( SELECT 1
   FROM shift_swaps
  WHERE ((shift_swaps.requester_shift_id = shifts.id) AND (shift_swaps.status = 'OPEN'::swap_request_status)))) AND (EXISTS ( SELECT 1
   FROM user_contracts uc
  WHERE ((uc.user_id = ( SELECT auth.uid() AS uid)) AND (uc.status = 'Active'::text) AND (uc.organization_id = shifts.organization_id))))));

CREATE POLICY shifts_select_rbac ON public.shifts
    AS PERMISSIVE FOR SELECT TO public
    USING ((user_has_action_in_scope('shift.view'::text, organization_id, department_id, sub_department_id) OR (((assigned_employee_id = ( SELECT auth.uid() AS uid)) OR (last_rejected_by = ( SELECT auth.uid() AS uid))) AND (EXISTS ( SELECT 1
   FROM user_contracts uc
  WHERE ((uc.user_id = ( SELECT auth.uid() AS uid)) AND (uc.status = 'Active'::text)))))));
