/**
 * useEbaRates — fetches the active organization's published rate cards for the
 * rate-admin UI. Follows the repo's TanStack Query convention (tuple queryKey; fetching
 * delegated to the read module). Rates change at most a few times a year, so the
 * data is treated as effectively static within a session.
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/platform/auth/useAuth';
import {
  getEbaRateSchedule, getTraineeRateSchedule,
  type EbaRateSet, type TraineeRateSet,
} from '../data/ebaRates.read.api';

export function useEbaRates(enabled = true) {
  const organizationId = useAuth().accessScope?.organizationId ?? null;
  const query = useQuery<EbaRateSet[]>({
    queryKey: ['eba-rate-schedule', organizationId],
    queryFn: () => getEbaRateSchedule(organizationId),
    enabled: enabled && organizationId !== null,
    staleTime: 60 * 60 * 1000, // 1h — reference data, rarely changes
  });

  return {
    schedule: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Schedule 5 trainee schedule from the active organization's cards (embedded fallback). */
export function useTraineeRates(enabled = true) {
  const organizationId = useAuth().accessScope?.organizationId ?? null;
  const query = useQuery<TraineeRateSet[]>({
    queryKey: ['eba-trainee-schedule', organizationId],
    queryFn: () => getTraineeRateSchedule(organizationId),
    enabled,
    staleTime: 60 * 60 * 1000,
  });
  return { schedule: query.data ?? [] };
}
