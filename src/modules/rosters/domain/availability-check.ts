/**
 * Availability check — shared, pure evaluation of whether a shift falls inside an
 * employee's DECLARED availability for that day.
 *
 * Policy (2026-07): **"unset availability = unavailable."** An employee with no
 * availability data on file is treated as unavailable, and a shift must be fully
 * contained within a declared available window to count as "available".
 *
 * This is the **warn-only** evaluation used by MANUAL workflows (manual
 * scheduling, bidding, trading, swapping): the assignment is never blocked, but a
 * clear warning is surfaced so the user can proceed knowingly. The Auto Scheduler
 * enforces the identical rule as a HARD constraint inside the optimizer
 * (`enforce_availability` — see optimizer-service/model_builder.py). Keep the two
 * in sync: both require full containment in a declared slot and both treat missing
 * data as unavailable.
 */

import type { EmployeeAvailability } from './availabilityResolution.types';

export type AvailabilityVerdict = 'available' | 'outside_window' | 'no_availability';

export interface ShiftAvailabilityResult {
  verdict: AvailabilityVerdict;
  /** True when a manual assignment should surface a warning. */
  isWarning: boolean;
  /** Short, user-facing reason (empty when available). */
  message: string;
}

function toMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  const [h, m] = time.split(':').map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

/**
 * Evaluate a shift against an employee's resolved availability for the shift's date.
 *
 * @param availability  Resolved availability for the SAME date as the shift (or null).
 * @param startTime     Shift start "HH:MM" (or "HH:MM:SS").
 * @param endTime       Shift end "HH:MM" (or "HH:MM:SS"); may be < start for overnight.
 */
export function evaluateShiftAvailability(
  availability: EmployeeAvailability | null | undefined,
  startTime: string,
  endTime: string,
): ShiftAvailabilityResult {
  // Unset availability = unavailable.
  if (!availability || !availability.hasData) {
    return {
      verdict: 'no_availability',
      isWarning: true,
      message:
        'No declared availability on file for this day — unset availability is treated as unavailable.',
    };
  }

  if (availability.isFullyUnavailable) {
    return {
      verdict: 'outside_window',
      isWarning: true,
      message: 'Employee is marked unavailable for this day.',
    };
  }

  const s = toMinutes(startTime);
  let e = toMinutes(endTime);
  if (e <= s) e += 1440; // overnight shift crosses midnight

  const covered =
    availability.isFullyAvailable ||
    availability.availableWindows.some((w) => {
      const ws = toMinutes(w.start);
      let we = toMinutes(w.end);
      if (we <= ws) we += 1440;
      // The shift must be fully contained within the available window.
      return ws <= s && we >= e;
    });

  if (covered) {
    return { verdict: 'available', isWarning: false, message: '' };
  }

  return {
    verdict: 'outside_window',
    isWarning: true,
    message: "This shift falls outside the employee's declared availability window.",
  };
}

/** A declared availability slot as stored in the `availability_slots` table. */
export interface DeclaredSlot {
  slot_date: string;
  start_time: string;
  end_time: string;
}

/**
 * Slot-based variant of {@link evaluateShiftAvailability}. Evaluates directly
 * against raw `availability_slots` rows — the SAME source the auto-scheduler
 * uses (roster-fetcher / optimizer) and the SAME full-containment logic — so a
 * manual warning and the auto-scheduler's hard filter agree. "Unset =
 * unavailable": no slot for the shift's date ⇒ warning.
 */
export function evaluateShiftAvailabilityFromSlots(
  slots: DeclaredSlot[] | null | undefined,
  shiftDate: string,
  startTime: string,
  endTime: string,
): ShiftAvailabilityResult {
  const daySlots = (slots ?? []).filter((s) => s.slot_date === shiftDate);

  if (daySlots.length === 0) {
    return {
      verdict: 'no_availability',
      isWarning: true,
      message:
        'No declared availability on file for this day — unset availability is treated as unavailable.',
    };
  }

  const s = toMinutes(startTime);
  let e = toMinutes(endTime);
  if (e <= s) e += 1440; // overnight

  const covered = daySlots.some((slot) => {
    const ws = toMinutes(slot.start_time);
    let we = toMinutes(slot.end_time);
    if (we <= ws) we += 1440;
    return ws <= s && we >= e; // full containment
  });

  return covered
    ? { verdict: 'available', isWarning: false, message: '' }
    : {
        verdict: 'outside_window',
        isWarning: true,
        message: "This shift falls outside the employee's declared availability window.",
      };
}
