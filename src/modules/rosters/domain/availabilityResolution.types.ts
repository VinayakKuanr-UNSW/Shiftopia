/**
 * Availability Resolution Types
 * 
 * Types for the availability resolution pipeline that transforms
 * raw availability rows into resolved, non-overlapping time segments.
 */

/**
 * Availability type enum matching database enum
 */
export type AvailabilityType = 'available' | 'preferred' | 'limited' | 'unavailable';

/**
 * Priority order for availability resolution
 * Higher number = higher priority (overrides lower)
 */
export const AVAILABILITY_PRIORITY: Record<AvailabilityType, number> = {
    preferred: 1,
    available: 2,
    limited: 3,
    unavailable: 4,
};

/**
 * Raw availability row from database
 */
export interface RawAvailability {
    id: string;
    profile_id: string;
    start_date: string; // "YYYY-MM-DD"
    end_date: string;   // "YYYY-MM-DD"
    start_time: string | null; // "HH:MM:SS" or null for full day
    end_time: string | null;   // "HH:MM:SS" or null for full day
    availability_type: AvailabilityType;
    is_recurring: boolean;
    recurrence_rule: string | null; // RFC5545: "FREQ=WEEKLY;BYDAY=MO,TU,WE"
    reason: string | null;
    created_at: string;
    updated_at: string;
}

/**
 * A single resolved time segment for display
 */
export interface AvailabilitySegment {
    startTime: string; // "HH:MM" (00:00-24:00)
    endTime: string;   // "HH:MM" (00:00-24:00)
    type: AvailabilityType;
    reason?: string;
}

/**
 * Resolved availability for a single day
 */
export interface ResolvedDayAvailability {
    profileId: string;
    date: string; // "YYYY-MM-DD"
    segments: AvailabilitySegment[];
    isFullyAvailable: boolean;
    isFullyUnavailable: boolean;
    hasData: boolean; // false if no availability rules apply
}

/**
 * Time window for internal processing
 */
export interface TimeWindow {
    start: number; // Minutes from midnight (0-1440)
    end: number;   // Minutes from midnight (0-1440)
    type: AvailabilityType;
    priority: number;
    reason?: string;
    createdAt: Date; // For tie-breaking
}

/**
 * Availability window for UI display (simplified)
 */
export interface AvailabilityWindow {
    start: string; // "HH:MM"
    end: string;   // "HH:MM"
}

/**
 * Employee availability for UI components
 * Compatible with existing AvailabilityBar component
 */
export interface EmployeeAvailability {
    employeeId: string;
    date: string;
    availableWindows: AvailabilityWindow[];
    unavailableWindows: AvailabilityWindow[];
    isFullyAvailable: boolean;
    isFullyUnavailable: boolean;
    hasData: boolean;
}
