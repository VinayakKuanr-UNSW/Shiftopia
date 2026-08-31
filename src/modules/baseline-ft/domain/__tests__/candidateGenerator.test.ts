/**
 * The generator's defining behaviour is what it REFUSES to do. When the
 * remaining deficit is smaller than the next pattern day it stops and reports
 * the remainder, because cl 35.1(c) makes a short full-time day unlawful rather
 * than merely undesirable — a 24-minute shift is not a smaller lawful shift,
 * it is an unlawful one. These pin that, and the determinism the idempotency
 * guarantee rests on.
 */
import { describe, expect, it } from 'vitest';
import { buildIdempotencyKey, generateCandidates, type RunScope } from '../candidateGenerator';
import type {
    BaselinePattern, CycleRequirement, EmployeeContractFacts, ExistingShift, IsoWeekday, PatternSlot,
} from '../types';

const ROLE = 'role-1';

const SCOPE: RunScope = {
    subDepartmentId: 'sub-1',
    periodStart: '2024-07-15',
    periodEnd: '2024-08-11',
};

const FACTS: EmployeeContractFacts = {
    employeeId: 'emp-1',
    userContractId: 'uc-1',
    contractedWeeklyHours: 38,
    cycleWeeks: 4,
    cycleAnchor: '2024-01-01',
    contractStart: '2020-01-01',
    contractEnd: null,
    roleId: ROLE,
    subDepartmentId: 'sub-1',
};

function slot(day: IsoWeekday, netMinutes: number, sortOrder = day): PatternSlot {
    return {
        sourceSlotId: `ts-${day}`,
        dayOfWeek: day,
        startTime: '08:00',
        endTime: '16:06',
        unpaidBreakMinutes: 30,
        paidBreakMinutes: 15,
        netMinutes,
        roleId: ROLE,
        sortOrder,
    };
}

/** Mon–Fri at the given net minutes per day. */
function weekPattern(netMinutes: number): BaselinePattern {
    return {
        employeeId: 'emp-1',
        userContractId: 'uc-1',
        subDepartmentId: 'sub-1',
        slots: ([1, 2, 3, 4, 5] as IsoWeekday[]).map(d => slot(d, netMinutes)),
    };
}

function cycle(deficitHours: number, over: Partial<CycleRequirement> = {}): CycleRequirement {
    return {
        cycleIndex: 7,
        start: '2024-07-15',
        endInclusive: '2024-08-11',
        ceilingHours: 152,
        activeDays: 28,
        cycleDays: 28,
        requiredHours: 152,
        existingHours: 152 - deficitHours,
        paidLeaveHours: 0,
        publicHolidayCreditHours: 0,
        blockedDates: [],
        deficitHours,
        deficitHoursIfElectionUnpaid: deficitHours,
        ...over,
    };
}

function run(over: Partial<Parameters<typeof generateCandidates>[0]> = {}) {
    return generateCandidates({
        facts: FACTS,
        pattern: weekPattern(456),        // 7.6h days
        cycles: [cycle(152)],
        existingShifts: [],
        periodStart: '2024-07-15',
        periodEnd: '2024-08-11',
        scope: SCOPE,
        ...over,
    });
}

describe('the honest variance', () => {
    it('proposes three 8h days for a 24h 24m deficit and reports 24m, never a fourth shift', () => {
        // The example from the design. An 8.0h pattern is used deliberately to
        // reproduce it exactly; the pattern gate is what rejects such a pattern
        // against a 38h contract, and that is a different unit.
        const { candidates, findings } = run({
            pattern: weekPattern(480),                       // 8.0h days
            cycles: [cycle(24.4)],
        });

        expect(candidates).toHaveLength(3);
        expect(candidates.map(c => c.shiftDate)).toEqual(['2024-07-15', '2024-07-16', '2024-07-17']);

        const residual = findings.find(f => f.code === 'BFT_RESIDUAL_VARIANCE');
        expect(residual).toBeDefined();
        expect(residual!.severity).toBe('INFO');
        expect(residual!.clause).toBe('ICC EBA cl 35.1(c)');
        expect(residual!.plain).toContain('24m remains unscheduled');
        expect(residual!.plain).toContain('cannot be shortened below 7.6 hours');
        expect((residual!.calculation as { residual_hours: number }).residual_hours).toBeCloseTo(0.4, 6);
    });

    it('never emits a candidate shorter than the pattern day', () => {
        const { candidates } = run({ cycles: [cycle(20)] });   // 20h against 7.6h days

        expect(candidates).toHaveLength(2);                    // 15.2h, not 2.6 x 7.6
        expect(candidates.every(c => c.netMinutes === 456)).toBe(true);
    });

    it('proposes nothing and says the cycle is already satisfied at zero deficit', () => {
        const { candidates, findings } = run({ cycles: [cycle(0)] });

        expect(candidates).toEqual([]);
        expect(findings.some(f => f.code === 'BFT_CYCLE_SATISFIED')).toBe(true);
        expect(findings.some(f => f.code === 'BFT_RESIDUAL_VARIANCE')).toBe(false);
    });

    it('reports running out of pattern days differently from running out of deficit', () => {
        // A one-day-a-week pattern cannot absorb 152h in four weeks: it runs
        // out of days, not out of hours. The two are different facts.
        const oneDay: BaselinePattern = { ...weekPattern(456), slots: [slot(1, 456)] };

        const { findings } = run({ pattern: oneDay, cycles: [cycle(152)] });
        const residual = findings.find(f => f.code === 'BFT_RESIDUAL_VARIANCE');

        expect(residual!.plain).toContain('no more working days left');
        expect(residual!.calculation).toMatchObject({ next_pattern_day_hours: null });
    });
});

describe('what blocks a day', () => {
    function existing(date: string): ExistingShift {
        return {
            id: `s-${date}`, date, startTime: '08:00', endTime: '16:06',
            netMinutes: 456, subDepartmentId: 'sub-OTHER', rosterPublishedOrLocked: false,
        };
    }

    it('skips a day the employee already works, in any sub-department', () => {
        // A second shift that day would be a split shift, which cl 39.1 does
        // not authorise for full-time.
        const { candidates, findings } = run({
            cycles: [cycle(152)],
            existingShifts: [existing('2024-07-16')],
        });

        expect(candidates.map(c => c.shiftDate)).not.toContain('2024-07-16');
        expect(findings.some(f => f.code === 'BFT_DAY_ALREADY_ROSTERED')).toBe(true);
    });

    it('skips a blocked day — approved leave, or a patterned public holiday', () => {
        const { candidates, findings } = run({
            cycles: [cycle(152, { blockedDates: ['2024-07-16'] })],
        });

        expect(candidates.map(c => c.shiftDate)).not.toContain('2024-07-16');
        const skip = findings.find(f => f.code === 'BFT_DAY_ON_LEAVE_OR_HOLIDAY');
        expect(skip?.clause).toBe('ICC EBA cl 56.4');
    });

    it('never proposes outside the roster period, even when the cycle extends past it', () => {
        const { candidates } = run({
            cycles: [cycle(152)],              // cycle runs to 2024-08-11
            periodEnd: '2024-07-19',           // period stops a fortnight earlier
        });

        expect(candidates.every(c => c.shiftDate <= '2024-07-19')).toBe(true);
        expect(candidates).toHaveLength(5);    // Mon–Fri of the first week only
    });

    it('never proposes on a weekday the pattern does not cover', () => {
        const { candidates } = run({ cycles: [cycle(152)] });
        const weekdays = new Set(candidates.map(c => new Date(`${c.shiftDate}T00:00:00Z`).getUTCDay()));

        expect(weekdays.has(0)).toBe(false);   // Sunday
        expect(weekdays.has(6)).toBe(false);   // Saturday
    });
});

describe('determinism', () => {
    it('produces byte-identical output when the pattern slots arrive in any order', () => {
        const forward = weekPattern(456);
        const reversed: BaselinePattern = { ...forward, slots: [...forward.slots].reverse() };

        const a = run({ pattern: forward, cycles: [cycle(45.6)] });
        const b = run({ pattern: reversed, cycles: [cycle(45.6)] });

        expect(JSON.stringify(b.candidates)).toBe(JSON.stringify(a.candidates));
    });

    it('produces byte-identical output when cycles arrive out of order', () => {
        const c7 = cycle(15.2);
        const c8: CycleRequirement = {
            ...cycle(15.2), cycleIndex: 8, start: '2024-08-12', endInclusive: '2024-09-08',
        };

        const a = run({ cycles: [c7, c8], periodEnd: '2024-09-08' });
        const b = run({ cycles: [c8, c7], periodEnd: '2024-09-08' });

        expect(JSON.stringify(b.candidates)).toBe(JSON.stringify(a.candidates));
        expect(a.candidates[0].cycleIndex).toBe(7);
    });

    it('repeats exactly across many runs', () => {
        const first = JSON.stringify(run({ cycles: [cycle(45.6)] }).candidates);
        for (let i = 0; i < 25; i++) {
            expect(JSON.stringify(run({ cycles: [cycle(45.6)] }).candidates)).toBe(first);
        }
    });

    it('takes the first same-day slot by total order and refuses the second', () => {
        // Two slots on one weekday is a split shift, which cl 39.1 does not
        // authorise for full-time. The generator must refuse the second — and
        // must pick the SAME winner regardless of the order the slots arrive
        // in, or the tiebreak would be traversal order rather than a guarantee.
        const forward: BaselinePattern = {
            ...weekPattern(456),
            slots: [
                { ...slot(1, 456), sourceSlotId: 'ts-b', sortOrder: 1 },
                { ...slot(1, 456), sourceSlotId: 'ts-a', sortOrder: 1 },
            ],
        };
        const reversed: BaselinePattern = { ...forward, slots: [...forward.slots].reverse() };

        const go = (p: BaselinePattern) => generateCandidates({
            facts: FACTS, pattern: p, cycles: [cycle(152)], existingShifts: [],
            periodStart: '2024-07-15', periodEnd: '2024-07-15', scope: SCOPE,
        });

        const a = go(forward);
        const b = go(reversed);

        expect(a.candidates.map(c => c.sourceSlotId)).toEqual(['ts-a']);
        expect(b.candidates.map(c => c.sourceSlotId)).toEqual(['ts-a']);
        expect(a.findings.some(f => f.code === 'BFT_DAY_ALREADY_ROSTERED')).toBe(true);
    });
});

describe('idempotency key', () => {
    it('describes the shift, not the run — so a second run rebuilds the same key', () => {
        const args = {
            employeeId: 'emp-1', shiftDate: '2024-07-15',
            startTime: '08:00', endTime: '16:06', roleId: ROLE,
        };

        expect(buildIdempotencyKey(SCOPE, args)).toBe(buildIdempotencyKey(SCOPE, args));
        expect(buildIdempotencyKey(SCOPE, args))
            .toBe('bft:sub-1:emp-1:2024-07-15:08:00-16:06:role-1');
    });

    it('is the SAME key from a Week view and from a Month view', () => {
        // The review screen navigates by Day / 3-Day / Week / Month, so the
        // same Tuesday shift is reached through many different windows. While
        // the period was part of the key, each window produced a different one
        // and the shift would have been created once per zoom level.
        //
        // `baseline_ft_proposed_shifts.idempotency_key` is globally unique, so
        // this is the assertion standing between a manager clicking between
        // views and a duplicate roster.
        const shift = {
            employeeId: 'emp-1', shiftDate: '2024-07-16',
            startTime: '08:00', endTime: '16:06', roleId: ROLE,
        };

        const week  = { subDepartmentId: 'sub-1', periodStart: '2024-07-15', periodEnd: '2024-07-21' };
        const month = { subDepartmentId: 'sub-1', periodStart: '2024-07-01', periodEnd: '2024-07-31' };
        const day   = { subDepartmentId: 'sub-1', periodStart: '2024-07-16', periodEnd: '2024-07-16' };

        expect(buildIdempotencyKey(week, shift)).toBe(buildIdempotencyKey(month, shift));
        expect(buildIdempotencyKey(week, shift)).toBe(buildIdempotencyKey(day, shift));
    });

    it('differs when any component of the shift differs', () => {
        const base = {
            employeeId: 'emp-1', shiftDate: '2024-07-15',
            startTime: '08:00', endTime: '16:06', roleId: ROLE,
        };
        const keys = new Set([
            buildIdempotencyKey(SCOPE, base),
            buildIdempotencyKey(SCOPE, { ...base, employeeId: 'emp-2' }),
            buildIdempotencyKey(SCOPE, { ...base, shiftDate: '2024-07-16' }),
            buildIdempotencyKey(SCOPE, { ...base, endTime: '17:00' }),
            buildIdempotencyKey(SCOPE, { ...base, roleId: 'role-2' }),
            buildIdempotencyKey({ subDepartmentId: 'sub-2' }, base),
        ]);

        expect(keys.size).toBe(6);
    });

    it('is carried onto every candidate it generates', () => {
        const { candidates } = run({ cycles: [cycle(15.2)] });

        expect(candidates).toHaveLength(2);
        expect(new Set(candidates.map(c => c.idempotencyKey)).size).toBe(2);
        expect(candidates[0].idempotencyKey).toContain('bft:sub-1:');
    });
});
