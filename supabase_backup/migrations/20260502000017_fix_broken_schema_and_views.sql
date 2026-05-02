-- Migration to fix missing schema and broken views
-- Includes: shift_bids, timesheets, template_groups/subgroups/shifts, and v_template_full update

-- 1. Add missing columns to existing tables
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS employment_type text;
ALTER TABLE public.rosters ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 2. Create missing tables
CREATE TABLE IF NOT EXISTS public.shift_bids (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id    uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'assigned')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.timesheets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id        uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    employee_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status          text NOT NULL DEFAULT 'pending',
    notes           text,
    rejected_reason text,
    start_time      timestamptz,
    end_time        timestamptz,
    clock_in        timestamptz,
    clock_out       timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_groups (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id uuid NOT NULL REFERENCES public.roster_templates(id) ON DELETE CASCADE,
    name        text NOT NULL,
    description text,
    color       text DEFAULT '#3b82f6',
    icon        text,
    sort_order  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_subgroups (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    uuid NOT NULL REFERENCES public.template_groups(id) ON DELETE CASCADE,
    name        text NOT NULL,
    description text,
    sort_order  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_shifts (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subgroup_id           uuid NOT NULL REFERENCES public.template_subgroups(id) ON DELETE CASCADE,
    name                  text,
    role_id               uuid REFERENCES public.roles(id),
    start_time            time NOT NULL,
    end_time              time NOT NULL,
    paid_break_minutes    integer DEFAULT 0,
    unpaid_break_minutes  integer DEFAULT 0,
    required_skills       jsonb DEFAULT '[]'::jsonb,
    required_licenses     jsonb DEFAULT '[]'::jsonb,
    site_tags             jsonb DEFAULT '[]'::jsonb,
    event_tags            jsonb DEFAULT '[]'::jsonb,
    notes                 text,
    sort_order            integer NOT NULL DEFAULT 0,
    day_of_week           integer NOT NULL DEFAULT 0,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 3. Redefine v_template_full
DROP VIEW IF EXISTS public.v_template_full;
CREATE VIEW public.v_template_full AS
WITH subgroup_data AS (
    SELECT 
        ts.subgroup_id,
        jsonb_agg(
            jsonb_build_object(
                'id', ts.id,
                'name', ts.name,
                'role_id', ts.role_id,
                'start_time', ts.start_time,
                'end_time', ts.end_time,
                'paid_break_minutes', ts.paid_break_minutes,
                'unpaid_break_minutes', ts.unpaid_break_minutes,
                'required_skills', ts.required_skills,
                'required_licenses', ts.required_licenses,
                'site_tags', ts.site_tags,
                'event_tags', ts.event_tags,
                'notes', ts.notes,
                'sort_order', ts.sort_order,
                'day_of_week', ts.day_of_week
            ) ORDER BY ts.sort_order
        ) as shifts
    FROM public.template_shifts ts
    GROUP BY ts.subgroup_id
),
group_data AS (
    SELECT 
        tsg.group_id,
        jsonb_agg(
            jsonb_build_object(
                'id', tsg.id,
                'name', tsg.name,
                'description', tsg.description,
                'sort_order', tsg.sort_order,
                'shifts', COALESCE(sd.shifts, '[]'::jsonb)
            ) ORDER BY tsg.sort_order
        ) as subGroups
    FROM public.template_subgroups tsg
    LEFT JOIN subgroup_data sd ON sd.subgroup_id = tsg.id
    GROUP BY tsg.group_id
)
SELECT 
    rt.*,
    o.name as organization_name,
    d.name as department_name,
    sd.name as sub_department_name,
    (
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', tg.id,
                'name', tg.name,
                'description', tg.description,
                'color', tg.color,
                'icon', tg.icon,
                'sort_order', tg.sort_order,
                'subGroups', COALESCE(gd.subGroups, '[]'::jsonb)
            ) ORDER BY tg.sort_order
        )
        FROM public.template_groups tg
        LEFT JOIN group_data gd ON gd.group_id = tg.id
        WHERE tg.template_id = rt.id
    ) as groups
FROM public.roster_templates rt
LEFT JOIN public.organizations o ON o.id = rt.organization_id
LEFT JOIN public.departments d ON d.id = rt.department_id
LEFT JOIN public.sub_departments sd ON sd.id = rt.sub_department_id;

-- 4. Enable RLS and add basic policies
ALTER TABLE public.shift_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_subgroups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_shifts ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    DROP POLICY IF EXISTS auth_read_shift_bids ON public.shift_bids;
    CREATE POLICY auth_read_shift_bids ON public.shift_bids FOR SELECT TO authenticated USING (true);

    DROP POLICY IF EXISTS auth_read_timesheets ON public.timesheets;
    CREATE POLICY auth_read_timesheets ON public.timesheets FOR SELECT TO authenticated USING (true);

    DROP POLICY IF EXISTS auth_read_template_groups ON public.template_groups;
    CREATE POLICY auth_read_template_groups ON public.template_groups FOR SELECT TO authenticated USING (true);

    DROP POLICY IF EXISTS auth_read_template_subgroups ON public.template_subgroups;
    CREATE POLICY auth_read_template_subgroups ON public.template_subgroups FOR SELECT TO authenticated USING (true);

    DROP POLICY IF EXISTS auth_read_template_shifts ON public.template_shifts;
    CREATE POLICY auth_read_template_shifts ON public.template_shifts FOR SELECT TO authenticated USING (true);
END $$;

-- 5. Set security invoker for the new view
ALTER VIEW public.v_template_full SET (security_invoker = true);
