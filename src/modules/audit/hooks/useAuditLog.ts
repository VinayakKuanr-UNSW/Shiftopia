import { useQuery } from '@tanstack/react-query';
import { auditApi } from '../api/audit.api';
import { AuditFilters } from '../types/audit.types';

/** Full chronological timeline for one shift */
export function useShiftTimeline(shiftId: string | undefined) {
    return useQuery({
        queryKey: ['audit', 'shift-timeline', shiftId],
        queryFn:  () => auditApi.getShiftTimeline(shiftId!),
        enabled:  !!shiftId,
        staleTime: 30_000,
    });
}

/** Recent activity dashboard feed */
export function useRecentAuditActivity(filters: AuditFilters = {}) {
    return useQuery({
        queryKey: ['audit', 'recent', filters],
        queryFn:  () => auditApi.getRecentActivity(filters),
        staleTime: 15_000,
        refetchInterval: 60_000, // auto-refresh every minute
    });
}

/** All events for a specific actor */
export function useActorHistory(
    actorId: string | undefined,
    fromDate?: string,
    toDate?: string,
) {
    return useQuery({
        queryKey: ['audit', 'actor', actorId, fromDate, toDate],
        queryFn:  () => auditApi.getActorHistory(actorId!, fromDate, toDate),
        enabled:  !!actorId,
        staleTime: 30_000,
    });
}

/** Action counts for summary cards */
export function useAuditActionCounts(fromDate: string, toDate: string) {
    return useQuery({
        queryKey: ['audit', 'counts', fromDate, toDate],
        queryFn:  () => auditApi.getActionCounts(fromDate, toDate),
        staleTime: 60_000,
    });
}
