-- Jurisdictions as data, with a hierarchy: a holiday applies to its jurisdiction
-- and every jurisdiction under it (docs/architecture/multi-organization.md §5).
--
-- Why: Ekka (Royal Queensland Show day) is a public holiday in Brisbane only, so
-- Brisbane needs a jurisdiction below Queensland. And three readers still
-- assumed NSW: shift_day_typed_shortfall and public_holiday_calendar_horizon
-- defaulted to 'AU-NSW', and their two callers (the shift-shape trigger and
-- template application) never passed one, so a BCEC shift was day-typed against
-- NSW holidays.
--
-- What changes:
--   1. public.jurisdictions (code, name, parent) replaces the CHECK that called
--      jurisdiction_is_known() — a function reading public_holidays — with
--      ordinary foreign keys from public_holidays and organizations.
--   2. jurisdiction_lineage(code): the code and its ancestors.
--   3. organization_jurisdiction(org): SECURITY DEFINER, because the shape
--      trigger runs as the caller and organizations are now readable by
--      members only; a NULL there would refuse the shift as "calendar empty".
--   4. Every holiday reader matches the lineage; the horizon is the shortest
--      level's.
--   5. No 'AU-NSW' default left: the trigger and template application pass the
--      shift's organization's jurisdiction.
--   6. TOIL counts holidays across the lineage of each permanent contract's
--      organization.
-- Data (Ekka rows, BCEC moving to AU-QLD-BNE) is applied separately and lands in
-- supabase/seeds/reference.sql.

-- ── 1. Jurisdictions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jurisdictions (
    -- ISO 3166-1 country, then ISO 3166-2 subdivision, then an optional local
    -- level of our own (e.g. AU-QLD-BNE, Brisbane, for the Ekka).
    code        text PRIMARY KEY CHECK (code ~ '^[A-Z]{2}(-[A-Z0-9]{1,3}){0,2}$'),
    name        text NOT NULL,
    parent_code text REFERENCES public.jurisdictions (code) ON DELETE RESTRICT,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT jurisdictions_not_own_parent CHECK (parent_code IS DISTINCT FROM code)
);
CREATE INDEX IF NOT EXISTS idx_jurisdictions_parent_code
    ON public.jurisdictions (parent_code) WHERE parent_code IS NOT NULL;

ALTER TABLE public.jurisdictions ENABLE ROW LEVEL SECURITY;
-- National days stay on the state rows (as before); AU holds none today.
-- Universal reference data: every signed-in user reads it; only the service
-- role writes it (no write policy, no write grant).
DROP POLICY IF EXISTS jurisdictions_select ON public.jurisdictions;
CREATE POLICY jurisdictions_select ON public.jurisdictions
    FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.jurisdictions FROM anon, authenticated;
GRANT SELECT ON public.jurisdictions TO authenticated;

INSERT INTO public.jurisdictions (code, name, parent_code) VALUES
    ('AU',         'Australia',       NULL),
    ('AU-NSW',     'New South Wales', 'AU'),
    ('AU-QLD',     'Queensland',      'AU'),
    ('AU-QLD-BNE', 'Brisbane',        'AU-QLD')
ON CONFLICT (code) DO NOTHING;

-- ── 2. Foreign keys replace the function CHECK ───────────────────────────────
ALTER TABLE public.public_holidays
    DROP CONSTRAINT IF EXISTS public_holidays_jurisdiction_fkey,
    ADD  CONSTRAINT public_holidays_jurisdiction_fkey
         FOREIGN KEY (jurisdiction) REFERENCES public.jurisdictions (code);
CREATE INDEX IF NOT EXISTS idx_public_holidays_jurisdiction_date
    ON public.public_holidays (jurisdiction, holiday_date);

ALTER TABLE public.organizations
    DROP CONSTRAINT IF EXISTS organizations_jurisdiction_known,
    DROP CONSTRAINT IF EXISTS organizations_jurisdiction_fkey,
    ADD  CONSTRAINT organizations_jurisdiction_fkey
         FOREIGN KEY (jurisdiction) REFERENCES public.jurisdictions (code);
CREATE INDEX IF NOT EXISTS idx_organizations_jurisdiction
    ON public.organizations (jurisdiction);

-- Its only caller was the CHECK above.
DROP FUNCTION IF EXISTS public.jurisdiction_is_known(text);

-- ── 3. Helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jurisdiction_lineage(p_code text)
 RETURNS text[]
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    -- The jurisdiction itself, then each parent up to the root. NULL for an
    -- unknown code, so "= ANY (lineage)" matches nothing.
    WITH RECURSIVE up (code, parent_code, depth) AS (
        SELECT j.code, j.parent_code, 0
          FROM public.jurisdictions j
         WHERE j.code = p_code
        UNION ALL
        SELECT j.code, j.parent_code, up.depth + 1
          FROM public.jurisdictions j
          JOIN up ON j.code = up.parent_code
         WHERE up.depth < 10
    )
    SELECT array_agg(up.code ORDER BY up.depth) FROM up;
$function$;
REVOKE ALL ON FUNCTION public.jurisdiction_lineage(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jurisdiction_lineage(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.organization_jurisdiction(p_organization_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    -- Not sensitive (a jurisdiction code), and must not come back NULL under
    -- RLS: the shift-shape trigger runs as the caller.
    SELECT o.jurisdiction FROM public.organizations o WHERE o.id = p_organization_id;
$function$;
REVOKE ALL ON FUNCTION public.organization_jurisdiction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_jurisdiction(uuid) TO authenticated, service_role;

-- ── 4. Readers follow the hierarchy ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fairness_category_minutes(p_shift_date date, p_start time without time zone, p_end time without time zone, p_net_minutes numeric, p_jurisdiction text)
 RETURNS TABLE(total numeric, saturday numeric, sunday numeric, public_holiday numeric, night numeric)
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    WITH span AS (
        SELECT p_shift_date + p_start AS t0,
               p_shift_date + p_end
                 + CASE WHEN p_end <= p_start THEN interval '1 day' ELSE interval '0' END AS t1
    ), days AS (
        SELECT g.d::date AS d,
               GREATEST(0, EXTRACT(EPOCH FROM LEAST(s.t1, g.d + interval '1 day')
                                            - GREATEST(s.t0, g.d)) / 60) AS on_day,
               GREATEST(0, EXTRACT(EPOCH FROM LEAST(s.t1, g.d + interval '30 hours')
                                            - GREATEST(s.t0, g.d + interval '22 hours')) / 60) AS night_from_d,
               EXISTS (SELECT 1 FROM public.public_holidays h
                        WHERE h.holiday_date = g.d::date AND h.jurisdiction = ANY (public.jurisdiction_lineage(p_jurisdiction))) AS is_ph
          FROM span s
         CROSS JOIN generate_series((p_shift_date - 1)::timestamp,
                                    (p_shift_date + 1)::timestamp,
                                    interval '1 day') AS g(d)
    ), scale AS (
        SELECT p_net_minutes / (EXTRACT(EPOCH FROM t1 - t0) / 60) AS k FROM span
    )
    SELECT p_net_minutes,
           k * COALESCE(sum(on_day) FILTER (WHERE EXTRACT(ISODOW FROM d) = 6), 0),
           k * COALESCE(sum(on_day) FILTER (WHERE EXTRACT(ISODOW FROM d) = 7), 0),
           k * COALESCE(sum(on_day) FILTER (WHERE is_ph), 0),
           k * COALESCE(sum(night_from_d), 0)
      FROM days, scale
     GROUP BY k;
$function$;

-- No 'AU-NSW' default any more: every caller names the jurisdiction. Defaults
-- cannot be removed by CREATE OR REPLACE, so drop and recreate, then restore grants.
DROP FUNCTION IF EXISTS public.shift_day_typed_shortfall(date, time without time zone, time without time zone, integer, text, boolean, boolean, uuid, text);
DROP FUNCTION IF EXISTS public.public_holiday_calendar_horizon(text);

CREATE FUNCTION public.public_holiday_calendar_horizon(p_jurisdiction text)
 RETURNS date
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    -- The calendar reaches only as far as its shortest level: Brisbane's
    -- coverage ends where either the Queensland rows or the Ekka rows end.
    SELECT min(level_end) FROM (
        SELECT max(h.holiday_date) AS level_end
          FROM public.public_holidays h
         WHERE h.jurisdiction = ANY (public.jurisdiction_lineage(p_jurisdiction))
         GROUP BY h.jurisdiction) levels;
$function$;

CREATE FUNCTION public.shift_day_typed_shortfall(p_shift_date date, p_start_time time without time zone, p_end_time time without time zone, p_unpaid_break_minutes integer, p_target_employment_type text, p_target_requires_flexible boolean, p_is_training boolean, p_role_id uuid, p_jurisdiction text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_is_security boolean;
    v_net         integer;
    v_is_ph       boolean;
    v_is_sunday   boolean;
    v_horizon     date;
BEGIN
    IF p_shift_date IS NULL OR p_start_time IS NULL OR p_end_time IS NULL THEN
        RETURN NULL;
    END IF;

    IF p_target_employment_type = 'FT' THEN
        RETURN NULL;
    END IF;

    v_is_ph := EXISTS (
        SELECT 1 FROM public.public_holidays ph
        WHERE ph.holiday_date = p_shift_date AND ph.jurisdiction = ANY (public.jurisdiction_lineage(p_jurisdiction))
    );

    IF NOT v_is_ph THEN
        v_horizon := public.public_holiday_calendar_horizon(p_jurisdiction);
        IF v_horizon IS NULL OR p_shift_date > v_horizon THEN
            RAISE EXCEPTION
                'The % public holiday calendar only reaches %, so a shift on % cannot be classified. Extend public_holidays before rostering past the horizon — treating an uncovered date as "not a public holiday" is how cl 56.2 silently stopped applying to an entire year once before.',
                p_jurisdiction, COALESCE(v_horizon::text, '(empty)'), p_shift_date
                USING ERRCODE = '23514';
        END IF;
    END IF;

    v_is_sunday := EXTRACT(DOW FROM p_shift_date) = 0;

    IF NOT v_is_ph AND NOT v_is_sunday THEN
        RETURN NULL;
    END IF;

    v_is_security := public.shift_is_security_role(p_role_id);
    v_net := public.shift_net_minutes(
        p_start_time,
        p_end_time,
        CASE WHEN v_is_security THEN 0 ELSE COALESCE(p_unpaid_break_minutes, 0) END
    );

    IF v_is_ph AND v_net < 240 THEN
        RETURN format(
            'SHAPE_MIN_ENGAGEMENT_PH: a shift on a public holiday must be at least 4 hours (ICC EBA cl 56.2); this one provides %s minutes of net working time.',
            v_net
        );
    END IF;

    IF v_is_sunday
       AND NOT (p_target_employment_type = 'PT' AND NOT COALESCE(p_target_requires_flexible, false))
       AND NOT COALESCE(p_is_training, false)
       AND v_net < 240
    THEN
        RETURN format(
            'SHAPE_MIN_ENGAGEMENT: a Sunday engagement must be at least 4 hours (ICC EBA cl 12.4(c)/12.5(c)); this one provides %s minutes of net working time.',
            v_net
        );
    END IF;

    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.public_holiday_calendar_horizon(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_holiday_calendar_horizon(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.shift_day_typed_shortfall(date, time without time zone, time without time zone, integer, text, boolean, boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_day_typed_shortfall(date, time without time zone, time without time zone, integer, text, boolean, boolean, uuid, text) TO authenticated, service_role;

-- ── 5. Callers pass the shift's own jurisdiction ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_shift_shape_day_typed_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_breach text;
BEGIN
    IF COALESCE(NEW.is_cancelled, false) THEN
        RETURN NEW;
    END IF;

    v_breach := public.shift_day_typed_shortfall(
        NEW.shift_date,
        NEW.start_time,
        NEW.end_time,
        NEW.unpaid_break_minutes,
        NEW.target_employment_type,
        NEW.target_requires_flexible,
        NEW.is_training,
        NEW.role_id,
        public.organization_jurisdiction(NEW.organization_id)
    );

    IF v_breach IS NOT NULL THEN
        RAISE EXCEPTION '%', v_breach USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_template_to_date_range_v2(p_template_id uuid, p_start_date date, p_end_date date, p_user_id uuid, p_source text DEFAULT 'roster_modal'::text, p_target_department_id uuid DEFAULT NULL::uuid, p_target_sub_department_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_template record;
    v_curr_date date;
    v_roster_id uuid;
    v_batch_id uuid;
    v_total_shifts integer := 0;
    v_shifts_skipped integer := 0;
    v_tg record;
    v_tsg record;
    v_ts record;
    v_breach_window text;
    v_rg_id uuid;
    v_rsg_id uuid;
    v_external_id text;
    v_shift_start_timestamp timestamptz;
    v_shift_end_timestamp timestamptz;
    v_dept_id uuid;
    v_sub_dept_id uuid;
    v_dow integer;
    v_new_shift_id uuid;
    v_breach text;
    v_shifts_skipped_unlawful integer := 0;
    v_unlawful jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.sm_require_template_apply(p_template_id, p_target_department_id, p_target_sub_department_id);
  IF NOT public.sm_request_is_system() THEN
    p_user_id := auth.uid();
  END IF;
    SELECT * INTO v_template FROM roster_templates WHERE id = p_template_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;

    v_dept_id := COALESCE(p_target_department_id, v_template.department_id);
    v_sub_dept_id := COALESCE(p_target_sub_department_id, v_template.sub_department_id);

    INSERT INTO roster_template_batches (
        template_id, applied_at, applied_by, start_date, end_date, source
    )
    VALUES (
        p_template_id, now(), p_user_id, p_start_date, p_end_date, p_source
    )
    RETURNING id INTO v_batch_id;

    PERFORM set_config('app.audit.via_gateway', '1', true);

    FOR v_curr_date IN (SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date) LOOP

        v_dow := (EXTRACT(DOW FROM v_curr_date))::integer;

        PERFORM pg_advisory_xact_lock(hashtextextended(
            'template_apply:' || v_curr_date::text || ':' || v_dept_id::text || ':' || COALESCE(v_sub_dept_id::text, ''), 0));

        SELECT id INTO v_roster_id
        FROM rosters
        WHERE start_date = v_curr_date
          AND department_id = v_dept_id
          AND sub_department_id IS NOT DISTINCT FROM v_sub_dept_id
        LIMIT 1;

        IF v_roster_id IS NULL THEN
            INSERT INTO rosters (
                start_date, end_date, template_id, organization_id,
                department_id, sub_department_id,
                description, status, is_locked, created_by
            )
            VALUES (
                v_curr_date, v_curr_date, p_template_id, v_template.organization_id,
                v_dept_id, v_sub_dept_id,
                v_template.description, 'draft', false, p_user_id
            )
            RETURNING id INTO v_roster_id;
        END IF;

        FOR v_tg IN (SELECT * FROM template_groups WHERE template_id = p_template_id) LOOP
            v_external_id := CASE LOWER(REPLACE(v_tg.name, ' ', '_'))
                WHEN 'convention_centre' THEN 'convention_centre'
                WHEN 'exhibition_centre' THEN 'exhibition_centre'
                WHEN 'theatre' THEN 'theatre'
                WHEN 'the_cutaway' THEN 'the_cutaway'
                WHEN 'office' THEN 'office'
                ELSE NULL
            END;

            IF v_external_id IS NULL THEN
                RAISE EXCEPTION 'apply_template: unknown template group "%" — cannot map to a roster group type', v_tg.name;
            END IF;

            SELECT id INTO v_rg_id FROM roster_groups WHERE roster_id = v_roster_id AND (external_id = v_external_id OR name = v_tg.name) LIMIT 1;

            IF v_rg_id IS NULL THEN
                INSERT INTO roster_groups (roster_id, name, external_id, sort_order)
                VALUES (v_roster_id, v_tg.name, v_external_id, v_tg.sort_order)
                RETURNING id INTO v_rg_id;
            END IF;

            FOR v_tsg IN (SELECT * FROM template_subgroups WHERE group_id = v_tg.id) LOOP
                SELECT id INTO v_rsg_id
                FROM roster_subgroups
                WHERE roster_group_id = v_rg_id AND lower(name) = lower(btrim(v_tsg.name));

                IF v_rsg_id IS NULL THEN
                    INSERT INTO roster_subgroups (roster_group_id, name, sort_order)
                    VALUES (v_rg_id, v_tsg.name, v_tsg.sort_order)
                    RETURNING id INTO v_rsg_id;
                END IF;

                FOR v_ts IN (SELECT * FROM template_shifts WHERE subgroup_id = v_tsg.id) LOOP
                    IF v_ts.day_of_week IS NULL OR v_ts.day_of_week = v_dow THEN

                        IF NOT EXISTS (
                            SELECT 1 FROM shifts
                            WHERE roster_id = v_roster_id
                              AND template_instance_id = v_ts.id
                        ) THEN
                            v_shift_start_timestamp := (v_curr_date || ' ' || v_ts.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                            v_shift_end_timestamp := (v_curr_date || ' ' || v_ts.end_time)::timestamp AT TIME ZONE 'Australia/Sydney';

                            IF v_ts.end_time < v_ts.start_time THEN
                                v_shift_end_timestamp := v_shift_end_timestamp + interval '1 day';
                            END IF;

                            IF v_shift_start_timestamp <= now() THEN
                                v_shifts_skipped := v_shifts_skipped + 1;
                                CONTINUE;
                            END IF;

                            v_breach_window := public.shift_break_window_breach(
                                v_ts.start_time, v_ts.end_time, COALESCE(v_ts.unpaid_break_minutes, 0),
                                v_ts.break_start, v_ts.break_end, v_ts.unpaid_breaks);
                            v_breach := public.shift_day_typed_shortfall(
                                v_curr_date,
                                v_ts.start_time,
                                v_ts.end_time,
                                COALESCE(v_ts.unpaid_break_minutes, 0),
                                v_ts.target_employment_type,
                                v_ts.target_requires_flexible,
                                false,
                                v_ts.role_id,
                                public.organization_jurisdiction(v_template.organization_id)
                            );
                            v_breach := COALESCE(v_breach_window, v_breach);
                            IF v_breach IS NOT NULL THEN
                                v_shifts_skipped_unlawful := v_shifts_skipped_unlawful + 1;
                                v_unlawful := v_unlawful || jsonb_build_object(
                                    'date',              v_curr_date,
                                    'template_shift_id', v_ts.id,
                                    'group',             v_tg.name,
                                    'sub_group',         v_tsg.name,
                                    'role_id',           v_ts.role_id,
                                    'start_time',        v_ts.start_time,
                                    'end_time',          v_ts.end_time,
                                    'breach',            v_breach
                                );
                                CONTINUE;
                            END IF;

                            INSERT INTO shifts (
                                roster_id, organization_id, department_id, sub_department_id,
                                role_id, shift_date, start_time, end_time,
                                start_at, end_at,
                                paid_break_minutes, unpaid_break_minutes, break_start, break_end, unpaid_breaks,
                                template_id, template_instance_id, is_from_template,
                                template_batch_id,
                                roster_subgroup_id,
                                lifecycle_status, notes,
                                created_by_user_id,
                                required_skills,
                                required_licenses,
                                event_ids
                            )
                            VALUES (
                                v_roster_id, v_template.organization_id, v_dept_id, v_sub_dept_id,
                                v_ts.role_id, v_curr_date, v_ts.start_time, v_ts.end_time,
                                v_shift_start_timestamp, v_shift_end_timestamp,
                                COALESCE(v_ts.paid_break_minutes, 0), COALESCE(v_ts.unpaid_break_minutes, 0),
                                v_ts.break_start, v_ts.break_end, COALESCE(v_ts.unpaid_breaks, '[]'::jsonb),
                                p_template_id, v_ts.id, true,
                                v_batch_id,
                                v_rsg_id,
                                'Draft', v_ts.notes,
                                p_user_id,
                                to_jsonb(v_ts.required_skills),
                                to_jsonb(v_ts.required_licenses),
                                '[]'::jsonb
                            )
                            RETURNING id INTO v_new_shift_id;

                            INSERT INTO public.shift_events (
                                shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
                            ) VALUES (
                                v_new_shift_id,
                                NULL,
                                p_user_id,
                                'OP_APPLIED'::public.shift_event_type,
                                jsonb_build_object(
                                    'op', 'create',
                                    'domain', 'lifecycle',
                                    'from_state', NULL,
                                    'to_state', 'S1',
                                    'source', 'apply_template_to_date_range_v2',
                                    'creation_source', 'template'
                                ),
                                CASE WHEN p_user_id IS NULL THEN 'system' ELSE 'manager' END,
                                'lifecycle'
                            );

                            v_total_shifts := v_total_shifts + 1;
                        END IF;
                    END IF;
                END LOOP;
            END LOOP;
        END LOOP;
    END LOOP;

    PERFORM set_config('app.audit.via_gateway', '0', true);

    UPDATE roster_templates
    SET
        status = 'published',
        updated_at = NOW(),
        last_used_at = NOW(),
        is_active = true
    WHERE id = p_template_id;

    RETURN jsonb_build_object(
        'success', true,
        'shifts_created', v_total_shifts,
        'shifts_skipped', v_shifts_skipped,
        'shifts_skipped_unlawful', v_shifts_skipped_unlawful,
        'unlawful_instances', v_unlawful,
        'batch_id', v_batch_id,
        'roster_id', v_roster_id
    );
END;
$function$;

-- ── 6. TOIL: holidays of the jurisdictions (and their parents) of the person's
--    permanent contracts that week ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION internal.toil_absence_credit_minutes(p_employee uuid, p_week_start date, p_daily_minutes integer)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_week_end   date := p_week_start + 6;
    v_leave      numeric := 0;
    v_ph         integer := 0;
    v_leave_days date[] := '{}';
    r            record;
    v_s          date;
    v_e          date;
    v_weekdays   integer;
    v_alldays    integer;
    v_in_week    integer;
BEGIN
    FOR r IN
        SELECT lr.start_date, lr.end_date, lr.requested_hours
          FROM public.leave_requests lr
         WHERE lr.employee_id = p_employee
           AND lr.status = 'approved'
           AND (lr.start_date AT TIME ZONE 'UTC')::date <= v_week_end
           AND (lr.end_date AT TIME ZONE 'UTC')::date >= p_week_start
    LOOP
        v_s := (r.start_date AT TIME ZONE 'UTC')::date;
        v_e := (r.end_date AT TIME ZONE 'UTC')::date;
        SELECT count(*) FILTER (WHERE extract(isodow FROM d) < 6), count(*)
          INTO v_weekdays, v_alldays
          FROM generate_series(v_s, v_e, interval '1 day') d;
        SELECT count(*) FILTER (WHERE v_weekdays = 0 OR extract(isodow FROM d) < 6)
          INTO v_in_week
          FROM generate_series(greatest(v_s, p_week_start), least(v_e, v_week_end), interval '1 day') d;
        IF coalesce(v_alldays, 0) > 0 THEN
            v_leave := v_leave + coalesce(r.requested_hours, 0) * 60 * v_in_week
                       / CASE WHEN v_weekdays > 0 THEN v_weekdays ELSE v_alldays END;
        END IF;
        v_leave_days := v_leave_days || ARRAY(
            SELECT d::date FROM generate_series(greatest(v_s, p_week_start), least(v_e, v_week_end), interval '1 day') d);
    END LOOP;

    -- Holidays of the jurisdictions where this person holds a permanent contract
    -- in the week (a Brisbane holiday is not a day off for Sydney staff).
    SELECT count(DISTINCT ph.holiday_date) INTO v_ph
      FROM public.public_holidays ph
     WHERE ph.holiday_date BETWEEN p_week_start AND v_week_end
       AND extract(isodow FROM ph.holiday_date) < 6
       AND NOT (ph.holiday_date = ANY (v_leave_days))
       AND EXISTS (
            SELECT 1
              FROM hr.user_contracts uc
              JOIN public.organizations o ON o.id = uc.organization_id
             WHERE uc.user_id = p_employee
               AND uc.employment_status IN ('Full-Time', 'Part-Time', 'Flexible Part-Time')
               AND daterange(uc.start_date, uc.end_date, '[]') && daterange(p_week_start, v_week_end, '[]')
               AND ph.jurisdiction = ANY (public.jurisdiction_lineage(o.jurisdiction)));

    RETURN round(v_leave)::integer + v_ph * coalesce(p_daily_minutes, 0);
END;
$function$;
