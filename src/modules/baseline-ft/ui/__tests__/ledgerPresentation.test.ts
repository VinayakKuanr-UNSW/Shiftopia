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
import { fmtHm, fmtHours, statusOf } from '../components/BaselineLedger';
import { findingKey, sortFindings } from '../components/FindingList';
import type { EmployeeLedger } from '../../api/baselineFt.commands';
import type { Finding } from '../../domain/types';

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
