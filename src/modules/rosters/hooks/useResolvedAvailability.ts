/**
 * useResolvedAvailability Hook
 *
 * Fetches and caches resolved availability for profiles in a date range.
 * Used by PeopleModeGrid to display availability bars.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmployeeAvailability } from '@/modules/rosters/domain/availabilityResolution.types';
import { getResolvedAvailabilities } from '@/modules/rosters/api/availability.api';

interface UseResolvedAvailabilityResult {
    /** Map of profileId -> date -> EmployeeAvailability */
    availabilityMap: Map<string, Map<string, EmployeeAvailability>>;
    /** Get availability for a specific profile and date */
    getAvailability: (profileId: string, date: string) => EmployeeAvailability | null;
    /** Loading state */
    isLoading: boolean;
    /** Error state */
    error: Error | null;
    /** Refetch data */
    refetch: () => void;
}

/**
 * Hook to fetch and manage resolved availability for multiple profiles
 */
/**
 * @param subDepartmentId Which JOB the availability is for. Omit it and the
 *   answer is person-wide (today's behaviour). Pass a specific sub-department
 *   id and the read narrows to declarations for THAT job plus unscoped ones.
 *   Added in the sub-department scoping work; existing callers that omit it
 *   get the same behaviour as before.
 */
export function useResolvedAvailability(
    profileIds: string[],
    dates: Date[],
    enabled: boolean = true,
    subDepartmentId?: string | null,
): UseResolvedAvailabilityResult {
    // Memoize the date range
    const dateRange = useMemo(() => {
        if (dates.length === 0) return null;
        const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
        return {
            start: sorted[0],
            end: sorted[sorted.length - 1],
        };
    }, [dates]);

    // Stable key for profile IDs (sorted for consistency)
    const profileIdKey = useMemo(() =>
        [...profileIds].sort().join(','),
        [profileIds]
    );

    const { data: availabilityMap = new Map(), isLoading, error, refetch } = useQuery({
        queryKey: [
            'availability',
            'resolved',
            // Source discriminator: bumped from v2→v3 when the scope parameter was
            // added. Without the bump, navigating from a page that fetched the
            // person-wide list to one asking about a specific job would serve the
            // cached person-wide result for the scoped key — and react-query would
            // not refetch because the data was still fresh.
            'slots-v3',
            profileIdKey,
            dateRange?.start.getTime(),
            dateRange?.end.getTime(),
            subDepartmentId ?? null,
        ] as const,
        queryFn: () => getResolvedAvailabilities(
            profileIds,
            dateRange!.start,
            dateRange!.end,
            subDepartmentId,
        ),
        enabled: enabled && !!dateRange && profileIds.length > 0,
        staleTime: 30_000,
    });

    const getAvailability = useCallback(
        (profileId: string, date: string): EmployeeAvailability | null => {
            const profileMap = availabilityMap.get(profileId);
            if (!profileMap) return null;
            return profileMap.get(date) || null;
        },
        [availabilityMap]
    );

    return {
        availabilityMap,
        getAvailability,
        isLoading,
        error: error as Error | null,
        refetch,
    };
}

export default useResolvedAvailability;
