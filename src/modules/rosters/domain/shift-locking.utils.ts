import { parseZonedDateTime } from '@/modules/core/lib/date.utils';
import { venueZone } from '@/modules/core/lib/venue';

/**
 * Page context for determining lock rules.
 * - 'my_roster': Employee self-service (Drop/Swap). All users. 4-hour lock.
 * - 'roster_management': Manager editing/publishing. Start-time lock.
 */
export type LockContext = 'my_roster' | 'roster_management';

/**
 * Checks if a shift is locked based on the page context.
 * 
 * Rule (both contexts): locked once the shift has started.
 * 
 * @param shiftDateStr The date string from database (YYYY-MM-DD)
 * @param startTimeStr The time string from database (HH:MM or HH:MM:SS)
 * @param context The page context ('my_roster' | 'roster_management') - Defaults to 'my_roster'
 * @param timezone Timezone identifier (default: the active venue's; pass the shift's)
 * @returns boolean
 */
export const isShiftLocked = (
    shiftDateStr: string,
    startTimeStr: string,
    _context: LockContext = 'my_roster',
    timezone: string = venueZone()
): boolean => {
    try {
        const cleanStartTime = startTimeStr.length === 5 ? `${startTimeStr}:00` : startTimeStr;

        // Get absolute timestamp for shift start (interpreted in Target timezone)
        const shiftStartAt = parseZonedDateTime(shiftDateStr, cleanStartTime, timezone);

        // Get absolute current time (UTC)
        const now = new Date();

        // ROSTER MANAGEMENT & MY ROSTER:
        // Locked if shift has ALREADY started. Pre-start agility allows operations right up to start time.
        return now >= shiftStartAt;

    } catch (e) {
        console.error('Error checking shift lock status', e);
        return true; // Fail safe: Lock if unsure
    }
};

/**
 * Checks if a shift has already started based on the current time and the venue's zone.
 */
export const isShiftCommenced = (
    shiftDateStr: string,
    startTimeStr: string,
    timezone: string = venueZone()
): boolean => {
    try {
        const cleanStartTime = startTimeStr.length === 5 ? `${startTimeStr}:00` : startTimeStr;
        const shiftStartAt = parseZonedDateTime(shiftDateStr, cleanStartTime, timezone);
        const now = new Date();
        return now >= shiftStartAt;
    } catch (e) {
        console.error('Error checking if shift commenced', e);
        return false;
    }
};

// Helper for policies
