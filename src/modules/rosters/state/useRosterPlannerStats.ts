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
    /** @deprecated Alias of {@link scheduledCost}. Prefer the explicit field. */
    estimatedCost: number;
    /** Pro-rated department budget for the window; 0 when none overlaps. */
    budget: number;

    /** The roster AS PLANNED — every live shift in view, filled or not. */
    scheduledCost: number;
    /** What was actually worked — only shifts with a real worked window. */
    actualCost: number;
    /** Scheduled minutes behind {@link scheduledCost}. */
    scheduledNetMinutes: number;
    /** Worked minutes behind {@link actualCost}. */
    actualNetMinutes: number;
    /** Live shifts that resolved a rate — the denominator for scheduledCost. */
    costedShifts: number;
    /** Live shifts with NO resolvable rate; they contribute $0 and deflate the total. */
    uncostedShifts: number;
    /** Live shifts that have actually been worked — the denominator for actualCost. */
    actualShifts: number;
}

const ZERO_STATS: RosterPlannerStats = {
    totalShifts: 0,
    assignedShifts: 0,
    openShifts: 0,
    estimatedCost: 0,
    budget: 0,
    scheduledCost: 0,
    actualCost: 0,
    scheduledNetMinutes: 0,
    actualNetMinutes: 0,
    costedShifts: 0,
    uncostedShifts: 0,
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
            estimatedCost: data.scheduled_cost,
            budget: data.budget_cost,
            scheduledCost: data.scheduled_cost,
            actualCost: data.actual_cost,
            scheduledNetMinutes: data.total_net_minutes,
            actualNetMinutes: data.actual_net_minutes,
            costedShifts: data.costed_shifts,
            uncostedShifts: data.uncosted_shifts,
            actualShifts: data.actual_shifts,
        };
    }, [data]);

    return { stats, isLoading };
}
