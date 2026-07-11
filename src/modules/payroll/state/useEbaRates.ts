/**
 * useEbaRates — fetches the effective-dated EBA rate schedule for the rate-admin
 * UI. Follows the repo's TanStack Query convention (tuple queryKey; fetching
 * delegated to the read module). Rates change at most a few times a year, so the
 * data is treated as effectively static within a session.
 */

import { useQuery } from '@tanstack/react-query';
import { getEbaRateSchedule, type EbaRateSet } from '../data/ebaRates.read.api';

export function useEbaRates(enabled = true) {
  const query = useQuery<EbaRateSet[]>({
    queryKey: ['eba-rate-schedule'],
    queryFn: getEbaRateSchedule,
    enabled,
    staleTime: 60 * 60 * 1000, // 1h — reference data, rarely changes
  });

  return {
    schedule: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
