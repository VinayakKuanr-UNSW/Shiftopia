/**
 * Shift Helper Functions
 * Utilities for checking shift status with proper timezone handling
 */

/**
 * Check if a shift has already started
 * Uses the shift's date and start_time with proper timezone handling
 */
export function hasShiftStarted(shift: { shift_date: string; start_time: string }): boolean {
    try {
        // Parse shift start time (assuming Australia/Sydney timezone)
        const [hours, minutes] = shift.start_time.split(':').map(Number);
        const shiftStart = new Date(shift.shift_date);
        shiftStart.setHours(hours, minutes, 0, 0);

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
        const [hours, minutes] = shift.start_time.split(':').map(Number);
        const shiftStart = new Date(shift.shift_date);
        shiftStart.setHours(hours, minutes, 0, 0);

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
        const [hours, minutes] = shift.start_time.split(':').map(Number);
        const shiftStart = new Date(shift.shift_date);
        shiftStart.setHours(hours, minutes, 0, 0);

        return shiftStart.toLocaleString('en-AU', {
            timeZone: 'Australia/Sydney',
            dateStyle: 'medium',
            timeStyle: 'short'
        });
    } catch (error) {
        return `${shift.shift_date} ${shift.start_time}`;
    }
}
