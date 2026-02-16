import { toZonedTime } from 'date-fns-tz';
import { Shift } from '@/modules/rosters/api/shifts.api';

// Hardcoded timezone as per business rule
const SYDNEY_TZ = 'Australia/Sydney';

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
 * @returns boolean
 */
export const isShiftLocked = (
    shiftDateStr: string,
    startTimeStr: string,
    context: LockContext = 'my_roster'
): boolean => {
    try {
        // 1. Get current time in Sydney
        const now = new Date();

        const sydneyFormatter = new Intl.DateTimeFormat('en-AU', {
            timeZone: SYDNEY_TZ,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        // Get "Now" parts in Sydney
        const parts = sydneyFormatter.formatToParts(now);
        const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value || '00';

        const nowSydneyISO = `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;

        // Shift Start ISO (It is already in "Sydney Local" format in the DB)
        const cleanStartTime = startTimeStr.length === 5 ? `${startTimeStr}:00` : startTimeStr;
        const shiftSydneyISO = `${shiftDateStr}T${cleanStartTime}`;

        // Convert both to timestamps
        const nowTs = new Date(nowSydneyISO + 'Z').getTime();
        const shiftTs = new Date(shiftSydneyISO + 'Z').getTime();

        // ROSTER MANAGEMENT (Manager View): Locked if start time is in the past
        if (context === 'roster_management') {
            return shiftTs <= nowTs;
        }

        // MY ROSTER (Employee Self-Service): Locked if within 4 hours
        // This applies to ALL access levels on this page
        const diffHours = (shiftTs - nowTs) / (1000 * 60 * 60);

        // DEBUG: Temporary logging to diagnose locking issue
        if (context === 'roster_management' || Math.abs(diffHours) < 24) {
            console.log(`[isShiftLocked] Context: ${context} | Shift: ${shiftSydneyISO} | Now: ${nowSydneyISO} | Diff: ${diffHours.toFixed(2)}h | Locked: ${shiftTs <= nowTs}`);
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

