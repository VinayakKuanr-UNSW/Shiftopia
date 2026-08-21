/**
 * Which JOB the availability page is currently showing.
 *
 * WHY THIS IS NOT `useScopeFilter('personal')`. That hook reads and writes
 * `ScopeFilterContext.personalScope` — a SINGLE selection shared by My Roster,
 * My Bids, My Swaps, My Broadcasts and Attendance, and persisted to
 * `localStorage['superman_scope_filters']`. Narrowing it here to one
 * sub-department would silently collapse the scope on all five of those pages,
 * and it would survive a reload. The availability scope is a property of THIS
 * page, so it lives here.
 *
 * It also could not use that hook's OPTIONS even if the state were local:
 * `buildPersonalScopeTree` derives them from Type X certificates, and in
 * production three (user, department, sub-department) contract scopes have no
 * matching certificate while two people hold none at all — including one who is
 * Casual in TWO sub-departments and would be offered exactly one of his two
 * jobs. Certificates govern what you may SEE. Contracts govern what you may
 * DECLARE. This reads contracts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    fetchAvailabilityScopes,
    type AvailabilityScope,
} from '../api/contract-basis.api';

/** Deliberately NOT `superman_scope_filters` — see the note above. */
const STORAGE_KEY = 'superman_availability_scope';

function readStored(userId: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return (JSON.parse(raw) as Record<string, string>)[userId] ?? null;
    } catch {
        // A corrupt entry must not take the page down — it only costs the user
        // their remembered tab.
        return null;
    }
}

function writeStored(userId: string, subDepartmentId: string | null): void {
    if (typeof window === 'undefined') return;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const all = raw ? (JSON.parse(raw) as Record<string, string | null>) : {};
        all[userId] = subDepartmentId;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
        /* storage full or blocked — the selection just will not be remembered */
    }
}

export interface UseAvailabilityScopeResult {
    /** Every job this person may hold a declaration for, declarable ones first. */
    scopes: AvailabilityScope[];
    /** The one being shown. Null only while loading or when there are no jobs. */
    selected: AvailabilityScope | null;
    select: (subDepartmentId: string | null) => void;
    isLoading: boolean;
    isError: boolean;
    /**
     * True when there is exactly one job. The page renders a static label
     * rather than a picker — a dropdown with one option reads as broken.
     */
    isSingleScope: boolean;
}

export function useAvailabilityScope(
    userId: string | null | undefined,
): UseAvailabilityScopeResult {
    const { data, isLoading } = useQuery({
        queryKey: ['availability', 'scopes', userId] as const,
        queryFn: () => fetchAvailabilityScopes(userId!),
        enabled: !!userId,
        // Contracts change on the order of months.
        staleTime: 5 * 60_000,
    });

    const scopes = useMemo(() => data?.scopes ?? [], [data]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [restored, setRestored] = useState(false);

    // Restore the remembered job once the list arrives, and only once — after
    // that the user's clicks own the selection.
    useEffect(() => {
        if (restored || !userId || scopes.length === 0) return;

        const stored = readStored(userId);
        const storedStillHeld = stored
            ? scopes.some((s) => s.subDepartmentId === stored)
            : false;

        // A remembered job the person no longer holds must not be selected —
        // their contract ended, and showing that calendar would invite a
        // declaration the database now refuses.
        setSelectedId(
            storedStillHeld
                ? stored
                // Otherwise the first DECLARABLE job. `fetchAvailabilityScopes`
                // sorts those first, so a multi-contract employee never lands
                // on their Full-Time job — the one scope where there is nothing
                // for them to do.
                : scopes[0]?.subDepartmentId ?? null,
        );
        setRestored(true);
    }, [userId, scopes, restored]);

    const select = useCallback((subDepartmentId: string | null) => {
        setSelectedId(subDepartmentId);
        if (userId) writeStored(userId, subDepartmentId);
    }, [userId]);

    const selected = useMemo(
        () => scopes.find((s) => s.subDepartmentId === selectedId) ?? null,
        [scopes, selectedId],
    );

    return {
        scopes,
        selected,
        select,
        isLoading,
        isError: data?.isError ?? false,
        isSingleScope: scopes.length === 1,
    };
}

export default useAvailabilityScope;
