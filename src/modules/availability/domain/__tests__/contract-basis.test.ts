import { describe, expect, it } from 'vitest';
import {
    resolveComplianceBasis,
    sortByComplianceBasis,
    toContractType,
    type ContractBasisInput,
} from '../contract-basis';

// ── fixtures ────────────────────────────────────────────────────────────────

const contract = (over: Partial<ContractBasisInput> = {}): ContractBasisInput => ({
    employmentStatus: 'Casual',
    contractedWeeklyHours: 38,
    startDate: '2026-01-01',
    ...over,
});

const FT = contract({ employmentStatus: 'Full-Time', contractedWeeklyHours: 38 });
const PT = contract({ employmentStatus: 'Part-Time', contractedWeeklyHours: 20 });
const CASUAL = contract({ employmentStatus: 'Casual', contractedWeeklyHours: 0 });

describe('toContractType', () => {
    it('collapses the statuses the rules switch on', () => {
        expect(toContractType('Full-Time')).toBe('FT');
        expect(toContractType('Part-Time')).toBe('PT');
        expect(toContractType('Casual')).toBe('CASUAL');
    });

    // 'Flexible Part-Time' is a part-time contract and keeps its caps — the
    // one collapse that is easy to get backwards.
    it('treats Flexible Part-Time as part-time, not casual', () => {
        expect(toContractType('Flexible Part-Time')).toBe('PT');
    });

    it('is insensitive to case and surrounding space', () => {
        expect(toContractType('  full-time ')).toBe('FT');
        expect(toContractType('CASUAL')).toBe('CASUAL');
    });

    // null reaches the rules as "check them anyway"; returning CASUAL here
    // would exempt an unreadable contract from every rolling cap.
    it('returns null — never CASUAL — for unknown or absent statuses', () => {
        expect(toContractType('Contractor')).toBeNull();
        expect(toContractType(null)).toBeNull();
        expect(toContractType('')).toBeNull();
    });
});

describe('resolveComplianceBasis', () => {
    it('returns an empty basis when the person holds no active contract', () => {
        expect(resolveComplianceBasis([])).toEqual({
            contractType: null,
            contractedWeeklyHours: undefined,
            employmentStatus: null,
            envelope: { spanStart: null, spanEnd: null, days: null, isConfigured: false },
            // Nobody we can read a contract for stays on the STRICT reading —
            // the same default the solver applies — so the page never tells
            // someone they are available when the solver will not place them.
            availabilityMode: 'OPT_IN',
        });
    });

    it('passes a single contract straight through', () => {
        const basis = resolveComplianceBasis([PT]);
        expect(basis.contractType).toBe('PT');
        expect(basis.contractedWeeklyHours).toBe(20);
    });

    // The production case: one person holds {Full-Time, Casual}. Resolving to
    // the casual would exempt them from every rolling window.
    it('prefers a non-casual contract over a casual one, in either input order', () => {
        expect(resolveComplianceBasis([CASUAL, FT]).contractType).toBe('FT');
        expect(resolveComplianceBasis([FT, CASUAL]).contractType).toBe('FT');
    });

    it('is stable across every permutation of three contracts', () => {
        const permutations: ContractBasisInput[][] = [
            [FT, PT, CASUAL],
            [FT, CASUAL, PT],
            [PT, FT, CASUAL],
            [PT, CASUAL, FT],
            [CASUAL, FT, PT],
            [CASUAL, PT, FT],
        ];
        for (const order of permutations) {
            const basis = resolveComplianceBasis(order);
            expect(basis.contractType).toBe('FT');
            expect(basis.contractedWeeklyHours).toBe(38);
        }
    });

    // Picking the smaller of two capped contracts manufactures violations
    // against hours the person is entitled to work.
    it('takes the larger weekly basis when both contracts are capped', () => {
        expect(resolveComplianceBasis([PT, FT]).contractedWeeklyHours).toBe(38);
    });

    it('breaks a remaining tie on the later start date', () => {
        const older = contract({ employmentStatus: 'Part-Time', contractedWeeklyHours: 20, startDate: '2025-01-01' });
        const newer = contract({ employmentStatus: 'Part-Time', contractedWeeklyHours: 20, startDate: '2026-06-01' });
        expect(sortByComplianceBasis([older, newer])[0]).toBe(newer);
        expect(sortByComplianceBasis([newer, older])[0]).toBe(newer);
    });

    it('sorts a missing start date last rather than letting it win as an empty string', () => {
        const dated = contract({ employmentStatus: 'Part-Time', contractedWeeklyHours: 20, startDate: '2025-01-01' });
        const undated = contract({ employmentStatus: 'Part-Time', contractedWeeklyHours: 20, startDate: null });
        expect(sortByComplianceBasis([undated, dated])[0]).toBe(dated);
        expect(sortByComplianceBasis([dated, undated])[0]).toBe(dated);
    });

    // Casuals in production carry contracted_weekly_hours = 0. That is "unset",
    // not a zero-hour limit, and must never reach a cap calculation.
    it('reports no weekly basis when the chosen contract records zero hours', () => {
        expect(resolveComplianceBasis([CASUAL].map((c) => ({ ...c }))).contractedWeeklyHours).toBeUndefined();
    });

    // `contracted_weekly_hours` is a Postgres numeric and can arrive as a
    // string. A typeof check would reject it and silently promote a 20h
    // part-timer to the 38h default, doubling every window limit.
    it('accepts a weekly basis that arrives as a string', () => {
        const ptAsString = contract({ employmentStatus: 'Part-Time', contractedWeeklyHours: '20' });
        expect(resolveComplianceBasis([ptAsString]).contractedWeeklyHours).toBe(20);
    });

    it('prefers the larger basis even when the two arrive in different shapes', () => {
        const ptString = contract({ employmentStatus: 'Part-Time', contractedWeeklyHours: '20' });
        const ftNumber = contract({ employmentStatus: 'Full-Time', contractedWeeklyHours: 38 });
        expect(resolveComplianceBasis([ptString, ftNumber]).contractedWeeklyHours).toBe(38);
        expect(resolveComplianceBasis([ftNumber, ptString]).contractedWeeklyHours).toBe(38);
    });

    it('treats an empty or unparseable basis as unset, not as zero hours', () => {
        expect(
            resolveComplianceBasis([contract({ employmentStatus: 'Part-Time', contractedWeeklyHours: '' })])
                .contractedWeeklyHours,
        ).toBeUndefined();
        expect(
            resolveComplianceBasis([contract({ employmentStatus: 'Part-Time', contractedWeeklyHours: 'n/a' })])
                .contractedWeeklyHours,
        ).toBeUndefined();
    });

    it('ranks an unrecognised status with the capped population, not the casuals', () => {
        const unknown = contract({ employmentStatus: 'Contractor', contractedWeeklyHours: 0 });
        const basis = resolveComplianceBasis([CASUAL, unknown]);
        expect(basis.employmentStatus).toBe('Contractor');
        expect(basis.contractType).toBeNull();
    });
});

describe('sortByComplianceBasis', () => {
    it('does not mutate its input', () => {
        const input = [CASUAL, FT];
        const sorted = sortByComplianceBasis(input);
        expect(input[0]).toBe(CASUAL);
        expect(sorted[0]).toBe(FT);
    });

    it('keeps the original order for contracts that compare equal', () => {
        const a = contract({ employmentStatus: 'Part-Time', contractedWeeklyHours: 20 });
        const b = contract({ employmentStatus: 'Part-Time', contractedWeeklyHours: 20 });
        const sorted = sortByComplianceBasis([a, b]);
        expect(sorted[0]).toBe(a);
        expect(sorted[1]).toBe(b);
    });
});

// ── Ordinary-hours envelope + availability mode ─────────────────────────────
//
// Added with migration 20260817000000. The mode is the frontend mirror of the
// solver's `availability_mode`: it decides whether the page tells the employee
// an empty availability calendar is a problem (casual — it is) or the normal
// state (FT/PT — availability is an exception ledger, leave is what regulates
// them).

describe('resolveComplianceBasis — availability mode', () => {
    it('puts permanents on OPT_OUT', () => {
        expect(resolveComplianceBasis([FT]).availabilityMode).toBe('OPT_OUT');
        expect(resolveComplianceBasis([PT]).availabilityMode).toBe('OPT_OUT');
        expect(resolveComplianceBasis([
            contract({ employmentStatus: 'Flexible Part-Time', contractedWeeklyHours: 20 }),
        ]).availabilityMode).toBe('OPT_OUT');
    });

    it('keeps casuals on OPT_IN', () => {
        expect(resolveComplianceBasis([CASUAL]).availabilityMode).toBe('OPT_IN');
    });

    it('keeps an unrecognised status on OPT_IN', () => {
        // Such a contract ranks WITH the capped population for the hours rules
        // (conservative there), but it carries no obligation we can name, so
        // widening their availability on the strength of it would be a guess
        // in the unsafe direction.
        expect(resolveComplianceBasis([
            contract({ employmentStatus: 'Contractor', contractedWeeklyHours: 38 }),
        ]).availabilityMode).toBe('OPT_IN');
    });

    it('follows the contract the hours rules resolved to, not row order', () => {
        // The production {Full-Time, Casual} case. The FT contract wins the
        // basis, so the mode has to come with it.
        expect(resolveComplianceBasis([CASUAL, FT]).availabilityMode).toBe('OPT_OUT');
    });
});

describe('resolveComplianceBasis — ordinary-hours envelope', () => {
    it('reports unconfigured when no span is set — every production contract today', () => {
        const { envelope } = resolveComplianceBasis([FT]);
        expect(envelope.isConfigured).toBe(false);
        expect(envelope.spanStart).toBeNull();
        expect(envelope.spanEnd).toBeNull();
    });

    it('carries a configured span through', () => {
        const { envelope } = resolveComplianceBasis([contract({
            employmentStatus: 'Full-Time',
            ordinarySpanStart: '06:00:00',
            ordinarySpanEnd: '18:00:00',
            ordinaryDays: [1, 2, 3, 4, 5],
        })]);
        expect(envelope).toEqual({
            spanStart: '06:00:00', spanEnd: '18:00:00', days: [1, 2, 3, 4, 5], isConfigured: true,
        });
    });

    it('treats a half-configured span as unconfigured', () => {
        // The DB CHECK rejects this shape, so it should be unreachable — but a
        // single open-ended bound rendered as real would read to the employee
        // as a restriction that does not exist.
        const { envelope } = resolveComplianceBasis([contract({
            employmentStatus: 'Full-Time', ordinarySpanStart: '06:00:00', ordinarySpanEnd: null,
        })]);
        expect(envelope.isConfigured).toBe(false);
    });

    it('keeps ordinary days even with no span, since leave hours divide by them', () => {
        // `resolveRequestedLeaveHours` uses the day count as the divisor for the
        // ordinary day, so a 3-day part-timer must not silently fall back to 5.
        const { envelope } = resolveComplianceBasis([contract({
            employmentStatus: 'Part-Time', contractedWeeklyHours: 20, ordinaryDays: [1, 2, 3],
        })]);
        expect(envelope.isConfigured).toBe(false);
        expect(envelope.days).toEqual([1, 2, 3]);
    });

    it('takes the envelope from the SAME contract that set the hours basis', () => {
        const casualWithSpan = contract({
            employmentStatus: 'Casual', contractedWeeklyHours: 0,
            ordinarySpanStart: '00:00:00', ordinarySpanEnd: '23:00:00',
        });
        const ftWithSpan = contract({
            employmentStatus: 'Full-Time', contractedWeeklyHours: 38,
            ordinarySpanStart: '06:00:00', ordinarySpanEnd: '18:00:00',
        });
        expect(resolveComplianceBasis([casualWithSpan, ftWithSpan]).envelope.spanStart)
            .toBe('06:00:00');
    });
});
