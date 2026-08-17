/**
 * Hours and hours-compliance for the Availability Manager.
 *
 * Moved here from `insights/model/grid-compliance.ts` when the Annual Shift
 * Grid was folded into this page. The casual exemption and the
 * contracted-hours basis below are the fix that stopped that grid painting a
 * wall of false violations; they are load-bearing and their rationale is kept
 * verbatim.
 *
 * ── Part 1: resolving paid minutes ──────────────────────────────────────────
 *
 * `net_length_minutes` IS the answer. It is written on every shift and is
 * non-null on all 336 rows in production. Everything below it is a guard, not
 * a strategy — the column is `is_nullable: YES` with no default in the schema,
 * so the invariant is one the app maintains rather than one Postgres enforces.
 *
 * ONLY THE UNPAID PORTION COMES OFF. `break_minutes` is the whole break and
 * `paid_break_minutes` is the part that stays paid — the rest pause is paid
 * time. Production is uniform on this: every row is
 * `break_minutes = 45 = paid 15 + unpaid 30`, and
 * `net = scheduled − unpaid_break_minutes` holds on all 336 rows while
 * `net = scheduled − break_minutes` holds on NONE of them. Deducting
 * `break_minutes` understates every derived shift by the paid rest pause,
 * which is what the Annual Shift Grid did.
 *
 * One resolver, called once at the API edge, so no second call site can derive
 * a different number for the same day.
 *
 * @see docs/architecture/availability-manager-grid-merge-plan.md §2
 */

import { getISOWeek, getISOWeekYear, parseISO } from 'date-fns';
import { calculateMinutesBetweenTimes } from '@/modules/rosters/domain/shift.entity';
import type {
    RawTeamShift,
    TeamContractType,
    TeamMember,
} from '../model/team-availability.types';

export interface NetMinutesInput {
    net_length_minutes?: number | null;
    scheduled_length_minutes?: number | null;
    /** The part of the break that is NOT paid. The only part deducted. */
    unpaid_break_minutes?: number | null;
    start_time?: string | null;
    end_time?: string | null;
}

const positiveOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
};

/** Paid minutes for one shift row. Never negative. */
export function resolveNetMinutes(shift: NetMinutesInput): number {
    const net = positiveOrNull(shift.net_length_minutes);
    if (net !== null) return net;

    // Below here only runs if the app's invariant broke. `start_time` and
    // `end_time` are the schema's only NOT NULL duration columns, so the last
    // rung is the one that cannot itself go missing.
    const unpaidBreak = positiveOrNull(shift.unpaid_break_minutes) ?? 0;

    const scheduled = positiveOrNull(shift.scheduled_length_minutes);
    if (scheduled !== null) return Math.max(0, scheduled - unpaidBreak);

    if (shift.start_time && shift.end_time) {
        // Shared helper — it handles the overnight wrap.
        const gross = calculateMinutesBetweenTimes(shift.start_time, shift.end_time);
        if (Number.isFinite(gross) && gross > 0) return Math.max(0, gross - unpaidBreak);
    }

    return 0;
}

// ============================================================================
// PART 2: ISO WEEK KEYS
// ============================================================================

/**
 * A week is keyed `2026-W33`, not by its bare ISO week number.
 *
 * The Annual Shift Grid keyed on the number because it only ever rendered one
 * calendar year, so numbers could not repeat and sorting them ascending was
 * also sorting them chronologically. Neither holds here. This page's fetch
 * window is a visible range plus a three-week lookback, so every range in late
 * December or early January spans two ISO years — and `[1, 2, 52, 53]` sorted
 * ascending puts January BEFORE the previous December. The rolling-window
 * sweep walks that array summing adjacent entries, so a bare-number key would
 * silently average non-adjacent weeks across the new year.
 *
 * `yyyy-Www` sorts lexicographically in true chronological order, which is the
 * property the sweep actually depends on.
 */
export function isoWeekKey(date: Date): string {
    return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, '0')}`;
}

/** Same, from a `yyyy-MM-dd` string. Parsed as LOCAL midnight, never UTC. */
export function isoWeekKeyFromISO(date: string): string {
    return isoWeekKey(parseISO(date));
}

/** `2026-W33` -> `W33`, for a column header with no room for the year. */
export function shortWeekLabel(key: string): string {
    return key.slice(key.indexOf('-') + 1);
}

// ============================================================================
// PART 3: COMPLIANCE
// ============================================================================

export interface ShiftHours {
    id: string;
    netHours: number;
    isDraft: boolean;
    roleName?: string | null;
    deptName?: string | null;
    subDeptName?: string | null;
}

export type CompV8Severity = 'violation' | 'warning' | 'ok';

export interface WindowViolation {
    weeks: 2 | 3 | 4;
    hours: number;
    limit: number;
    severity: CompV8Severity;
}

export interface WeekComp {
    weekHours: number;
    windows: WindowViolation[];
    worstV8Severity: CompV8Severity;
}

export interface EmpComp {
    overallV8Severity: CompV8Severity;
    worstDesc: string;
    /** Keyed `yyyy-Www`. */
    weeks: Record<string, WeekComp>;
    dailyViolations: Set<string>;
    dailyWarnings: Set<string>;
}

// ── EBA constants ────────────────────────────────────────────────────────────

export const EBA_WEEKLY_LIMIT = 38;   // h/week — default weekly basis (fallback)
export const DAILY_CAP_HARD = 12;     // h — violation
export const DAILY_CAP_SOFT = 10;     // h — warning
export const NEAR_LIMIT_RATIO = 0.90; // 90 % of limit triggers warning badge

export const ROLLING_WINDOWS = [
    { weeks: 2 as const, days: 14 },
    { weeks: 3 as const, days: 21 },
    { weeks: 4 as const, days: 28 },
] as const;

/**
 * Per-employee hours compliance.
 *
 * IMPORTANT — casual exemption. This mirrors the canonical v8 rule in
 * `compliance/v8/rules/ordinary-hours-avg.ts`, which EXEMPTS casuals from the
 * ordinary-hours averaging (rolling-window) caps:
 *     if (employee.contract_type === 'CASUAL') return [];
 * and uses the employee's `contracted_weekly_hours` (falling back to 38) as the
 * weekly basis rather than a flat 38.
 *
 * Applying the rolling caps to casuals paints a wall of false "VIOLATION"
 * badges for schedules that every gate which actually created them treats as
 * compliant. Casuals therefore get NO rolling-window badges, and rolling
 * windows never drive their overall severity. Daily caps (12h hard / 10h soft)
 * still apply to EVERYONE.
 *
 * Unknown/null contract types (someone we could not read a contract for) KEEP
 * the rolling checks — conservative, so we do not hide potential issues.
 *
 * `sortedWeekKeys` must be ASCENDING and CONTIGUOUS: the sweep treats adjacent
 * entries as adjacent weeks. Pass the WIDENED week set, not the visible one —
 * a 4-week window ending in the first visible week reaches three weeks behind
 * it, and computing it from the visible weeks alone reports a passing average
 * for a breaching one.
 */
export function computeEmpComp(
    byWeek: Record<string, number>,
    byDate: Record<string, ShiftHours[]>,
    sortedWeekKeys: string[],
    contractType: TeamContractType,
    contractedWeeklyHours?: number,
): EmpComp {
    const isCasual = contractType === 'CASUAL';
    const weeklyLimit = contractedWeeklyHours && contractedWeeklyHours > 0
        ? contractedWeeklyHours
        : EBA_WEEKLY_LIMIT;

    // 1. Daily cap checks (apply to everyone, including casuals)
    const dailyViolations = new Set<string>();
    const dailyWarnings = new Set<string>();
    for (const [date, shifts] of Object.entries(byDate)) {
        const hours = shifts.reduce((sum, s) => sum + s.netHours, 0);
        if (hours > DAILY_CAP_HARD) dailyViolations.add(date);
        else if (hours > DAILY_CAP_SOFT) dailyWarnings.add(date);
    }

    // 2. Per-week entries
    const weekComps: Record<string, WeekComp> = {};
    for (const key of sortedWeekKeys) {
        weekComps[key] = { weekHours: byWeek[key] || 0, windows: [], worstV8Severity: 'ok' };
    }

    // 3. Bubble daily cap severity into its week
    for (const date of dailyViolations) {
        const key = isoWeekKeyFromISO(date);
        if (weekComps[key]) weekComps[key].worstV8Severity = 'violation';
    }
    for (const date of dailyWarnings) {
        const key = isoWeekKeyFromISO(date);
        if (weekComps[key] && weekComps[key].worstV8Severity === 'ok')
            weekComps[key].worstV8Severity = 'warning';
    }

    // 4. Rolling-window checks. Casuals are EXEMPT — skip entirely.
    if (!isCasual) {
        for (const win of ROLLING_WINDOWS) {
            const limit = weeklyLimit * win.weeks;
            const warnLimit = limit * NEAR_LIMIT_RATIO;

            for (let endIdx = win.weeks - 1; endIdx < sortedWeekKeys.length; endIdx++) {
                let sum = 0;
                for (let i = endIdx - win.weeks + 1; i <= endIdx; i++) {
                    sum += byWeek[sortedWeekKeys[i]] || 0;
                }
                if (sum <= warnLimit) continue;

                const severity: CompV8Severity = sum > limit ? 'violation' : 'warning';
                const endKey = sortedWeekKeys[endIdx];
                if (!weekComps[endKey]) continue;

                const existing = weekComps[endKey].windows.find(w => w.weeks === win.weeks);
                if (existing) {
                    if (sum > existing.hours) {
                        existing.hours = parseFloat(sum.toFixed(1));
                        existing.severity = severity;
                    }
                } else {
                    weekComps[endKey].windows.push({
                        weeks: win.weeks,
                        hours: parseFloat(sum.toFixed(1)),
                        limit,
                        severity,
                    });
                }

                if (severity === 'violation') {
                    weekComps[endKey].worstV8Severity = 'violation';
                } else if (severity === 'warning' && weekComps[endKey].worstV8Severity === 'ok') {
                    weekComps[endKey].worstV8Severity = 'warning';
                }
            }
        }
    }

    // 5. Derive overall severity + description
    let overallV8Severity: CompV8Severity = 'ok';
    let worstDesc = 'All checks passed';

    for (const comp of Object.values(weekComps)) {
        for (const win of comp.windows) {
            if (win.severity === 'violation' && overallV8Severity !== 'violation') {
                overallV8Severity = 'violation';
                worstDesc = `${win.hours}h in ${win.weeks}w window (limit ${win.limit}h)`;
            } else if (win.severity === 'warning' && overallV8Severity === 'ok') {
                overallV8Severity = 'warning';
                worstDesc = `Near limit: ${win.hours}h in ${win.weeks}w window`;
            }
        }
    }
    if (dailyViolations.size > 0 && overallV8Severity !== 'violation') {
        overallV8Severity = 'violation';
        worstDesc = `Daily cap exceeded on ${dailyViolations.size} day(s) (>${DAILY_CAP_HARD}h)`;
    } else if (dailyWarnings.size > 0 && overallV8Severity === 'ok') {
        overallV8Severity = 'warning';
        worstDesc = `Near daily cap on ${dailyWarnings.size} day(s) (>${DAILY_CAP_SOFT}h)`;
    }

    return { overallV8Severity, worstDesc, weeks: weekComps, dailyViolations, dailyWarnings };
}

// ============================================================================
// PART 4: AGGREGATION
// ============================================================================

export interface EmployeeHours {
    /** yyyy-MM-dd -> the shifts worked that day. */
    byDate: Record<string, ShiftHours[]>;
    /** yyyy-Www -> total paid hours in that week. */
    byWeek: Record<string, number>;
    /** Dates carrying at least one draft shift. */
    draftDates: Set<string>;
    /** Paid hours from draft shifts only — the caveat on every total above. */
    draftHours: number;
    totalHours: number;
}

export interface TeamHoursFold {
    /** profileId -> their hours. Members with no shifts get an empty entry. */
    byProfile: Map<string, EmployeeHours>;
    /** ASCENDING, CONTIGUOUS week keys spanning the fetched range. */
    sortedWeekKeys: string[];
    /**
     * Shifts assigned to somebody who is not a member of the current scope.
     *
     * The Annual Shift Grid added these people as extra rows, invented from the
     * shift's own profile join. This page's rows come from active contracts, so
     * instead of a silently missing row the page reports the count — a person
     * holding shifts with no active contract in scope is a lead, not noise.
     */
    orphanShiftCount: number;
    orphanProfileIds: Set<string>;
}

const emptyHours = (): EmployeeHours => ({
    byDate: {},
    byWeek: {},
    draftDates: new Set(),
    draftHours: 0,
    totalHours: 0,
});

/**
 * Fold the widened shift set into per-employee daily and weekly hours.
 *
 * `sortedWeekKeys` is derived from the RANGE, not from the shifts, so a week
 * nobody worked is still present as a zero. The rolling-window sweep steps
 * through this array assuming adjacency; a gap where a quiet week should be
 * would make a 4-week window silently span five.
 */
export function buildHoursByEmployee(
    shifts: readonly RawTeamShift[],
    members: readonly Pick<TeamMember, 'profileId'>[],
    range: { start: Date; end: Date },
): TeamHoursFold {
    const byProfile = new Map<string, EmployeeHours>();
    for (const member of members) byProfile.set(member.profileId, emptyHours());

    const orphanProfileIds = new Set<string>();
    let orphanShiftCount = 0;

    for (const shift of shifts) {
        const profileId = shift.assignedEmployeeId;
        if (!profileId) continue; // unassigned — it is demand, not someone's hours

        const entry = byProfile.get(profileId);
        if (!entry) {
            orphanProfileIds.add(profileId);
            orphanShiftCount += 1;
            continue;
        }

        const hours = Math.max(0, shift.netMinutes / 60);
        const weekKey = isoWeekKeyFromISO(shift.shiftDate);

        (entry.byDate[shift.shiftDate] ??= []).push({
            id: shift.id,
            netHours: hours,
            isDraft: shift.isDraft,
            roleName: shift.roleName,
            deptName: shift.deptName,
            subDeptName: shift.subDeptName,
        });

        entry.byWeek[weekKey] = (entry.byWeek[weekKey] ?? 0) + hours;
        entry.totalHours += hours;
        if (shift.isDraft) {
            entry.draftDates.add(shift.shiftDate);
            entry.draftHours += hours;
        }
    }

    return {
        byProfile,
        sortedWeekKeys: weekKeysInRange(range.start, range.end),
        orphanShiftCount,
        orphanProfileIds,
    };
}

/** Every ISO week touched by [start, end], ascending and contiguous. */
export function weekKeysInRange(start: Date, end: Date): string[] {
    const keys: string[] = [];
    const seen = new Set<string>();
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());

    while (cursor <= last) {
        const key = isoWeekKey(cursor);
        if (!seen.has(key)) {
            seen.add(key);
            keys.push(key);
        }
        cursor.setDate(cursor.getDate() + 7);
    }

    // Stepping by 7 can skip the final partial week when the range does not end
    // on the same weekday it started.
    const endKey = isoWeekKey(last);
    if (!seen.has(endKey)) keys.push(endKey);

    return keys;
}

// ============================================================================
// PART 5: WEEK COLUMNS
// ============================================================================

export interface WeekColumn {
    /** yyyy-Www */
    key: string;
    /** `W33` — what the header prints. */
    label: string;
    /** The dates of this week that are ON SCREEN, ascending. */
    visibleDates: string[];
    /**
     * Fewer than 7 of the week's days are visible.
     *
     * The total shown is still the TRUE full-week figure — the fetch spans
     * whole ISO weeks precisely so it can be — so this flags a column whose
     * number is deliberately not the sum of the cells beside it.
     */
    isPartial: boolean;
}

/**
 * Group the visible date axis into ISO weeks, in order.
 *
 * Driven by the VISIBLE dates: this decides where a total column is drawn and
 * which cells sit to its left. What the column CONTAINS comes from the widened
 * fold, which is why a partial week can still show a true total.
 */
export function buildWeekColumns(dates: readonly string[]): WeekColumn[] {
    const byKey = new Map<string, string[]>();

    for (const date of dates) {
        const key = isoWeekKeyFromISO(date);
        const list = byKey.get(key);
        if (list) list.push(date);
        else byKey.set(key, [date]);
    }

    return [...byKey.entries()].map(([key, visibleDates]) => ({
        key,
        label: shortWeekLabel(key),
        visibleDates,
        isPartial: visibleDates.length < 7,
    }));
}
