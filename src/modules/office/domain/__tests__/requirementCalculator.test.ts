/**
 * The requirement calculator is where the averaging bug would live if it lived
 * anywhere. cl 35.x(a) caps a CYCLE; a roster period is an unrelated calendar a
 * manager picks. These pin the three things most likely to go wrong: that a
 * period straddling a cycle boundary produces two independently-capped
 * requirements rather than one averaged total, that a contract active for part
 * of a cycle is pro-rated by DAY rather than rounded to a week, and that leave
 * and public holidays each discharge a day exactly once.
 */
import { describe, expect, it } from 'vitest';
import { computeCycleRequirements, isoWeekdayOf } from '../requirementCalculator';
import type { EmployeeContractFacts, ExistingShift, IsoWeekday, LeaveDay } from '../types';

const ANCHOR = '2024-01-01';   // a Monday, the shared cycle epoch

const FACTS: EmployeeContractFacts = {
    employeeId: 'emp-1',
    userContractId: 'uc-1',
    contractedWeeklyHours: 38,
    cycleWeeks: 4,
    cycleAnchor: ANCHOR,
    contractStart: '2020-01-01',
    contractEnd: null,
    roleId: 'role-1',
    subDepartmentId: 'sub-1',
};

/** Mon–Fri at 7.6h — the compliant full-time week. */
const MON_FRI: ReadonlyMap<IsoWeekday, number> = new Map([[1, 7.6], [2, 7.6], [3, 7.6], [4, 7.6], [5, 7.6]]);

function shift(date: string, netMinutes = 456, subDept = 'sub-1'): ExistingShift {
    return {
        id: `s-${date}-${subDept}`,
        date,
        startTime: '08:00',
        endTime: '16:06',
        netMinutes,
        subDepartmentId: subDept,
        rosterPublishedOrLocked: false,
    };
}

function base(over: Partial<Parameters<typeof computeCycleRequirements>[0]> = {}) {
    return computeCycleRequirements({
        facts: FACTS,
        periodStart: '2024-07-15',
        periodEnd: '2024-08-15',
        existingShifts: [],
        leaveDays: [],
        publicHolidays: [],
        patternHoursByWeekday: MON_FRI,
        ...over,
    });
}

describe('cycle windowing', () => {
    it('splits a period that straddles a cycle boundary into two capped cycles', () => {
        // 2024-07-15 is exactly 196 days after the anchor — 7 whole four-week
        // cycles — so it opens cycle 7. The period runs into cycle 8.
        const { cycles } = base();

        expect(cycles).toHaveLength(2);

        expect(cycles[0]).toMatchObject({
            cycleIndex: 7,
            start: '2024-07-15',
            endInclusive: '2024-08-11',
            activeDays: 28,
            cycleDays: 28,
            ceilingHours: 152,
            requiredHours: 152,
        });

        // Cycle 8 opens 2024-08-12 but the period ends on the 15th, so only
        // four of its days are in scope: 152 x 4/28.
        expect(cycles[1]).toMatchObject({
            cycleIndex: 8,
            start: '2024-08-12',
            endInclusive: '2024-09-08',
            activeDays: 4,
        });
        expect(cycles[1].requiredHours).toBeCloseTo((152 * 4) / 28, 6);
    });

    it('never sums the two cycles into a single period requirement', () => {
        // The guard against the averaging bug: 152 + 21.7 is NOT a cap that
        // exists anywhere in the Agreement, and no caller should be able to
        // read one off this result.
        const { cycles } = base();
        expect(cycles.every(c => c.requiredHours <= c.ceilingHours + 1e-9)).toBe(true);
    });

    it('pro-rates by day when a contract starts mid-cycle', () => {
        // Starts on the 22nd — 7 days into cycle 7, leaving 21 of its 28 days.
        const { cycles } = base({
            facts: { ...FACTS, contractStart: '2024-07-22' },
        });

        expect(cycles[0]).toMatchObject({ cycleIndex: 7, activeDays: 21 });
        expect(cycles[0].requiredHours).toBeCloseTo((152 * 21) / 28, 6);
    });

    it('pro-rates by day when a contract ends mid-cycle', () => {
        const { cycles } = base({
            facts: { ...FACTS, contractEnd: '2024-07-21' },
        });

        expect(cycles).toHaveLength(1);
        expect(cycles[0]).toMatchObject({ cycleIndex: 7, activeDays: 7 });
        expect(cycles[0].requiredHours).toBeCloseTo((152 * 7) / 28, 6);
    });

    it('reports nothing when the contract never overlaps the period', () => {
        const { cycles, findings } = base({
            facts: { ...FACTS, contractStart: '2025-01-01' },
        });

        expect(cycles).toEqual([]);
        expect(findings.some(f => f.code === 'BFT_CONTRACT_OUTSIDE_PERIOD')).toBe(true);
    });

    it('scales the ceiling with the declared cycle length', () => {
        const { cycles } = base({
            facts: { ...FACTS, cycleWeeks: 2 },
            periodStart: '2024-07-15',
            periodEnd: '2024-07-28',
        });

        expect(cycles).toHaveLength(1);
        expect(cycles[0]).toMatchObject({ cycleDays: 14, ceilingHours: 76 });
    });
});

describe('consumption', () => {
    it('counts existing hours from EVERY sub-department, not just the one being rostered', () => {
        // The contractual limit is a property of the person. Hours worked in
        // another sub-department fill the same 152h ceiling, so ignoring them
        // would over-roster the employee.
        const { cycles } = base({
            existingShifts: [
                shift('2024-07-16', 456, 'sub-1'),
                shift('2024-07-17', 456, 'sub-OTHER'),
            ],
        });

        expect(cycles[0].existingHours).toBeCloseTo(15.2, 6);
        expect(cycles[0].deficitHours).toBeCloseTo(152 - 15.2, 6);
    });

    it('counts hours from the whole cycle, including days before the period opens', () => {
        // Cycle 7 opens on the 15th and the period opens with it here, so use a
        // period that starts later than the cycle to prove the distinction.
        const { cycles } = base({
            periodStart: '2024-07-29',
            periodEnd: '2024-08-11',
            existingShifts: [shift('2024-07-16')],   // in the cycle, before the period
        });

        expect(cycles[0].existingHours).toBeCloseTo(7.6, 6);
    });

    it('warns when the employee is already over the cycle cap and proposes nothing', () => {
        const many = Array.from({ length: 21 }, (_, i) => {
            const day = String(15 + i).padStart(2, '0');
            return shift(i < 17 ? `2024-07-${day}` : `2024-08-0${i - 16}`, 480);
        });

        const { cycles, findings } = base({ existingShifts: many });

        expect(cycles[0].existingHours).toBeGreaterThan(152);
        expect(cycles[0].deficitHours).toBe(0);
        expect(findings.some(f => f.code === 'BFT_ALREADY_OVER_CYCLE_CAP')).toBe(true);
    });
});

describe('leave', () => {
    const leave = (date: string, credit: LeaveDay['credit'], type = 'annual'): LeaveDay => ({
        date, leaveType: type, credit, creditHours: 7.6, status: 'approved',
    });

    it('credits paid leave against the requirement and blocks the day', () => {
        const { cycles } = base({ leaveDays: [leave('2024-07-16', 'CREDITS')] });

        expect(cycles[0].paidLeaveHours).toBeCloseTo(7.6, 6);
        expect(cycles[0].deficitHours).toBeCloseTo(152 - 7.6, 6);
        expect(cycles[0].blockedDates).toContain('2024-07-16');
    });

    it('blocks unpaid leave WITHOUT crediting it — cl 57.5 suspends, it does not discharge', () => {
        const { cycles } = base({ leaveDays: [leave('2024-07-16', 'BLOCKS', 'unpaid')] });

        expect(cycles[0].paidLeaveHours).toBe(0);
        expect(cycles[0].deficitHours).toBeCloseTo(152, 6);   // still owed in full
        expect(cycles[0].blockedDates).toContain('2024-07-16');
    });

    it('reports BOTH readings of an unresolved election rather than guessing', () => {
        // cl 55.1 / 58.2 let the Team Member take these as paid annual leave OR
        // as unpaid leave, and we do not record which. Guessing either way would
        // be inventing a fact.
        const { cycles, findings } = base({
            leaveDays: [leave('2024-07-16', 'ELECTION', 'religious_cultural')],
        });

        expect(cycles[0].deficitHours).toBeCloseTo(152 - 7.6, 6);          // as paid
        expect(cycles[0].deficitHoursIfElectionUnpaid).toBeCloseTo(152, 6); // as unpaid
        expect(findings.some(f => f.code === 'BFT_LEAVE_ELECTION_UNRESOLVED')).toBe(true);
    });

    it('does not let pending leave reduce the requirement, but does surface it', () => {
        const { cycles, findings } = base({
            leaveDays: [{ ...leave('2024-07-16', 'CREDITS'), status: 'pending' }],
        });

        expect(cycles[0].paidLeaveHours).toBe(0);
        expect(cycles[0].blockedDates).not.toContain('2024-07-16');
        expect(findings.some(f => f.code === 'BFT_PENDING_LEAVE_IN_PERIOD')).toBe(true);
    });

    it('credits a date once even when two approved leave rows cover it', () => {
        const { cycles } = base({
            leaveDays: [leave('2024-07-16', 'CREDITS'), leave('2024-07-16', 'CREDITS', 'personal')],
        });

        expect(cycles[0].paidLeaveHours).toBeCloseTo(7.6, 6);
    });
});

describe('public holidays — cl 56.4', () => {
    it('credits a holiday falling on a day the pattern rosters', () => {
        // 2024-08-05 is a Monday, which MON_FRI rosters.
        expect(isoWeekdayOf('2024-08-05')).toBe(1);

        const { cycles } = base({ publicHolidays: ['2024-08-05'] });

        expect(cycles[0].publicHolidayCreditHours).toBeCloseTo(7.6, 6);
        expect(cycles[0].blockedDates).toContain('2024-08-05');
        expect(cycles[0].deficitHours).toBeCloseTo(152 - 7.6, 6);
    });

    it('ignores a holiday on a day the pattern does not roster', () => {
        // 2024-08-04 is a Sunday — not in MON_FRI, so the employee would not
        // "ordinarily be rostered" and cl 56.4 does not engage.
        expect(isoWeekdayOf('2024-08-04')).toBe(7);

        const { cycles } = base({ publicHolidays: ['2024-08-04'] });

        expect(cycles[0].publicHolidayCreditHours).toBe(0);
        expect(cycles[0].deficitHours).toBeCloseTo(152, 6);
    });

    it('credits that day\'s own pattern hours, not a weekly average', () => {
        // A four-day pattern of 9.5h days. cl 56.4 pays "the ordinary hours of
        // work for that day", so a holiday on one of them discharges 9.5h —
        // not the 7.6h that 38 / 5 would suggest.
        const fourDay: ReadonlyMap<IsoWeekday, number> = new Map([[1, 9.5], [2, 9.5], [3, 9.5], [4, 9.5]]);

        const { cycles } = base({ publicHolidays: ['2024-08-05'], patternHoursByWeekday: fourDay });

        expect(cycles[0].publicHolidayCreditHours).toBeCloseTo(9.5, 6);
    });

    it('does not double-credit a holiday that falls inside approved annual leave (cl 44.8)', () => {
        // Annual leave is "exclusive of any public holidays", so the day is
        // discharged exactly once however it is characterised.
        const { cycles } = base({
            publicHolidays: ['2024-08-05'],
            leaveDays: [{
                date: '2024-08-05', leaveType: 'annual', credit: 'CREDITS',
                creditHours: 7.6, status: 'approved',
            }],
        });

        const totalCredit = cycles[0].paidLeaveHours + cycles[0].publicHolidayCreditHours;
        expect(totalCredit).toBeCloseTo(7.6, 6);
        expect(cycles[0].deficitHours).toBeCloseTo(152 - 7.6, 6);
    });
});

describe('data gaps', () => {
    it('defaults missing contracted hours to 38 and says so', () => {
        const { cycles, findings } = base({
            facts: { ...FACTS, contractedWeeklyHours: undefined },
        });

        expect(cycles[0].ceilingHours).toBe(152);
        const warn = findings.find(f => f.code === 'BFT_WEEKLY_HOURS_DEFAULTED');
        expect(warn?.severity).toBe('WARNING');
        expect(warn?.overridable).toBe(true);
    });
});
