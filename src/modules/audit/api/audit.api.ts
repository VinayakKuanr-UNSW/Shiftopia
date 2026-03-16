import { supabase } from '@/platform/realtime/client';
import {
    AuditLogEntry,
    AuditLogEntryWithActor,
    AuditFilters,
    AuditAction,
    AUDIT_ACTION_META,
    AuditCategory,
} from '../types/audit.types';

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Actions that belong to a given category (for server-side filtering) */
const actionsByCategory = (category: AuditCategory): AuditAction[] =>
    (Object.entries(AUDIT_ACTION_META) as [AuditAction, (typeof AUDIT_ACTION_META)[AuditAction]][])
        .filter(([, meta]) => meta.category === category)
        .map(([action]) => action);

// ── Public API ───────────────────────────────────────────────────────────────

export const auditApi = {
    /**
     * Full timeline for a single shift, oldest-first.
     * Includes joined actor profile for display.
     */
    async getShiftTimeline(shiftId: string): Promise<AuditLogEntryWithActor[]> {
        const { data, error } = await supabase
            .from('shift_audit_log')
            .select(`
                *,
                actor:actor_id (
                    full_name,
                    avatar_url,
                    email
                ),
                target:target_id (
                    full_name,
                    avatar_url
                )
            `)
            .eq('shift_id', shiftId)
            .order('occurred_at', { ascending: true });

        if (error) throw error;
        return (data ?? []) as AuditLogEntryWithActor[];
    },

    /**
     * Recent activity across all shifts — for the audit dashboard.
     * Returns entries newest-first, optionally filtered by actor/action/category/dates.
     */
    async getRecentActivity(filters: AuditFilters = {}): Promise<AuditLogEntryWithActor[]> {
        let query = supabase
            .from('shift_audit_log')
            .select(`
                *,
                actor:actor_id (
                    full_name,
                    avatar_url,
                    email
                ),
                target:target_id (
                    full_name,
                    avatar_url
                )
            `)
            .order('occurred_at', { ascending: false })
            .limit(filters.limit ?? 100);

        if (filters.shiftId)  query = query.eq('shift_id',  filters.shiftId);
        if (filters.actorId)  query = query.eq('actor_id',  filters.actorId);
        if (filters.action)   query = query.eq('action',    filters.action);
        if (filters.fromDate) query = query.gte('occurred_at', filters.fromDate);
        if (filters.toDate)   query = query.lte('occurred_at', filters.toDate + 'T23:59:59Z');

        if (filters.category) {
            const actions = actionsByCategory(filters.category);
            if (actions.length > 0) query = query.in('action', actions);
        }

        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []) as AuditLogEntryWithActor[];
    },

    /**
     * All audit entries for a specific actor (employee or manager).
     */
    async getActorHistory(
        actorId: string,
        fromDate?: string,
        toDate?: string,
    ): Promise<AuditLogEntry[]> {
        let query = supabase
            .from('shift_audit_log')
            .select('*')
            .eq('actor_id', actorId)
            .order('occurred_at', { ascending: false })
            .limit(200);

        if (fromDate) query = query.gte('occurred_at', fromDate);
        if (toDate)   query = query.lte('occurred_at', toDate + 'T23:59:59Z');

        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []) as AuditLogEntry[];
    },

    /**
     * Manual log — for events the DB triggers can't capture automatically
     * (e.g., check-in with GPS coordinates, compliance override reasons).
     */
    async logManualEvent(entry: {
        shiftId:    string;
        action:     AuditAction;
        fromState?: string;
        toState?:   string;
        targetId?:  string;
        reason?:    string;
        metadata?:  Record<string, unknown>;
    }): Promise<string> {
        const { data, error } = await supabase.rpc('insert_audit_log', {
            p_shift_id:   entry.shiftId,
            p_action:     entry.action,
            p_from_state: entry.fromState   ?? null,
            p_to_state:   entry.toState     ?? null,
            p_target_id:  entry.targetId    ?? null,
            p_reason:     entry.reason      ?? null,
            p_metadata:   entry.metadata    ?? {},
        });

        if (error) throw error;
        return data as string; // returns the inserted UUID
    },

    /**
     * Count of events by action for a given date range.
     * Useful for summary cards on the audit dashboard.
     */
    async getActionCounts(
        fromDate: string,
        toDate: string,
    ): Promise<Record<string, number>> {
        const { data, error } = await supabase
            .from('shift_audit_log')
            .select('action')
            .gte('occurred_at', fromDate)
            .lte('occurred_at', toDate + 'T23:59:59Z');

        if (error) throw error;
        return (data ?? []).reduce<Record<string, number>>((acc, row) => {
            const a = (row as AuditLogEntry).action;
            acc[a] = (acc[a] ?? 0) + 1;
            return acc;
        }, {});
    },
};
