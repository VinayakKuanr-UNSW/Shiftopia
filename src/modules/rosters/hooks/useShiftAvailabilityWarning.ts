/**
 * useShiftAvailabilityWarning — reusable hook for MANUAL assignment surfaces.
 *
 * Given an (employee, date, start, end), resolves the employee's declared
 * availability for that date and evaluates whether the shift falls inside it,
 * applying the "unset = unavailable" policy. Returns a warn-only result; manual
 * workflows (manual scheduling, bidding, trading, swapping) should surface the
 * warning but never block on it — the Auto Scheduler is where availability is a
 * hard constraint.
 *
 * Adoption is three lines at any manual surface:
 *   const { result } = useShiftAvailabilityWarning(empId, date, start, end);
 *   if (result?.isWarning) { …render <AvailabilityWarningBanner result={result} /> and require ack… }
 */

import { useQuery } from '@tanstack/react-query';
import { getEmployeeAvailabilityForDate } from '@/modules/rosters/api/availability.api';
import {
  evaluateShiftAvailability,
  type ShiftAvailabilityResult,
} from '@/modules/rosters/domain/availability-check';

/** 'YYYY-MM-DD' -> local-midnight Date. */
function parseLocalDateStr(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}

export function useShiftAvailabilityWarning(
  employeeId: string | null | undefined,
  date: string | null | undefined, // YYYY-MM-DD
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): { result: ShiftAvailabilityResult | null; isLoading: boolean } {
  const enabled = !!employeeId && !!date && !!startTime && !!endTime;

  const { data, isLoading } = useQuery({
    queryKey: ['availability', 'resolved', 'single', employeeId, date],
    // `getEmployeeAvailabilityForDate` takes a Date; `date` here is a
    // 'YYYY-MM-DD' string. Parsed on LOCAL date parts, never `new Date(str)`
    // (UTC midnight — rolls the day west of UTC).
    queryFn: () => getEmployeeAvailabilityForDate(employeeId!, parseLocalDateStr(date!)),
    enabled,
    staleTime: 30_000,
  });

  if (!enabled) return { result: null, isLoading: false };

  return {
    result: evaluateShiftAvailability(data ?? null, startTime!, endTime!),
    isLoading,
  };
}

export default useShiftAvailabilityWarning;
