/**
 * Team Availability — types.
 *
 * The page is built on SIX concepts, deliberately kept distinct because the
 * scheduling policy ("unset availability = unavailable") makes several of them
 * look identical everywhere else in the app:
 *
 *   REQUIRED   how many people the business needs in an hour
 *   AVAILABLE  how many people COULD work it (declared, not on leave)
 *   CONTRACT   available because their contract says so, with no declaration
 *              expected — the Full-Time population
 *   ASSIGNED   how many are actually rostered on
 *   GAP        required − assigned
 *   UNSET      declared nothing at all, and should have — counts as
 *              unavailable, but is a *management* problem (chase the person),
 *              not a *staffing* one
 *
 * Collapsing UNSET into "unavailable" is what hides the actionable half of the
 * problem: in prod, ~40 of 107 profiles are undeclared on a weekend day, and a
 * manager cannot currently tell "declined this day" from "never told us".
 *
 * CONTRACT exists for the same reason, one layer further out. Full-Time staff
 * hold no availability rows at all by design (20260817120000), so folding them
 * into UNSET would report the entire permanent workforce as a chase-list and
 * subtract all 17 of them from AVAILABLE — a page whose whole purpose is
 * Required vs Available would then understate supply by its most reliable staff.
 *
 * @see docs/architecture/team-availability-page-plan.md
 */

import type { EmployeeAvailability } from '@/modules/rosters/domain/availabilityResolution.types';

// ============================================================================
// PER-PERSON, PER-DAY STATE
// ============================================================================

/**
 * The state of one (employee, day) cell in the team grid.
 *
 * Precedence, highest first — a person on leave who also declared availability
 * is on LEAVE, and a person with an assigned shift is ASSIGNED regardless of
 * what they declared (the shift is the commitment that actually exists).
 */
export type TeamDayState =
    | 'assigned'      // rostered onto at least one shift that day
    | 'leave'         // approved leave covers the day
    | 'available'     // declared one or more available windows
    | 'contract'      // available by contract; a declaration is not expected
    | 'unavailable'   // has declared rules, but no window this day
    | 'unset';        // no availability rules on file at all

export const TEAM_DAY_STATE_ORDER: readonly TeamDayState[] = [
    'assigned',
    'leave',
    'available',
    'contract',
    'unavailable',
    'unset',
] as const;

/** Human labels — also used for the accessible name of each grid cell. */
export const TEAM_DAY_STATE_LABELS: Record<TeamDayState, string> = {
    assigned: 'Assigned',
    leave: 'On leave',
    available: 'Available',
    contract: 'Contract based',
    unavailable: 'Unavailable',
    unset: 'Not declared',
};

export interface TeamDayCell {
    profileId: string;
    /** yyyy-MM-dd */
    date: string;
    state: TeamDayState;
    /** Declared windows for the day, "HH:mm" — empty unless state is available. */
    windows: Array<{ start: string; end: string }>;
    /** Shifts the person is rostered onto that day. */
    shifts: Array<{ id: string; start: string; end: string; roleName: string | null }>;
}

export interface MemberContractInfo {
    roleId: string | null;
    roleName: string | null;
    employmentStatus: string | null;
}

/**
 * The employment token the compliance rules switch on, collapsed from the
 * free-er `employment_status` ('Flexible Part-Time' collapses onto PT).
 *
 * `null` means "we could not tell" and is deliberately NOT treated as CASUAL:
 * the casual branch is the EXEMPTING one, so guessing it would silently drop
 * the ordinary-hours caps for anyone whose contract we failed to read.
 */
export type TeamContractType = 'FT' | 'PT' | 'CASUAL' | null;

export interface TeamMember {
    profileId: string;
    fullName: string;
    avatarUrl?: string;
    roleId: string | null;
    roleName: string | null;
    roleNames?: string[];
    contracts?: MemberContractInfo[];
    departmentId: string | null;
    subDepartmentId: string | null;
    /** 'Casual' | 'Full-Time' | 'Part-Time' — the flexible pool is the casuals. */
    employmentStatus: string | null;
    /** False when the member has no availability_rules rows at all. */
    hasDeclared?: boolean;
    /**
     * Compliance basis — which contract's terms the hours rules are applied
     * against, resolved by `resolveComplianceBasis`. Held SEPARATELY from
     * `employmentStatus`/`roleName` above, which are display and filter fields:
     * 30 of 103 people in production hold several active contracts, and the
     * one the UI labels them with is not necessarily the one that decides
     * whether a rolling cap applies to them.
     */
    contractType?: TeamContractType;
    contractedWeeklyHours?: number;
    /**
     * Holds an active work-limited visa (student / temporary graduate), so
     * their hours carry a legal ceiling this app does not itself enforce.
     */
    hasRestrictedWorkLimit?: boolean;
}

// ============================================================================
// HOURLY COVERAGE
// ============================================================================

/**
 * One (date, hour) bucket of the coverage curve.
 *
 * `gap` is the staffing question (are we short?), `shortfall` is the harder
 * one: how much of that gap CANNOT be closed even by calling in every declared
 * person. A gap with enough available people is a rostering task; a shortfall
 * is a recruitment or availability-chasing task.
 */
export interface CoverageBucket {
    /** yyyy-MM-dd */
    date: string;
    /** 0–23, local venue hour (Australia/Sydney). */
    hour: number;
    required: number;
    available: number;
    assigned: number;
    /** required − assigned. Positive = short, negative = over-rostered. */
    gap: number;
    /** The part of `gap` no declared person can cover. Always >= 0. */
    shortfall: number;
}

/** Which source produced `required`. Surfaced in the UI — never guess silently. */
export type RequiredSource = 'demand' | 'shifts';

export const REQUIRED_SOURCE_LABELS: Record<RequiredSource, string> = {
    demand: 'Forecast demand',
    shifts: 'Planned shifts',
};

// ============================================================================
// SUMMARY
// ============================================================================

export interface TeamAvailabilitySummary {
    memberCount: number;
    /** Total staffed-hours needed across the range (sum of `required`). */
    requiredHours: number;
    /** Total staffed-hours actually rostered (sum of `assigned`). */
    assignedHours: number;
    /** Members with at least one declared window in the range. */
    declaredCount: number;
    /** Members with no availability rules on file at all. */
    unsetCount: number;
    /** Mean distinct members available per weekday / weekend day in range. */
    avgWeekdayAvailable: number;
    avgWeekendAvailable: number;
    /** Buckets where required > assigned. */
    gapHours: number;
    /** Buckets where the gap cannot be closed from declared availability. */
    shortfallHours: number;
    /** Distinct dates containing at least one shortfall bucket. */
    shortfallDays: number;
    requiredSource: RequiredSource;
}

// ============================================================================
// AGGREGATE RESULT
// ============================================================================

export interface TeamAvailabilityData {
    members: TeamMember[];
    /** profileId -> yyyy-MM-dd -> cell */
    cells: Map<string, Map<string, TeamDayCell>>;
    buckets: CoverageBucket[];
    summary: TeamAvailabilitySummary;
    /** yyyy-MM-dd, ascending — the resolved date axis. */
    dates: string[];
}

// ============================================================================
// RAW INPUTS (what the api layer hands the domain layer)
// ============================================================================

export interface RawTeamShift {
    id: string;
    shiftDate: string;             // yyyy-MM-dd
    startTime: string;             // HH:mm
    endTime: string;               // HH:mm
    assignedEmployeeId: string | null;
    roleName: string | null;
    /**
     * PAID minutes — break already deducted. Resolved once at the API edge by
     * `resolveNetMinutes` so no consumer re-derives it from a different column
     * and gets a different answer.
     */
    netMinutes: number;
    /**
     * Provisional roster. Not cosmetic: on 2026-08-12 every one of the 120
     * assigned shifts in production was a draft, so an hours figure that does
     * not carry this states a workload nobody has committed to as fact.
     */
    isDraft: boolean;
    deptName: string | null;
    subDeptName: string | null;
    /**
     * Carried raw as well as folded into `netMinutes`, because the fatigue
     * model works in clock spans and needs the unpaid break separately to know
     * how much of the span was actually on the tools.
     */
    unpaidBreakMinutes: number;
}

export interface RawLeaveDay {
    profileId: string;
    /** yyyy-MM-dd */
    date: string;
}

export interface TeamAvailabilityInputs {
    members: TeamMember[];
    dates: string[];
    /** profileId -> yyyy-MM-dd -> resolved availability (absent = unset). */
    availability: Map<string, Map<string, EmployeeAvailability>>;
    shifts: RawTeamShift[];
    leaveDays: RawLeaveDay[];
    /** date -> hour -> required headcount. Absent entries mean "no demand data". */
    required: Map<string, Map<number, number>> | null;
    requiredSource: RequiredSource;
}

export type { EmployeeAvailability };
