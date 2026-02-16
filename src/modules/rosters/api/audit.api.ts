/**
 * Shift Audit Trail API Service
 * 
 * Provides functions for fetching and managing shift audit events.
 */

import { supabase } from '@/platform/realtime/client';

export interface ShiftAuditEvent {
    id: string;
    shift_id: string;
    event_type: string;
    event_category: 'creation' | 'modification' | 'bidding' | 'status' | 'assignment' | 'attendance';
    performed_by_id: string | null;
    performed_by_name: string;
    performed_by_role: 'manager' | 'employee' | 'admin' | 'system_automation' | 'cron_job' | 'ai_scheduler';
    field_changed: string | null;
    old_value: string | null;
    new_value: string | null;
    old_data: Record<string, any> | null;
    new_data: Record<string, any> | null;
    batch_id: string | null;
    metadata: Record<string, any> | null;
    created_at: string;
}

export interface AuditFetchOptions {
    shiftId: string;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
    categoryFilter?: string;
}

export interface BatchGroup {
    batch_id: string;
    events: ShiftAuditEvent[];
    performed_by_name: string;
    created_at: string;
    shift_count: number;
}

/**
 * Fetch audit events for a specific shift
 */
export async function getShiftAuditEvents(options: AuditFetchOptions): Promise<ShiftAuditEvent[]> {
    const { shiftId, includeArchived = false, limit = 100, offset = 0, categoryFilter } = options;

    // Fetch from main table
    let query = supabase
        .from('shift_audit_events')
        .select('*')
        .eq('shift_id', shiftId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (categoryFilter && categoryFilter !== 'all') {
        query = query.eq('event_category', categoryFilter);
    }

    const { data: mainEvents, error: mainError } = await query;

    if (mainError) {
        console.error('[Audit] Error fetching main events:', mainError);
        throw mainError;
    }

    let allEvents = mainEvents || [];

    // If including archived, also fetch from archive table
    if (includeArchived) {
        let archiveQuery = supabase
            .from('shift_audit_events_archive')
            .select('*')
            .eq('shift_id', shiftId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (categoryFilter && categoryFilter !== 'all') {
            archiveQuery = archiveQuery.eq('event_category', categoryFilter);
        }

        const { data: archiveEvents, error: archiveError } = await archiveQuery;

        if (archiveError) {
            console.error('[Audit] Error fetching archive events:', archiveError);
            // Don't throw - just continue with main events
        } else if (archiveEvents) {
            // Merge and sort by date
            allEvents = [...allEvents, ...archiveEvents].sort(
                (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
        }
    }

    return allEvents as ShiftAuditEvent[];
}

/**
 * Get batch groups for bulk operations
 */
export function groupEventsByBatch(events: ShiftAuditEvent[]): (ShiftAuditEvent | BatchGroup)[] {
    const batchMap = new Map<string, ShiftAuditEvent[]>();
    const result: (ShiftAuditEvent | BatchGroup)[] = [];

    events.forEach(event => {
        if (event.batch_id) {
            if (!batchMap.has(event.batch_id)) {
                batchMap.set(event.batch_id, []);
            }
            batchMap.get(event.batch_id)!.push(event);
        } else {
            result.push(event);
        }
    });

    // Convert batch groups
    batchMap.forEach((batchEvents, batchId) => {
        if (batchEvents.length > 1) {
            result.push({
                batch_id: batchId,
                events: batchEvents,
                performed_by_name: batchEvents[0].performed_by_name,
                created_at: batchEvents[0].created_at,
                shift_count: batchEvents.length,
            });
        } else {
            result.push(batchEvents[0]);
        }
    });

    // Sort by date
    return result.sort((a, b) => {
        const dateA = 'created_at' in a ? a.created_at : (a as BatchGroup).created_at;
        const dateB = 'created_at' in b ? b.created_at : (b as BatchGroup).created_at;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
    });
}

/**
 * Set batch ID for bulk operations
 */
export async function setBatchId(batchId: string): Promise<void> {
    const { error } = await supabase.rpc('set_batch_id', { batch_id: batchId });
    if (error) {
        console.error('[Audit] Error setting batch ID:', error);
        throw error;
    }
}

/**
 * Format field name for display
 */
export function formatFieldName(field: string): string {
    const fieldLabels: Record<string, string> = {
        'start_time': 'Start Time',
        'end_time': 'End Time',
        'shift_date': 'Date',
        'department': 'Department',
        'role': 'Role',
        'assigned_employee': 'Assigned To',
        'notes': 'Notes',
        'is_draft': 'Draft Status',
        'is_published': 'Published',
        'is_on_bidding': 'Bidding Status',
    };

    return fieldLabels[field] || field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Format event type for display
 */
export function formatEventType(eventType: string): string {
    const eventLabels: Record<string, string> = {
        'shift_created_draft': 'Shift Created (Draft)',
        'shift_created_published': 'Shift Created',
        'field_updated': 'Field Updated',
        'manual_adjustment': 'Manual Adjustment',
        'published': 'Published',
        'unpublished': 'Unpublished',
        'pushed_to_bidding': 'Pushed to Bidding',
        'removed_from_bidding': 'Removed from Bidding',
        'bid_submitted': 'Bid Submitted',
        'bid_withdrawn': 'Bid Withdrawn',
        'bid_accepted': 'Bid Accepted',
        'bid_rejected': 'Bid Rejected',
        'employee_assigned': 'Employee Assigned',
        'employee_unassigned': 'Employee Unassigned',
        'status_changed': 'Status Changed',
        'checked_in': 'Checked In',
        'checked_out': 'Checked Out',
        'shift_completed': 'Shift Completed',
        'shift_deleted': 'Shift Deleted',
    };

    return eventLabels[eventType] || eventType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Get icon name for event category
 */
export function getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
        'creation': 'Plus',
        'modification': 'Edit',
        'bidding': 'Gavel',
        'status': 'RefreshCw',
        'assignment': 'User',
        'attendance': 'Clock',
    };

    return icons[category] || 'Activity';
}

/**
 * Get color for event category
 */
export function getCategoryColor(category: string): string {
    const colors: Record<string, string> = {
        'creation': 'emerald',
        'modification': 'blue',
        'bidding': 'purple',
        'status': 'amber',
        'assignment': 'cyan',
        'attendance': 'orange',
    };

    return colors[category] || 'gray';
}

/**
 * Check if actor is a system automation
 */
export function isSystemActor(role: string): boolean {
    return ['system_automation', 'cron_job', 'ai_scheduler'].includes(role);
}
