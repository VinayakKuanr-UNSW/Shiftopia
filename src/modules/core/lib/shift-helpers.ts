/**
 * Shift Helper Functions
 * Utilities for checking shift status with proper timezone handling
 */
import { parseZonedDateTime, formatInTimezone, SYDNEY_TZ } from './date.utils';

/**
 * Check if a shift has already started
 * Uses the shift's date and start_time with proper timezone handling
 */
export function hasShiftStarted(shift: { shift_date: string; start_time: string }): boolean {
    try {
        // Parse shift start time (assuming Australia/Sydney timezone)
        // Australia/Sydney wall-clock instant — independent of the viewer's browser tz.
        const shiftStart = parseZonedDateTime(shift.shift_date, shift.start_time, SYDNEY_TZ);

        const now = new Date();
        return shiftStart <= now;
    } catch (error) {
        console.error('Error checking if shift started:', error);
        return false; // Fail safe - don't block if we can't determine
    }
}

/**
 * Get hours until shift starts
 * Returns negative if shift has already started
 */
export function getHoursUntilShift(shift: { shift_date: string; start_time: string }): number {
    try {
        // Australia/Sydney wall-clock instant — independent of the viewer's browser tz.
        const shiftStart = parseZonedDateTime(shift.shift_date, shift.start_time, SYDNEY_TZ);

        const now = new Date();
        const diffMs = shiftStart.getTime() - now.getTime();
        return diffMs / (1000 * 60 * 60);
    } catch (error) {
        console.error('Error calculating hours until shift:', error);
        return 0;
    }
}

/**
 * Format shift start time for display
 */
export function formatShiftStart(shift: { shift_date: string; start_time: string }): string {
    try {
        // Australia/Sydney wall-clock instant — independent of the viewer's browser tz.
        const shiftStart = parseZonedDateTime(shift.shift_date, shift.start_time, SYDNEY_TZ);
        return formatInTimezone(shiftStart, SYDNEY_TZ, 'd MMM yyyy, h:mm a');
    } catch (error) {
        return `${shift.shift_date} ${shift.start_time}`;
    }
}
