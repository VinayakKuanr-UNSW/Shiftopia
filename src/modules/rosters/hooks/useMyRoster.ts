
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, addDays, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { useAuth } from '@/modules/auth/hooks/useAuth';
import { CalendarView } from '@/modules/rosters/contexts/RosterUIContext';
import { shiftsQueries } from '@/modules/rosters/api/shifts.queries';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { Shift } from '@/modules/rosters/domain/shift.entity';
import { getDepartmentColor } from '@/modules/core/lib/utils';

interface ShiftWithDetails {
    shift: Shift;
    groupName: string;
    groupColor: string;
    subGroupName: string;
}

import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';

export const useMyRoster = (view: CalendarView, selectedDate: Date) => {
    const { user } = useAuth();
    const { organizationId, departmentId, subDepartmentId } = useOrgSelection();

    // Calculate date range based on the view
    const calculateDateRange = () => {
        let start: Date;
        let end: Date;

        if (view === 'day') {
            start = selectedDate;
            end = selectedDate;
        } else if (view === '3day') {
            start = selectedDate;
            end = addDays(selectedDate, 2);
        } else if (view === 'week') {
            start = startOfWeek(selectedDate, { weekStartsOn: 1 });
            end = endOfWeek(selectedDate, { weekStartsOn: 1 });
        } else if (view === 'month') {
            start = startOfMonth(selectedDate);
            end = endOfMonth(selectedDate);
        } else {
            start = selectedDate;
            end = selectedDate;
        }

        return { start, end };
    };

    // Update date range when view or selectedDate changes
    const { start, end } = calculateDateRange();
    const startDateStr = format(start, 'yyyy-MM-dd');
    const endDateStr = format(end, 'yyyy-MM-dd');

    // Fetch shifts for the date range using unified keys
    const { data: shifts = [], isLoading, error } = useQuery({
        // Use the centralized query key factory
        queryKey: shiftKeys.byEmployee(user?.id || '', startDateStr, endDateStr),
        queryFn: async () => {
            if (!user?.id) return [];
            return shiftsQueries.getEmployeeShifts(user.id, startDateStr, endDateStr);
        },
        enabled: !!user?.id,
        staleTime: 30000, // Consistent with useRosterShifts
    });

    const resolvedDateRange = eachDayOfInterval({ start, end });

    // Get shifts for a specific date
    const getShiftsForDate = (date: Date): ShiftWithDetails[] => {
        const dateStr = format(date, 'yyyy-MM-dd');

        // Filter from the cached array
        let daysShifts = shifts.filter(s => s.shift_date === dateStr);

        // Apply Global Context Filters
        if (daysShifts.length > 0) {
            console.log('[useMyRoster] Filtering shifts:', {
                total: daysShifts.length,
                date: dateStr,
                orgId: organizationId,
                deptId: departmentId,
                subDeptId: subDepartmentId
            });

            if (organizationId) {
                daysShifts = daysShifts.filter(s => s.organization_id === organizationId);
            }
            if (departmentId) {
                daysShifts = daysShifts.filter(s => s.department_id === departmentId);
            }
            if (subDepartmentId) {
                daysShifts = daysShifts.filter(s => s.sub_department_id === subDepartmentId);
            }
        }

        return daysShifts.map(shift => ({
            shift,
            groupName: shift.group_type || 'General',
            groupColor: getDepartmentColor(shift.group_type || 'general'),
            subGroupName: shift.sub_group_name || ''
        }));
    };

    // Navigation functions
    const goToPrevious = () => {
        if (view === 'day') {
            return subDays(selectedDate, 1);
        } else if (view === '3day') {
            return subDays(selectedDate, 3);
        } else if (view === 'week') {
            return subDays(selectedDate, 7);
        } else if (view === 'month') {
            const newDate = new Date(selectedDate);
            newDate.setMonth(newDate.getMonth() - 1);
            return newDate;
        }
        return selectedDate;
    };

    const goToNext = () => {
        if (view === 'day') {
            return addDays(selectedDate, 1);
        } else if (view === '3day') {
            return addDays(selectedDate, 3);
        } else if (view === 'week') {
            return addDays(selectedDate, 7);
        } else if (view === 'month') {
            const newDate = new Date(selectedDate);
            newDate.setMonth(newDate.getMonth() + 1);
            return newDate;
        }
        return selectedDate;
    };

    return {
        dateRange: resolvedDateRange,
        shifts,
        isLoading,
        error,
        getShiftsForDate,
        goToPrevious,
        goToNext
    };
};
