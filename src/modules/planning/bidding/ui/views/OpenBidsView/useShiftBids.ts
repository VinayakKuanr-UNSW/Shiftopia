// src/modules/planning/bidding/ui/views/OpenBidsView/useShiftBids.ts

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import type { EmployeeBid, IterationHistoryEntry } from './types';

interface UseShiftBidsReturn {
  bids: EmployeeBid[];           // current iteration bids
  iterationHistory: IterationHistoryEntry[];  // past iterations (read-only)
  currentIteration: number;
  isLoading: boolean;
  refetch: () => void;
}

export function useShiftBids(shiftId: string | null): UseShiftBidsReturn {
  const {
    data,
    isLoading,
    refetch
  } = useQuery({
    queryKey: [...shiftKeys.bids(shiftId || ''), 'allIterations'],
    queryFn: async () => {
      if (!shiftId) return { currentIteration: 1, allBids: [] };

      // 1. Get current iteration from shift
      const { data: shiftRow } = await supabase
        .from('shifts')
        .select('bidding_iteration')
        .eq('id', shiftId)
        .single();

      const currentIteration: number = (shiftRow as any)?.bidding_iteration || 1;

      // 2. Fetch ALL bids for this shift across all iterations
      const { data: rows, error } = await supabase
        .from('shift_bids')
        .select(`
          id, shift_id, employee_id, status, bidding_iteration, created_at,
          profiles!shift_bids_employee_id_fkey(
            id, full_name, first_name, last_name, employment_type
          )
        `)
        .eq('shift_id', shiftId)
        .order('bidding_iteration', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching shift bids:', error);
        return { currentIteration, allBids: [] };
      }

      return { currentIteration, allBids: rows || [] };
    },
    enabled: !!shiftId,
    staleTime: 10000,
  });

  const currentIteration = data?.currentIteration ?? 1;
  const allBids = data?.allBids ?? [];

  // Split into current iteration bids and past history
  const currentBids: EmployeeBid[] = allBids
    .filter((b: any) => b.bidding_iteration === currentIteration)
    .map((b: any) => {
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
        biddingIteration: b.bidding_iteration,
      };
    });

  // Build past iteration history (grouped)
  const iterationHistory: IterationHistoryEntry[] = [];
  for (let itr = currentIteration - 1; itr >= 1; itr--) {
    const itrBids = allBids.filter((b: any) => b.bidding_iteration === itr);
    const bids = itrBids.map((b: any) => {
      const profile = b.profiles;
      const name = profile
        ? (profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Unknown')
        : 'Unknown';
      return { employeeName: name, status: b.status };
    });
    iterationHistory.push({ iteration: itr, bids });
  }

  return { bids: currentBids, iterationHistory, currentIteration, isLoading, refetch };
}
