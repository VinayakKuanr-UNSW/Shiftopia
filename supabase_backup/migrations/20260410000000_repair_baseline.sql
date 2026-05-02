-- ==========================================
-- REPAIR BASELINE: Missing Core Schema
-- ==========================================

-- 1. ENUMS & TYPES
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'access_level') THEN
        CREATE TYPE access_level AS ENUM ('alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_group_type') THEN
        CREATE TYPE template_group_type AS ENUM ('convention_centre', 'exhibition_centre', 'theatre');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_assignment_status') THEN
        CREATE TYPE shift_assignment_status AS ENUM ('assigned', 'unassigned');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_fulfillment_status') THEN
        CREATE TYPE shift_fulfillment_status AS ENUM ('scheduled', 'bidding', 'offered', 'none');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_attendance_status') THEN
        CREATE TYPE shift_attendance_status AS ENUM ('unknown', 'checked_in', 'no_show', 'late', 'excused', 'auto_clock_out');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_assignment_outcome') THEN
        CREATE TYPE shift_assignment_outcome AS ENUM ('pending', 'offered', 'confirmed', 'emergency_assigned', 'no_show');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_bidding_status') THEN
        CREATE TYPE shift_bidding_status AS ENUM ('not_on_bidding', 'on_bidding_normal', 'on_bidding_urgent', 'bidding_closed_no_winner', 'on_bidding');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_trading') THEN
        CREATE TYPE shift_trading AS ENUM ('NoTrade', 'TradeRequested', 'TradeAccepted', 'TradeApproved');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_lifecycle') THEN
        CREATE TYPE shift_lifecycle AS ENUM ('Draft', 'Published', 'InProgress', 'Completed', 'Cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_lifecycle_status') THEN
        CREATE TYPE shift_lifecycle_status AS ENUM ('draft', 'published', 'in_progress', 'completed', 'cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'roster_status') THEN
        CREATE TYPE roster_status AS ENUM ('draft', 'published', 'archived');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'swap_request_status') THEN
        CREATE TYPE swap_request_status AS ENUM ('OPEN', 'OFFER_SELECTED', 'MANAGER_PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'swap_offer_status') THEN
        CREATE TYPE swap_offer_status AS ENUM ('SUBMITTED', 'SELECTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');
    END IF;

    -- Composite Types
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'publish_shift_result') THEN
        CREATE TYPE publish_shift_result AS (
            success boolean,
            shift_id uuid,
            roster_shift_id uuid,
            action text,
            from_state text,
            to_state text,
            error_code text,
            error_message text
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_validation_result') THEN
        CREATE TYPE shift_validation_result AS (
            is_valid boolean,
            error_code text,
            error_message text,
            warnings jsonb
        );
    END IF;
END $$;

-- 2. CORE TABLES
CREATE TABLE IF NOT EXISTS public.organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    code text,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.departments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id),
    name text NOT NULL,
    code text,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sub_departments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id uuid NOT NULL REFERENCES public.departments(id),
    name text NOT NULL,
    code text,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id),
    first_name text NOT NULL,
    last_name text,
    email text NOT NULL,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.remuneration_levels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    level_number integer NOT NULL,
    level_name text NOT NULL,
    hourly_rate_min numeric,
    hourly_rate_max numeric,
    annual_salary_min numeric,
    annual_salary_max numeric,
    description text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id uuid REFERENCES public.departments(id),
    sub_department_id uuid REFERENCES public.sub_departments(id),
    name text NOT NULL,
    code text,
    level integer NOT NULL DEFAULT 0,
    remuneration_level_id uuid REFERENCES public.remuneration_levels(id),
    employment_type text,
    description text,
    responsibilities text[],
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    forecasting_bucket text,
    supervision_ratio_min integer,
    supervision_ratio_max integer,
    is_baseline_eligible boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.rosters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id),
    department_id uuid REFERENCES public.departments(id),
    sub_department_id uuid REFERENCES public.sub_departments(id),
    start_date date NOT NULL,
    end_date date NOT NULL,
    description text,
    status roster_status DEFAULT 'draft',
    is_locked boolean NOT NULL DEFAULT false,
    created_by uuid,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roster_days (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    roster_id uuid NOT NULL REFERENCES public.rosters(id),
    date date NOT NULL,
    organization_id uuid NOT NULL,
    department_id uuid,
    sub_department_id uuid,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roster_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    roster_day_id uuid NOT NULL REFERENCES public.roster_days(id),
    name text NOT NULL,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roster_subgroups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    roster_group_id uuid NOT NULL REFERENCES public.roster_groups(id),
    name text NOT NULL,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roster_shifts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    roster_subgroup_id uuid NOT NULL REFERENCES public.roster_subgroups(id),
    name text,
    role_id uuid REFERENCES public.roles(id),
    start_time time NOT NULL,
    end_time time NOT NULL,
    paid_break_minutes integer DEFAULT 0,
    unpaid_break_minutes integer DEFAULT 0,
    lifecycle shift_lifecycle_status DEFAULT 'draft',
    published_to_shift_id uuid,
    published_at timestamptz,
    published_by uuid,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shifts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    roster_id uuid NOT NULL REFERENCES public.rosters(id),
    roster_shift_id uuid REFERENCES public.roster_shifts(id),
    organization_id uuid NOT NULL REFERENCES public.organizations(id),
    department_id uuid NOT NULL REFERENCES public.departments(id),
    sub_department_id uuid REFERENCES public.sub_departments(id),
    role_id uuid REFERENCES public.roles(id),
    shift_date date NOT NULL,
    start_time time NOT NULL,
    end_time time NOT NULL,
    is_cancelled boolean NOT NULL DEFAULT false,
    is_overnight boolean NOT NULL DEFAULT false,
    is_from_template boolean NOT NULL DEFAULT false,
    version integer NOT NULL DEFAULT 1,
    assignment_status shift_assignment_status NOT NULL DEFAULT 'unassigned',
    fulfillment_status shift_fulfillment_status NOT NULL DEFAULT 'none',
    attendance_status shift_attendance_status NOT NULL DEFAULT 'unknown',
    assignment_outcome shift_assignment_outcome,
    bidding_status shift_bidding_status NOT NULL DEFAULT 'not_on_bidding',
    trading_status shift_trading NOT NULL DEFAULT 'NoTrade',
    lifecycle_status shift_lifecycle NOT NULL DEFAULT 'Draft',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    deleted_at timestamptz,
    is_draft boolean DEFAULT true,
    is_published boolean DEFAULT false,
    is_on_bidding boolean DEFAULT false,
    bidding_enabled boolean DEFAULT false,
    bidding_open_at timestamptz,
    bidding_close_at timestamptz,
    is_urgent boolean DEFAULT false,
    cancellation_reason text,
    emergency_assigned_at timestamptz,
    emergency_assigned_by uuid,
    assignment_source text,
    creation_source text,
    assigned_employee_id uuid,
    assigned_at timestamptz,
    confirmed_at timestamptz,
    published_at timestamptz,
    published_by_user_id uuid,
    last_modified_by uuid,
    last_modified_reason text,
    scheduled_start timestamptz,
    scheduled_end timestamptz,
    paid_break_minutes integer DEFAULT 0,
    unpaid_break_minutes integer DEFAULT 0,
    remuneration_level_id uuid REFERENCES public.remuneration_levels(id),
    sub_group_name text,
    shift_group_id uuid,
    shift_subgroup_id uuid,
    display_order integer,
    required_skills jsonb,
    required_licenses jsonb,
    event_tags jsonb,
    tags jsonb,
    notes text,
    eligibility_snapshot jsonb,
    compliance_checked_at timestamptz,
    template_id uuid,
    template_instance_id uuid,
    group_type template_group_type,
    template_group template_group_type,
    template_sub_group text,
    roster_date date,
    dropped_by_id uuid,
    synthesis_run_id uuid
);

CREATE TABLE IF NOT EXISTS public.role_levels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id uuid NOT NULL REFERENCES public.roles(id),
    level_code text NOT NULL,
    hierarchy_rank integer NOT NULL,
    remuneration_level_id uuid NOT NULL REFERENCES public.remuneration_levels(id)
);

CREATE TABLE IF NOT EXISTS public.attendance_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id uuid NOT NULL REFERENCES public.shifts(id),
    employee_id uuid NOT NULL,
    scheduled_start timestamptz NOT NULL,
    scheduled_end timestamptz NOT NULL,
    actual_start timestamptz,
    actual_end timestamptz,
    status text,
    minutes_late integer,
    notes text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.deleted_shifts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id uuid REFERENCES public.departments(id),
    organization_id uuid REFERENCES public.organizations(id),
    template_id uuid,
    deleted_at timestamptz,
    deleted_by uuid,
    deleted_reason text,
    snapshot_data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid REFERENCES public.organizations(id),
    name text NOT NULL,
    description text,
    event_type text,
    venue text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    start_time time,
    end_time time,
    expected_attendance integer,
    status text,
    is_active boolean,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_performance_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    window_days integer NOT NULL,
    reliability_score numeric,
    cancel_rate numeric,
    no_show_rate numeric,
    acceptance_rate numeric,
    captured_at timestamptz DEFAULT now()
);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.employee_daily_metrics AS
SELECT 
    gen_random_uuid()::uuid as employee_id,
    current_date as event_date,
    0::bigint as offered,
    0::bigint as accepted,
    0::bigint as rejected,
    0::bigint as ignored,
    0::bigint as assigned,
    0::bigint as emergency,
    0::bigint as cancelled,
    0::bigint as late_cancelled,
    0::bigint as swapped,
    0::bigint as late_in,
    0::bigint as early_out,
    0::bigint as no_show,
    0::bigint as worked;

CREATE TABLE IF NOT EXISTS public.shift_swaps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id uuid NOT NULL,
    requester_shift_id uuid NOT NULL REFERENCES public.shifts(id),
    target_id uuid,
    target_shift_id uuid REFERENCES public.shifts(id),
    status swap_request_status DEFAULT 'OPEN',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.swap_offers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    swap_request_id uuid NOT NULL REFERENCES public.shift_swaps(id),
    offerer_id uuid NOT NULL,
    offered_shift_id uuid REFERENCES public.shifts(id),
    status swap_offer_status NOT NULL DEFAULT 'SUBMITTED',
    compliance_snapshot jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rbac_actions (
    code text PRIMARY KEY,
    description text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rbac_permissions (
    access_level access_level,
    action_code text REFERENCES public.rbac_actions(code),
    scope text CHECK (scope IN ('SELF', 'SUB_DEPT', 'DEPT', 'ORG')),
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (access_level, action_code)
);

CREATE TABLE IF NOT EXISTS public.user_contracts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    organization_id uuid NOT NULL REFERENCES public.organizations(id),
    department_id uuid REFERENCES public.departments(id),
    sub_department_id uuid REFERENCES public.sub_departments(id),
    access_level access_level DEFAULT 'alpha',
    status text DEFAULT 'Active',
    created_at timestamptz DEFAULT now()
);

-- Placeholder for migration compatibility
CREATE TABLE IF NOT EXISTS public.roster_shift_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    roster_shift_id uuid REFERENCES public.roster_shifts(id),
    employee_id uuid,
    status text,
    assigned_at timestamptz,
    confirmed_at timestamptz,
    assigned_by uuid
);

-- DUMMY VIEWS
CREATE OR REPLACE VIEW public.v_shifts_grouped AS SELECT * FROM public.shifts;
CREATE OR REPLACE VIEW public.v_template_full AS SELECT id, organization_id, department_id, sub_department_id, description, '{}'::jsonb as groups FROM public.rosters;
CREATE OR REPLACE VIEW public.v_channels_with_stats AS SELECT id FROM public.organizations;
CREATE OR REPLACE VIEW public.v_unread_broadcasts_by_group AS SELECT id FROM public.organizations;
CREATE OR REPLACE VIEW public.v_broadcast_groups_with_stats AS SELECT id FROM public.organizations;
CREATE OR REPLACE VIEW public.v_performance_data_quality_alerts AS SELECT id FROM public.organizations;

-- 3. HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.user_contracts
        WHERE user_id = auth.uid()
          AND access_level = 'zeta'
          AND status = 'Active'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.has_permission(p_action_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.user_contracts uc
        JOIN public.rbac_permissions perm ON perm.access_level = uc.access_level
        WHERE uc.user_id = auth.uid()
          AND uc.status = 'Active'
          AND perm.action_code = p_action_code
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.user_has_action_in_scope(
    p_action_code text,
    p_organization_id uuid,
    p_department_id uuid DEFAULT NULL,
    p_sub_department_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.user_contracts uc
        JOIN public.rbac_permissions perm ON perm.access_level = uc.access_level
        WHERE uc.user_id = auth.uid()
          AND uc.status = 'Active'
          AND perm.action_code = p_action_code
          AND (
              (perm.scope = 'ORG' AND (p_organization_id IS NULL OR uc.organization_id = p_organization_id))
              OR
              (perm.scope = 'DEPT' AND (p_organization_id IS NULL OR uc.organization_id = p_organization_id) AND (p_department_id IS NULL OR uc.department_id = p_department_id))
              OR
              (perm.scope = 'SUB_DEPT' AND (p_organization_id IS NULL OR uc.organization_id = p_organization_id) AND (p_department_id IS NULL OR uc.department_id = p_department_id) AND (p_sub_department_id IS NULL OR uc.sub_department_id = p_sub_department_id))
              OR
              (perm.scope = 'SELF' AND (p_organization_id IS NULL OR uc.organization_id = p_organization_id) AND (p_department_id IS NULL OR uc.department_id = p_department_id) AND (p_sub_department_id IS NULL OR uc.sub_department_id = p_sub_department_id))
          )
    );
END;
$$;

-- Mock functions used in migrations
CREATE OR REPLACE FUNCTION public.validate_roster_shift_for_publish(p_id uuid) RETURNS public.shift_validation_result LANGUAGE plpgsql AS $$ BEGIN RETURN (true, NULL, NULL, NULL)::public.shift_validation_result; END; $$;
CREATE OR REPLACE FUNCTION public.get_roster_shift_state(a text, b boolean, c boolean) RETURNS text LANGUAGE plpgsql AS $$ BEGIN RETURN 'UNKNOWN'; END; $$;
CREATE OR REPLACE FUNCTION public.check_shift_compliance(a uuid, b uuid) RETURNS RECORD LANGUAGE plpgsql AS $$ DECLARE r RECORD; BEGIN SELECT true as compliant INTO r; RETURN r; END; $$;
CREATE OR REPLACE FUNCTION public.get_publish_target_state(a boolean, b boolean, c numeric) RETURNS RECORD LANGUAGE plpgsql AS $$ DECLARE r RECORD; BEGIN SELECT 'Draft' as state_id INTO r; RETURN r; END; $$;
CREATE OR REPLACE FUNCTION public.log_shift_event(a uuid, b text, c text, d text, e jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;

-- 4. GRANTS
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_action_in_scope(text, uuid, uuid, uuid) TO authenticated;
