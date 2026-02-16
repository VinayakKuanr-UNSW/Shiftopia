import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/platform/realtime/client';
import type { AuditEvent, AuditFilters, PaginationState, ShiftSnapshot, ShiftAuditGroup } from '../types/audit-types';

interface UseAuditDataReturn {
    events: AuditEvent[];
    groupedShifts: ShiftAuditGroup[];
    loading: boolean;
    error: Error | null;
    totalCount: number;
    refetch: () => void;
}

export function useAuditData(filters: AuditFilters, pagination: PaginationState): UseAuditDataReturn {
    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [totalCount, setTotalCount] = useState(0);

    useEffect(() => {
        fetchAuditEvents();
    }, [filters, pagination.page, pagination.pageSize]);

    const fetchAuditEvents = async () => {
        setLoading(true);
        setError(null);

        try {
            // Calculate offset for pagination
            const offset = pagination.page * pagination.pageSize;

            // Query audit logs - no FK join since shift_audit_events is now independent
            let query = supabase
                .from('shift_audit_events')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false })
                .range(offset, offset + pagination.pageSize - 1);

            // Apply date filter
            if (filters.dateRange?.start) {
                query = query.gte('created_at', filters.dateRange.start.toISOString());
            }
            if (filters.dateRange?.end) {
                query = query.lte('created_at', filters.dateRange.end.toISOString());
            }

            // Apply event type filter
            if (filters.eventType) {
                query = query.eq('event_type', filters.eventType);
            }

            // Apply search filter
            if (filters.searchQuery) {
                query = query.or(`shift_id.ilike.%${filters.searchQuery}%,performed_by_name.ilike.%${filters.searchQuery}%`);
            }

            const { data, error: queryError, count } = await query;

            if (queryError) {
                console.error('Audit query error:', queryError);
                throw queryError;
            }

            // Set total count for pagination
            setTotalCount(count || 0);

            // Map database fields to our interface
            // Extract shift data from new_data/old_data JSONB if available
            const formattedEvents: AuditEvent[] = (data || []).map((log: any) => {
                const shiftData = log.new_data || log.old_data || {};
                return {
                    id: log.id,
                    shift_id: log.shift_id,
                    event_type: log.event_type,
                    performed_by: log.performed_by_id || 'system',
                    performed_by_name: log.performed_by_name || 'System',
                    performed_at: log.created_at,
                    changes: log.field_changed ? [{
                        field: log.field_changed,
                        before: log.old_value,
                        after: log.new_value
                    }] : [],
                    notes: log.metadata?.notes,
                    role_name: shiftData.role_name || log.metadata?.role_name,
                    shift_date: shiftData.shift_date,
                    start_time: shiftData.start_time,
                };
            });

            setEvents(formattedEvents);

        } catch (err) {
            console.error('Error fetching audit events:', err);
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    };

    // Group events by shift_id for consolidated view
    const groupedShifts = useMemo<ShiftAuditGroup[]>(() => {
        const groups = new Map<string, AuditEvent[]>();

        events.forEach(event => {
            const existing = groups.get(event.shift_id) || [];
            existing.push(event);
            groups.set(event.shift_id, existing);
        });

        return Array.from(groups.entries()).map(([shift_id, shiftEvents]) => {
            // Sort events by time (oldest first for timeline)
            const sortedEvents = [...shiftEvents].sort(
                (a, b) => new Date(a.performed_at).getTime() - new Date(b.performed_at).getTime()
            );

            const firstEvent = sortedEvents[0];
            const lastEvent = sortedEvents[sortedEvents.length - 1];

            return {
                shift_id,
                shift_date: firstEvent?.shift_date,
                start_time: firstEvent?.start_time,
                role_name: firstEvent?.role_name,
                events: sortedEvents,
                event_count: sortedEvents.length,
                first_event_at: firstEvent?.performed_at,
                last_event_at: lastEvent?.performed_at,
                latest_actor_name: lastEvent?.performed_by_name || 'Unknown',
            };
        }).sort((a, b) =>
            // Sort by last activity (most recent first)
            new Date(b.last_event_at).getTime() - new Date(a.last_event_at).getTime()
        );
    }, [events]);

    return { events, groupedShifts, loading, error, totalCount, refetch: fetchAuditEvents };
}

export function useShiftAudit(shiftId: string) {
    const [timeline, setTimeline] = useState<ShiftSnapshot[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (shiftId) {
            fetchShiftTimeline();
        }
    }, [shiftId]);

    const fetchShiftTimeline = async () => {
        setLoading(true);
        setError(null);

        try {
            const { data, error: queryError } = await supabase
                .from('shift_audit_events')
                .select('*')
                .eq('shift_id', shiftId)
                .order('created_at', { ascending: true });

            if (queryError) throw queryError;

            const snapshots: ShiftSnapshot[] = (data || []).map((log: any, index: number) => ({
                id: log.id,
                version: index + 1,
                performed_at: log.created_at,
                event_type: log.event_type,
                performed_by_role: log.performed_by_role,
                batch_id: log.batch_id,
                data: log.new_data || log.old_data,
                performed_by_name: log.performed_by_name,
                changes: log.field_changed ? [{
                    field: log.field_changed,
                    oldValue: log.old_value,
                    newValue: log.new_value
                }] : undefined,
            }));

            setTimeline(snapshots);
        } catch (err) {
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    };

    return { timeline, loading, error, refetch: fetchShiftTimeline };
}
