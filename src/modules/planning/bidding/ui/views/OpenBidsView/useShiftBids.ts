// src/modules/planning/bidding/ui/views/OpenBidsView/useShiftBids.ts

import { useQuery } from '@tanstack/react-query';
import { shiftsQueries } from '@/modules/rosters/api/shifts.queries';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import type { EmployeeBid } from './types';

interface UseShiftBidsReturn {
  bids: EmployeeBid[];
  isLoading: boolean;
  refetch: () => void;
}

export function useShiftBids(shiftId: string | null): UseShiftBidsReturn {
  const {
    data: bids = [],
    isLoading,
    refetch
  } = useQuery({
    queryKey: shiftKeys.bids(shiftId || ''),
    queryFn: async () => {
      if (!shiftId) return [];
      const data = await shiftsQueries.getShiftBids(shiftId);

      const mappedBids: EmployeeBid[] = data.map((b: any) => {
        const profile = b.profiles;
        const name = profile
          ? (profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Unknown')
          : 'Unknown';

        return {
          id: b.id,
          shiftId: b.shift_id,
          employeeId: b.employee_id,
          employeeName: name,
          employmentType: profile?.employment_type || 'Casual',
          status: b.status,
          submittedAt: b.created_at,
          isWinner: b.status === 'accepted' || b.status === 'assigned',
        };
      });

      return mappedBids;
    },
    enabled: !!shiftId,
    staleTime: 10000,
  });

  return { bids, isLoading, refetch };
}
