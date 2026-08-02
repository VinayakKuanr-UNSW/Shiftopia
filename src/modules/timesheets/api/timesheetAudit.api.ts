import { supabase } from '@/platform/supabase/client';

/**
 * Timesheet lifecycle audit (provenance) reader.
 *
 * `timesheet_audit_log` is the append-only timeline populated by the DB trigger
 * `trg_timesheet_provenance` (migration 20260722100000_timesheet_auto_verify.sql).
 * It answers, for any timesheet: was it auto-approved by the bot, manually
 * approved (by whom), edited after approval, reopened, rejected, …
 */

const db = supabase as any;

export type TimesheetAuditEventType =
    | 'CREATED'
    | 'SUBMITTED'
    | 'AUTO_APPROVED'
    | 'BOT_REVIEW'
    | 'MANUALLY_APPROVED'
    | 'REJECTED'
    | 'EDITED'
    | 'REOPENED'
    | 'REVERTED'
    | 'NO_SHOW';

export type TimesheetAuditSource = 'bot' | 'manager' | 'employee' | 'system';

export interface TimesheetAuditEvent {
    id: string;
    eventType: TimesheetAuditEventType | string;
    source: TimesheetAuditSource | string;
    actorId: string | null;
    actorName: string | null;
    detail: Record<string, unknown>;
    createdAt: string;
}

interface AuditRow {
    id: string;
    event_type: string;
    source: string;
    actor: string | null;
    actor_label: string | null;
    detail: Record<string, unknown> | null;
    created_at: string;
}

/** True when the table or column simply isn't provisioned yet (feature not migrated). */
const isTableMissingError = (err: any): boolean =>
    !!err && (
        err.status === 400 ||
        err.status === 404 ||
        err.code === '42P01' ||
        err.code === '42703' ||
        (typeof err.code === 'string' && err.code.startsWith('PGRST')) ||
        (typeof err.message === 'string' && (
            err.message.includes('does not exist') ||
            err.message.includes('Could not find') ||
            err.message.includes('schema cache') ||
            err.message.includes('column')
        ))
    );

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string | null | undefined): id is string => !!id && UUID_REGEX.test(id);

/** Full provenance timeline for one shift's timesheet, newest first. */
export async function getTimesheetAuditTrail(shiftId: string): Promise<TimesheetAuditEvent[]> {
    if (!shiftId) return [];

    const events: TimesheetAuditEvent[] = [];

    // 1. Query timesheet_audit_log table if present
    try {
        const { data, error } = await db
            .from('timesheet_audit_log')
            .select('*')
            .eq('shift_id', shiftId)
            .order('created_at', { ascending: false });
        if (!error && data && data.length > 0) {
            const rows = data as AuditRow[];
            const actorIds = Array.from(new Set(rows.map(r => r.actor).filter(isUuid)));
            const names = new Map<string, string>();
            if (actorIds.length > 0) {
                const { data: profiles } = await db
                    .from('profiles')
                    .select('id, first_name, last_name')
                    .in('id', actorIds);
                for (const p of (profiles || []) as Array<{ id: string; first_name: string | null; last_name: string | null }>) {
                    names.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(' '));
                }
            }
            for (const r of rows) {
                events.push({
                    id: r.id,
                    eventType: r.event_type,
                    source: r.source,
                    actorId: r.actor,
                    actorName: r.actor_label || (r.actor ? names.get(r.actor) || null : null),
                    detail: r.detail || {},
                    createdAt: r.created_at,
                });
            }
        }
    } catch {
        // Table missing or optional
    }

    // 2. Query shift_events table if present
    try {
        const { data: shiftEvts } = await db
            .from('shift_events')
            .select('*')
            .eq('shift_id', shiftId)
            .order('event_time', { ascending: false });
        if (shiftEvts && shiftEvts.length > 0) {
            for (const se of shiftEvts) {
                events.push({
                    id: se.id || se.event_id || `se-${Math.random()}`,
                    eventType: se.event_type || 'EDITED',
                    source: se.actor_role === 'autoscheduler' ? 'bot' : (se.actor_role || 'system'),
                    actorId: se.actor_id,
                    actorName: se.actor_name || se.assignee_name || null,
                    detail: se.changes ? { ...se.changes, reason: se.reason } : (se.reason ? { reason: se.reason } : {}),
                    createdAt: se.event_time || se.created_at || new Date().toISOString(),
                });
            }
        }
    } catch {
        // RPC / table optional
    }

    // 3. Query shift + timesheets row to guarantee full clock-in, clock-out, manager adjustment, & status audit transparency
    try {
        const { data: shiftRow } = await db
            .from('shifts')
            .select(`
                *,
                assigned_profiles:assigned_employee_id (first_name, last_name),
                timesheets (*)
            `)
            .eq('id', shiftId)
            .maybeSingle();

        if (shiftRow) {
            const empName = shiftRow.assigned_profiles
                ? `${shiftRow.assigned_profiles.first_name || ''} ${shiftRow.assigned_profiles.last_name || ''}`.trim()
                : 'Employee';
            const ts = Array.isArray(shiftRow.timesheets) ? shiftRow.timesheets[0] : (shiftRow.timesheets || null);

            const actualStart = shiftRow.actual_start || shiftRow.actual_start_time;
            const actualEnd = shiftRow.actual_end || shiftRow.actual_end_time;
            const shiftDate = shiftRow.shift_date || (shiftRow.start_at ? shiftRow.start_at.slice(0, 10) : '');

            // Synthesize Clock In event if employee clocked in
            if (actualStart) {
                const ciIso = (shiftRow.start_at ? shiftRow.start_at.slice(0, 10) : shiftDate) + 'T' + (actualStart.includes('T') ? actualStart.split('T')[1] : actualStart + ':00Z');
                events.push({
                    id: `synth-ci-${shiftId}`,
                    eventType: 'CLOCK_IN',
                    source: 'employee',
                    actorId: shiftRow.assigned_employee_id || null,
                    actorName: empName,
                    detail: {
                        clock_in: actualStart,
                        arrival_variance_reason: shiftRow.arrival_variance_reason || ts?.arrival_variance_reason || null,
                    },
                    createdAt: isNaN(new Date(ciIso).getTime()) ? (shiftRow.start_at || shiftRow.created_at || new Date().toISOString()) : ciIso,
                });
            }

            // Synthesize Clock Out event if employee clocked out
            if (actualEnd) {
                const coIso = (shiftRow.end_at ? shiftRow.end_at.slice(0, 10) : shiftDate) + 'T' + (actualEnd.includes('T') ? actualEnd.split('T')[1] : actualEnd + ':00Z');
                events.push({
                    id: `synth-co-${shiftId}`,
                    eventType: 'CLOCK_OUT',
                    source: 'employee',
                    actorId: shiftRow.assigned_employee_id || null,
                    actorName: empName,
                    detail: {
                        clock_out: actualEnd,
                        departure_variance_reason: shiftRow.departure_variance_reason || ts?.departure_variance_reason || null,
                    },
                    createdAt: isNaN(new Date(coIso).getTime()) ? (shiftRow.end_at || shiftRow.updated_at || new Date().toISOString()) : coIso,
                });
            }

            // Synthesize Manager Adjustment event if manager changed timings or added notes
            const tsStart = ts?.start_time || shiftRow.timesheet_start_time;
            const tsEnd = ts?.end_time || shiftRow.timesheet_end_time;
            const notes = ts?.notes || shiftRow.timesheet_notes || shiftRow.notes;

            if (tsStart || tsEnd || notes) {
                events.push({
                    id: `synth-edit-${shiftId}`,
                    eventType: 'EDITED',
                    source: 'manager',
                    actorId: null,
                    actorName: 'Manager',
                    detail: {
                        before: { start_time: actualStart || shiftRow.start_time, end_time: actualEnd || shiftRow.end_time },
                        after: { start_time: tsStart || actualStart || shiftRow.start_time, end_time: tsEnd || actualEnd || shiftRow.end_time },
                        notes: notes,
                        arrival_variance_reason: shiftRow.arrival_variance_reason || ts?.arrival_variance_reason,
                        departure_variance_reason: shiftRow.departure_variance_reason || ts?.departure_variance_reason,
                    },
                    createdAt: shiftRow.updated_at || new Date().toISOString(),
                });
            }

            // Synthesize Timesheet Status event (Auto-Verified, Approved, Submitted, Rejected)
            const status = (ts?.status || shiftRow.timesheet_status || '').toLowerCase();
            if (status && status !== 'draft') {
                let evtType = 'EDITED';
                let src = 'manager';
                let actor = 'Manager';

                if (status === 'auto_approved' || status === 'auto_verified') {
                    evtType = 'AUTO_APPROVED';
                    src = 'bot';
                    actor = 'AutoPilot';
                } else if (status === 'approved' || status === 'verified') {
                    evtType = 'MANUALLY_APPROVED';
                    src = 'manager';
                    actor = 'Manager';
                } else if (status === 'submitted') {
                    evtType = 'SUBMITTED';
                    src = 'employee';
                    actor = empName;
                } else if (status === 'rejected') {
                    evtType = 'REJECTED';
                    src = 'manager';
                    actor = 'Manager';
                }

                events.push({
                    id: `synth-status-${shiftId}`,
                    eventType: evtType,
                    source: src,
                    actorId: null,
                    actorName: actor,
                    detail: {
                        status: status,
                        reason: ts?.rejected_reason || shiftRow.timesheet_rejected_reason || notes,
                    },
                    createdAt: shiftRow.updated_at || new Date().toISOString(),
                });
            }

            // Synthesize Shift Creation event
            if (shiftRow.created_at) {
                events.push({
                    id: `synth-create-${shiftId}`,
                    eventType: 'CREATED',
                    source: 'system',
                    actorId: null,
                    actorName: 'System',
                    detail: {
                        scheduled_start: shiftRow.start_time,
                        scheduled_end: shiftRow.end_time,
                    },
                    createdAt: shiftRow.created_at,
                });
            }
        }
    } catch {
        // Query error fallback
    }

    // Deduplicate events by unique key
    const seen = new Set<string>();
    const uniqueEvents: TimesheetAuditEvent[] = [];

    for (const evt of events) {
        const key = `${evt.eventType}-${evt.createdAt}-${JSON.stringify(evt.detail)}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueEvents.push(evt);
        }
    }

    // Sort newest first
    uniqueEvents.sort((a, b) => {
        const tA = new Date(a.createdAt).getTime();
        const tB = new Date(b.createdAt).getTime();
        return (isNaN(tB) ? 0 : tB) - (isNaN(tA) ? 0 : tA);
    });

    return uniqueEvents;
}
