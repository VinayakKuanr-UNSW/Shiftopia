
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shiftService, ShiftDetails } from '../services/shiftService';

export const useShifts = () => {
  const queryClient = useQueryClient();

  // Get all shifts
  const useAllShifts = () => {
    return useQuery({
      queryKey: ['shifts'],
      queryFn: shiftService.getAllShifts
    });
  };

  // Get shift by ID
  const useShift = (id: string) => {
    return useQuery({
      queryKey: ['shifts', id],
      queryFn: () => shiftService.getShiftById(id),
      enabled: !!id
    });
  };

  // Get shifts by date range
  const useShiftsByDateRange = (startDate: string, endDate: string) => {
    return useQuery({
      queryKey: ['shifts', 'range', startDate, endDate],
      queryFn: () => shiftService.getShiftsByDateRange(startDate, endDate),
      enabled: !!startDate && !!endDate
    });
  };

  // Get shifts by department
  const useShiftsByDepartment = (department: string) => {
    return useQuery({
      queryKey: ['shifts', 'department', department],
      queryFn: () => shiftService.getShiftsByDepartment(department),
      enabled: !!department
    });
  };

  // Update shift status
  const useUpdateShiftStatus = () => {
    return useMutation({
      mutationFn: ({ id, status, assignedEmployee }: { id: string; status: string; assignedEmployee?: string }) =>
        shiftService.updateShiftStatus(id, status, assignedEmployee),
      onSuccess: async (data) => {
        if (data) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['shifts'] }),
            queryClient.invalidateQueries({ queryKey: ['shifts', data.id] }),
            queryClient.invalidateQueries({ queryKey: ['bids', 'shift', data.id] })
          ]);
        }
      }
    });
  };

  return {
    useAllShifts,
    useShift,
    useShiftsByDateRange,
    useShiftsByDepartment,
    useUpdateShiftStatus
  };
};
