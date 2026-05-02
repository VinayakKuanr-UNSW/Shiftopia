-- ==========================================
-- ALIGN SCHEMA WITH FRONTEND EXPECTATIONS
-- ==========================================

-- 1. TYPES
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
        CREATE TYPE notification_type AS ENUM (
            'bid_accepted', 'bid_rejected', 'broadcast', 'general', 
            'shift_assigned', 'shift_cancelled', 'shift_updated', 
            'swap_approved', 'swap_rejected', 'swap_request', 
            'timesheet_approved', 'timesheet_rejected'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_status') THEN
        CREATE TYPE template_status AS ENUM ('archived', 'draft', 'published');
    END IF;
END $$;

-- 2. NEW TABLES
CREATE TABLE IF NOT EXISTS public.roster_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name character varying NOT NULL,
    description text,
    status template_status DEFAULT 'draft',
    organization_id uuid REFERENCES public.organizations(id),
    department_id uuid REFERENCES public.departments(id),
    sub_department_id uuid REFERENCES public.sub_departments(id),
    published_month character varying,
    published_at timestamptz,
    published_by uuid,
    start_date date,
    end_date date,
    created_by uuid,
    last_edited_by uuid,
    version integer DEFAULT 1,
    is_base_template boolean DEFAULT false,
    last_used_at timestamptz,
    is_active boolean DEFAULT true,
    created_from text,
    applied_count integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roster_template_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id uuid REFERENCES public.roster_templates(id),
    start_date date,
    end_date date,
    source text,
    applied_by uuid,
    applied_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.synthesis_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid REFERENCES public.organizations(id),
    department_id uuid REFERENCES public.departments(id),
    sub_department_id uuid REFERENCES public.sub_departments(id),
    roster_id uuid REFERENCES public.rosters(id),
    shift_date date,
    created_by uuid,
    created_at timestamptz DEFAULT now(),
    attempted_count integer DEFAULT 0,
    created_count integer DEFAULT 0,
    options jsonb,
    rolled_back_at timestamptz,
    rolled_back_by uuid,
    rolled_back_count integer DEFAULT 0,
    deleted_count integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid REFERENCES public.profiles(id),
    user_id uuid, -- Sometimes used interchangeably with profile_id
    type notification_type NOT NULL DEFAULT 'general',
    title text,
    message text,
    entity_type text,
    entity_id uuid,
    link text,
    dedup_key text,
    read_at timestamptz,
    dismissed_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- 3. TABLE ENHANCEMENTS
-- Organizations
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS branding jsonb,
ADD COLUMN IF NOT EXISTS logo_url text,
ADD COLUMN IF NOT EXISTS venue_lat numeric,
ADD COLUMN IF NOT EXISTS venue_lon numeric,
ADD COLUMN IF NOT EXISTS address text,
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS email text,
ADD COLUMN IF NOT EXISTS website text,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS avatar_url text,
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS status text DEFAULT 'Active',
ADD COLUMN IF NOT EXISTS full_name text,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Shifts
ALTER TABLE public.shifts
ADD COLUMN IF NOT EXISTS break_minutes integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC',
ADD COLUMN IF NOT EXISTS total_hours numeric,
ADD COLUMN IF NOT EXISTS start_at timestamptz,
ADD COLUMN IF NOT EXISTS end_at timestamptz,
ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz,
ADD COLUMN IF NOT EXISTS user_contract_id uuid REFERENCES public.user_contracts(id),
ADD COLUMN IF NOT EXISTS roster_template_id uuid REFERENCES public.roster_templates(id),
ADD COLUMN IF NOT EXISTS template_batch_id uuid REFERENCES public.roster_template_batches(id),
ADD COLUMN IF NOT EXISTS roster_subgroup_id uuid REFERENCES public.roster_subgroups(id);

-- Ensure shifts -> profiles relationship exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'shifts_assigned_employee_id_fkey'
    ) THEN
        ALTER TABLE public.shifts 
        ADD CONSTRAINT shifts_assigned_employee_id_fkey 
        FOREIGN KEY (assigned_employee_id) REFERENCES public.profiles(id);
    END IF;
END $$;

-- 4. SWAP RELATIONSHIPS
-- Ensure shift_swaps -> profiles relationships
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'shift_swaps_requester_id_fkey') THEN
        ALTER TABLE public.shift_swaps ADD CONSTRAINT shift_swaps_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.profiles(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'shift_swaps_target_id_fkey') THEN
        ALTER TABLE public.shift_swaps ADD CONSTRAINT shift_swaps_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.profiles(id);
    END IF;
END $$;

-- Ensure swap_offers -> profiles relationships
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'swap_offers_offerer_id_fkey') THEN
        ALTER TABLE public.swap_offers ADD CONSTRAINT swap_offers_offerer_id_fkey FOREIGN KEY (offerer_id) REFERENCES public.profiles(id);
    END IF;
END $$;
