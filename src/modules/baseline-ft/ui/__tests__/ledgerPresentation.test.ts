/**
 * The presentation helpers carry meaning, not just formatting.
 *
 * `statusOf` decides which chip a manager sees, and the difference between
 * "Variance" and "Over cycle cap" is the difference between a correct answer
 * and an existing breach. `fmtHours` must never round 7.6 to 8 — that number is
 * simultaneously cl 35.1(c)'s daily floor and 38/5, so a rounded display would
 * hide the exact thing the feature exists to police.
 */
import { describe, expect, it } from 'vitest';
import { cycleSentence, fmtHm, fmtHours, statusOf } from '../components/BaselineLedger';
import { findingKey, sortFindings } from '../components/FindingList';
import type { EmployeeLedger } from '../../api/baselineFt.commands';
import type { Candidate, CycleRequirement, Finding } from '../../domain/types';

function ledger(over: Partial<EmployeeLedger> = {}): EmployeeLedger {
    return {
        employeeId: 'e1',
        name: 'Test',
        requiredHours: 152,
        existingHours: 152,
        leaveHours: 0,
        proposedHours: 0,
        varianceHours: 0,
        hasUnresolvedElection: false,
        cycles: [],
        proposed: [],
        rejected: [],
        findings: [],
        patternBlocked: false,
        ...over,
    };
}

describe('fmtHours', () => {
    it('keeps the tenth, because 7.6 is the whole point', () => {
        expect(fmtHours(7.6)).toBe('7.6h');
        expect(fmtHours(152)).toBe('152.0h');
        expect(fmtHours(0)).toBe('0.0h');
    });

    it('does not let float noise leak into the display', () => {
        expect(fmtHours(7.6000000001)).toBe('7.6h');
        expect(fmtHours(0.1 + 0.2)).toBe('0.3h');
    });
});

describe('fmtHm', () => {
    it('speaks in the words a person uses for a duration', () => {
        expect(fmtHm(0.4)).toBe('24m');
        expect(fmtHm(1.4)).toBe('1h 24m');
        expect(fmtHm(2)).toBe('2h');
        expect(fmtHm(0)).toBe('0m');
    });

    it('marks an over-roster with a minus sign, not a bare number', () => {
        // A negative variance is a different FACT from a positive one -- the
        // employee is already past their ceiling -- so it must not read as a
        // smaller shortfall.
        expect(fmtHm(-8)).toBe('−8h');
        expect(fmtHm(-0.4)).toBe('−24m');
    });
});

describe('statusOf', () => {
    it('reports a satisfied employee when the variance is float noise', () => {
        expect(statusOf(ledger({ varianceHours: 0 }))).toBe('satisfied');
        expect(statusOf(ledger({ varianceHours: 0.01 }))).toBe('satisfied');
        expect(statusOf(ledger({ varianceHours: -0.01 }))).toBe('satisfied');
    });

    it('reports a variance when hours remain unscheduled', () => {
        // The honest-variance case: 48 minutes left, below a full-time day.
        expect(statusOf(ledger({ varianceHours: 0.8 }))).toBe('variance');
    });

    it('distinguishes an OVER-roster from a shortfall', () => {
        // Already past the cycle ceiling. Baseline surfaces this and offers no
        // fix, because deleting a shift is outside its authority.
        expect(statusOf(ledger({ varianceHours: -8 }))).toBe('over');
    });

    it('lets a blocking finding outrank a tidy variance', () => {
        // Zero variance with a blocking problem is not "fully scheduled" --
        // the zero may be zero because nothing could be proposed at all.
        const blocked = ledger({
            varianceHours: 0,
            findings: [{
                severity: 'BLOCKING', code: 'V8_MIN_REST_GAP',
                plain: 'x', overridable: false,
            }],
        });
        expect(statusOf(blocked)).toBe('blocked');
    });
});

describe('sortFindings', () => {
    const f = (severity: Finding['severity'], plain: string): Finding =>
        ({ severity, plain, code: plain, overridable: severity === 'WARNING' });

    it('puts what demands action above what is merely worth knowing', () => {
        const sorted = sortFindings([
            f('INFO', 'c'), f('BLOCKING', 'b'), f('WARNING', 'a'),
        ]);
        expect(sorted.map(x => x.severity)).toEqual(['BLOCKING', 'WARNING', 'INFO']);
    });

    it('is stable within a severity, so the list does not reshuffle on re-render', () => {
        const sorted = sortFindings([
            f('INFO', 'zebra'), f('INFO', 'alpha'), f('INFO', 'mango'),
        ]);
        expect(sorted.map(x => x.plain)).toEqual(['alpha', 'mango', 'zebra']);
    });

    it('does not mutate the array it was given', () => {
        const input = [f('INFO', 'c'), f('BLOCKING', 'b')];
        sortFindings(input);
        expect(input.map(x => x.severity)).toEqual(['INFO', 'BLOCKING']);
    });
});

describe('findingKey', () => {
    const residual = (cycleStart: string): Finding => ({
        severity: 'INFO',
        code: 'BFT_RESIDUAL_VARIANCE',
        plain: `2h 24m remains unscheduled from ${cycleStart}.`,
        employeeId: '3a606351-e93f-44b6-b700-078f108ef80a',
        overridable: false,
    });

    it('separates two findings that differ only by cycle', () => {
        // The real case from production: a Month view straddling two four-week
        // cycles emits one BFT_RESIDUAL_VARIANCE per cycle, identical in code
        // and employeeId. React warned about duplicate keys and was free to
        // drop one — hiding a genuinely unscheduled remainder from the person
        // reconciling the roster.
        const findings = [residual('2026-08-10'), residual('2026-09-07')];
        const keys = findings.map(findingKey);

        expect(new Set(keys).size).toBe(2);
        expect(keys[0]).not.toBe(keys[1]);
    });

    it('is unique across a whole list, however alike the findings are', () => {
        const findings = Array.from({ length: 6 }, () => residual('2026-08-10'));
        expect(new Set(findings.map(findingKey)).size).toBe(6);
    });

    it('still distinguishes by candidate and employee, not only by position', () => {
        const a: Finding = { ...residual('x'), candidateKey: 'bft:sub:emp:2026-09-01:08:00-16:06:role' };
        const b: Finding = { ...residual('x'), candidateKey: 'bft:sub:emp:2026-09-02:08:00-16:06:role' };
        expect(findingKey(a, 0)).toContain('2026-09-01');
        expect(findingKey(b, 0)).toContain('2026-09-02');
    });
});

/* ────────────────────────────────────────────────────────────────────────────
   The sentence that replaced the five-number strip
   ──────────────────────────────────────────────────────────────────────────── */

function cycle(over: Partial<CycleRequirement> = {}): CycleRequirement {
    return {
        cycleIndex: 0,
        start: '2026-08-10',
        endInclusive: '2026-09-06',
        ceilingHours: 152,
        activeDays: 7,
        cycleDays: 28,
        requiredHours: 38,
        existingHours: 0,
        paidLeaveHours: 0,
        publicHolidayCreditHours: 0,
        blockedDates: [],
        deficitHours: 38,
        deficitHoursIfElectionUnpaid: 38,
        ...over,
    };
}

function shift(date: string, netMinutes = 456): Candidate {
    return {
        employeeId: 'emp-1',
        userContractId: 'uc-1',
        sourceSlotId: `slot-${date}`,
        shiftDate: date,
        startTime: '08:00',
        endTime: '16:06',
        unpaidBreakMinutes: 30,
        paidBreakMinutes: 15,
        netMinutes,
        roleId: 'role-1',
        cycleIndex: 0,
        idempotencyKey: `bft:sub:emp-1:${date}:08:00-16:06:role-1`,
    };
}

describe('cycleSentence', () => {
    it('says a settled period is settled, and never calls it a deficit', () => {
        // The exact case from the screen that prompted this redesign: owed
        // 38.0h, 7.6h already rostered, four 7.6h shifts proposed = 30.4h. The
        // old panel showed "Still Owed 30.4h · Deficit" in amber, and listed the
        // four shifts that discharge precisely that 30.4h in a separate card
        // underneath — leaving the reader to do the arithmetic to find out
        // nothing was wrong.
        const { text, residualHours } = cycleSentence(
            cycle({ existingHours: 7.6, deficitHours: 30.4 }),
            [shift('2026-08-31'), shift('2026-09-01'), shift('2026-09-02'), shift('2026-09-04')],
        );

        expect(text).toContain('settles it exactly');
        expect(text).toContain('7.6h already rostered');
        expect(text).toContain('4 shifts proposed');
        expect(residualHours).toBe(0);
        expect(text).not.toMatch(/deficit/i);
    });

    it('names what is left over, and why, when the proposal does NOT clear it', () => {
        // A genuine variance IS news, and this is the only time it is stated.
        const { text, residualHours } = cycleSentence(
            cycle({ deficitHours: 38 }),
            [shift('2026-08-31'), shift('2026-09-01'), shift('2026-09-02'), shift('2026-09-04')],
        );

        expect(residualHours).toBeCloseTo(7.6, 1);
        expect(text).toContain('leaving 7h 36m unscheduled');
        // The reason, not just the number — a non-zero remainder is a correct
        // answer under cl 35.1(c) and has to read as one.
        expect(text).toContain('cannot be shorter than 7.6 hours');
    });

    it('reports an already-met cycle without proposing anything', () => {
        const { text, residualHours } = cycleSentence(
            cycle({ existingHours: 38, deficitHours: 0 }), []);
        expect(text).toContain('already meet that');
        expect(residualHours).toBe(0);
    });

    it('lists every kind of credit that discharged the obligation', () => {
        const { text } = cycleSentence(
            cycle({ existingHours: 7.6, paidLeaveHours: 7.6, publicHolidayCreditHours: 7.6, deficitHours: 15.2 }),
            [shift('2026-09-01'), shift('2026-09-02')],
        );
        expect(text).toContain('7.6h already rostered');
        expect(text).toContain('7.6h leave');
        expect(text).toContain('7.6h public holidays');
    });

    it('says so plainly when nothing could be proposed at all', () => {
        const { text } = cycleSentence(cycle({ deficitHours: 38 }), []);
        expect(text).toContain('No shift could be proposed');
    });
});
