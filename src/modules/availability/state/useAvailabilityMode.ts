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
import { fetchContractBasis } from '../api/contract-basis.api';
import type { AvailabilityMode } from '@/modules/rosters/domain/availability-check';

export function useAvailabilityMode(
    employeeId: string | null | undefined,
    enabled = true,
): { mode: AvailabilityMode; isLoading: boolean } {
    const { data, isLoading } = useQuery({
        queryKey: ['contract-basis', 'availability-mode', employeeId] as const,
        queryFn: () => fetchContractBasis(employeeId!),
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
