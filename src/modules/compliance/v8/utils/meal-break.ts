import { V8Shift } from '../types';
import { mealBreakWindow } from '../../shape/evaluate';
import { shiftDurationMinutes } from './time';

/** cl 36.1 — the five hours after which a meal break is owed. */
const MEAL_BREAK_OWED_AFTER_MINUTES = 300;

/** cl 36.1 / Sch 3 §3.2(a), §5.3(a) — the shortest meal break. */
const MEAL_BREAK_MIN_MINUTES = 30;

/**
 * How long a shift's meal break is.
 *
 * The meal break is the break window. Off Security it is unpaid, so
 * `unpaid_break_minutes` is the window's length and answers without it. A
 * Security meal break is paid (Sch 3 §3.2(a), §5.3(a)): its unpaid minutes are
 * 0 and `paid_break_minutes` holds only the cl 37 rest pauses, so only the
 * window can say. A caller that did not hydrate the window is answered from
 * the shape gate's guarantee instead — a shift over five hours cannot be saved
 * without a window of at least 30 minutes (SHAPE_BREAK_WINDOW, and the DB
 * CHECK shifts_shape_break_window) — never from the rest pauses.
 *
 * Mirrors meal_break_minutes in internal.eba_check_assignment.
 */
export function mealBreakMinutes(shift: V8Shift, isSecurity: boolean): number {
    const window = mealBreakWindow(shift.start_time, shift.break_start, shift.break_end);
    if (window) return Math.max(0, window.minutes);
    if (!isSecurity) return shift.unpaid_break_minutes || 0;
    return shiftDurationMinutes(shift.start_time, shift.end_time) > MEAL_BREAK_OWED_AFTER_MINUTES
        ? MEAL_BREAK_MIN_MINUTES
        : 0;
}
