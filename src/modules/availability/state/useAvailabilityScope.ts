/**
 * The JOB the availability page is showing, resolved from the global scope
 * filter's sub-department selection.
 *
 * CONTROLLED, not self-owning. The page uses the same Org → Department →
 * Sub-Department control every other page uses, with the sub-department level
 * forced to a single choice (`singleSelectLevels={['subdept']}`), because
 * availability is declared FOR a sub-department and "these three
 * sub-departments" is not a job anyone can declare for.
 *
 * This hook therefore does NOT own the selection or persist it. It used to do
 * both, with its own `localStorage` key, and that had to go the moment the
 * global filter arrived: two components persisting the same choice under
 * different keys is one of them silently winning on reload.
 *
 * WHAT IT STILL OWNS is the part the global filter cannot answer. The scope
 * tree is built from Type X certificates — what you may SEE — while declaring
 * availability is governed by CONTRACTS: `trg_availability_scope_is_contracted`
 * refuses a declaration for a sub-department you hold no active contract in.
 * The two disagree in production: three contract scopes have no matching
 * certificate. So the selection comes from the filter and is checked here, and
 * a selection with no contract behind it is reported rather than being allowed
 * to fail at the database with a raw trigger error.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    fetchAvailabilityScopes,
    type AvailabilityScope,
} from '../api/contract-basis.api';

export interface UseAvailabilityScopeResult {
    /** Every job this person holds a contract in, declarable ones first. */
    scopes: AvailabilityScope[];
    /**
     * The selected job, when the chosen sub-department is one they hold a
     * contract in. Null when nothing is selected yet, or when the selection is
     * outside their contracts — `isContracted` separates those two.
     */
    selected: AvailabilityScope | null;
    /**
     * False when a sub-department IS selected but no contract backs it. The
     * page shows this rather than an editor, because the write would be
     * refused by the database and the calendar would look broken instead of
     * explained.
     */
    isContracted: boolean;
    isLoading: boolean;
    isError: boolean;
}

export function useAvailabilityScope(
    userId: string | null | undefined,
    /** From the global scope filter. Null while it is still resolving. */
    selectedSubDepartmentId: string | null,
): UseAvailabilityScopeResult {
    const { data, isLoading } = useQuery({
        queryKey: ['availability', 'scopes', userId] as const,
        queryFn: () => fetchAvailabilityScopes(userId!),
        enabled: !!userId,
        // Contracts change on the order of months.
        staleTime: 5 * 60_000,
    });

    const scopes = useMemo(() => data?.scopes ?? [], [data]);

    const selected = useMemo(
        () =>
            selectedSubDepartmentId
                ? scopes.find((s) => s.subDepartmentId === selectedSubDepartmentId) ?? null
                : null,
        [scopes, selectedSubDepartmentId],
    );

    return {
        scopes,
        selected,
        // Nothing selected is not "not contracted" — it is "not chosen yet",
        // and conflating them would flash a "you have no contract here" card
        // at everyone on first paint.
        isContracted: !selectedSubDepartmentId || !!selected,
        isLoading,
        isError: data?.isError ?? false,
    };
}

export default useAvailabilityScope;
