/**
 * Office — reading a full-time team's world, and the cycles a copy is checked
 * against.
 *
 *   loadOfficeWorld — I/O. Contracts, existing shifts, leave, public holidays,
 *                     once per team and period.
 *   copyCyclesFor   — PURE. One employee's cl 35.1(a) cycles over that world.
 *
 * This module used to carry a pattern-based proposal pipeline — per-employee
 * weekly patterns turned into candidate shifts, admitted through V8 and written
 * by an Apply step. The screen that edited patterns was removed, Apply had no
 * caller, and the copy flow (the one live consumer) always passed no patterns.
 * What it needed from all of that was the cycle arithmetic, which is all that
 * remains.
 */

import {
    cycleBoundsFor,
    toEpochDay,
    fromEpochDay,
} from '@/modules/compliance/ordinary-hours-cycle';

import {
    attachLeaveCredit,
    computeCycleRequirements,
    contractHoursByWeekday,
    isoWeekdayOf,
} from '../domain/requirementCalculator';
import type {
    CycleRequirement,
    ExistingShift,
    Finding,
    RawLeaveDay,
} from '../domain/types';

import {
    loadEligibleEmployees,
    loadExistingShifts,
    loadLeaveDays,
    loadPublicHolidays,
    type EligibleEmployee,
} from './office.loaders';

/* ────────────────────────────────────────────────────────────────────────────
   1. The world
   ──────────────────────────────────────────────────────────────────────────── */

export interface OfficeWorld {
    employees: EligibleEmployee[];
    shiftsByEmployee: Map<string, ExistingShift[]>;
    /** Without credit hours — those are resolved per employee. See `attachLeaveCredit`. */
    leaveByEmployee: Map<string, RawLeaveDay[]>;
    publicHolidays: string[];
    findings: Finding[];
}

/**
 * Widen a date window to cover the WHOLE cycles it touches.
 *
 * Consumption must be counted over complete cycles: hours worked earlier in a
 * cycle fill the same ceiling as hours inside the roster period, so reading
 * only the period would understate what the employee has already done and
 * over-roster them. Reading extra days can only ever make the count more
 * complete, so widening is always the safe direction.
 */
export function widenToCycles(
    periodStart: string,
    periodEnd: string,
    anchors: ReadonlyArray<{ anchor: string; weeks: number }>,
): { from: string; to: string } {
    let from = toEpochDay(periodStart);
    let to = toEpochDay(periodEnd);
    for (const { anchor, weeks } of anchors) {
        const lo = cycleBoundsFor(periodStart, anchor, weeks);
        const hi = cycleBoundsFor(periodEnd, anchor, weeks);
        from = Math.min(from, toEpochDay(lo.start));
        to = Math.max(to, toEpochDay(hi.endInclusive));
    }
    return { from: fromEpochDay(from), to: fromEpochDay(to) };
}

/**
 * Everything the cycle arithmetic needs, read once for a team and a period.
 *
 * Employees are resolved FIRST because their declared cycles determine how far
 * the shift and leave reads have to be widened; the rest is then one parallel
 * round trip.
 */
export async function loadOfficeWorld(args: {
    subDepartmentId: string;
    periodStart: string;
    periodEnd: string;
}): Promise<OfficeWorld> {
    const { subDepartmentId, periodStart, periodEnd } = args;

    const { employees, findings } =
        await loadEligibleEmployees(subDepartmentId, periodStart, periodEnd);

    if (employees.length === 0) {
        return {
            employees: [], shiftsByEmployee: new Map(), leaveByEmployee: new Map(),
            publicHolidays: [], findings,
        };
    }

    const employeeIds = employees.map(e => e.facts.employeeId);
    const window = widenToCycles(periodStart, periodEnd,
        employees.map(e => ({ anchor: e.facts.cycleAnchor, weeks: e.facts.cycleWeeks })));

    const [shiftsByEmployee, leaveByEmployee, publicHolidays] = await Promise.all([
        loadExistingShifts(employeeIds, window.from, window.to),
        loadLeaveDays(employeeIds, window.from, window.to),
        loadPublicHolidays(window.from, window.to),
    ]);

    return { employees, shiftsByEmployee, leaveByEmployee, publicHolidays, findings };
}

/* ────────────────────────────────────────────────────────────────────────────
   2. One employee's cycles — PURE
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The cl 35.1(a) cycles a copy range falls in, for one employee: what the
 * contract owes per cycle, what is already rostered, and the leave and
 * public-holiday credit against it.
 *
 * `null` when the employee is not one of this team's full-time employees, so
 * there is no cycle to read. Credit hours come from the CONTRACT, spread over
 * Monday–Friday (see `contractHoursByWeekday`).
 */
export function copyCyclesFor(
    world: OfficeWorld,
    employeeId: string,
    periodStart: string,
    periodEnd: string,
): CycleRequirement[] | null {
    const employee = world.employees.find(e => e.facts.employeeId === employeeId);
    if (!employee) return null;

    const hoursByWeekday = contractHoursByWeekday(employee.facts.contractedWeeklyHours);
    const { cycles } = computeCycleRequirements({
        facts: employee.facts,
        periodStart,
        periodEnd,
        existingShifts: world.shiftsByEmployee.get(employeeId) ?? [],
        leaveDays: attachLeaveCredit(world.leaveByEmployee.get(employeeId) ?? [], hoursByWeekday, isoWeekdayOf),
        publicHolidays: world.publicHolidays,
        patternHoursByWeekday: hoursByWeekday,
    });
    return cycles;
}
