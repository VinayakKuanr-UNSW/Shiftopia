// src/modules/planning/ui/views/OpenBidsView/hooks/useOpenShifts.ts

import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { shiftsQueries } from '@/modules/rosters/api/shifts.queries';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { calculateTimeRemaining } from './utils';
import { determineShiftState } from '@/modules/rosters/domain/shift-state.utils';
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import type { OpenShift, ShiftStatus, GroupType } from './types';

interface UseOpenShiftsReturn {
  shifts: OpenShift[];
  isLoading: boolean;
  refetch: () => void;
  setShifts: React.Dispatch<React.SetStateAction<OpenShift[]>>;
}

export function useOpenShifts(organizationId?: string): UseOpenShiftsReturn {
  const { toast } = useToast();
  const { activeContract } = useAuth();

  // Derive filters from the access certificate (contract)
  // If a filter is present in the contract, it LOCKS the view to that scope.
  const filters = {
    organizationId: activeContract?.organizationId || organizationId || '',
    departmentId: activeContract?.departmentId,
    subDepartmentId: activeContract?.subDepartmentId
  };

  const {
    data: shifts = [],
    isLoading,
    refetch,
    isError
  } = useQuery({
    queryKey: shiftKeys.openShifts(filters.organizationId),
    queryFn: async () => {
      // Pass the strict filters to the API
      const data = await shiftsQueries.getOpenShifts(filters);

      // Client-side transformation and augmentation
      const mapped: OpenShift[] = data.map((s: any) => {
        const [sh, sm] = s.start_time.split(':').map(Number);
        const [eh, em] = s.end_time.split(':').map(Number);
        let durationMins = (eh * 60 + em) - (sh * 60 + sm);
        if (durationMins < 0) durationMins += 24 * 60; // Overnight
        const paidBreak = s.paid_break_minutes || 0;
        const unpaidBreak = s.unpaid_break_minutes || 0;
        const netHours = ((durationMins - unpaidBreak) / 60).toFixed(1);

        const shiftStart = s.start_at ? new Date(s.start_at) : parseZonedDateTime(s.shift_date, s.start_time, s.tz_identifier || SYDNEY_TZ);
        const biddingDeadline = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000).toISOString();

        // Consistent urgency logic
        const timeToStart = shiftStart.getTime() - Date.now();
        const isUrgent = s.bidding_status === 'on_bidding_urgent' ||
          s.is_urgent ||
          (timeToStart > 0 && timeToStart < 24 * 60 * 60 * 1000);

        // Derive State ID
        const stateId = determineShiftState(s);

        return {
          id: s.id,
          title: s.roles?.name || 'Shift',
          group: (s.group_type as GroupType) || 'convention',
          groupLabel: (s.group_type || 'CONVENTION').toUpperCase().replace('_', ' '),
          date: s.shift_date,
          dayLabel: new Date(s.shift_date).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          }),
          startTime: s.start_time.slice(0, 5),
          endTime: s.end_time.slice(0, 5),
          netHours,
          paidBreak,
          unpaidBreak,
          location: s.organizations?.name || 'Location',
          department: s.departments?.name || 'Department',
          subDepartment: s.sub_departments?.name || '',
          role: s.roles?.name || 'Role',
          remunerationLevel: s.remuneration_levels?.level_name,
          hourlyRate: s.remuneration_levels?.hourly_rate_min
            ? `$${s.remuneration_levels.hourly_rate_min}`
            : '',
          status: 'pending' as ShiftStatus,
          bidCount: 0,
          biddingDeadline,
          shiftIdDisplay: stateId === 'Unknown' ? `#${s.id.slice(0, 4).toUpperCase()}` : stateId,
          stateId,
          organizationId: s.organization_id,
          departmentId: s.department_id,
          subDepartmentId: s.sub_department_id,
          lifecycleStatus: 'published' as const,
          assignmentStatus: (s.assignment_status || 'unassigned') as any,
          fulfillmentStatus: s.fulfillment_status,
          assignmentOutcome: s.assignment_outcome,
          subGroup: s.sub_group_name || s.sub_departments?.name,
          employeeName: s.profiles ? `${s.profiles.first_name} ${s.profiles.last_name}` : undefined,
          groupColor: 'blue',
          isUrgent,
        };
      });

      // Determine view status (pending/urgent/resolved)
      const enriched = mapped.map((s) => {
        const timeLeft = calculateTimeRemaining(s.biddingDeadline);
        let status: ShiftStatus = 'pending';

        if (s.isUrgent) status = 'urgent';
        if (timeLeft.isExpired) status = 'resolved';

        return { ...s, status };
      });

      return enriched;
    },
    enabled: !!filters.organizationId,
    staleTime: 30000,
    refetchInterval: 60000, // Refresh every minute to update urgency/deadlines
  });

  if (isError) {
    toast({
      title: 'Error',
      description: 'Failed to load open shifts',
      variant: 'destructive',
    });
  }

  return {
    shifts,
    isLoading,
    refetch,
    setShifts: () => { }, // No-op as we are using React Query source of truth
  };
}
