import { describe, expect, it } from 'vitest';
import {
    contractsInScope,
    resolveComplianceBasis,
    resolveScopedBasis,
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
            isFullTime: false,
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
        expect(basis.isFullTime).toBe(false);
    });

    it('marks Full-Time contracts with isFullTime=true', () => {
        const basis = resolveComplianceBasis([FT]);
        expect(basis.contractType).toBe('FT');
        expect(basis.contractedWeeklyHours).toBe(38);
        expect(basis.isFullTime).toBe(true);
        expect(basis.availabilityMode).toBe('OPT_OUT');
    });

    // The production case: one person holds {Full-Time, Casual}. Resolving to
    // the casual would exempt them from every rolling window.
    it('prefers a non-casual contract over a casual one, in either input order', () => {
        expect(resolveComplianceBasis([CASUAL, FT]).contractType).toBe('FT');
        expect(resolveComplianceBasis([CASUAL, FT]).isFullTime).toBe(true);
        expect(resolveComplianceBasis([FT, CASUAL]).contractType).toBe('FT');
        expect(resolveComplianceBasis([FT, CASUAL]).isFullTime).toBe(true);
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

// ============================================================================
// SCOPED BASIS — the same precedence, asked of ONE JOB
// ============================================================================
//
// The SQL half of this pair (`sm_holds_active_contract_in` /
// `sm_holds_active_ft_contract_in`, migrations 20260821090000 / 20260821090100)
// is pinned independently by supabase/tests/availability_subdepartment_scope.sql.
// Two independent behavioural suites asserting the same three branches is the
// parity check here — deliberately not a test that reads the migration's text,
// which passes as happily against a comment as against the code.

// Production's actual shape: one Full-Time contract in Building Services ·
// Security, plus four Casual contracts across Event Delivery · Set-up (three
// roles) and Live Events · Front of House.
const SECURITY = { subDepartmentId: 'sd-security', departmentId: 'd-building' };
const SETUP = { subDepartmentId: 'sd-setup', departmentId: 'd-events' };
const FOH = { subDepartmentId: 'sd-foh', departmentId: 'd-live' };

const MULTI_JOB: ContractBasisInput[] = [
    contract({ employmentStatus: 'Full-Time', contractedWeeklyHours: 38, ...SECURITY }),
    contract({ employmentStatus: 'Casual', contractedWeeklyHours: 0, ...SETUP }),
    contract({ employmentStatus: 'Casual', contractedWeeklyHours: 0, ...SETUP }),
    contract({ employmentStatus: 'Casual', contractedWeeklyHours: 0, ...SETUP }),
    contract({ employmentStatus: 'Casual', contractedWeeklyHours: 0, ...FOH }),
];

describe('resolveScopedBasis — the 1 Full-Time + 4 Casual employee', () => {
    // The defect, stated as a test. Without it the three below could pass on a
    // fixture where the person-wide answer happened to be right anyway.
    it('person-wide, the Full-Time contract wins — which is why the page hid the editor', () => {
        const basis = resolveComplianceBasis(MULTI_JOB);
        expect(basis.contractType).toBe('FT');
        expect(basis.isFullTime).toBe(true);
        expect(basis.availabilityMode).toBe('OPT_OUT');
    });

    it('scoped to Security, they are Full-Time — availability stays contract-based', () => {
        const basis = resolveScopedBasis(MULTI_JOB, SECURITY);
        expect(basis.contractType).toBe('FT');
        expect(basis.isFullTime).toBe(true);
        expect(basis.availabilityMode).toBe('OPT_OUT');
        expect(basis.contractedWeeklyHours).toBe(38);
    });

    it('scoped to Set-up, they are Casual — silence means unavailable, so the editor must show', () => {
        const basis = resolveScopedBasis(MULTI_JOB, SETUP);
        expect(basis.contractType).toBe('CASUAL');
        expect(basis.isFullTime).toBe(false);
        expect(basis.availabilityMode).toBe('OPT_IN');
        // Casual rows carry 0 weekly hours, which is "unset", never a zero-hour cap.
        expect(basis.contractedWeeklyHours).toBeUndefined();
    });

    it('scoped to Front of House, they are Casual there too', () => {
        expect(resolveScopedBasis(MULTI_JOB, FOH).availabilityMode).toBe('OPT_IN');
        expect(resolveScopedBasis(MULTI_JOB, FOH).isFullTime).toBe(false);
    });

    // Three Set-up contracts differing only by role share ONE declaration. If
    // the grain were the contract this would be three separate calendars for
    // the same physical shift.
    it('collapses several contracts in one sub-department to a single basis', () => {
        expect(resolveScopedBasis(MULTI_JOB, SETUP)).toEqual(resolveScopedBasis(
            [MULTI_JOB[1], MULTI_JOB[4]], SETUP,
        ));
    });
});

describe('resolveScopedBasis — scope semantics', () => {
    // The invariant that lets every existing caller keep its meaning: an
    // unresolved scope is the person-wide question, not an empty one. It is
    // also the NULL branch of sm_holds_active_ft_contract_in.
    it('a null sub-department is identical to the person-wide basis', () => {
        expect(resolveScopedBasis(MULTI_JOB, { subDepartmentId: null }))
            .toEqual(resolveComplianceBasis(MULTI_JOB));
        expect(resolveScopedBasis([], { subDepartmentId: null }))
            .toEqual(resolveComplianceBasis([]));
    });

    it('applies the SAME precedence inside a scope, not a second ordering', () => {
        const casualHere = contract({ employmentStatus: 'Casual', contractedWeeklyHours: 0, ...SETUP });
        const ptHere = contract({ employmentStatus: 'Part-Time', contractedWeeklyHours: 20, ...SETUP });
        // Non-casual beats casual — the rule from resolveComplianceBasis.
        expect(resolveScopedBasis([casualHere, ptHere], SETUP).contractType).toBe('PT');
        expect(resolveScopedBasis([ptHere, casualHere], SETUP).contractType).toBe('PT');
    });

    // A DEPARTMENT-WIDE contract has no sub-department of its own and covers
    // every sub-department beneath it. No Active contract is in that shape in
    // production, but the SQL guards honour it and the two must not diverge.
    it('admits a department-wide contract for a sub-department beneath it', () => {
        const deptWide = contract({
            employmentStatus: 'Full-Time', contractedWeeklyHours: 38,
            subDepartmentId: null, departmentId: 'd-events',
        });
        expect(contractsInScope([deptWide], SETUP)).toHaveLength(1);
        expect(resolveScopedBasis([deptWide], SETUP).isFullTime).toBe(true);
    });

    it('does NOT admit a department-wide contract from a different department', () => {
        const deptWideElsewhere = contract({
            employmentStatus: 'Full-Time', contractedWeeklyHours: 38,
            subDepartmentId: null, departmentId: 'd-building',
        });
        expect(contractsInScope([deptWideElsewhere], SETUP)).toHaveLength(0);
    });

    // Conservative by omission: without a departmentId there is no way to know
    // the contract covers this sub-department, and guessing that it does would
    // silently make someone Full-Time for a job they may not hold.
    it('excludes a department-wide contract when the scope names no department', () => {
        const deptWide = contract({
            employmentStatus: 'Full-Time', subDepartmentId: null, departmentId: 'd-events',
        });
        expect(contractsInScope([deptWide], { subDepartmentId: 'sd-setup' })).toHaveLength(0);
    });

    // Documented fallback. The page only ever offers scopes built from the
    // person's own contracts, and the database refuses the write regardless —
    // this pins that the fallback is the STRICT basis, not a permissive one.
    it('returns the empty basis for a scope the person holds no contract in', () => {
        const basis = resolveScopedBasis(MULTI_JOB, { subDepartmentId: 'sd-nowhere' });
        expect(basis.contractType).toBeNull();
        expect(basis.isFullTime).toBe(false);
        expect(basis.availabilityMode).toBe('OPT_IN');
    });

    it('takes the envelope from the winning contract IN SCOPE, not the person-wide winner', () => {
        const ftSecurity = contract({
            employmentStatus: 'Full-Time', contractedWeeklyHours: 38, ...SECURITY,
            ordinarySpanStart: '06:00:00', ordinarySpanEnd: '18:00:00',
        });
        const ptSetup = contract({
            employmentStatus: 'Part-Time', contractedWeeklyHours: 20, ...SETUP,
            ordinarySpanStart: '09:00:00', ordinarySpanEnd: '15:00:00',
        });
        expect(resolveScopedBasis([ftSecurity, ptSetup], SETUP).envelope.spanStart).toBe('09:00:00');
        expect(resolveComplianceBasis([ftSecurity, ptSetup]).envelope.spanStart).toBe('06:00:00');
    });
});
