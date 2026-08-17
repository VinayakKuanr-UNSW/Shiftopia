/**
 * Availability check — shared, pure evaluation of whether a shift falls inside an
 * employee's DECLARED availability for that day.
 *
 * WHAT AN ABSENT DECLARATION MEANS DEPENDS ON THE EMPLOYEE. There are two
 * populations and they are exact opposites, so a single "unset = unavailable"
 * rule is wrong for one of them:
 *
 *   OPT_IN  (casual) — availability is an OFFER. Silence means unavailable, so
 *                      an empty day IS a problem worth warning about.
 *   OPT_OUT (FT/PT)  — availability is a CONTRACT OBLIGATION. Silence means
 *                      available; unavailability is stated positively, through
 *                      Leave. An empty day is the normal, correct state.
 *
 * Evaluated PER DATE for OPT_OUT, not per employee: a declaration on a date
 * NARROWS that date, and silence on any other date still means available. This
 * is a deliberate mirror of the `availability_mode` branch in
 * `employee_eligible()` (optimizer-service/model_builder.py) — that function and
 * this one are the hard and the soft reading of the same rule and MUST agree.
 * Before the FT work they did not: this file applied "unset = unavailable" to
 * everyone while the solver had already moved to per-mode semantics, so all 17
 * full-timers in production tripped a false "no declared availability" warning
 * on every manual assign, bid, swap and reserve-list search.
 *
 * This is the **warn-only** evaluation used by MANUAL workflows (manual
 * scheduling, bidding, trading, swapping): the assignment is never blocked, but a
 * clear warning is surfaced so the user can proceed knowingly. The Auto Scheduler
 * enforces the same rule as a HARD constraint (`enforce_availability`).
 *
 * `mode` DEFAULTS TO 'OPT_IN', the strict reading. A caller that cannot resolve
 * the employee's contract therefore over-warns rather than under-warns, which is
 * the failure direction a human can see and correct.
 */

import type { EmployeeAvailability } from './availabilityResolution.types';
import { toTargetEmploymentType } from '@/modules/core/model/employment.types';

export type AvailabilityVerdict =
  | 'available'
  /**
   * No declaration on file, and none is expected — the employee is available by
   * contract. Distinct from 'available' so a caller can render "Contract based"
   * rather than implying a declaration was read and matched.
   */
  | 'contract_available'
  | 'outside_window'
  | 'no_availability';

/**
 * What an ABSENT declaration means for this employee. The TS name of the
 * solver's `EmployeeInput.availability_mode`.
 */
export type AvailabilityMode = 'OPT_IN' | 'OPT_OUT';

/**
 * Resolve the mode from a contract's employment status.
 *
 * Delegates the token normalisation to `toTargetEmploymentType` so there is ONE
 * alias table in the frontend for 'Full-Time' / 'full time' / 'FT' /
 * 'Flexible Part-Time' — the same one the solver payload is built from. Note
 * that helper's documented posture: anything unrecognised collapses to 'Casual',
 * so an unreadable status lands on the strict OPT_IN here, matching
 * `resolveComplianceBasis`.
 */
export function availabilityModeForEmploymentStatus(
  employmentStatus: string | null | undefined,
): AvailabilityMode {
  return toTargetEmploymentType(employmentStatus) === 'Casual' ? 'OPT_IN' : 'OPT_OUT';
}

export interface ShiftAvailabilityResult {
  verdict: AvailabilityVerdict;
  /** True when a manual assignment should surface a warning. */
  isWarning: boolean;
  /** Short, user-facing reason (empty when available). */
  message: string;
}

const CONTRACT_AVAILABLE: ShiftAvailabilityResult = {
  verdict: 'contract_available',
  isWarning: false,
  message: '',
};

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
 * @param mode          What silence means for this employee. Defaults to the
 *                      strict 'OPT_IN' so an unresolved contract over-warns.
 */
export function evaluateShiftAvailability(
  availability: EmployeeAvailability | null | undefined,
  startTime: string,
  endTime: string,
  mode: AvailabilityMode = 'OPT_IN',
): ShiftAvailabilityResult {
  if (!availability || !availability.hasData) {
    // OPT_OUT: silence is the contract speaking, not an omission.
    if (mode === 'OPT_OUT') return CONTRACT_AVAILABLE;
    return {
      verdict: 'no_availability',
      isWarning: true,
      message:
        'No declared availability on file for this day — unset availability is treated as unavailable.',
    };
  }

  // Warns under BOTH modes. An explicit "unavailable" marker is a positive
  // statement, which is exactly what OPT_OUT requires unavailability to be — so
  // unlike absence, it is never reinterpreted as available.
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
 * manual warning and the auto-scheduler's hard filter agree.
 *
 * No slot for the shift's date ⇒ warning under OPT_IN, contract-available under
 * OPT_OUT. Note that FT profiles hold no slots at all after
 * 20260817120000_ft_availability_removal, so for them this is the ONLY branch
 * that ever runs and passing the right mode is what makes it correct.
 */
export function evaluateShiftAvailabilityFromSlots(
  slots: DeclaredSlot[] | null | undefined,
  shiftDate: string,
  startTime: string,
  endTime: string,
  mode: AvailabilityMode = 'OPT_IN',
): ShiftAvailabilityResult {
  const daySlots = (slots ?? []).filter((s) => s.slot_date === shiftDate);

  if (daySlots.length === 0) {
    if (mode === 'OPT_OUT') return CONTRACT_AVAILABLE;
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
