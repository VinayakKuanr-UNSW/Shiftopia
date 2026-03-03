export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export type Database = {
    // Allows to automatically instantiate createClient with right options
    // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
    __InternalSupabase: {
        PostgrestVersion: "14.1"
    }
    public: {
        Tables: {
            attendance_records: {
                Row: {
                    actual_end: string | null
                    actual_start: string | null
                    created_at: string | null
                    employee_id: string
                    id: string
                    minutes_late: number | null
                    notes: string | null
                    scheduled_end: string
                    scheduled_start: string
                    shift_id: string
                    status: string
                }
                Insert: {
                    actual_end?: string | null
                    actual_start?: string | null
                    created_at?: string | null
                    employee_id: string
                    id?: string
                    minutes_late?: number | null
                    notes?: string | null
                    scheduled_end: string
                    scheduled_start: string
                    shift_id: string
                    status?: string
                }
                Update: {
                    actual_end?: string | null
                    actual_start?: string | null
                    created_at?: string | null
                    employee_id?: string
                    id?: string
                    minutes_late?: number | null
                    notes?: string | null
                    scheduled_end?: string
                    scheduled_start?: string
                    shift_id?: string
                    status?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "attendance_records_shift_id_fkey"
                        columns: ["shift_id"]
                        isOneToOne: false
                        referencedRelation: "shifts"
                        referencedColumns: ["id"]
                    },
                ]
            }
            audit_logs: {
                Row: {
                    action: string
                    actor_email: string | null
                    actor_id: string | null
                    created_at: string | null
                    details: Json | null
                    entity_id: string
                    entity_type: string
                    id: string
                }
                Insert: {
                    action: string
                    actor_email?: string | null
                    actor_id?: string | null
                    created_at?: string | null
                    details?: Json | null
                    entity_id: string
                    entity_type: string
                    id?: string
                }
                Update: {
                    action?: string
                    actor_email?: string | null
                    actor_id?: string | null
                    created_at?: string | null
                    details?: Json | null
                    entity_id?: string
                    entity_type?: string
                    id?: string
                }
                Relationships: []
            }
            audit_logs_old: {
                Row: {
                    action: string
                    actor_email: string | null
                    actor_id: string | null
                    created_at: string | null
                    details: Json | null
                    entity_id: string
                    entity_type: string
                    id: string
                }
                Insert: {
                    action: string
                    actor_email?: string | null
                    actor_id?: string | null
                    created_at?: string | null
                    details?: Json | null
                    entity_id: string
                    entity_type: string
                    id?: string
                }
                Update: {
                    action?: string
                    actor_email?: string | null
                    actor_id?: string | null
                    created_at?: string | null
                    details?: Json | null
                    entity_id?: string
                    entity_type?: string
                    id?: string
                }
                Relationships: []
            }
            departments: {
                Row: {
                    created_at: string | null
                    id: string
                    name: string
                    organization_id: string
                }
                Insert: {
                    created_at?: string | null
                    id?: string
                    name: string
                    organization_id: string
                }
                Update: {
                    created_at?: string | null
                    id?: string
                    name?: string
                    organization_id?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "departments_organization_id_fkey"
                        columns: ["organization_id"]
                        isOneToOne: false
                        referencedRelation: "organizations"
                        referencedColumns: ["id"]
                    },
                ]
            }
            employee_assignments: {
                Row: {
                    assigned_at: string | null
                    created_at: string | null
                    employee_id: string
                    end_date: string | null
                    id: string
                    role: string
                    start_date: string
                }
                Insert: {
                    assigned_at?: string | null
                    created_at?: string | null
                    employee_id: string
                    end_date?: string | null
                    id?: string
                    role: string
                    start_date: string
                }
                Update: {
                    assigned_at?: string | null
                    created_at?: string | null
                    employee_id?: string
                    end_date?: string | null
                    id?: string
                    role?: string
                    start_date?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "employee_assignments_employee_id_fkey"
                        columns: ["employee_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                ]
            }
            employee_availability: {
                Row: {
                    created_at: string | null
                    created_by: string | null
                    day_of_week: number
                    employee_id: string
                    end_time: string
                    id: string
                    is_available: boolean | null
                    start_time: string
                    status: string | null
                    updated_at: string | null
                }
                Insert: {
                    created_at?: string | null
                    created_by?: string | null
                    day_of_week: number
                    employee_id: string
                    end_time: string
                    id?: string
                    is_available?: boolean | null
                    start_time: string
                    status?: string | null
                    updated_at?: string | null
                }
                Update: {
                    created_at?: string | null
                    created_by?: string | null
                    day_of_week?: number
                    employee_id?: string
                    end_time?: string
                    id?: string
                    is_available?: boolean | null
                    start_time?: string
                    status?: string | null
                    updated_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "employee_availability_employee_id_fkey"
                        columns: ["employee_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                ]
            }
            employee_contracts: {
                Row: {
                    access_level: string
                    created_at: string | null
                    department_id: string | null
                    employee_id: string
                    id: string
                    organization_id: string
                    role: string
                    start_date: string | null
                    sub_department_id: string | null
                    termination_date: string | null
                    updated_at: string | null
                }
                Insert: {
                    access_level?: string
                    created_at?: string | null
                    department_id?: string | null
                    employee_id: string
                    id?: string
                    organization_id: string
                    role?: string
                    start_date?: string | null
                    sub_department_id?: string | null
                    termination_date?: string | null
                    updated_at?: string | null
                }
                Update: {
                    access_level?: string
                    created_at?: string | null
                    department_id?: string | null
                    employee_id?: string
                    id?: string
                    organization_id?: string
                    role?: string
                    start_date?: string | null
                    sub_department_id?: string | null
                    termination_date?: string | null
                    updated_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "employee_contracts_department_id_fkey"
                        columns: ["department_id"]
                        isOneToOne: false
                        referencedRelation: "departments"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "employee_contracts_employee_id_fkey"
                        columns: ["employee_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "employee_contracts_organization_id_fkey"
                        columns: ["organization_id"]
                        isOneToOne: false
                        referencedRelation: "organizations"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "employee_contracts_sub_department_id_fkey"
                        columns: ["sub_department_id"]
                        isOneToOne: false
                        referencedRelation: "sub_departments"
                        referencedColumns: ["id"]
                    },
                ]
            }
            employee_leave_balances: {
                Row: {
                    annual_leave_balance_hours: number | null
                    created_at: string | null
                    employee_id: string
                    id: string
                    last_updated_at: string | null
                    sick_leave_balance_hours: number | null
                    updated_at: string | null
                }
                Insert: {
                    annual_leave_balance_hours?: number | null
                    created_at?: string | null
                    employee_id: string
                    id?: string
                    last_updated_at?: string | null
                    sick_leave_balance_hours?: number | null
                    updated_at?: string | null
                }
                Update: {
                    annual_leave_balance_hours?: number | null
                    created_at?: string | null
                    employee_id?: string
                    id?: string
                    last_updated_at?: string | null
                    sick_leave_balance_hours?: number | null
                    updated_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "employee_leave_balances_employee_id_fkey"
                        columns: ["employee_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                ]
            }
            employee_licenses: {
                Row: {
                    created_at: string | null
                    employee_id: string
                    expiry_date: string | null
                    id: string
                    license_number: string | null
                    license_type: string
                    status: string | null
                    updated_at: string | null
                    verification_status: string | null
                }
                Insert: {
                    created_at?: string | null
                    employee_id: string
                    expiry_date?: string | null
                    id?: string
                    license_number?: string | null
                    license_type: string
                    status?: string | null
                    updated_at?: string | null
                    verification_status?: string | null
                }
                Update: {
                    created_at?: string | null
                    employee_id?: string
                    expiry_date?: string | null
                    id?: string
                    license_number?: string | null
                    license_type?: string
                    status?: string | null
                    updated_at?: string | null
                    verification_status?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "employee_licenses_employee_id_fkey"
                        columns: ["employee_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                ]
            }
            employee_performance_metrics: {
                Row: {
                    efficiency_rating: number | null
                    employee_id: string
                    feedback_score: number | null
                    id: string
                    last_review_date: string | null
                    punctuality_score: number | null
                    reliability_score: number | null
                    updated_at: string | null
                }
                Insert: {
                    efficiency_rating?: number | null
                    employee_id: string
                    feedback_score?: number | null
                    id?: string
                    last_review_date?: string | null
                    punctuality_score?: number | null
                    reliability_score?: number | null
                    updated_at?: string | null
                }
                Update: {
                    efficiency_rating?: number | null
                    employee_id?: string
                    feedback_score?: number | null
                    id?: string
                    last_review_date?: string | null
                    punctuality_score?: number | null
                    reliability_score?: number | null
                    updated_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "employee_performance_metrics_employee_id_fkey"
                        columns: ["employee_id"]
                        isOneToOne: true
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                ]
            }
            employee_skills: {
                Row: {
                    created_at: string | null
                    employee_id: string
                    endorsements: number | null
                    id: string
                    proficiency_level: string | null
                    skill_name: string
                    verified_at: string | null
                }
                Insert: {
                    created_at?: string | null
                    employee_id: string
                    endorsements?: number | null
                    id?: string
                    proficiency_level?: string | null
                    skill_name: string
                    verified_at?: string | null
                }
                Update: {
                    created_at?: string | null
                    employee_id?: string
                    endorsements?: number | null
                    id?: string
                    proficiency_level?: string | null
                    skill_name?: string
                    verified_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "employee_skills_employee_id_fkey"
                        columns: ["employee_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                ]
            }
            employees: {
                Row: {
                    avatar_url: string | null
                    contact_number: string | null
                    created_at: string | null
                    department: string | null
                    email: string
                    first_name: string
                    hourly_rate: number | null
                    id: string
                    is_active: boolean | null
                    last_name: string
                    role: string | null
                    skills: string[] | null
                    updated_at: string | null
                }
                Insert: {
                    avatar_url?: string | null
                    contact_number?: string | null
                    created_at?: string | null
                    department?: string | null
                    email: string
                    first_name: string
                    hourly_rate?: number | null
                    id?: string
                    is_active?: boolean | null
                    last_name: string
                    role?: string | null
                    skills?: string[] | null
                    updated_at?: string | null
                }
                Update: {
                    avatar_url?: string | null
                    contact_number?: string | null
                    created_at?: string | null
                    department?: string | null
                    email?: string
                    first_name?: string
                    hourly_rate?: number | null
                    id?: string
                    is_active?: boolean | null
                    last_name?: string
                    role?: string | null
                    skills?: string[] | null
                    updated_at?: string | null
                }
                Relationships: []
            }
            leave_requests: {
                Row: {
                    approval_date: string | null
                    approved_by: string | null
                    created_at: string | null
                    employee_id: string
                    end_date: string
                    id: string
                    leave_type: string
                    reason: string | null
                    start_date: string
                    status: string | null
                    updated_at: string | null
                }
                Insert: {
                    approval_date?: string | null
                    approved_by?: string | null
                    created_at?: string | null
                    employee_id: string
                    end_date: string
                    id?: string
                    leave_type: string
                    reason?: string | null
                    start_date: string
                    status?: string | null
                    updated_at?: string | null
                }
                Update: {
                    approval_date?: string | null
                    approved_by?: string | null
                    created_at?: string | null
                    employee_id?: string
                    end_date?: string
                    id?: string
                    leave_type?: string
                    reason?: string | null
                    start_date?: string
                    status?: string | null
                    updated_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "leave_requests_approved_by_fkey"
                        columns: ["approved_by"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "leave_requests_employee_id_fkey"
                        columns: ["employee_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                ]
            }
            organizations: {
                Row: {
                    address: string | null
                    created_at: string | null
                    id: string
                    logo_url: string | null
                    name: string
                    subdomain: string
                    subscription_plan: string | null
                    updated_at: string | null
                }
                Insert: {
                    address?: string | null
                    created_at?: string | null
                    id?: string
                    logo_url?: string | null
                    name: string
                    subdomain: string
                    subscription_plan?: string | null
                    updated_at?: string | null
                }
                Update: {
                    address?: string | null
                    created_at?: string | null
                    id?: string
                    logo_url?: string | null
                    name?: string
                    subdomain?: string
                    subscription_plan?: string | null
                    updated_at?: string | null
                }
                Relationships: []
            }
            profiles: {
                Row: {
                    avatar_url: string | null
                    bio: string | null
                    created_at: string | null
                    email: string | null
                    first_name: string | null
                    full_name: string | null
                    id: string
                    last_name: string | null
                    phone: string | null
                    preferred_name: string | null
                    role: Database["public"]["Enums"]["app_role"]
                    updated_at: string | null
                }
                Insert: {
                    avatar_url?: string | null
                    bio?: string | null
                    created_at?: string | null
                    email?: string | null
                    first_name?: string | null
                    full_name?: string | null
                    id: string
                    last_name?: string | null
                    phone?: string | null
                    preferred_name?: string | null
                    role?: Database["public"]["Enums"]["app_role"]
                    updated_at?: string | null
                }
                Update: {
                    avatar_url?: string | null
                    bio?: string | null
                    created_at?: string | null
                    email?: string | null
                    first_name?: string | null
                    full_name?: string | null
                    id?: string
                    last_name?: string | null
                    phone?: string | null
                    preferred_name?: string | null
                    role?: Database["public"]["Enums"]["app_role"]
                    updated_at?: string | null
                }
                Relationships: []
            }
            remuneration_levels: {
                Row: {
                    award_code: string | null
                    base_rate: number
                    casual_loading: number | null
                    created_at: string | null
                    id: string
                    level_name: string
                    notes: string | null
                    penalty_rates: Json | null
                    updated_at: string | null
                }
                Insert: {
                    award_code?: string | null
                    base_rate: number
                    casual_loading?: number | null
                    created_at?: string | null
                    id?: string
                    level_name: string
                    notes?: string | null
                    penalty_rates?: Json | null
                    updated_at?: string | null
                }
                Update: {
                    award_code?: string | null
                    base_rate?: number
                    casual_loading?: number | null
                    created_at?: string | null
                    id?: string
                    level_name?: string
                    notes?: string | null
                    penalty_rates?: Json | null
                    updated_at?: string | null
                }
                Relationships: []
            }
            roster_shift_assignments: {
                Row: {
                    assigned_at: string | null
                    assigned_by: string | null
                    assignment_method: string | null
                    assignment_status: string
                    confirmation_status: string | null
                    confirmed_at: string | null
                    created_at: string | null
                    employee_id: string
                    id: string
                    is_primary: boolean | null
                    notifications_sent: Json | null
                    shift_id: string
                    updated_at: string | null
                }
                Insert: {
                    assigned_at?: string | null
                    assigned_by?: string | null
                    assignment_method?: string | null
                    assignment_status?: string
                    confirmation_status?: string | null
                    confirmed_at?: string | null
                    created_at?: string | null
                    employee_id: string
                    id?: string
                    is_primary?: boolean | null
                    notifications_sent?: Json | null
                    shift_id: string
                    updated_at?: string | null
                }
                Update: {
                    assigned_at?: string | null
                    assigned_by?: string | null
                    assignment_method?: string | null
                    assignment_status?: string
                    confirmation_status?: string | null
                    confirmed_at?: string | null
                    created_at?: string | null
                    employee_id?: string
                    id?: string
                    is_primary?: boolean | null
                    notifications_sent?: Json | null
                    shift_id?: string
                    updated_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "roster_shift_assignments_assigned_by_fkey"
                        columns: ["assigned_by"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "roster_shift_assignments_employee_id_fkey"
                        columns: ["employee_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "roster_shift_assignments_shift_id_fkey"
                        columns: ["shift_id"]
                        isOneToOne: false
                        referencedRelation: "shifts"
                        referencedColumns: ["id"]
                    },
                ]
            }
            roster_templates: {
                Row: {
                    created_at: string | null
                    created_by: string | null
                    description: string | null
                    group_type: Database["public"]["Enums"]["template_group_type"] | null
                    id: string
                    is_active: boolean | null
                    last_used_at: string | null
                    name: string
                    organization_id: string | null
                    status: Database["public"]["Enums"]["template_status"]
                    tags: string[] | null
                    updated_at: string | null
                }
                Insert: {
                    created_at?: string | null
                    created_by?: string | null
                    description?: string | null
                    group_type?:
                    | Database["public"]["Enums"]["template_group_type"]
                    | null
                    id?: string
                    is_active?: boolean | null
                    last_used_at?: string | null
                    name: string
                    organization_id?: string | null
                    status?: Database["public"]["Enums"]["template_status"]
                    tags?: string[] | null
                    updated_at?: string | null
                }
                Update: {
                    created_at?: string | null
                    created_by?: string | null
                    description?: string | null
                    group_type?:
                    | Database["public"]["Enums"]["template_group_type"]
                    | null
                    id?: string
                    is_active?: boolean | null
                    last_used_at?: string | null
                    name?: string
                    organization_id?: string | null
                    status?: Database["public"]["Enums"]["template_status"]
                    tags?: string[] | null
                    updated_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "roster_templates_created_by_fkey"
                        columns: ["created_by"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "roster_templates_organization_id_fkey"
                        columns: ["organization_id"]
                        isOneToOne: false
                        referencedRelation: "organizations"
                        referencedColumns: ["id"]
                    },
                ]
            }
            shift_bids: {
                Row: {
                    bid_amount: number | null
                    bid_status: string
                    comments: string | null
                    created_at: string | null
                    employee_id: string
                    evaluated_at: string | null
                    evaluated_by: string | null
                    id: string
                    processed_at: string | null
                    rejection_reason: string | null
                    shift_id: string
                    updated_at: string | null
                }
                Insert: {
                    bid_amount?: number | null
                    bid_status?: string
                    comments?: string | null
                    created_at?: string | null
                    employee_id: string
                    evaluated_at?: string | null
                    evaluated_by?: string | null
                    id?: string
                    processed_at?: string | null
                    rejection_reason?: string | null
                    shift_id: string
                    updated_at?: string | null
                }
                Update: {
                    bid_amount?: number | null
                    bid_status?: string
                    comments?: string | null
                    created_at?: string | null
                    employee_id?: string
                    evaluated_at?: string | null
                    evaluated_by?: string | null
                    id?: string
                    processed_at?: string | null
                    rejection_reason?: string | null
                    shift_id?: string
                    updated_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "shift_bids_employee_id_fkey"
                        columns: ["employee_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shift_bids_evaluated_by_fkey"
                        columns: ["evaluated_by"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shift_bids_shift_id_fkey"
                        columns: ["shift_id"]
                        isOneToOne: false
                        referencedRelation: "shifts"
                        referencedColumns: ["id"]
                    },
                ]
            }
            shifts: {
                Row: {
                    actual_end: string | null
                    actual_hourly_rate: number | null
                    actual_net_minutes: number | null
                    actual_start: string | null
                    assigned_at: string | null
                    assigned_employee_id: string | null
                    assignment_id: string | null
                    assignment_method_text: string | null
                    bidding_close_at: string | null
                    bidding_open_at: string | null
                    break_minutes: number | null
                    calculated_cost: number | null
                    cost_center_id: string | null
                    cost_code: string | null
                    created_at: string | null
                    created_by: string | null
                    date: string
                    department_id: string
                    description: string | null
                    employee_id: string | null
                    end_time: string
                    event_id: string | null
                    fulfillment_status: Database["public"]["Enums"]["shift_fulfillment_status"]
                    id: string
                    is_draft: boolean | null
                    is_on_bidding: boolean | null
                    is_open: boolean | null
                    is_published: boolean | null
                    is_urgent: boolean | null
                    leave_request_id: string | null
                    lifecycle_status: Database["public"]["Enums"]["shift_lifecycle_status"]
                    location_id: string | null
                    notes: string | null
                    organization_id: string | null
                    published_at: string | null
                    published_by_user_id: string | null
                    recurrence_rule: string | null
                    remuneration_level_id: string | null
                    required_certs: string[] | null
                    required_skills: string[] | null
                    role_required: string | null
                    shift_date: string
                    shift_type_id: string | null
                    start_time: string
                    status: Database["public"]["Enums"]["shift_status"]
                    sub_department_id: string | null
                    template_id: string | null
                    title: string | null
                    updated_at: string | null
                    version: number | null
                }
                Insert: {
                    actual_end?: string | null
                    actual_hourly_rate?: number | null
                    actual_net_minutes?: number | null
                    actual_start?: string | null
                    assigned_at?: string | null
                    assigned_employee_id?: string | null
                    assignment_id?: string | null
                    assignment_method_text?: string | null
                    bidding_close_at?: string | null
                    bidding_open_at?: string | null
                    break_minutes?: number | null
                    calculated_cost?: number | null
                    cost_center_id?: string | null
                    cost_code?: string | null
                    created_at?: string | null
                    created_by?: string | null
                    date?: string
                    department_id: string
                    description?: string | null
                    employee_id?: string | null
                    end_time: string
                    event_id?: string | null
                    fulfillment_status?: Database["public"]["Enums"]["shift_fulfillment_status"]
                    id?: string
                    is_draft?: boolean | null
                    is_on_bidding?: boolean | null
                    is_open?: boolean | null
                    is_published?: boolean | null
                    is_urgent?: boolean | null
                    leave_request_id?: string | null
                    lifecycle_status?: Database["public"]["Enums"]["shift_lifecycle_status"]
                    location_id?: string | null
                    notes?: string | null
                    organization_id?: string | null
                    published_at?: string | null
                    published_by_user_id?: string | null
                    recurrence_rule?: string | null
                    remuneration_level_id?: string | null
                    required_certs?: string[] | null
                    required_skills?: string[] | null
                    role_required?: string | null
                    shift_date: string
                    shift_type_id?: string | null
                    start_time: string
                    status?: Database["public"]["Enums"]["shift_status"]
                    sub_department_id?: string | null
                    template_id?: string | null
                    title?: string | null
                    updated_at?: string | null
                    version?: number | null
                }
                Update: {
                    actual_end?: string | null
                    actual_hourly_rate?: number | null
                    actual_net_minutes?: number | null
                    actual_start?: string | null
                    assigned_at?: string | null
                    assigned_employee_id?: string | null
                    assignment_id?: string | null
                    assignment_method_text?: string | null
                    bidding_close_at?: string | null
                    bidding_open_at?: string | null
                    break_minutes?: number | null
                    calculated_cost?: number | null
                    cost_center_id?: string | null
                    cost_code?: string | null
                    created_at?: string | null
                    created_by?: string | null
                    date?: string
                    department_id?: string
                    description?: string | null
                    employee_id?: string | null
                    end_time?: string
                    event_id?: string | null
                    fulfillment_status?: Database["public"]["Enums"]["shift_fulfillment_status"]
                    id?: string
                    is_draft?: boolean | null
                    is_on_bidding?: boolean | null
                    is_open?: boolean | null
                    is_published?: boolean | null
                    is_urgent?: boolean | null
                    leave_request_id?: string | null
                    lifecycle_status?: Database["public"]["Enums"]["shift_lifecycle_status"]
                    location_id?: string | null
                    notes?: string | null
                    organization_id?: string | null
                    published_at?: string | null
                    published_by_user_id?: string | null
                    recurrence_rule?: string | null
                    remuneration_level_id?: string | null
                    required_certs?: string[] | null
                    required_skills?: string[] | null
                    role_required?: string | null
                    shift_date?: string
                    shift_type_id?: string | null
                    start_time?: string
                    status?: Database["public"]["Enums"]["shift_status"]
                    sub_department_id?: string | null
                    template_id?: string | null
                    title?: string | null
                    updated_at?: string | null
                    version?: number | null
                }
                Relationships: [
                    {
                        foreignKeyName: "shifts_assigned_employee_id_fkey"
                        columns: ["assigned_employee_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shifts_cost_center_id_fkey"
                        columns: ["cost_center_id"]
                        isOneToOne: false
                        referencedRelation: "cost_centers"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shifts_created_by_fkey"
                        columns: ["created_by"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shifts_department_id_fkey"
                        columns: ["department_id"]
                        isOneToOne: false
                        referencedRelation: "departments"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shifts_employee_id_fkey"
                        columns: ["employee_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shifts_event_id_fkey"
                        columns: ["event_id"]
                        isOneToOne: false
                        referencedRelation: "events"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shifts_leave_request_id_fkey"
                        columns: ["leave_request_id"]
                        isOneToOne: false
                        referencedRelation: "leave_requests"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shifts_location_id_fkey"
                        columns: ["location_id"]
                        isOneToOne: false
                        referencedRelation: "locations"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shifts_organization_id_fkey"
                        columns: ["organization_id"]
                        isOneToOne: false
                        referencedRelation: "organizations"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shifts_published_by_user_id_fkey"
                        columns: ["published_by_user_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shifts_remuneration_level_id_fkey"
                        columns: ["remuneration_level_id"]
                        isOneToOne: false
                        referencedRelation: "remuneration_levels"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shifts_shift_type_id_fkey"
                        columns: ["shift_type_id"]
                        isOneToOne: false
                        referencedRelation: "shift_types"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shifts_sub_department_id_fkey"
                        columns: ["sub_department_id"]
                        isOneToOne: false
                        referencedRelation: "sub_departments"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "shifts_template_id_fkey"
                        columns: ["template_id"]
                        isOneToOne: false
                        referencedRelation: "roster_templates"
                        referencedColumns: ["id"]
                    },
                ]
            }
            sub_departments: {
                Row: {
                    created_at: string | null
                    department_id: string
                    id: string
                    name: string
                }
                Insert: {
                    created_at?: string | null
                    department_id: string
                    id?: string
                    name: string
                }
                Update: {
                    created_at?: string | null
                    department_id?: string
                    id?: string
                    name?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "sub_departments_department_id_fkey"
                        columns: ["department_id"]
                        isOneToOne: false
                        referencedRelation: "departments"
                        referencedColumns: ["id"]
                    },
                ]
            }
            swap_requests: {
                Row: {
                    approval_date: string | null
                    approved_by: string | null
                    created_at: string | null
                    id: string
                    reason: string | null
                    requester_id: string
                    shift_id: string
                    status: string | null
                    target_employee_id: string | null
                    updated_at: string | null
                }
                Insert: {
                    approval_date?: string | null
                    approved_by?: string | null
                    created_at?: string | null
                    id?: string
                    reason?: string | null
                    requester_id: string
                    shift_id: string
                    status?: string | null
                    target_employee_id?: string | null
                    updated_at?: string | null
                }
                Update: {
                    approval_date?: string | null
                    approved_by?: string | null
                    created_at?: string | null
                    id?: string
                    reason?: string | null
                    requester_id?: string
                    shift_id?: string
                    status?: string | null
                    target_employee_id?: string | null
                    updated_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "swap_requests_approved_by_fkey"
                        columns: ["approved_by"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "swap_requests_requester_id_fkey"
                        columns: ["requester_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "swap_requests_shift_id_fkey"
                        columns: ["shift_id"]
                        isOneToOne: false
                        referencedRelation: "shifts"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "swap_requests_target_employee_id_fkey"
                        columns: ["target_employee_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    },
                ]
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            add_roster_shift: {
                Args: {
                    p_organization_id: string
                    p_department_id: string
                    p_shift_date: string
                    p_start_time: string
                    p_end_time: string
                    p_break_minutes?: number
                    p_role_required?: string
                    p_employee_id?: string
                    p_notes?: string
                }
                Returns: string
            }
            apply_template_to_date_range: {
                Args: {
                    p_template_id: string
                    p_start_date: string
                    p_end_date: string
                }
                Returns: undefined
            }
            archive_old_audit_events: {
                Args: {
                    cutoff_date: string
                }
                Returns: undefined
            }
            assign_employee: {
                Args: {
                    p_shift_id: string
                    p_employee_id: string
                }
                Returns: undefined
            }
            assign_employee_to_shift: {
                Args: {
                    p_shift_id: string
                    p_employee_id: string
                }
                Returns: undefined
            }
            auth_can_manage_rosters: {
                Args: {
                    org_id: string
                }
                Returns: boolean
            }
            auth_get_org_id: {
                Args: Record<PropertyKey, never>
                Returns: string
            }
            auth_get_user_role: {
                Args: {
                    org_id: string
                }
                Returns: Database["public"]["Enums"]["app_role"]
            }
            auth_has_role: {
                Args: {
                    required_role: Database["public"]["Enums"]["app_role"]
                }
                Returns: boolean
            }
            auth_is_admin: {
                Args: Record<PropertyKey, never>
                Returns: boolean
            }
            cancel_shift: {
                Args: {
                    p_shift_id: string
                    p_reason: string
                    p_actor_id?: string
                }
                Returns: undefined
            }
            calculate_shift_cost: {
                Args: {
                    p_shift_id: string
                }
                Returns: undefined
            }
            check_template_version: {
                Args: {
                    p_template_id: string
                    p_expected_version: number
                }
                Returns: {
                    version_match: boolean
                    current_version: number | null
                    last_edited_by: string | null
                    last_edited_at: string | null
                }[]
            }
            cleanup_shift_duplicates: {
                Args: Record<PropertyKey, never>
                Returns: undefined
            }
            create_shift_from_request: {
                Args: {
                    p_request_id: string
                }
                Returns: string
            }
            delete_claim: {
                Args: {
                    uid: string
                    claim: string
                }
                Returns: string
            }
            delete_template_cascade: {
                Args: {
                    p_template_id: string
                }
                Returns: undefined
            }
            delete_template_shifts_cascade: {
                Args: {
                    p_template_id: string
                }
                Returns: number
            }
            echo_test: {
                Args: {
                    p_input: string
                }
                Returns: string
            }
            get_audit_events: {
                Args: {
                    p_start_date: string
                    p_end_date: string
                    p_entity_id?: string
                    p_limit?: number
                }
                Returns: {
                    id: string
                    created_at: string
                    action: string
                    level: Database["public"]["Enums"]["audit_level"]
                    details: Json
                    actor_email: string
                }[]
            }
            get_available_shifts: {
                Args: {
                    p_employee_id: string
                }
                Returns: {
                    shift_id: string
                    shift_date: string
                    start_time: string
                    end_time: string
                    role_required: string
                    department_name: string
                    org_name: string
                }[]
            }
            get_claims: {
                Args: {
                    uid: string
                }
                Returns: Json
            }
            get_compliance_status_details: {
                Args: {
                    p_shift_id: string
                }
                Returns: Json
            }
            get_employee_compliance_status: {
                Args: {
                    p_employee_id: string
                    p_date: string
                }
                Returns: Json
            }
            get_my_claims: {
                Args: Record<PropertyKey, never>
                Returns: Json
            }
            get_my_shifts: {
                Args: {
                    p_employee_id: string
                    p_start_date: string
                    p_end_date: string
                }
                Returns: {
                    shift_id: string
                    shift_date: string
                    start_time: string
                    end_time: string
                    role: string
                    department_name: string
                    status: string
                }[]
            }
            get_roster_summary: {
                Args: {
                    p_org_id: string
                    p_start_date: string
                    p_end_date: string
                }
                Returns: {
                    date: string
                    total_shifts: number
                    unassigned_shifts: number
                    total_cost: number
                }[]
            }
            get_shift_audit_history: {
                Args: {
                    p_shift_id: string
                }
                Returns: {
                    id: string
                    created_at: string
                    action: string
                    actor_email: string
                    details: Json
                }[]
            }
            get_shifts_by_date_range: {
                Args: {
                    p_start_date: string
                    p_end_date: string
                    p_org_id: string
                }
                Returns: {
                    shift_id: string
                    shift_date: string
                    start_time: string
                    end_time: string
                    role: string
                    employee_name: string
                    status: string
                }[]
            }
            get_user_role: {
                Args: {
                    user_id: string
                }
                Returns: string
            }
            is_admin: {
                Args: Record<PropertyKey, never>
                Returns: boolean
            }
            is_claims_admin: {
                Args: Record<PropertyKey, never>
                Returns: boolean
            }
            is_role: {
                Args: {
                    check_role: string
                }
                Returns: boolean
            }
            log_audit_event: {
                Args: {
                    p_entity_type: string
                    p_entity_id: string
                    p_action: string
                    p_details?: Json
                    p_actor_id?: string
                }
                Returns: undefined
            }
            process_shift_bids: {
                Args: {
                    p_shift_id: string
                }
                Returns: undefined
            }
            publish_shift: {
                Args: {
                    p_shift_id: string
                    p_actor_id?: string
                }
                Returns: Json
            }
            push_shift_to_bidding_on_cancel: {
                Args: {
                    p_shift_id: string
                    p_actor_id?: string
                }
                Returns: Json
            }
            set_claim: {
                Args: {
                    uid: string
                    claim: string
                    value: Json
                }
                Returns: string
            }
            submit_leave_request: {
                Args: {
                    p_employee_id: string
                    p_leave_type: string
                    p_start_date: string
                    p_end_date: string
                    p_reason?: string
                }
                Returns: string
            }
            submit_timesheet: {
                Args: {
                    p_shift_id: string
                    p_actual_start: string
                    p_actual_end: string
                    p_break_minutes?: number
                    p_notes?: string
                }
                Returns: string
            }
            test_rls: {
                Args: Record<PropertyKey, never>
                Returns: {
                    can_select: boolean
                    can_insert: boolean
                    can_update: boolean
                    can_delete: boolean
                }[]
            }
            update_shift_times: {
                Args: {
                    p_shift_id: string
                    p_start_time: string
                    p_end_time: string
                    p_actor_id?: string
                }
                Returns: undefined
            }
            validate_shift_update: {
                Args: {
                    p_shift_id: string
                    p_new_start: string
                    p_new_end: string
                }
                Returns: boolean
            }
            validate_template_name: {
                Args: {
                    p_organization_id: string
                    p_department_id: string
                    p_sub_department_id: string
                    p_name: string
                    p_exclude_id?: string
                }
                Returns: {
                    is_valid: boolean
                    error_message: string | null
                }[]
            }
        }
        Enums: {
            app_role: ["admin", "manager", "employee"]
            audit_action: [
                "SHIFT_CREATED",
                "SHIFT_UPDATED",
                "SHIFT_DELETED",
                "SHIFT_PUBLISHED",
                "SHIFT_ASSIGNED",
                "SHIFT_UNASSIGNED",
                "SHIFT_REASSIGNED",
                "SHIFT_COMPLIANCE_CHECKED",
                "SHIFT_COMPLIANCE_PASSED",
                "SHIFT_COMPLIANCE_WARNING",
                "SHIFT_COMPLIANCE_FAILED",
                "SHIFT_COMPLIANCE_OVERRIDE_APPLIED",
                "SHIFT_COMPLIANCE_OVERRIDE_REMOVED",
                "SHIFT_BIDDING_OPENED",
                "SHIFT_BIDDING_CLOSED",
                "SHIFT_BID_PLACED",
                "SHIFT_BID_WITHDRAWN",
                "SHIFT_BID_SELECTED",
                "SHIFT_BID_ACCEPTED",
                "SHIFT_BID_REJECTED",
                "SHIFT_TRADE_POSTED",
                "SHIFT_TRADE_OFFER_PLACED",
                "SHIFT_TRADE_APPROVED",
                "SHIFT_TRADE_REJECTED",
                "SHIFT_TRADE_CANCELLED",
                "SHIFT_CANCELLED",
                "SHIFT_CANCELLATION_REVERSED",
                "SHIFT_STARTED",
                "SHIFT_COMPLETED",
                "SHIFT_PUBLISHED",
                "SHIFT_LOCKED",
                "SHIFT_UNLOCKED",
                "SHIFT_VERSION_CONFLICT",
                "SHIFT_DATA_CORRECTED",
                "SHIFT_CANCELLED_STANDARD",
                "SHIFT_PUSHED_TO_BIDDING",
                "SHIFT_CANCELLED_LATE",
                "SHIFT_PUSHED_TO_BIDDING_URGENT",
                "SHIFT_CANCELLED_CRITICAL",
                "SHIFT_REQUIRES_MANAGER_REVIEW"
            ]
            audit_level: ["INFO", "WARNING", "ERROR", "CRITICAL"]
            audit_type: [
                "SHIFT_CREATED",
                "SHIFT_UPDATED",
                "SHIFT_DELETED",
                "SHIFT_ASSIGNED",
                "SHIFT_UNASSIGNED",
                "SHIFT_REASSIGNED",
                "SHIFT_COMPLIANCE_CHECKED",
                "SHIFT_COMPLIANCE_PASSED",
                "SHIFT_COMPLIANCE_WARNING",
                "SHIFT_COMPLIANCE_FAILED",
                "SHIFT_COMPLIANCE_OVERRIDE_APPLIED",
                "SHIFT_COMPLIANCE_OVERRIDE_REMOVED",
                "SHIFT_BIDDING_OPENED",
                "SHIFT_BIDDING_CLOSED",
                "SHIFT_BID_PLACED",
                "SHIFT_BID_WITHDRAWN",
                "SHIFT_BID_SELECTED",
                "SHIFT_BID_ACCEPTED",
                "SHIFT_BID_REJECTED",
                "SHIFT_TRADE_POSTED",
                "SHIFT_TRADE_OFFER_PLACED",
                "SHIFT_TRADE_APPROVED",
                "SHIFT_TRADE_REJECTED",
                "SHIFT_TRADE_CANCELLED",
                "SHIFT_CANCELLED",
                "SHIFT_CANCELLATION_REVERSED",
                "SHIFT_STARTED",
                "SHIFT_COMPLETED",
                "SHIFT_PUBLISHED",
                "SHIFT_LOCKED",
                "SHIFT_UNLOCKED",
                "SHIFT_VERSION_CONFLICT",
                "SHIFT_DATA_CORRECTED",
                "SHIFT_CANCELLED_STANDARD",
                "SHIFT_PUSHED_TO_BIDDING",
                "SHIFT_CANCELLED_LATE",
                "SHIFT_PUSHED_TO_BIDDING_URGENT",
                "SHIFT_CANCELLED_CRITICAL",
                "SHIFT_REQUIRES_MANAGER_REVIEW"
            ]
            shift_fulfillment_status: ["scheduled", "bidding", "offered", "none"]
            shift_lifecycle_status: ["draft", "published"]
            shift_status: ["open", "assigned", "confirmed", "completed", "cancelled"]
            swap_status: [
                "pending",
                "approved",
                "rejected",
                "cancelled",
                "completed"
            ]
            system_role: ["admin", "manager", "team_lead", "team_member"]
            template_group_type: ["convention_centre", "exhibition_centre", "theatre"]
            template_status: ["draft", "published", "archived"]
            timesheet_status: ["draft", "submitted", "approved", "rejected"]
        }
    }
}
