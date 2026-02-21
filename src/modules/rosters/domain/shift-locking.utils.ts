import { SYDNEY_TZ, parseZonedDateTime } from '@/modules/core/lib/date.utils';
import { Shift } from '@/modules/rosters/api/shifts.api';

/**
 * Page context for determining lock rules.
 * - 'my_roster': Employee self-service (Drop/Swap). All users. 4-hour lock.
 * - 'roster_management': Manager editing/publishing. Start-time lock.
 */
export type LockContext = 'my_roster' | 'roster_management';

/**
 * Checks if a shift is locked based on the page context.
 * 
 * Rules:
 * - 'my_roster': Locked if shift starts within 4 hours (ALL users).
 * - 'roster_management': Locked if shift has ALREADY started (Managers).
 * 
 * @param shiftDateStr The date string from database (YYYY-MM-DD)
 * @param startTimeStr The time string from database (HH:MM or HH:MM:SS)
 * @param context The page context ('my_roster' | 'roster_management') - Defaults to 'my_roster'
 * @param timezone Timezone identifier (default: SYDNEY_TZ)
 * @returns boolean
 */
export const isShiftLocked = (
    shiftDateStr: string,
    startTimeStr: string,
    context: LockContext = 'my_roster',
    timezone: string = SYDNEY_TZ
): boolean => {
    try {
        const cleanStartTime = startTimeStr.length === 5 ? `${startTimeStr}:00` : startTimeStr;

        // Get absolute timestamp for shift start (interpreted in Target timezone)
        const shiftStartAt = parseZonedDateTime(shiftDateStr, cleanStartTime, timezone);

        // Get absolute current time (UTC)
        const now = new Date();

        // ROSTER MANAGEMENT (Manager View): Locked if start time is in the past
        if (context === 'roster_management') {
            return now >= shiftStartAt;
        }

        // MY ROSTER (Employee Self-Service): Locked if within 4 hours
        // This applies to ALL access levels on this page
        // Difference in hours (Shift Start - Now)
        const diffHours = (shiftStartAt.getTime() - now.getTime()) / (1000 * 60 * 60);

        // DEBUG: Temporary logging to diagnose locking issue
        if (Math.abs(diffHours) < 24) {
            console.log(`[isShiftLocked] Context: ${context} | Shift: ${shiftStartAt.toISOString()} | Now: ${now.toISOString()} | Diff: ${diffHours.toFixed(2)}h | Locked: ${diffHours < 4}`);
        }

        return diffHours < 4;

    } catch (e) {
        console.error('Error checking shift lock status', e);
        return true; // Fail safe: Lock if unsure
    }
};

// Helper for policies
export const canEditShiftPolicy = (shift: Shift): boolean => {
    // Manager view - locked only if shift has started
    return !isShiftLocked(shift.shift_date, shift.start_time, 'roster_management');
};
