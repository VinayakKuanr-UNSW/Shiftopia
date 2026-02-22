/* ============================================================
   ENUMS & TYPES - Must match database
   ============================================================ */

export type ShiftStatus =
    | 'open'
    | 'assigned'
    | 'confirmed'
    | 'completed'
    | 'cancelled';

export type AttendanceStatus = 'scheduled' | 'checked_in' | 'checked_out' | 'absent' | 'late';

export type TemplateGroupType = 'convention_centre' | 'exhibition_centre' | 'theatre';

export type AssignmentStatusText =
    | 'unassigned'
    | 'assigned'
    | 'pending'
    | 'declined';
export type AssignmentMethodText =
    | 'manual'
    | 'template'
    | 'bid'
    | 'trade'
    | 'auto';
export type CancellationTypeText = 'standard' | 'late' | 'critical' | 'no_show';
export type BiddingPriorityText = 'normal' | 'urgent' | 'critical';
export type ComplianceStatusText =
    | 'compliant'
    | 'warning'
    | 'violation'
    | 'pending'
    | 'overridden';
export type LockReasonText = 'published' | 'timesheet' | 'admin' | 'payroll';

/* ============================================================
   INTERFACES
   ============================================================ */

export interface Shift {
    id: string;
    organization_id: string | null;
    department_id: string;
    sub_department_id: string | null;
    created_by_user_id: string | null;
    created_at: string;
    updated_at: string;
    version: number;
    roster_id: string;
    roster_date: string;
    shift_date: string;
    template_id: string | null;
    template_group: TemplateGroupType | null;
    template_sub_group: string | null;
    is_from_template: boolean;
    template_instance_id: string | null;
    group_type: TemplateGroupType | null;
    sub_group_name: string | null;
    display_order: number;
    shift_group_id: string | null;
    shift_subgroup_id: string | null;
    role_id: string | null;
    role_level: number | null;
    remuneration_level_id: string | null;
    remuneration_rate: number | null;
    actual_hourly_rate: number | null;
    currency: string;
    cost_center_id: string | null;
    start_time: string;
    end_time: string;
    scheduled_start: string | null;
    scheduled_end: string | null;
    is_overnight: boolean;
    scheduled_length_minutes: number | null;
    break_minutes: number;
    paid_break_minutes: number;
    unpaid_break_minutes: number;
    net_length_minutes: number | null;
    total_hours: number | null;
    timezone: string;

    // New UTC-at-Rest fields
    start_at?: string | null;
    end_at?: string | null;
    tz_identifier?: string | null;

    assigned_employee_id: string | null;
    assignment_id: string | null;

    assigned_at: string | null;

    lifecycle_status: 'Draft' | 'Published' | 'InProgress' | 'Completed' | 'Cancelled';
    assignment_status?: AssignmentStatusText; // Made optional as sometimes missing from simple queries
    assignment_outcome?: 'pending' | 'offered' | 'confirmed' | 'emergency_assigned';
    fulfillment_status: 'scheduled' | 'bidding' | 'offered' | 'none';
    is_draft: boolean;
    is_cancelled: boolean;
    cancelled_at: string | null;
    cancelled_by_user_id: string | null;
    cancellation_reason: string | null;

    offer_expires_at?: string | null; // Made optional as not in all views
    bidding_status: 'not_on_bidding' | 'on_bidding_normal' | 'on_bidding_urgent' | 'bidding_closed_no_winner';
    bidding_priority_text: string;

    trade_requested_at: string | null;
    is_trade_requested?: boolean;
    trading_status?: 'NoTrade' | 'TradeRequested' | 'TradeAccepted' | 'TradeApproved';

    // Attendance
    attendance_status?: AttendanceStatus;
    required_skills: string[];
    required_licenses: string[];
    eligibility_snapshot: Record<string, any> | null;
    event_ids: string[];
    tags: string[];

    compliance_snapshot: Record<string, any> | null;
    compliance_checked_at: string | null;
    compliance_override: boolean;
    compliance_override_reason: string | null;
    is_published: boolean;
    published_at: string | null;
    published_by_user_id: string | null;
    is_locked: boolean;
    lock_reason_text: string | null;
    timesheet_id: string | null;
    actual_start: string | null;
    actual_end: string | null;
    actual_net_minutes: number | null;
    payroll_exported: boolean;
    last_modified_by: string | null;
    last_modified_reason: string | null;
    deleted_at: string | null;
    deleted_by: string | null;
    notes: string | null;
    is_recurring: boolean;
    recurrence_rule: string | null;
    confirmed_at: string | null;
    organizations?: { id: string; name: string } | null;
    departments?: { id: string; name: string } | null;
    sub_departments?: { id: string; name: string } | null;
    roles?: { id: string; name: string } | null;
    remuneration_levels?: {
        id: string;
        level_number: number;
        level_name: string;
        hourly_rate_min: number;
        hourly_rate_max?: number;
    } | null;
    assigned_profiles?: {
        first_name: string;
        last_name: string;
    } | null;
    roster_subgroup?: {
        name: string;
        roster_group?: {
            name: string;
            external_id: string | null;
        } | null;
    } | null;
}

/* ============================================================
   HELPERS - FIXED UUID VALIDATION
   ============================================================ */

/**
 * Check if value is a valid UUID (accepts all standard UUID formats)
 * This regex accepts:
 * - Standard UUIDs (v1-v5)
 * - Nil UUIDs (00000000-0000-0000-0000-000000000000)
 * - Custom UUIDs with any hex characters
 */
export const isValidUuid = (value: string | null | undefined): boolean => {
    if (!value || typeof value !== 'string') return false;
    // More permissive UUID regex - accepts any 8-4-4-4-12 hex pattern
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value
    );
};

/** Safe UUID - returns null for invalid/mock UUIDs */
export const safeUuid = (value?: string | null): string | null => {
    if (!value || value.trim() === '') return null;
    if (!isValidUuid(value)) {
        console.warn(`Invalid UUID detected: "${value}", returning null`);
        return null;
    }
    return value;
};

/* ============================================================
   UTILITY FUNCTIONS
   ============================================================ */

export function calculateMinutesBetweenTimes(
    startTime: string,
    endTime: string
): number {
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    let startMinutes = startHour * 60 + startMin;
    let endMinutes = endHour * 60 + endMin;

    if (endMinutes <= startMinutes) {
        endMinutes += 24 * 60;
    }

    return endMinutes - startMinutes;
}
