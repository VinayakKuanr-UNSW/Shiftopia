import { useQuery } from '@tanstack/react-query';
import { shiftKeys, ShiftFilters } from '../api/queryKeys';
import { rosterSummaryQueries } from '../api/rosterSummary.queries';
import { useMemo } from 'react';

/**
 * Shared shape consumed by the Roster Planner stats footer.
 * Another agent depends on this exact interface — do not deviate.
 */
export interface RosterPlannerStats {
    totalShifts: number;
    assignedShifts: number;
    openShifts: number;
    estimatedCost: number;
    /** Pro-rated department budget for the window; 0 when none overlaps. */
    budget: number;
}

const ZERO_STATS: RosterPlannerStats = {
    totalShifts: 0,
    assignedShifts: 0,
    openShifts: 0,
    estimatedCost: 0,
    budget: 0,
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
            estimatedCost: data.est_cost,
            budget: data.budget_cost,
        };
    }, [data]);

    return { stats, isLoading };
}
