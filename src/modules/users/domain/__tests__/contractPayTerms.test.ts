import { describe, expect, it } from 'vitest';
import {
    allowedPayBases,
    defaultPayBasis,
    eaTopAnnualRate,
    ebaClassificationKey,
    evaluateEngagement,
    evaluatePayTerms,
    formatBand,
    isLevelInBand,
    resolveEbaRate,
    type EbaRateSetLike,
    type PayTermsInput,
} from '../contractPayTerms';

/** The rows public.eba_rate holds in production (2025 base + the 6 Jul 2026 increase). */
const SCHEDULE: EbaRateSetLike[] = [
    {
        effectiveFrom: '2025-01-01',
        rates: [
            { classification: 'TRAINEE', employmentBasis: 'permanent', ordinaryHourlyRate: 24.96, paidHourlyRate: 24.96 },
            { classification: 'TRAINEE', employmentBasis: 'casual', ordinaryHourlyRate: 24.96, paidHourlyRate: 31.20 },
            { classification: 'LEVEL_7', employmentBasis: 'permanent', ordinaryHourlyRate: 34.19, paidHourlyRate: 34.19 },
            { classification: 'LEVEL_7', employmentBasis: 'casual', ordinaryHourlyRate: 34.19, paidHourlyRate: 42.74 },
            { classification: 'SECURITY_LEVEL_6', employmentBasis: 'annualised', ordinaryHourlyRate: 32.82, paidHourlyRate: 39.48 },
        ],
    },
    {
        effectiveFrom: '2026-07-06',
        rates: [
            { classification: 'TRAINEE', employmentBasis: 'permanent', ordinaryHourlyRate: 26.23, paidHourlyRate: 26.23 },
            { classification: 'TRAINEE', employmentBasis: 'casual', ordinaryHourlyRate: 26.23, paidHourlyRate: 32.79 },
            { classification: 'LEVEL_7', employmentBasis: 'permanent', ordinaryHourlyRate: 35.93, paidHourlyRate: 35.93 },
            { classification: 'LEVEL_7', employmentBasis: 'casual', ordinaryHourlyRate: 35.93, paidHourlyRate: 44.92 },
            { classification: 'SECURITY_LEVEL_6', employmentBasis: 'annualised', ordinaryHourlyRate: 34.49, paidHourlyRate: 41.49 },
        ],
    },
];

const TODAY = '2026-10-08';
const TOP = 70997.68; // 35.93 × 38 × 52

const base: PayTermsInput = {
    employmentStatus: 'Casual',
    payBasis: 'eba_level',
    level: 4,
    annualSalary: 0,
    exclusionReason: '',
    band: null,
    levelNote: '',
    isSecurityRole: false,
    usesWageScheme: false,
    contractedWeeklyHours: 0,
    eaTopAnnualRate: TOP,
};

const clauses = (issues: { clause: string }[]) => issues.map(i => i.clause);

describe('allowedPayBases', () => {
    it('keeps casuals and Flexible Part-Time on a level', () => {
        expect(allowedPayBases('Casual', false)).toEqual(['eba_level']);
        expect(allowedPayBases('Flexible Part-Time', false)).toEqual(['eba_level']);
    });

    it('lets Full-Time and Part-Time be salaried', () => {
        expect(allowedPayBases('Full-Time', false)).toEqual(['eba_level', 'salary']);
        expect(allowedPayBases('Part-Time', false)).toEqual(['eba_level', 'salary']);
    });

    // Sch 2 §1 is "Team Members other than Full-time Security".
    it('takes Full-Time Security off the plain level rate', () => {
        expect(allowedPayBases('Full-Time', true)).toEqual(['eba_security_annualised', 'salary']);
        expect(allowedPayBases('Casual', true)).toEqual(['eba_level']);
    });
});

describe('defaultPayBasis', () => {
    it('starts a typically-salaried permanent role on salary', () => {
        expect(defaultPayBasis('Full-Time', false, true)).toBe('salary');
    });

    it('never starts a casual on salary, even in a typically-salaried role', () => {
        expect(defaultPayBasis('Casual', false, true)).toBe('eba_level');
    });

    it('starts Full-Time Security on the annualised rate', () => {
        expect(defaultPayBasis('Full-Time', true, false)).toBe('eba_security_annualised');
    });
});

describe('band helpers', () => {
    it('treats a role with no band as allowing any level', () => {
        expect(isLevelInBand(0, null)).toBe(true);
        expect(isLevelInBand(7, { eba_level_min: null, eba_level_max: null })).toBe(true);
        expect(formatBand(null)).toBeNull();
    });

    it('checks and formats a band', () => {
        const band = { eba_level_min: 6, eba_level_max: 7 };
        expect(isLevelInBand(6, band)).toBe(true);
        expect(isLevelInBand(5, band)).toBe(false);
        expect(formatBand(band)).toBe('L6–L7');
        expect(formatBand({ eba_level_min: 4, eba_level_max: 4 })).toBe('L4');
    });
});

describe('evaluatePayTerms — refuses what the EA does not allow', () => {
    it('refuses a salaried casual', () => {
        const r = evaluatePayTerms({ ...base, payBasis: 'salary', annualSalary: 90000, exclusionReason: 'managerial', level: '' });
        expect(clauses(r.errors)).toContain('Sch 2 §1');
    });

    it('refuses a salaried Flexible Part-Time engagement', () => {
        const r = evaluatePayTerms({ ...base, employmentStatus: 'Flexible Part-Time', payBasis: 'salary', annualSalary: 50000, exclusionReason: 'managerial', level: '' });
        expect(clauses(r.errors)).toContain('cl 12.4(b)');
    });

    it('refuses annualised Security outside Levels 3–6', () => {
        const r = evaluatePayTerms({ ...base, employmentStatus: 'Full-Time', isSecurityRole: true, payBasis: 'eba_security_annualised', level: 7 });
        expect(clauses(r.errors)).toContain('Sch 2 §2');
    });

    it('refuses Full-Time Security on the plain level rate', () => {
        const r = evaluatePayTerms({ ...base, employmentStatus: 'Full-Time', isSecurityRole: true, payBasis: 'eba_level', level: 4 });
        expect(clauses(r.errors)).toContain('Sch 2 §1–2');
    });

    it('refuses annualised pay on a non-Security role', () => {
        const r = evaluatePayTerms({ ...base, employmentStatus: 'Full-Time', payBasis: 'eba_security_annualised', level: 4 });
        expect(clauses(r.errors)).toContain('Sch 3 §1.1');
    });

    it('requires a level for an EA basis', () => {
        const r = evaluatePayTerms({ ...base, level: '' });
        expect(r.errors.map(e => e.message)).toContain('Choose a level.');
    });

    it('requires the salary amount and the reason it is outside the EA', () => {
        const r = evaluatePayTerms({ ...base, employmentStatus: 'Full-Time', payBasis: 'salary', level: '' });
        expect(r.errors).toHaveLength(2);
        expect(clauses(r.errors)).toEqual(['cl 2.2', 'cl 2.2']);
    });

    it('refuses an EA wage scheme on a salaried contract', () => {
        const r = evaluatePayTerms({ ...base, employmentStatus: 'Full-Time', payBasis: 'salary', level: '', annualSalary: 95000, exclusionReason: 'managerial', usesWageScheme: true });
        expect(clauses(r.errors)).toEqual(['Sch 4–6']);
    });
});

describe('evaluatePayTerms — a level outside the role band', () => {
    const band = { eba_level_min: 6, eba_level_max: 7 };

    it('needs a note', () => {
        const r = evaluatePayTerms({ ...base, level: 5, band });
        expect(r.levelOutsideBand).toBe(true);
        expect(r.errors[0].message).toContain('outside this role\'s range (L6–L7)');
    });

    it('is allowed once the note is there', () => {
        const r = evaluatePayTerms({ ...base, level: 5, band, levelNote: 'Still training on the outlet systems' });
        expect(r.levelOutsideBand).toBe(true);
        expect(r.errors).toEqual([]);
    });

    it('is not flagged inside the band', () => {
        const r = evaluatePayTerms({ ...base, level: 7, band });
        expect(r.levelOutsideBand).toBe(false);
        expect(r.errors).toEqual([]);
    });
});

describe('evaluatePayTerms — salary cautions (never blocking)', () => {
    const salaried = { ...base, employmentStatus: 'Full-Time', payBasis: 'salary' as const, level: '' as const };

    it('warns when "above the EA rate" is claimed for a salary that is not', () => {
        const r = evaluatePayTerms({ ...salaried, annualSalary: 65000, exclusionReason: 'above_threshold' });
        expect(r.errors).toEqual([]);
        expect(clauses(r.warnings)).toEqual(['cl 2.2(b)']);
        // Money is shown in Gross Pay alone — the caution names the clause, not the figure.
        expect(r.warnings[0].message).not.toMatch(/\$/);
    });

    it('warns when a manager earns no more than Level 7', () => {
        const r = evaluatePayTerms({ ...salaried, annualSalary: 60000, exclusionReason: 'managerial' });
        expect(clauses(r.warnings)).toEqual(['cl 2.2(a)']);
    });

    it('stays quiet above the EA rate', () => {
        const r = evaluatePayTerms({ ...salaried, annualSalary: 95000, exclusionReason: 'above_threshold' });
        expect(r.warnings).toEqual([]);
    });

    it('compares Part-Time pro rata', () => {
        // 20h/week → threshold 70,997.68 × 20/38 = 37,367.20
        const pt = { ...salaried, employmentStatus: 'Part-Time', contractedWeeklyHours: 20, exclusionReason: 'above_threshold' as const };
        expect(evaluatePayTerms({ ...pt, annualSalary: 40000 }).warnings).toEqual([]);
        expect(evaluatePayTerms({ ...pt, annualSalary: 35000 }).warnings).toHaveLength(1);
    });
});

describe('evaluateEngagement — cl 13 multi-hire', () => {
    const fullTime = { status: 'Active', employment_status: 'Full-Time', role_id: 'role-supervisor' };

    it('treats a casual engagement beside a permanent one as a multi-hire', () => {
        const r = evaluateEngagement('Casual', 'role-usher', [fullTime], 'MH-0042');
        expect(r).toEqual({ kind: 'multi_hire', errors: [] });
    });

    it('needs the Request to Multi-Hire reference', () => {
        const r = evaluateEngagement('Casual', 'role-usher', [fullTime], '  ');
        expect(clauses(r.errors)).toEqual(['cl 13.1(d)']);
    });

    it('refuses the person\'s usual job', () => {
        const r = evaluateEngagement('Casual', 'role-supervisor', [fullTime], 'MH-0042');
        expect(clauses(r.errors)).toEqual(['cl 13.1(a)']);
    });

    it('is a primary engagement with no active permanent contract', () => {
        expect(evaluateEngagement('Casual', 'role-usher', [], '').kind).toBe('primary');
        expect(evaluateEngagement('Casual', 'role-usher', [{ ...fullTime, status: 'Terminated' }], '').kind).toBe('primary');
        expect(evaluateEngagement('Casual', 'role-usher', [{ status: 'Active', employment_status: 'Casual', role_id: 'x' }], '').kind).toBe('primary');
    });

    it('is a primary engagement when the new contract is not casual', () => {
        expect(evaluateEngagement('Part-Time', 'role-usher', [fullTime], '').kind).toBe('primary');
    });
});

describe('rates', () => {
    it('keys Level 0 as TRAINEE and annualised Security separately', () => {
        expect(ebaClassificationKey(0, 'eba_level')).toBe('TRAINEE');
        expect(ebaClassificationKey(7, 'eba_level')).toBe('LEVEL_7');
        expect(ebaClassificationKey(6, 'eba_security_annualised')).toBe('SECURITY_LEVEL_6');
    });

    it('takes the rate in force on the date', () => {
        expect(resolveEbaRate(SCHEDULE, 'LEVEL_7', 'casual', '2026-07-05')?.paidHourlyRate).toBe(42.74);
        expect(resolveEbaRate(SCHEDULE, 'LEVEL_7', 'casual', '2026-07-06')?.paidHourlyRate).toBe(44.92);
        expect(resolveEbaRate(SCHEDULE, 'LEVEL_7', 'casual', '2024-12-31')).toBeNull();
    });

    it('computes the cl 2.2(b) reading from Level 7', () => {
        expect(eaTopAnnualRate(SCHEDULE, TODAY)).toBe(TOP);
    });
});
