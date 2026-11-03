import { V8Shift } from '../types';
import { mealBreakWindow, breakSpanMinutes } from '../../shape/evaluate';
import { shiftDurationMinutes } from './time';

/** cl 36.1 — the five hours after which a meal break is owed. */
const MEAL_BREAK_OWED_AFTER_MINUTES = 300;

/** cl 36.1 / Sch 3 §3.2(a), §5.3(a) — the shortest meal break. */
const MEAL_BREAK_MIN_MINUTES = 30;

/**
 * How long a shift's meal break is.
 *
 * Sums all scheduled break windows in `unpaid_breaks` when present, falling
 * back to `break_start`–`break_end`, then `unpaid_break_minutes` off Security,
 * and finally the 30-minute Schedule 3 floor on unhydrated Security shifts >5h.
 *
 * Mirrors meal_break_minutes in internal.eba_check_assignment.
 */
export function mealBreakMinutes(shift: V8Shift, isSecurity: boolean): number {
    if (Array.isArray(shift.unpaid_breaks) && shift.unpaid_breaks.length > 0) {
        let total = 0;
        let anyValid = false;
        for (const b of shift.unpaid_breaks) {
            const span = breakSpanMinutes(b.start, b.end);
            if (span !== null && span > 0) {
                total += span;
                anyValid = true;
            }
        }
        if (anyValid) return total;
    }
    const window = mealBreakWindow(shift.start_time, shift.break_start, shift.break_end);
    if (window) return Math.max(0, window.minutes);
    if (!isSecurity) return shift.unpaid_break_minutes || 0;
    return shiftDurationMinutes(shift.start_time, shift.end_time) > MEAL_BREAK_OWED_AFTER_MINUTES
        ? MEAL_BREAK_MIN_MINUTES
        : 0;
}
