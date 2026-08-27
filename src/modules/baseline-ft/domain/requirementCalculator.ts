/**
 * Baseline FT — what the contract owes, per anchored work cycle.
 *
 * THE CYCLE IS NOT THE ROSTER PERIOD. cl 35.x(a) caps a work cycle; the roster
 * period is an unrelated calendar a manager picks. A period of 15 Jul – 15 Aug
 * against a four-week cycle anchored on 2024-01-01 straddles two cycles, and
 * each is capped on its own. Producing one number for the period would silently
 * average across a boundary, which is the exact defect `ordinary-hours-cycle.ts`
 * was written to end — so this module returns one requirement PER CYCLE and
 * never a total.
 *
 * CONSUMPTION IS EMPLOYEE-WIDE, GENERATION IS SUB-DEPARTMENT-SCOPED. An
 * employee's contractual limit is a property of the person, not of the roster
 * being edited. Hours they already work in another sub-department count against
 * the same 152h, so `existingShifts` must be the whole schedule. Only the
 * shifts we GENERATE are confined to the selected sub-department.
 */

import {
    cycleBoundsFor,
    cycleCeilingHours,
    cycleIndexFor,
    toEpochDay,
    fromEpochDay,
} from '@/modules/compliance/ordinary-hours-cycle';
import type {
    CycleRequirement,
    EmployeeContractFacts,
    ExistingShift,
    Finding,
    IsoWeekday,
    LeaveDay,
} from './types';

/** cl 35.x(a) — the weekly basis the ladder is built from. */
export const DEFAULT_WEEKLY_HOURS = 38;

export interface RequirementInput {
    facts: EmployeeContractFacts;
    /** Roster period, inclusive, `yyyy-MM-dd`. */
    periodStart: string;
    periodEnd: string;
    /** EVERY shift the employee holds in the window, any sub-department. */
    existingShifts: readonly ExistingShift[];
    leaveDays: readonly LeaveDay[];
    /** `yyyy-MM-dd` dates that are public holidays in the relevant jurisdiction. */
    publicHolidays: readonly string[];
    /**
     * Net ORDINARY HOURS the pattern rosters on each weekday it covers — the
     * evidence for cl 56.4's "would ordinarily be rostered", and the measure of
     * what that day discharges.
     *
     * Hours rather than a bare weekday list because cl 56.4 pays "the ordinary
     * hours of work for that day". A four-day pattern of 9.5h days discharges
     * 9.5h when a public holiday lands on one of them, not the 7.6h a weekly
     * average would imply.
     */
    patternHoursByWeekday: ReadonlyMap<IsoWeekday, number>;
}

export interface RequirementResult {
    cycles: CycleRequirement[];
    findings: Finding[];
}

/** ISO weekday (1=Mon … 7=Sun) for a `yyyy-MM-dd` date, via UTC to avoid zone drift. */
export function isoWeekdayOf(dateISO: string): IsoWeekday {
    // 1970-01-01 was a Thursday, so epoch day 0 ≡ ISO weekday 4.
    const d = toEpochDay(dateISO);
    return ((((d + 3) % 7) + 7) % 7 + 1) as IsoWeekday;
}

/** Inclusive list of dates between two `yyyy-MM-dd` bounds. Empty if reversed. */
export function datesBetween(startISO: string, endISO: string): string[] {
    const a = toEpochDay(startISO);
    const b = toEpochDay(endISO);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
    const out: string[] = [];
    for (let d = a; d <= b; d++) out.push(fromEpochDay(d));
    return out;
}

/** Latest start / earliest end of two inclusive ranges, or null when disjoint. */
function intersect(
    aStart: string, aEnd: string, bStart: string, bEnd: string,
): { start: string; end: string } | null {
    const s = toEpochDay(aStart) >= toEpochDay(bStart) ? aStart : bStart;
    const e = toEpochDay(aEnd) <= toEpochDay(bEnd) ? aEnd : bEnd;
    return toEpochDay(s) <= toEpochDay(e) ? { start: s, end: e } : null;
}

function countDays(startISO: string, endISO: string): number {
    const n = toEpochDay(endISO) - toEpochDay(startISO) + 1;
    return n > 0 ? n : 0;
}

/**
 * Compute the per-cycle requirement and the deficit remaining after everything
 * already on the books.
 */
export function computeCycleRequirements(input: RequirementInput): RequirementResult {
    const { facts, periodStart, periodEnd, existingShifts, leaveDays, publicHolidays } = input;
    const findings: Finding[] = [];

    const weeklyHours = facts.contractedWeeklyHours ?? DEFAULT_WEEKLY_HOURS;
    if (facts.contractedWeeklyHours === undefined) {
        findings.push({
            severity: 'WARNING',
            code: 'BFT_WEEKLY_HOURS_DEFAULTED',
            plain:
                `This employee's contract records no weekly hours, so ${DEFAULT_WEEKLY_HOURS}h ` +
                `has been assumed. Set the contracted hours to remove the assumption.`,
            clause: 'ICC EBA cl 35.1(a)',
            overridable: true,
            employeeId: facts.employeeId,
            calculation: { assumed_weekly_hours: DEFAULT_WEEKLY_HOURS },
        });
    }

    // The contract's life, clipped to the roster period. Everything below is
    // computed inside this window and nowhere else.
    const contractEnd = facts.contractEnd ?? periodEnd;
    const active = intersect(facts.contractStart, contractEnd, periodStart, periodEnd);
    if (!active) {
        findings.push({
            severity: 'INFO',
            code: 'BFT_CONTRACT_OUTSIDE_PERIOD',
            plain: 'This contract is not active at any point in the selected period.',
            overridable: false,
            employeeId: facts.employeeId,
            calculation: {
                contract_start: facts.contractStart,
                contract_end: facts.contractEnd,
                period_start: periodStart,
                period_end: periodEnd,
            },
        });
        return { cycles: [], findings };
    }

    // ── Index leave and holidays for O(1) lookup, keeping determinism ────────
    //
    // Approved leave binds. Pending leave does NOT reduce the requirement — it
    // is not a decision — but it is surfaced later against any candidate that
    // lands on it, so a manager is not asked to approve leave and a shift for
    // the same day without noticing.
    const approvedLeave = new Map<string, LeaveDay>();
    const pendingLeaveDates = new Set<string>();
    for (const l of leaveDays) {
        if (l.status === 'approved') {
            // A date with two approved leave rows credits once, not twice.
            if (!approvedLeave.has(l.date)) approvedLeave.set(l.date, l);
        } else {
            pendingLeaveDates.add(l.date);
        }
    }

    const holidaySet = new Set(publicHolidays);
    const patternHours = input.patternHoursByWeekday;

    const hasElection = [...approvedLeave.values()].some(l => l.credit === 'ELECTION');
    if (hasElection) {
        const types = [...new Set(
            [...approvedLeave.values()].filter(l => l.credit === 'ELECTION').map(l => l.leaveType),
        )].sort();
        findings.push({
            severity: 'WARNING',
            code: 'BFT_LEAVE_ELECTION_UNRESOLVED',
            plain:
                `This employee has ${types.join(' and ')} leave, which the Agreement lets them take ` +
                `either as paid annual leave or as unpaid leave. We do not record which they chose, ` +
                `so both readings are shown — confirm the election before applying.`,
            clause: 'ICC EBA cl 55.1 / cl 58.2',
            overridable: true,
            employeeId: facts.employeeId,
            calculation: { leave_types: types },
        });
    }

    // ── Walk each cycle the active window touches ────────────────────────────
    const lo = cycleIndexFor(active.start, facts.cycleAnchor, facts.cycleWeeks);
    const hi = cycleIndexFor(active.end, facts.cycleAnchor, facts.cycleWeeks);
    const cycleDays = facts.cycleWeeks * 7;
    const ceiling = cycleCeilingHours(facts.cycleWeeks, weeklyHours);

    const cycles: CycleRequirement[] = [];

    for (let idx = lo; idx <= hi; idx++) {
        // A representative date inside this cycle, used only to ask for bounds.
        const probe = fromEpochDay(toEpochDay(facts.cycleAnchor) + idx * cycleDays);
        const bounds = cycleBoundsFor(probe, facts.cycleAnchor, facts.cycleWeeks);

        const within = intersect(bounds.start, bounds.endInclusive, active.start, active.end);
        if (!within) continue;

        const activeDays = countDays(within.start, within.end);
        const requiredHours = (ceiling * activeDays) / cycleDays;

        // Existing consumption — every sub-department, as above. Counted over
        // the WHOLE cycle, not just the active window: hours worked earlier in
        // the cycle still fill the same ceiling.
        let existingHours = 0;
        for (const s of existingShifts) {
            if (s.date >= bounds.start && s.date <= bounds.endInclusive) {
                existingHours += s.netMinutes / 60;
            }
        }

        // ── Credits. Each DATE credits at most once. ─────────────────────────
        //
        // That single rule is what makes cl 44.8 fall out correctly: annual
        // leave is "exclusive of any public holidays", so a public holiday
        // inside an annual-leave period is paid as a public holiday and does
        // not also consume a leave day. Either way the employee is discharged
        // for that day exactly once, which is what crediting once expresses.
        let paidLeaveHours = 0;
        let electionHours = 0;
        let publicHolidayCreditHours = 0;
        const blockedDates: string[] = [];

        for (const date of datesBetween(within.start, within.end)) {
            const leave = approvedLeave.get(date);
            if (leave) {
                blockedDates.push(date);              // absent either way
                if (leave.credit === 'CREDITS') {
                    paidLeaveHours += leave.creditHours;
                } else if (leave.credit === 'ELECTION') {
                    electionHours += leave.creditHours;
                }
                // 'BLOCKS' — cl 57.5: unpaid leave suspends the exchange
                // rather than discharging it, so nothing is credited and the
                // shortfall surfaces as a visible variance.
                continue;
            }

            // cl 56.4 — a non-casual not required to work a public holiday they
            // would ORDINARILY be rostered on is paid at ordinary rate for that
            // day's ordinary hours. The pattern is the evidence of "ordinarily":
            // it is the declared normal week, and it is fixed before the
            // generator runs, so using it breaks the circularity of asking the
            // roster we are about to build.
            const phHours = holidaySet.has(date) ? patternHours.get(isoWeekdayOf(date)) : undefined;
            if (phHours !== undefined) {
                publicHolidayCreditHours += phHours;
                blockedDates.push(date);
            }
        }

        // PRIMARY reading treats an unresolved election as CREDITING, which
        // yields the SMALLER deficit and therefore generates FEWER shifts.
        // That is the safe direction: under-rostering shows up as a variance a
        // human can see and correct, whereas over-rostering is a breach of the
        // cycle cap that only surfaces after the fact.
        const deficitHours = Math.max(
            0,
            requiredHours - existingHours - paidLeaveHours - electionHours - publicHolidayCreditHours,
        );
        const deficitHoursIfElectionUnpaid = Math.max(
            0,
            requiredHours - existingHours - paidLeaveHours - publicHolidayCreditHours,
        );

        cycles.push({
            cycleIndex: idx,
            start: bounds.start,
            endInclusive: bounds.endInclusive,
            ceilingHours: ceiling,
            activeDays,
            cycleDays,
            requiredHours,
            existingHours,
            paidLeaveHours: paidLeaveHours + electionHours,
            publicHolidayCreditHours,
            blockedDates,
            deficitHours,
            deficitHoursIfElectionUnpaid,
        });

        // Over the cap before we have proposed anything — an existing problem
        // this run surfaced, not one it created. Reported, never "fixed":
        // deleting a shift is outside this feature's authority.
        if (existingHours > ceiling + 1 / 60) {
            findings.push({
                severity: 'WARNING',
                code: 'BFT_ALREADY_OVER_CYCLE_CAP',
                plain:
                    `This employee is already rostered ${existingHours.toFixed(1)}h between ` +
                    `${bounds.start} and ${bounds.endInclusive}, above the ${ceiling.toFixed(1)}h ` +
                    `ordinary-hours ceiling for a ${facts.cycleWeeks}-week cycle. No baseline ` +
                    `shifts are proposed for this cycle.`,
                clause: 'ICC EBA cl 35.1(a)',
                overridable: true,
                employeeId: facts.employeeId,
                calculation: {
                    existing_hours: existingHours,
                    ceiling_hours: ceiling,
                    cycle_start: bounds.start,
                    cycle_end: bounds.endInclusive,
                },
            });
        }
    }

    // Pending leave overlapping the period, surfaced once per employee.
    const pendingInPeriod = [...pendingLeaveDates]
        .filter(d => d >= active.start && d <= active.end)
        .sort();
    if (pendingInPeriod.length > 0) {
        findings.push({
            severity: 'WARNING',
            code: 'BFT_PENDING_LEAVE_IN_PERIOD',
            plain:
                `This employee has ${pendingInPeriod.length} day(s) of leave still awaiting a ` +
                `decision in this period. Pending leave does not reduce their required hours, so ` +
                `shifts may be proposed on those days.`,
            overridable: true,
            employeeId: facts.employeeId,
            calculation: { pending_dates: pendingInPeriod },
        });
    }

    return { cycles, findings };
}
