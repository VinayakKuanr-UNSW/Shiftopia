import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { shiftsApi } from '@/modules/rosters';
import { addDays, subDays, format, parseISO } from 'date-fns';
import {
    checkCompliance,
    ComplianceCheckInput,
    ComplianceCheckResult,
    ShiftTimeRange,
} from '@/modules/compliance';

export interface UseSwapComplianceProps {
    requesterId: string | undefined;
    candidateShift: {
        shift_date: string;
        start_time: string;
        end_time: string;
        unpaid_break_minutes?: number;
    } | undefined;
    targetShiftId: string | undefined; // The shift the requester is swapping OUT
}

export function useSwapCompliance({
    requesterId,
    candidateShift,
    targetShiftId
}: UseSwapComplianceProps) {

    // 1. Calculate date range for roster fetch (surrounding the candidate shift)
    const dateRange = useMemo(() => {
        if (!candidateShift?.shift_date) return null;

        const centerDate = parseISO(candidateShift.shift_date);
        return {
            start: format(subDays(centerDate, 30), 'yyyy-MM-dd'),
            end: format(addDays(centerDate, 30), 'yyyy-MM-dd'),
        };
    }, [candidateShift?.shift_date]);

    // 2. Fetch Requester's Roster
    const { data: requesterRoster = [], isLoading } = useQuery({
        queryKey: ['requesterRosterForCompliance', requesterId, dateRange?.start, dateRange?.end],
        queryFn: async () => {
            if (!requesterId || !dateRange) return [];
            return shiftsApi.getEmployeeShifts(requesterId, dateRange.start, dateRange.end);
        },
        enabled: !!requesterId && !!dateRange,
        staleTime: 60 * 1000,
    });

    // 3. Run Compliance Check
    const result: ComplianceCheckResult | null = useMemo(() => {
        if (!candidateShift || !requesterId || isLoading) return null;

        // Map roster to engine format AND exclude the target shift
        const existingShifts: ShiftTimeRange[] = requesterRoster
            .filter(s => s.id !== targetShiftId)
            .map(s => ({
                shift_date: s.shift_date,
                start_time: s.start_time,
                end_time: s.end_time,
                unpaid_break_minutes: s.unpaid_break_minutes || 0,
            }));

        const input: ComplianceCheckInput = {
            employee_id: requesterId,
            action_type: 'assign', // Treating swap offer as a new assignment for validation
            candidate_shift: {
                shift_date: candidateShift.shift_date,
                start_time: candidateShift.start_time,
                end_time: candidateShift.end_time,
                unpaid_break_minutes: candidateShift.unpaid_break_minutes || 0,
            },
            existing_shifts: existingShifts,
        };

        return checkCompliance(input);
    }, [candidateShift, requesterId, isLoading, requesterRoster, targetShiftId]);

    return {
        result,
        isLoading,
        isValidating: isLoading, // Alias for UI clarity
    };
}
