export type AuditEventType =
    // Creation
    | 'shift_created_draft'
    | 'shift_created_published'
    // Status
    | 'published'
    | 'unpublished'
    | 'draft_status_changed'
    | 'cancelled'
    | 'uncancelled'
    | 'shift_soft_deleted'
    | 'completed'
    // Assignment
    | 'employee_assigned'
    | 'employee_unassigned'
    // Schedule
    | 'schedule_changed'
    | 'notes_updated'
    // Bidding
    | 'pushed_to_bidding'
    | 'removed_from_bidding'
    | 'bid_placed'
    | 'bid_won'
    | 'bid_rejected'
    | 'bid_withdrawn'
    | 'bid_status_changed'
    // Trading
    | 'trade_requested'
    | 'trade_offer_submitted'
    | 'trade_offer_selected'
    | 'trade_pending_manager'
    | 'trade_approved'
    | 'trade_rejected'
    | 'trade_cancelled'
    | 'trade_expired'
    | 'trade_offer_rejected'
    | 'trade_offer_withdrawn'
    | 'trade_offer_expired'
    | 'trade_status_changed'
    | 'trade_offer_status_changed'
    // Legacy / fallback
    | 'override_applied';

export type AuditFlag = 'warning' | 'compliance' | 'override' | 'locked';

/** Snapshot of context at the time of logging (role, department, names). */
export interface AuditSnapshot {
    role_name?: string;
    department_name?: string;
    sub_department_name?: string;
    shift_date?: string;
    start_time?: string;
    end_time?: string;
    bidder_name?: string;
    requester_name?: string;
    offerer_name?: string;
    decided_by?: string;
    decided_at?: string;
    approved_by?: string;
    approved_at?: string;
    [key: string]: any;
}

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
    event_category?: string;
    performed_by: string;
    performed_by_name: string;
    performed_by_role?: string;
    performed_at: string;
    changes: ChangeSet[];
    notes?: string;
    flags?: AuditFlag[];
    // Context snapshot (replaces old joined data)
    snapshot?: AuditSnapshot;
    related_entity_id?: string;
    related_entity_type?: string;
    // Derived display helpers (populated from snapshot)
    role_name?: string;
    department_name?: string;
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
    snapshot?: AuditSnapshot;
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
