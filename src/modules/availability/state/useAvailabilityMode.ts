/**
 * useAvailabilityMode — what an ABSENT availability declaration means for one
 * employee, for manual assignment surfaces that hold only an employee id.
 *
 * WHY A HOOK RATHER THAN A PROP. The two surfaces that need this (DndAssignModal,
 * useShiftAvailabilityWarning) are handed an `employeeId` and nothing else — no
 * contract, no employment status. Threading one down would mean touching every
 * caller of every caller, and each would then be free to derive the mode its own
 * way. This resolves it from the same `fetchContractBasis` reader the
 * availability page and the leave form use, so the warning a manager sees cannot
 * disagree with what the employee is told on their own page.
 *
 * FAILS TO THE STRICT READING. `fetchContractBasis` returns the empty basis on a
 * read error, whose `availabilityMode` is 'OPT_IN'. A transient failure therefore
 * over-warns (a visible, correctable false alarm) rather than silently
 * suppressing a real one.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchScopedContractBasis } from '../api/contract-basis.api';
import type { AvailabilityScopeRef } from '../domain/contract-basis';
import type { AvailabilityMode } from '@/modules/rosters/domain/availability-check';

/**
 * @param scope Which JOB to resolve the mode for. OMIT IT and the answer is
 *   person-wide — today's behaviour, unchanged — because
 *   `fetchScopedContractBasis` treats a null sub-department as "every
 *   contract", the same NULL semantics the database guards use. Pass the
 *   shift's sub-department once the caller has one (Phase 6): a person can be
 *   Full-Time in Security and Casual in Set-up, and only the scoped answer
 *   tells a manager which of those they are looking at.
 */
export function useAvailabilityMode(
    employeeId: string | null | undefined,
    enabled = true,
    scope?: AvailabilityScopeRef,
): { mode: AvailabilityMode; isLoading: boolean } {
    const subDepartmentId = scope?.subDepartmentId ?? null;
    const departmentId = scope?.departmentId ?? null;

    const { data, isLoading } = useQuery({
        // The scope is part of the KEY, not just the query. Without it, opening
        // the modal against Set-up after Security would serve Security's mode
        // from cache — and on a Capacitor WebView it would never self-correct,
        // because `refetchOnWindowFocus` hangs off `visibilitychange`, which
        // that WebView never fires.
        queryKey: [
            'contract-basis', 'availability-mode', employeeId, subDepartmentId, departmentId,
        ] as const,
        queryFn: () => fetchScopedContractBasis(employeeId!, { subDepartmentId, departmentId }),
        enabled: enabled && !!employeeId,
        // Contracts change on the order of months; the modal this feeds is
        // opened repeatedly against the same few people.
        staleTime: 5 * 60_000,
    });

    return {
        // While loading, `data` is undefined and the strict reading applies. The
        // caller gets `isLoading` so it can hold the banner back rather than
        // flash "no declared availability" at a full-timer for one frame.
        mode: data?.availabilityMode ?? 'OPT_IN',
        isLoading,
    };
}

export default useAvailabilityMode;
