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

/** True when the table simply isn't provisioned yet (feature not migrated). */
const isTableMissingError = (err: any): boolean =>
    !!err && (
        err.code === '42P01' ||
        err.status === 404 ||
        (typeof err.code === 'string' && err.code.startsWith('PGRST')) ||
        (typeof err.message === 'string' && (
            err.message.includes('does not exist') ||
            err.message.includes('Could not find') ||
            err.message.includes('schema cache')
        ))
    );

/** Full provenance timeline for one shift's timesheet, newest first. */
export async function getTimesheetAuditTrail(shiftId: string): Promise<TimesheetAuditEvent[]> {
    if (!shiftId) return [];
    try {
        const { data, error } = await db
            .from('timesheet_audit_log')
            .select('id, event_type, source, actor, actor_label, detail, created_at')
            .eq('shift_id', shiftId)
            .order('created_at', { ascending: false });
        if (error) {
            if (isTableMissingError(error)) return [];
            throw error;
        }
        const rows = (data || []) as AuditRow[];
        if (rows.length === 0) return [];

        // Resolve actor names (one batched lookup).
        const actorIds = Array.from(new Set(rows.map(r => r.actor).filter((id): id is string => !!id)));
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

        return rows.map(r => ({
            id: r.id,
            eventType: r.event_type,
            source: r.source,
            actorId: r.actor,
            actorName: r.actor_label || (r.actor ? names.get(r.actor) || null : null),
            detail: r.detail || {},
            createdAt: r.created_at,
        }));
    } catch (err) {
        if (isTableMissingError(err)) return [];
        throw err;
    }
}
