/**
 * Timesheet Status State Machine
 * 
 * Flow:
 * DRAFT -> SUBMITTED
 * SUBMITTED -> APPROVED | REJECTED
 * REJECTED -> DRAFT
 * APPROVED -> LOCKED
 */



/**
 * Legacy TimesheetRow / UI Entry
 */
export interface TimesheetRow {
    id: string | number;
    // Update IDs
    groupId?: string | number;
    subGroupId?: string | number;

    date: Date | string;
    // Employee Info
    employeeId: string;
    employee: string;
    // Hierarchy 1
    organization: string;
    department: string;
    subDepartment: string;
    // Hierarchy 2
    group: string;
    subGroup: string;
    role: string;
    remunerationLevel: string;
    /** The shift's stored level as a number (0 = Introductory). */
    remunerationLevelNumber?: number | null;
    // Scheduled
    scheduledStart: string;
    scheduledEnd: string;
    // Geofenced
    clockIn: string;
    clockOut: string;
    // Adjusted (editable)
    adjustedStart: string;
    adjustedEnd: string;
    /**
     * true  → manager has explicitly saved a custom time (stored in timesheets.start_time)
     * false → auto-snapped from Actual (or fell back to Scheduled). Display dimmed.
     */
    isAdjustedManual: boolean;
    adjustedStartSource?: 'manual' | 'snapped' | 'auto' | null;
    adjustedEndSource?: 'manual' | 'snapped' | 'auto' | null;
    /** manager billable/break edit count (F7) — drives the 📝 badge */
    editCount?: number;
    /** optimistic-lock row version at load time (F18); passed back as a CAS guard */
    version?: number | null;
    /** manager-selected reasons when billable varies from roster (per side) */
    arrivalVarianceReason?: string | null;
    departureVarianceReason?: string | null;
    length: string; // Auto-calculated
    paidBreak: string;
    unpaidBreak: string;
    rosteredBreakStart?: string | null;
    rosteredBreakEnd?: string | null;
    actualBreakStart?: string | null;
    actualBreakEnd?: string | null;
    breakVarianceMinutes?: number | null;
    hasBreakVarianceFlag?: boolean;
    netLength: string; // Auto-calculated
    /** Raw minutes behind `netLength` (already EBA-floored). */
    netLengthMinutes?: number;
    // Differential
    differential: string; // Scheduled vs Adjusted (financial) difference
    // Statuses
    liveStatus: 'Completed' | 'Cancelled' | 'Active' | 'No-Show' | 'Swapped' | string;
    timesheetStatus: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | string;
    // Attendance (from shifts.attendance_status)
    attendanceStatus?: string | null;
    attendanceNote?: string | null;
    varianceMinutes?: number | null;
    clockInVarianceMinutes?: number | null;
    clockOutVarianceMinutes?: number | null;
    // Minutes delta: adjusted_start vs actual_start (positive = adjusted later than actual)
    adjustedVarianceMinutes?: number | null;
    // Manager notes
    notes?: string | null;
    rejectedReason?: string | null;

    // Raw fields for internal UI logic (indicators)
    rawActualStart?: string | null;
    rawActualEnd?: string | null;
    rawStartAt?: string | null;
    rawEndAt?: string | null;
    groupType?: 'convention_centre' | 'exhibition_centre' | 'theatre' | string | null;

    // EBA minimum-engagement floor (F-locked 2026-07-28) — automatic, no
    // manager override. See src/modules/timesheets/domain/billable-time.ts.
    /** Training-shift flag — drives the 2h EBA tier instead of 3h/4h. */
    isTraining?: boolean;
    /** True when netLength was raised to the EBA minimum-engagement floor. */
    wasToppedUpToMinEngagement?: boolean;
    /** The EBA minimum (minutes) that applied, or null when it doesn't (no-show/cancelled). */
    requiredEngagementMinutes?: number | null;
    /** Raw `profiles.employment_type` — feeds the min-engagement floor and pay-estimate calls. */
    employmentType?: string | null;
    /** Role name (lowercased) includes 'security' — selects the Security Sch 3 pay tiers. */
    isSecurityRole?: boolean;
}


