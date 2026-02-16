export type AuditEventType =
    | 'draft_created'
    | 'published'
    | 'assigned'
    | 'unassigned'
    | 'trade_requested'
    | 'trade_approved'
    | 'trade_rejected'
    | 'override_applied'
    | 'cancelled'
    | 'completed'
    | 'pushed_to_bidding'
    | 'removed_from_bidding';

export type AuditFlag = 'warning' | 'compliance' | 'override' | 'locked';

export interface ChangeSet {
    field: string;
    before?: any;
    after?: any;
    // Aliases for compatibility
    oldValue?: any;
    newValue?: any;
}

export interface AuditEvent {
    id: string;
    shift_id: string;
    event_type: AuditEventType | string;
    performed_by: string;
    performed_by_name: string;
    performed_at: string;
    changes: ChangeSet[];
    notes?: string;
    flags?: AuditFlag[];
    // Joined data for display
    role_name?: string;
    shift_date?: string;
    start_time?: string;
}

export interface ShiftSnapshot {
    id: string;
    version: number;
    performed_at: string;
    performed_by_role?: string;
    batch_id?: string;
    event_type: AuditEventType;
    data: any;
    performed_by_name: string;
    changes?: ChangeSet[];
}

export interface ComplianceStatus {
    passed: boolean;
    rules: {
        name: string;
        passed: boolean;
        message?: string;
    }[];
}

export interface AuditFilters {
    dateRange?: {
        start: Date;
        end: Date;
    };
    eventType?: AuditEventType;
    actor?: string;
    searchQuery?: string;
    organizationId?: string;
    departmentId?: string;
    subDepartmentId?: string;
}

export interface PaginationState {
    page: number;
    pageSize: number;
    total: number;
}

// Consolidated view: one row per shift with all events grouped
export interface ShiftAuditGroup {
    shift_id: string;
    shift_date?: string;
    start_time?: string;
    end_time?: string;
    role_name?: string;
    department_name?: string;
    current_status?: string;
    current_employee?: string;
    events: AuditEvent[];
    event_count: number;
    first_event_at: string;
    last_event_at: string;
    latest_actor_name: string;
}
