
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { timesheetService } from '../services/timesheetService';
import { Timesheet, ShiftStatus } from '../models/types';

export const useTimesheets = () => {
  const queryClient = useQueryClient();

  // Get all timesheets
  const useAllTimesheets = () => {
    return useQuery({
      queryKey: ['timesheets'],
      queryFn: timesheetService.getAllTimesheets
    });
  };

  // Get timesheets by date range
  const useTimesheetsByDateRange = (startDate: string, endDate: string) => {
    return useQuery({
      queryKey: ['timesheets', 'range', startDate, endDate],
      queryFn: () => timesheetService.getTimesheetsByDateRange(startDate, endDate),
      enabled: !!startDate && !!endDate
    });
  };

  // Get timesheet by date
  const useTimesheetByDate = (date: string) => {
    return useQuery({
      queryKey: ['timesheets', 'date', date],
      queryFn: () => timesheetService.getTimesheetByDate(date),
      enabled: !!date
    });
  };

  // Update timesheet
  const useUpdateTimesheet = () => {
    return useMutation({
      mutationFn: ({ date, updates }: { date: string, updates: Partial<Timesheet> }) =>
        timesheetService.updateTimesheet(date, updates),
      onSuccess: async (data) => {
        if (data) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['timesheets'] }),
            queryClient.invalidateQueries({ queryKey: ['timesheets', 'date', data.date] })
          ]);
        }
      }
    });
  };

  // Update shift status
  const useUpdateShiftStatus = () => {
    return useMutation({
      mutationFn: ({
        date,
        groupId,
        subGroupId,
        shiftId,
        status
      }: {
        date: string;
        groupId: number;
        subGroupId: number;
        shiftId: string;
        status: ShiftStatus;
      }) =>
        timesheetService.updateShiftStatus(date, groupId, subGroupId, shiftId, status),
      onSuccess: async (data) => {
        if (data) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['timesheets'] }),
            queryClient.invalidateQueries({ queryKey: ['timesheets', 'date', data.date] })
          ]);
        }
      }
    });
  };

  // Clock in
  const useClockInShift = () => {
    return useMutation({
      mutationFn: ({
        date,
        groupId,
        subGroupId,
        shiftId,
        actualStartTime
      }: {
        date: string;
        groupId: number;
        subGroupId: number;
        shiftId: string;
        actualStartTime: string;
      }) =>
        timesheetService.clockInShift(date, groupId, subGroupId, shiftId, actualStartTime),
      onSuccess: async (data) => {
        if (data) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['timesheets'] }),
            queryClient.invalidateQueries({ queryKey: ['timesheets', 'date', data.date] })
          ]);
        }
      }
    });
  };

  // Clock out
  const useClockOutShift = () => {
    return useMutation({
      mutationFn: ({
        date,
        groupId,
        subGroupId,
        shiftId,
        actualEndTime
      }: {
        date: string;
        groupId: number;
        subGroupId: number;
        shiftId: string;
        actualEndTime: string;
      }) =>
        timesheetService.clockOutShift(date, groupId, subGroupId, shiftId, actualEndTime),
      onSuccess: async (data) => {
        if (data) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['timesheets'] }),
            queryClient.invalidateQueries({ queryKey: ['timesheets', 'date', data.date] })
          ]);
        }
      }
    });
  };

  // Swap shift
  const useSwapShift = () => {
    return useMutation({
      mutationFn: ({
        date,
        groupId,
        subGroupId,
        shiftId,
        newEmployeeId
      }: {
        date: string;
        groupId: number;
        subGroupId: number;
        shiftId: string;
        newEmployeeId: string;
      }) =>
        timesheetService.swapShift(date, groupId, subGroupId, shiftId, newEmployeeId),
      onSuccess: async (data) => {
        if (data) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['timesheets'] }),
            queryClient.invalidateQueries({ queryKey: ['timesheets', 'date', data.date] })
          ]);
        }
      }
    });
  };

  // Cancel shift
  const useCancelShift = () => {
    return useMutation({
      mutationFn: ({
        date,
        groupId,
        subGroupId,
        shiftId,
        reason
      }: {
        date: string;
        groupId: number;
        subGroupId: number;
        shiftId: string;
        reason?: string;
      }) =>
        timesheetService.cancelShift(date, groupId, subGroupId, shiftId, reason),
      onSuccess: async (data) => {
        if (data) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['timesheets'] }),
            queryClient.invalidateQueries({ queryKey: ['timesheets', 'date', data.date] })
          ]);
        }
      }
    });
  };

  return {
    useAllTimesheets,
    useTimesheetsByDateRange,
    useTimesheetByDate,
    useUpdateTimesheet,
    useUpdateShiftStatus,
    useClockInShift,
    useClockOutShift,
    useSwapShift,
    useCancelShift
  };
};
