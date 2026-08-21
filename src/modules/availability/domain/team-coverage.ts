/**
 * Team coverage — pure domain logic.
 *
 * No I/O, no React. Everything here is deterministic on its inputs so the
 * Required / Available / Assigned / Gap / Unset model can be tested directly.
 *
 * ── Two different interval semantics, on purpose ────────────────────────────
 *
 * COVERAGE CURVE (this file's buckets) uses OVERLAP: a person counts toward an
 * hour if any part of their declared window falls in it. That is the right
 * question for "how many bodies could be on the floor at 09:00".
 *
 * SHIFT ASSIGNABILITY (`findNearMisses`) uses FULL CONTAINMENT, matching
 * `rosters/domain/availability-check.ts` and the solver's `enforce_availability`
 * hard constraint. A 06:30 shift is NOT assignable to someone available from
 * 07:00, even though both overlap hour 6.
 *
 * Mixing these up is what makes a 30-minute miss read as "totally unavailable".
 */

import type {
    CoverageBucket,
    RawLeaveDay,
    RawTeamShift,
    TeamAvailabilityInputs,
    TeamAvailabilitySummary,
    TeamDayCell,
    TeamDayState,
    TeamMember,
} from '../model/team-availability.types';
import type { EmployeeAvailability } from '@/modules/rosters/domain/availabilityResolution.types';

const MINUTES_PER_DAY = 1440;

/** "HH:mm" | "HH:mm:ss" -> minutes from midnight. */
export function toMinutes(time: string | null | undefined): number {
    if (!time) return 0;
    const [h, m] = time.split(':');
    return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}

/**
 * Normalise an interval to [start, end) in minutes, extending past 1440 when it
 * crosses midnight. An end equal to the start is treated as a full 24 hours
 * (that is how `00:00–00:00` is stored for an all-day declaration).
 */
export function normaliseInterval(start: string, end: string): { from: number; to: number } {
    const from = toMinutes(start);
    let to = toMinutes(end);
    if (to <= from) to += MINUTES_PER_DAY;
    return { from, to };
}

/** Shift a yyyy-MM-dd string by whole days without touching timezones. */
export function addDaysISO(date: string, days: number): string {
    const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
}

/** ISO day-of-week, 1 = Monday … 7 = Sunday. Local date parts, never UTC. */
export function isoDayOfWeek(date: string): number {
    const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
    const dow = new Date(y, m - 1, d).getDay(); // 0 = Sun
    return dow === 0 ? 7 : dow;
}

export function isWeekendISO(date: string): boolean {
    return isoDayOfWeek(date) >= 6;
}

/**
 * Every (date, hour) an interval overlaps, rolling into the next date when it
 * crosses midnight. Returns `[date, hour]` pairs.
 */
export function overlappedHours(
    date: string,
    start: string,
    end: string,
): Array<[string, number]> {
    const { from, to } = normaliseInterval(start, end);
    const out: Array<[string, number]> = [];
    const firstHour = Math.floor(from / 60);
    const lastHour = Math.ceil(to / 60) - 1;
    for (let h = firstHour; h <= lastHour; h++) {
        if (h < 24) out.push([date, h]);
        else out.push([addDaysISO(date, 1), h - 24]);
    }
    return out;
}

/**
 * Is `[shiftStart, shiftEnd)` FULLY contained in one of the declared windows?
 * Mirrors `evaluateShiftAvailability` — kept as a separate local implementation
 * because that one returns a UI verdict and this one is used for ranking.
 */
export function isFullyContained(
    windows: ReadonlyArray<{ start: string; end: string }>,
    shiftStart: string,
    shiftEnd: string,
): boolean {
    const { from: s, to: e } = normaliseInterval(shiftStart, shiftEnd);
    return windows.some((w) => {
        const { from: ws, to: we } = normaliseInterval(w.start, w.end);
        return ws <= s && we >= e;
    });
}

/**
 * How many minutes short of covering `[shiftStart, shiftEnd)` the best declared
 * window is. 0 means fully contained. `Infinity` means no window comes close
 * enough to be meaningful (disjoint).
 *
 * The shortfall is the sum of the uncovered head and tail, so an employee
 * available 07:00–23:00 is "30 short" on a 06:30–14:30 shift.
 */
export function containmentShortfallMinutes(
    windows: ReadonlyArray<{ start: string; end: string }>,
    shiftStart: string,
    shiftEnd: string,
): number {
    if (windows.length === 0) return Infinity;
    const { from: s, to: e } = normaliseInterval(shiftStart, shiftEnd);

    let best = Infinity;
    for (const w of windows) {
        const { from: ws, to: we } = normaliseInterval(w.start, w.end);
        // Disjoint windows tell us nothing useful — skip rather than report a
        // huge number that would pollute the ranking.
        if (we <= s || ws >= e) continue;
        const head = Math.max(0, ws - s);
        const tail = Math.max(0, e - we);
        best = Math.min(best, head + tail);
    }
    return best;
}

// ============================================================================
// CELLS
// ============================================================================

/**
 * Is this member rostered from their contract rather than from a declaration?
 *
 * Reads `contractType` — the COMPLIANCE BASIS resolved by
 * `resolveComplianceBasis`, not the display `employmentStatus` — because 30 of
 * 103 people hold several active contracts and the one the UI labels them with
 * is not necessarily the one that decides their availability model.
 */
function isContractRostered(member: TeamMember): boolean {
    return member.contractType === 'FT';
}

function resolveState(
    member: TeamMember,
    availability: EmployeeAvailability | undefined,
    hasShift: boolean,
    onLeave: boolean,
): TeamDayState {
    if (hasShift) return 'assigned';
    if (onLeave) return 'leave';
    // `getResolvedAvailabilities` omits profiles with no rules entirely, so a
    // missing entry is genuinely "never declared", not "declared nothing today".
    if (!availability || member.hasDeclared === false) {
        // …but for a full-timer "never declared" is the CORRECT and only
        // possible state: their rows were removed by 20260817120000 and the
        // write guard prevents new ones. Reporting them as 'unset' would put the
        // whole permanent workforce on a chase-list that has nothing to chase.
        return isContractRostered(member) ? 'contract' : 'unset';
    }
    if (availability.isFullyUnavailable || availability.availableWindows.length === 0) {
        return 'unavailable';
    }
    return 'available';
}

export function buildTeamDayCells(
    inputs: TeamAvailabilityInputs,
): Map<string, Map<string, TeamDayCell>> {
    const { members, dates, availability, shifts, leaveDays } = inputs;

    const shiftsByProfileDate = new Map<string, RawTeamShift[]>();
    for (const s of shifts) {
        if (!s.assignedEmployeeId) continue;
        const key = `${s.assignedEmployeeId}|${s.shiftDate}`;
        const list = shiftsByProfileDate.get(key) ?? [];
        list.push(s);
        shiftsByProfileDate.set(key, list);
    }

    const leaveSet = new Set<string>(
        leaveDays.map((l: RawLeaveDay) => `${l.profileId}|${l.date}`),
    );

    const out = new Map<string, Map<string, TeamDayCell>>();

    for (const member of members) {
        const byDate = new Map<string, TeamDayCell>();
        const memberAvail = availability.get(member.profileId);

        for (const date of dates) {
            const key = `${member.profileId}|${date}`;
            const dayShifts = shiftsByProfileDate.get(key) ?? [];
            const dayAvail = memberAvail?.get(date);
            const state = resolveState(
                member,
                dayAvail,
                dayShifts.length > 0,
                leaveSet.has(key),
            );

            byDate.set(date, {
                profileId: member.profileId,
                date,
                state,
                windows: dayAvail?.availableWindows ?? [],
                shifts: dayShifts.map((s) => ({
                    id: s.id,
                    start: s.startTime,
                    end: s.endTime,
                    roleName: s.roleName,
                })),
            });
        }
        out.set(member.profileId, byDate);
    }

    return out;
}

// ============================================================================
// COVERAGE BUCKETS
// ============================================================================

/**
 * Required headcount derived from placed shifts: every non-cancelled shift
 * counts toward the hours it overlaps, assigned or not. This is the "planned
 * establishment" fallback used until the demand engine has finalised output —
 * see `team-availability.api.ts`.
 */
export function requiredFromShifts(
    shifts: ReadonlyArray<RawTeamShift>,
    dates: ReadonlyArray<string>,
): Map<string, Map<number, number>> {
    const dateSet = new Set(dates);
    const required = new Map<string, Map<number, number>>();

    for (const s of shifts) {
        for (const [date, hour] of overlappedHours(s.shiftDate, s.startTime, s.endTime)) {
            if (!dateSet.has(date)) continue;
            const byHour = required.get(date) ?? new Map<number, number>();
            byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
            required.set(date, byHour);
        }
    }
    return required;
}

export function buildCoverageBuckets(
    inputs: TeamAvailabilityInputs,
): CoverageBucket[] {
    const { dates, availability, shifts, leaveDays, members } = inputs;
    const dateSet = new Set(dates);
    const memberIds = new Set(members.map((m) => m.profileId));

    const required =
        inputs.required ?? requiredFromShifts(shifts, dates);

    const leaveSet = new Set<string>(leaveDays.map((l) => `${l.profileId}|${l.date}`));

    // (date|hour) -> set of profileIds, so a person with two windows in the
    // same hour is counted once.
    const availableAt = new Map<string, Set<string>>();
    const assignedAt = new Map<string, Set<string>>();

    for (const member of members) {
        const byDate = availability.get(member.profileId);

        // Contract-rostered (Full-Time): available every hour of every date in
        // range except approved leave. They hold no declaration to read, so
        // skipping them the way an undeclared casual is skipped would subtract
        // the entire permanent workforce from AVAILABLE and report a shortfall
        // against the staff most certain to be there.
        //
        // ALL 24 HOURS is the honest answer today: `ordinary_span_start/end` is
        // NULL on every contract in production, and a NULL span means
        // unrestricted (see `OrdinaryHoursEnvelope`). When an envelope is
        // configured this is where it binds — narrow the hour loop to the span
        // and its `days`, and carry those fields on `TeamMember` to do it.
        if (isContractRostered(member)) {
            for (const date of dates) {
                if (leaveSet.has(`${member.profileId}|${date}`)) continue;
                for (let hour = 0; hour < 24; hour++) {
                    const k = `${date}|${hour}`;
                    const set = availableAt.get(k) ?? new Set<string>();
                    set.add(member.profileId);
                    availableAt.set(k, set);
                }
            }
            continue;
        }

        if (!byDate) continue; // unset — contributes nothing to AVAILABLE
        for (const [date, avail] of byDate) {
            if (!dateSet.has(date)) continue;
            if (leaveSet.has(`${member.profileId}|${date}`)) continue; // leave beats declared
            for (const w of avail.availableWindows) {
                for (const [d, h] of overlappedHours(date, w.start, w.end)) {
                    if (!dateSet.has(d)) continue;
                    const k = `${d}|${h}`;
                    const set = availableAt.get(k) ?? new Set<string>();
                    set.add(member.profileId);
                    availableAt.set(k, set);
                }
            }
        }
    }

    for (const s of shifts) {
        if (!s.assignedEmployeeId || !memberIds.has(s.assignedEmployeeId)) continue;
        for (const [d, h] of overlappedHours(s.shiftDate, s.startTime, s.endTime)) {
            if (!dateSet.has(d)) continue;
            const k = `${d}|${h}`;
            const set = assignedAt.get(k) ?? new Set<string>();
            set.add(s.assignedEmployeeId);
            assignedAt.set(k, set);
        }
    }

    const buckets: CoverageBucket[] = [];
    for (const date of dates) {
        for (let hour = 0; hour < 24; hour++) {
            const k = `${date}|${hour}`;
            const availableSet = availableAt.get(k) ?? new Set<string>();
            const assignedSet = assignedAt.get(k) ?? new Set<string>();

            const req = required.get(date)?.get(hour) ?? 0;
            const assigned = assignedSet.size;
            const gap = req - assigned;

            // Spare = declared-available and NOT already rostered this hour.
            // Computed as a set difference rather than `available − assigned`,
            // because a manager can roster someone outside their declared
            // window (the warn-only path), which would make the subtraction
            // negative and understate the shortfall.
            let spare = 0;
            for (const id of availableSet) if (!assignedSet.has(id)) spare++;

            buckets.push({
                date,
                hour,
                required: req,
                available: availableSet.size,
                assigned,
                gap,
                shortfall: Math.max(0, gap - spare),
            });
        }
    }

    return buckets;
}

// ============================================================================
// SUMMARY
// ============================================================================

export function summarise(
    inputs: TeamAvailabilityInputs,
    cells: Map<string, Map<string, TeamDayCell>>,
    buckets: ReadonlyArray<CoverageBucket>,
    /** Reference point for "expiring soon"; yyyy-MM-dd. */
    today: string,
): TeamAvailabilitySummary {
    const { members, dates, requiredSource, availability } = inputs;

    // The chase-list. Contract-rostered staff are excluded because there is
    // nothing to chase: they cannot declare availability, so counting them would
    // make the "Not declared" tile permanently report the full-time headcount as
    // an outstanding action.
    //
    // "Never declared" is read the SAME way `resolveState` reads it — an absent
    // entry in the availability map. `getResolvedAvailabilities` omits any
    // profile with no rules, and its rule probe is scoped, so absence here means
    // "never declared FOR THIS JOB" rather than "never declared at all". That is
    // what makes the tile answer the question the page is filtered to.
    //
    // It used to test `m.hasDeclared === false` alone. Nothing populates
    // `hasDeclared` — `getTeamMembers` does not return it and no other producer
    // sets it — so the predicate was false for every member and the tile read a
    // permanent ZERO. A count that is always zero looks like good news, which is
    // why it survived: an empty chase-list is indistinguishable from a finished
    // one. `hasDeclared` is still honoured when a caller does set it (the domain
    // tests do), it is simply no longer the only signal.
    const neverDeclared = (m: TeamMember): boolean =>
        m.hasDeclared === false || !availability.get(m.profileId);

    const unsetCount = members.filter(
        (m) => neverDeclared(m) && !isContractRostered(m),
    ).length;

    // 'contract' counts here. The tile reads "N/M declared" against
    // `memberCount`, so excluding full-timers from the numerator while leaving
    // them in the denominator would show a coverage figure that can never reach
    // 100% and looks like a data-quality problem.
    let declaredCount = 0;
    for (const member of members) {
        const byDate = cells.get(member.profileId);
        if (!byDate) continue;
        for (const date of dates) {
            const state = byDate.get(date)?.state;
            if (state === 'available' || state === 'contract') {
                declaredCount++;
                break;
            }
        }
    }

    // Mean distinct members available per day, split weekday / weekend — the
    // split is the finding: prod runs ~66 weekday vs ~40 weekend.
    let weekdayDays = 0;
    let weekendDays = 0;
    let weekdayTotal = 0;
    let weekendTotal = 0;
    for (const date of dates) {
        let n = 0;
        for (const member of members) {
            // 'contract' is availability — see `buildCoverageBuckets`. Omitting
            // it is what made the weekday/weekend split read as a supply crisis.
            const state = cells.get(member.profileId)?.get(date)?.state;
            if (state === 'available' || state === 'contract') n++;
        }
        if (isWeekendISO(date)) {
            weekendDays++;
            weekendTotal += n;
        } else {
            weekdayDays++;
            weekdayTotal += n;
        }
    }

    const gapHours = buckets.filter((b) => b.gap > 0).length;
    const shortfallBuckets = buckets.filter((b) => b.shortfall > 0);
    const shortfallDays = new Set(shortfallBuckets.map((b) => b.date)).size;

    const round1 = (n: number) => Math.round(n * 10) / 10;

    // Buckets are one hour wide, so a headcount sum IS a staffed-hours total.
    let requiredHours = 0;
    let assignedHours = 0;
    for (const b of buckets) {
        requiredHours += b.required;
        assignedHours += b.assigned;
    }

    return {
        memberCount: members.length,
        requiredHours,
        assignedHours,
        declaredCount,
        unsetCount,
        avgWeekdayAvailable: weekdayDays > 0 ? round1(weekdayTotal / weekdayDays) : 0,
        avgWeekendAvailable: weekendDays > 0 ? round1(weekendTotal / weekendDays) : 0,
        gapHours,
        shortfallHours: shortfallBuckets.length,
        shortfallDays,
        requiredSource,
    };
}

// ============================================================================
// NEAR-MISS DETECTOR
// ============================================================================

export interface NearMiss {
    shiftId: string;
    shiftDate: string;
    shiftStart: string;
    shiftEnd: string;
    roleName: string | null;
    profileId: string;
    memberName: string;
    /** The member's declared windows that day. */
    windows: Array<{ start: string; end: string }>;
    /** Minutes by which the best window fails to contain the shift. */
    shortfallMinutes: number;
}

/**
 * For every UNFILLED shift, find members who declared availability that day but
 * fall just short of full containment.
 *
 * Because assignability requires full containment, a 30-minute miss is reported
 * everywhere else in the app identically to "not available at all". This turns
 * those into a ranked call list.
 *
 * @param maxShortfallMinutes  Ignore misses wider than this (default 60).
 */
export function findNearMisses(
    inputs: TeamAvailabilityInputs,
    cells: Map<string, Map<string, TeamDayCell>>,
    maxShortfallMinutes = 60,
): NearMiss[] {
    const byId = new Map(inputs.members.map((m) => [m.profileId, m]));
    const out: NearMiss[] = [];

    for (const shift of inputs.shifts) {
        if (shift.assignedEmployeeId) continue; // only unfilled shifts need a call list

        for (const member of inputs.members) {
            const cell = cells.get(member.profileId)?.get(shift.shiftDate);
            if (!cell) continue;
            // Already committed elsewhere, or off — not a call candidate.
            //
            // 'contract' is excluded DELIBERATELY, and it is not an oversight to
            // fix later: a near miss is someone whose declared window falls just
            // short of containing the shift. A full-timer has no window and is
            // available for the whole day, so they are not a near miss — they are
            // an outright candidate, which is the auto-scheduler's business.
            // Listing them here would bury the genuine 30-minute misses this
            // panel exists to surface.
            if (cell.state !== 'available') continue;
            if (isFullyContained(cell.windows, shift.startTime, shift.endTime)) continue;

            const shortfallMinutes = containmentShortfallMinutes(
                cell.windows,
                shift.startTime,
                shift.endTime,
            );
            if (!Number.isFinite(shortfallMinutes)) continue;
            if (shortfallMinutes > maxShortfallMinutes) continue;

            out.push({
                shiftId: shift.id,
                shiftDate: shift.shiftDate,
                shiftStart: shift.startTime,
                shiftEnd: shift.endTime,
                roleName: shift.roleName,
                profileId: member.profileId,
                memberName: byId.get(member.profileId)?.fullName ?? 'Unknown',
                windows: cell.windows,
                shortfallMinutes,
            });
        }
    }

    return out.sort(
        (a, b) =>
            a.shortfallMinutes - b.shortfallMinutes ||
            a.shiftDate.localeCompare(b.shiftDate) ||
            a.memberName.localeCompare(b.memberName),
    );
}
