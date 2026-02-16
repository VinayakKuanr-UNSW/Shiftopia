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
export function useResolvedAvailability(
    profileIds: string[],
    dates: Date[],
    enabled: boolean = true
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
            profileIdKey,
            dateRange?.start.getTime(),
            dateRange?.end.getTime(),
        ] as const,
        queryFn: () => getResolvedAvailabilities(
            profileIds,
            dateRange!.start,
            dateRange!.end
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
