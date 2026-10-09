import { useQuery } from '@tanstack/react-query';
import { shiftKeys, ShiftFilters } from '../api/queryKeys';
import { rosterSummaryQueries } from '../api/rosterSummary.queries';
import { useMemo } from 'react';

/**
 * Shared shape consumed by the Roster Planner stats footer. Counts and hours
 * only: labour cost and budget are shown in Gross Pay alone.
 */
export interface RosterPlannerStats {
    totalShifts: number;
    assignedShifts: number;
    openShifts: number;
    /** Net minutes of every live shift in view, filled or not. */
    scheduledNetMinutes: number;
    /** Worked minutes — only shifts with a real worked window. */
    actualNetMinutes: number;
    /** Live shifts that have actually been worked. */
    actualShifts: number;
}

const ZERO_STATS: RosterPlannerStats = {
    totalShifts: 0,
    assignedShifts: 0,
    openShifts: 0,
    scheduledNetMinutes: 0,
    actualNetMinutes: 0,
    actualShifts: 0,
};

/**
 * useRosterPlannerStats
 *
 * Fetches server-side aggregate totals (single row) for the Roster Planner
 * stats footer so every view (bucket / day / week / month) renders the same,
 * correct numbers.
 *
 * @param orgId The organization ID
 * @param startDate The start date of the view
 * @param endDate The end date of the view
 * @param filters Department/SubDepartment filters
 * @param enabled Whether to actually fire the query
 */
export function useRosterPlannerStats(
    orgId: string | null | undefined,
    startDate: string | null | undefined,
    endDate: string | null | undefined,
    filters?: ShiftFilters | null,
    enabled?: boolean
) {
    const queryKey = shiftKeys.plannerStats(orgId!, startDate!, endDate!, filters);

    const { data, isLoading } = useQuery({
        queryKey,
        queryFn: async () => {
            if (!orgId || !startDate || !endDate) return null;
            return rosterSummaryQueries.getRosterPlannerStats(orgId, startDate, endDate, filters);
        },
        enabled: (enabled ?? true) && !!orgId && !!startDate && !!endDate,
        staleTime: 30_000, // Matches shift list stale time
    });

    const stats = useMemo<RosterPlannerStats>(() => {
        if (!data) return ZERO_STATS;
        return {
            totalShifts: data.total_shifts,
            assignedShifts: data.assigned_shifts,
            openShifts: data.open_shifts,
            scheduledNetMinutes: data.total_net_minutes,
            actualNetMinutes: data.actual_net_minutes,
            actualShifts: data.actual_shifts,
        };
    }, [data]);

    return { stats, isLoading };
}
