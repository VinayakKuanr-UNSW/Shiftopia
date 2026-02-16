// src/modules/planning/ui/views/OpenBidsView/hooks/useShiftBids.ts

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

      const mappedBids: EmployeeBid[] = data.map((b: any) => ({
        id: b.id,
        shiftId: b.shift_id,
        employeeId: b.employee_id,
        employeeName: b.profiles?.full_name || 'Unknown',
        employmentType: b.profiles?.employment_type || 'Casual',
        pool: 'General',
        department: 'Dept',
        status: b.status,
        submittedAt: b.created_at,
        fatigueRisk: 'low',
        fatigueLabel: 'Safe',
        fatigueReason: 'OK',
        isBestMatch: false,
      }));

      return mappedBids;
    },
    enabled: !!shiftId,
    staleTime: 10000,
  });

  return {
    bids,
    isLoading,
    refetch,
  };
}
