/**
 * Availability Resolution Service
 * 
 * Transforms raw availability rows from the database into resolved,
 * non-overlapping time segments for each profile and date.
 * 
 * Pipeline:
 * 1. Fetch raw availability rows for profile_ids and date range
 * 2. Expand recurring rules into concrete day windows
 * 3. Build daily timelines with priority resolution
 * 4. Produce non-overlapping segments per profile per day
 */

import { format, eachDayOfInterval, parseISO, isWithinInterval, getDay } from 'date-fns';
import {
    RawAvailability,
    AvailabilitySegment,
    ResolvedDayAvailability,
    TimeWindow,
    EmployeeAvailability,
    AvailabilityWindow,
    AVAILABILITY_PRIORITY,
    AvailabilityType,
} from './availabilityResolution.types';

/* ============================================================
   TIME CONVERSION UTILITIES
   ============================================================ */

const MINUTES_IN_DAY = 24 * 60; // 1440

/**
 * Convert "HH:MM" or "HH:MM:SS" to minutes from midnight
 */
export function timeToMinutes(time: string): number {
    const parts = time.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1] || '0', 10);
    return hours * 60 + minutes;
}

/**
 * Convert minutes from midnight to "HH:MM"
 */
export function minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/* ============================================================
   RECURRENCE EXPANSION
   ============================================================ */

/**
 * Parse RFC5545-style recurrence rule
 * Supports: FREQ=DAILY, FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU
 */
interface ParsedRecurrence {
    freq: 'DAILY' | 'WEEKLY';
    byDay?: number[]; // 0=Sunday, 1=Monday, etc.
}

const DAY_MAP: Record<string, number> = {
    SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

function parseRecurrenceRule(rule: string): ParsedRecurrence | null {
    if (!rule) return null;

    const parts = rule.toUpperCase().split(';');
    const result: ParsedRecurrence = { freq: 'DAILY' };

    for (const part of parts) {
        const [key, value] = part.split('=');
        if (key === 'FREQ') {
            if (value === 'WEEKLY') result.freq = 'WEEKLY';
            else if (value === 'DAILY') result.freq = 'DAILY';
        } else if (key === 'BYDAY' && value) {
            result.byDay = value.split(',').map(d => DAY_MAP[d.trim()]).filter(d => d !== undefined);
        }
    }

    return result;
}

/**
 * Check if a date matches the recurrence rule
 */
function doesDateMatchRecurrence(date: Date, rule: ParsedRecurrence): boolean {
    if (rule.freq === 'DAILY') {
        return true;
    }

    if (rule.freq === 'WEEKLY' && rule.byDay) {
        const dayOfWeek = getDay(date); // 0=Sunday
        return rule.byDay.includes(dayOfWeek);
    }

    return true;
}

/* ============================================================
   TIMELINE BUILDING & RESOLUTION
   ============================================================ */

/**
 * Build time windows for a specific date from raw availability rules
 */
function buildTimeWindows(
    rules: RawAvailability[],
    targetDate: Date
): TimeWindow[] {
    const windows: TimeWindow[] = [];
    const targetDateStr = format(targetDate, 'yyyy-MM-dd');

    for (const rule of rules) {
        const ruleStart = parseISO(rule.start_date);
        const ruleEnd = parseISO(rule.end_date);

        // Check if target date is within rule date range
        if (!isWithinInterval(targetDate, { start: ruleStart, end: ruleEnd })) {
            continue;
        }

        // Check recurrence for recurring rules
        if (rule.is_recurring && rule.recurrence_rule) {
            const parsed = parseRecurrenceRule(rule.recurrence_rule);
            if (parsed && !doesDateMatchRecurrence(targetDate, parsed)) {
                continue;
            }
        }

        // Determine time window (null = full day)
        let startMinutes = 0;
        let endMinutes = MINUTES_IN_DAY;

        if (rule.start_time) {
            startMinutes = timeToMinutes(rule.start_time);
        }
        if (rule.end_time) {
            const endMins = timeToMinutes(rule.end_time);
            // Handle "00:00" as end of day
            endMinutes = endMins === 0 ? MINUTES_IN_DAY : endMins;
        }

        windows.push({
            start: startMinutes,
            end: endMinutes,
            type: rule.availability_type,
            priority: AVAILABILITY_PRIORITY[rule.availability_type],
            reason: rule.reason || undefined,
            createdAt: new Date(rule.created_at),
        });
    }

    return windows;
}

/**
 * Resolve overlapping time windows into non-overlapping segments
 * Uses priority order: unavailable > limited > available > preferred
 * For same priority, latest created wins
 */
function resolveOverlaps(windows: TimeWindow[]): AvailabilitySegment[] {
    if (windows.length === 0) {
        return [];
    }

    // Create timeline markers for all window boundaries
    const markers = new Set<number>();
    markers.add(0);
    markers.add(MINUTES_IN_DAY);

    for (const w of windows) {
        markers.add(w.start);
        markers.add(w.end);
    }

    const sortedMarkers = Array.from(markers).sort((a, b) => a - b);
    const segments: AvailabilitySegment[] = [];

    // For each time slice, determine the winning availability
    for (let i = 0; i < sortedMarkers.length - 1; i++) {
        const sliceStart = sortedMarkers[i];
        const sliceEnd = sortedMarkers[i + 1];

        // Find all windows that cover this slice
        const covering = windows.filter(w => w.start <= sliceStart && w.end >= sliceEnd);

        if (covering.length === 0) continue;

        // Sort by priority (desc), then by createdAt (desc) for tie-breaking
        covering.sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return b.createdAt.getTime() - a.createdAt.getTime();
        });

        const winner = covering[0];

        // Merge with previous segment if same type
        const prev = segments[segments.length - 1];
        if (prev && prev.type === winner.type && timeToMinutes(prev.endTime) === sliceStart) {
            prev.endTime = minutesToTime(sliceEnd);
        } else {
            segments.push({
                startTime: minutesToTime(sliceStart),
                endTime: minutesToTime(sliceEnd),
                type: winner.type,
                reason: winner.reason,
            });
        }
    }

    return segments;
}

/* ============================================================
   MAIN RESOLUTION FUNCTION
   ============================================================ */

/**
 * Resolve availability for a single profile on a single date
 */
export function resolveAvailabilityForDay(
    profileId: string,
    date: Date,
    rules: RawAvailability[]
): ResolvedDayAvailability {
    const dateStr = format(date, 'yyyy-MM-dd');

    // Filter rules for this profile
    const profileRules = rules.filter(r => r.profile_id === profileId);

    // Build time windows for this date
    const windows = buildTimeWindows(profileRules, date);

    // If no windows, return empty result
    if (windows.length === 0) {
        return {
            profileId,
            date: dateStr,
            segments: [],
            isFullyAvailable: false,
            isFullyUnavailable: false,
            hasData: false,
        };
    }

    // Resolve overlaps
    const segments = resolveOverlaps(windows);

    // Determine full-day status
    const isFullyAvailable = segments.length === 1
        && segments[0].startTime === '00:00'
        && segments[0].endTime === '24:00'
        && segments[0].type === 'available';

    const isFullyUnavailable = segments.length === 1
        && segments[0].startTime === '00:00'
        && segments[0].endTime === '24:00'
        && segments[0].type === 'unavailable';

    return {
        profileId,
        date: dateStr,
        segments,
        isFullyAvailable,
        isFullyUnavailable,
        hasData: true,
    };
}

/**
 * Resolve availability for multiple profiles across a date range
 * Returns Map<profileId, Map<date, ResolvedDayAvailability>>
 */
export function resolveAvailabilityBatch(
    profileIds: string[],
    startDate: Date,
    endDate: Date,
    rules: RawAvailability[]
): Map<string, Map<string, ResolvedDayAvailability>> {
    const result = new Map<string, Map<string, ResolvedDayAvailability>>();

    // Generate all dates in range
    const dates = eachDayOfInterval({ start: startDate, end: endDate });

    for (const profileId of profileIds) {
        const profileMap = new Map<string, ResolvedDayAvailability>();

        for (const date of dates) {
            const resolved = resolveAvailabilityForDay(profileId, date, rules);
            profileMap.set(resolved.date, resolved);
        }

        result.set(profileId, profileMap);
    }

    return result;
}

/* ============================================================
   UI ADAPTER - Convert to AvailabilityBar format
   ============================================================ */

/**
 * Convert ResolvedDayAvailability to EmployeeAvailability format
 * for use with the existing AvailabilityBar component
 */
export function toEmployeeAvailability(
    resolved: ResolvedDayAvailability
): EmployeeAvailability {
    const availableWindows: AvailabilityWindow[] = [];
    const unavailableWindows: AvailabilityWindow[] = [];

    for (const seg of resolved.segments) {
        const window: AvailabilityWindow = {
            start: seg.startTime,
            end: seg.endTime === '24:00' ? '24:00' : seg.endTime,
        };

        if (seg.type === 'available' || seg.type === 'preferred') {
            availableWindows.push(window);
        } else {
            unavailableWindows.push(window);
        }
    }

    return {
        employeeId: resolved.profileId,
        date: resolved.date,
        availableWindows,
        unavailableWindows,
        isFullyAvailable: resolved.isFullyAvailable,
        isFullyUnavailable: resolved.isFullyUnavailable,
        hasData: resolved.hasData,
    };
}
