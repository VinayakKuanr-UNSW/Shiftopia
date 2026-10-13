/**
 * TOIL — React Query hooks. Every key sits under `toilKeys.all`, which the
 * leave module's `invalidateAfterLeaveWrite` also invalidates: approving or
 * revoking TOIL leave writes to the ledger through a trigger.
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getToilLedger, getToilLots, getToilPositions } from '../api/toil.api';

export const toilKeys = {
    all: ['toil'] as const,
    positions: (ids: readonly string[]) => [...toilKeys.all, 'positions', [...ids].sort()] as const,
    ledger: (employeeId: string) => [...toilKeys.all, 'ledger', employeeId] as const,
    lots: (employeeId: string) => [...toilKeys.all, 'lots', employeeId] as const,
};

export function invalidateToil(qc: QueryClient): void {
    void qc.invalidateQueries({ queryKey: toilKeys.all });
}

export function useToilInvalidation() {
    const qc = useQueryClient();
    return () => invalidateToil(qc);
}

/** Positions for these people (those the caller may not see are left out). */
export function useToilPositions(employeeIds: readonly string[], enabled = true) {
    return useQuery({
        queryKey: toilKeys.positions(employeeIds),
        enabled: enabled && employeeIds.length > 0,
        queryFn: () => getToilPositions(employeeIds),
    });
}

export function useToilLedger(employeeId: string | null | undefined, enabled = true) {
    return useQuery({
        queryKey: toilKeys.ledger(employeeId ?? ''),
        enabled: enabled && Boolean(employeeId),
        queryFn: () => getToilLedger(employeeId!),
    });
}

export function useToilLots(employeeId: string | null | undefined, enabled = true) {
    return useQuery({
        queryKey: toilKeys.lots(employeeId ?? ''),
        enabled: enabled && Boolean(employeeId),
        queryFn: () => getToilLots(employeeId!),
    });
}
