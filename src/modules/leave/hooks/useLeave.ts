/**
 * Leave — data hooks for the one-page Leave screen.
 *
 * REACT QUERY, NOT HAND-ROLLED STATE. The page used to hold every list in
 * `useState` and re-run one `loadData()` after each action, which refetched
 * everything and could not tell any other screen that something had changed.
 * An approval deletes and unassigns shifts, so its invalidation reaches the
 * roster, the Office grid and the shift queries too (`invalidateAfterLeaveWrite`).
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
    getLeaveBalances, getLeaveRequests, getLeaveShiftConflicts,
    getAllTimeLeaveRequests, getScopedEmployeeIds, getServiceStartDate, getTeamLeaveContext, getTeamLeaveRequests, isFullTimeSecurityEmployee,
} from '../api/leave.api';
import { shiftKeys, rosterKeys } from '@/modules/rosters/api/queryKeys';

export const leaveKeys = {
    all: ['leave'] as const,
    mine: (employeeId: string) => [...leaveKeys.all, 'mine', employeeId] as const,
    team: (since: string) => [...leaveKeys.all, 'team', since] as const,
    context: (ids: readonly string[]) => [...leaveKeys.all, 'context', [...ids].sort()] as const,
    scoped: (scope: { org_ids: readonly string[]; dept_ids: readonly string[]; subdept_ids: readonly string[] }) =>
        [...leaveKeys.all, 'scoped', [...scope.org_ids].sort(), [...scope.dept_ids].sort(), [...scope.subdept_ids].sort()] as const,
    tenure: (ids: readonly string[]) => [...leaveKeys.all, 'tenure', [...ids].sort()] as const,
    conflicts: (employeeId: string, start: string, end: string) =>
        [...leaveKeys.all, 'conflicts', employeeId, start, end] as const,
};

/** Everything a leave write can have changed. */
export function invalidateAfterLeaveWrite(qc: QueryClient): void {
    void qc.invalidateQueries({ queryKey: leaveKeys.all });
    void qc.invalidateQueries({ queryKey: shiftKeys.all });
    void qc.invalidateQueries({ queryKey: rosterKeys.all });
    void qc.invalidateQueries({ queryKey: ['office'] });
}

export function useLeaveInvalidation() {
    const qc = useQueryClient();
    return () => invalidateAfterLeaveWrite(qc);
}

/** My balances, my requests, and whether I accrue at the Schedule 3 rate. */
export function useMyLeave(employeeId: string | undefined) {
    return useQuery({
        queryKey: leaveKeys.mine(employeeId ?? ''),
        enabled: Boolean(employeeId),
        queryFn: async () => {
            const [balances, requests, isFtSecurity, serviceStart] = await Promise.all([
                getLeaveBalances(employeeId!),
                getLeaveRequests(employeeId!),
                isFullTimeSecurityEmployee(employeeId!),
                getServiceStartDate(employeeId!),
            ]);
            return { balances, requests, isFtSecurity, serviceStart };
        },
    });
}

/**
 * The team's leave — every status — still running on or after `since`.
 *
 * One read feeds the queue, the upcoming list, the history and the calendar,
 * so the four can never disagree about a request. Bounded by `since` (90 days
 * back) so History does not grow without limit.
 */
export function useTeamLeave(since: string, enabled: boolean) {
    return useQuery({
        queryKey: leaveKeys.team(since),
        enabled,
        queryFn: () => getTeamLeaveRequests({
            status: ['pending', 'approved', 'rejected', 'cancelled'],
            endAfter: since,
        }),
    });
}

/** Names, balances and units for the people in the team list. */
export function useTeamContext(employeeIds: readonly string[], enabled: boolean) {
    return useQuery({
        queryKey: leaveKeys.context(employeeIds),
        enabled: enabled && employeeIds.length > 0,
        queryFn: () => getTeamLeaveContext(employeeIds),
    });
}

/** Shifts assigned to someone inside a date range — what leave there would hit. */
export function useLeaveConflicts(employeeId: string | null, start: string, end: string) {
    return useQuery({
        queryKey: leaveKeys.conflicts(employeeId ?? '', start, end),
        enabled: Boolean(employeeId && start && end && start <= end),
        queryFn: () => getLeaveShiftConflicts(employeeId!, start, end),
    });
}

/** Everyone with an active contract in the header scope — the Grid's rows. */
export function useScopedEmployees(
    scope: { org_ids: readonly string[]; dept_ids: readonly string[]; subdept_ids: readonly string[] },
    enabled: boolean,
) {
    return useQuery({
        queryKey: leaveKeys.scoped(scope),
        enabled,
        queryFn: () => getScopedEmployeeIds(scope),
    });
}

/**
 * All-time requests for the leave types whose cap spans the whole of
 * employment (gender affirmation, cl 58.2) — see `getAllTimeLeaveRequests`.
 */
export function useTenureLeave(employeeIds: readonly string[], enabled: boolean) {
    return useQuery({
        queryKey: leaveKeys.tenure(employeeIds),
        enabled: enabled && employeeIds.length > 0,
        // Both count over the whole of employment: cl 58.2's cap, and long
        // service taken against what has accrued since service began.
        queryFn: () => getAllTimeLeaveRequests(employeeIds, ['gender_affirmation', 'long_service']),
    });
}

