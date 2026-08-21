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
import { useAvailabilityMode } from '@/modules/availability/state/useAvailabilityMode';
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
  /**
   * Which JOB the shift belongs to. Omit and the answer is person-wide
   * (today's behaviour). Pass the shift's `sub_department_id` and both the
   * slots read and the contract-basis mode resolve against THAT job — so a
   * Full-Time employee in Security who is also Casual in Set-up gets OPT_OUT
   * for a Security shift and OPT_IN for a Set-up one.
   */
  subDepartmentId?: string | null,
): { result: ShiftAvailabilityResult | null; isLoading: boolean } {
  const enabled = !!employeeId && !!date && !!startTime && !!endTime;

  const { data, isLoading } = useQuery({
    queryKey: ['availability', 'resolved', 'single', employeeId, date, subDepartmentId ?? null],
    // `getEmployeeAvailabilityForDate` takes a Date; `date` here is a
    // 'YYYY-MM-DD' string. Parsed on LOCAL date parts, never `new Date(str)`
    // (UTC midnight — rolls the day west of UTC).
    queryFn: () => getEmployeeAvailabilityForDate(employeeId!, parseLocalDateStr(date!), subDepartmentId),
    enabled,
    staleTime: 30_000,
  });

  // An FT/PT employee's silence means available, so the verdict depends on their
  // contract as much as on their slots.
  //
  // The scope is threaded to `useAvailabilityMode` so the FT/casual classification
  // is per-job: a person who is Full-Time in Security and Casual in Set-up gets
  // OPT_OUT for a Security shift warning and OPT_IN for a Set-up one. Without
  // this, the Full-Time contract always wins person-wide, and the hook never
  // warns about Set-up slots — the exact bug this scoping work exists to fix.
  const { mode, isLoading: modeLoading } = useAvailabilityMode(
    employeeId,
    enabled,
    subDepartmentId != null ? { subDepartmentId } : undefined,
  );

  if (!enabled) return { result: null, isLoading: false };

  // Report loading until BOTH are in. Evaluating against a not-yet-resolved mode
  // would default to OPT_IN and flash "no declared availability on file" at a
  // full-timer before correcting itself.
  return {
    result: evaluateShiftAvailability(data ?? null, startTime!, endTime!, mode),
    isLoading: isLoading || modeLoading,
  };
}

export default useShiftAvailabilityWarning;
