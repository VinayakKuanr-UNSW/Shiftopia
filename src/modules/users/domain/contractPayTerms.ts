/**
 * Contract pay terms — HOW a contract is paid, separate from how it is engaged.
 *
 * Pure rules (no Supabase) for the contract wizard. They mirror the CHECKs on
 * hr.user_contracts (migration 20261008100113_contract_pay_basis), so a wrong
 * combination is explained with its clause before the database refuses it, and
 * add the rules the database cannot see (role band, Security, the EA ceiling).
 *
 * ICC Sydney EA 2025 — pay follows COVERAGE, not employment type:
 *   • eba_level — the Schedule 2 §1 rate for a Schedule 1 level (L0 is the
 *     Introductory level, stored as 'TRAINEE'). The ONLY basis for a casual.
 *     Schedule 2 §1 covers "Team Members other than Full-time Security", so a
 *     Full-Time Security engagement is never on it.
 *   • eba_security_annualised — Full-Time Security, Levels 3–6, on a 12-hour
 *     continuous roster averaging 42 h/week (Sch 2 §2, Sch 3 §3.1).
 *   • salary — outside the EA: managerial (cl 2.2(a)) or a Full-Time Team
 *     Member earning more than the EA's highest rate (cl 2.2(b), pro rata for
 *     Part-Time). Full-Time or Part-Time only; no level; Schedules 4–6 do not
 *     apply.
 *
 * A level outside the role's band is allowed — EA levels follow competency,
 * not job title — but needs a note saying why.
 */

// ── Constants ──────────────────────────────────────────────────────────────

export type PayBasis = 'eba_level' | 'eba_security_annualised' | 'salary';
export type EbaExclusionReason = 'managerial' | 'above_threshold';

export const PAY_BASIS_LABELS: Record<PayBasis, string> = {
    eba_level: 'EA level',
    eba_security_annualised: 'Security annualised',
    salary: 'Salaried',
};

export const EXCLUSION_REASON_LABELS: Record<EbaExclusionReason, string> = {
    managerial: 'Managerial — cl 2.2(a)',
    above_threshold: 'Above the EA\'s highest rate — cl 2.2(b)',
};

/** Sch 2 §2 pays annualised Security at these levels only. */
export const SECURITY_ANNUALISED_LEVELS: readonly number[] = [3, 4, 5, 6];

/** Ordinary hours in a full-time week (cl 12.2(b)). */
export const ORDINARY_WEEK_HOURS = 38;

/** Average weekly hours of the Full-Time Security roster: 38 + 4 (Sch 3 §3.1(d)). */
export const SECURITY_ROSTER_WEEK_HOURS = 42;

const WEEKS_PER_YEAR = 52;

// ── Types ──────────────────────────────────────────────────────────────────

/** A role's EA band. Both null = no EA guidance (any level allowed). */
export interface RoleBand {
    eba_level_min: number | null;
    eba_level_max: number | null;
}

/** One requirement or caution, with the clause behind it. */
export interface PayIssue {
    message: string;
    clause: string;
}

export interface PayTermsInput {
    employmentStatus: string;
    payBasis: PayBasis;
    level: number | '';
    /** 0 = not entered. */
    annualSalary: number;
    exclusionReason: EbaExclusionReason | '';
    band: RoleBand | null;
    /** Why the level sits outside the role's band. */
    levelNote: string;
    isSecurityRole: boolean;
    /** Apprentice, trainee or supported wage is switched on. */
    usesWageScheme: boolean;
    contractedWeeklyHours: number;
    /** The EA's highest annual rate on the start date — see eaTopAnnualRate(). */
    eaTopAnnualRate: number | null;
}

export interface PayEvaluation {
    /** Block saving. */
    errors: PayIssue[];
    /** Shown, never block. */
    warnings: PayIssue[];
    levelOutsideBand: boolean;
}

// ── Bases ──────────────────────────────────────────────────────────────────

/** The pay bases an engagement may use. */
export function allowedPayBases(employmentStatus: string, isSecurityRole: boolean): PayBasis[] {
    if (employmentStatus === 'Full-Time') {
        return isSecurityRole ? ['eba_security_annualised', 'salary'] : ['eba_level', 'salary'];
    }
    if (employmentStatus === 'Part-Time') return ['eba_level', 'salary'];
    // Casual and Flexible Part-Time: always on a level.
    return ['eba_level'];
}

/** The basis the wizard starts on for an engagement. */
export function defaultPayBasis(
    employmentStatus: string,
    isSecurityRole: boolean,
    typicallySalaried: boolean,
): PayBasis {
    const allowed = allowedPayBases(employmentStatus, isSecurityRole);
    if (typicallySalaried && allowed.includes('salary')) return 'salary';
    return allowed[0];
}

// ── Band ───────────────────────────────────────────────────────────────────

export function hasBand(band: RoleBand | null | undefined): band is { eba_level_min: number; eba_level_max: number } {
    return band != null && band.eba_level_min != null && band.eba_level_max != null;
}

/** True when the level is inside the band, or the role has no band. */
export function isLevelInBand(level: number, band: RoleBand | null | undefined): boolean {
    if (!hasBand(band)) return true;
    return level >= band.eba_level_min && level <= band.eba_level_max;
}

/** "L6–L7", "L4", or null when the role has no band. */
export function formatBand(band: RoleBand | null | undefined): string | null {
    if (!hasBand(band)) return null;
    return band.eba_level_min === band.eba_level_max
        ? `L${band.eba_level_min}`
        : `L${band.eba_level_min}–L${band.eba_level_max}`;
}

// ── Rules ──────────────────────────────────────────────────────────────────

export function evaluatePayTerms(input: PayTermsInput): PayEvaluation {
    const errors: PayIssue[] = [];
    const warnings: PayIssue[] = [];
    const { employmentStatus, payBasis, level, band } = input;

    const allowed = allowedPayBases(employmentStatus, input.isSecurityRole);
    if (!allowed.includes(payBasis)) {
        errors.push(basisNotAllowed(employmentStatus, payBasis, input.isSecurityRole));
    }

    let levelOutsideBand = false;

    if (payBasis === 'eba_level' || payBasis === 'eba_security_annualised') {
        if (level === '') {
            errors.push({ message: 'Choose a level.', clause: 'Sch 1' });
        } else {
            if (payBasis === 'eba_security_annualised' && !SECURITY_ANNUALISED_LEVELS.includes(level)) {
                errors.push({
                    message: 'Annualised Security pay covers Levels 3–6 only.',
                    clause: 'Sch 2 §2',
                });
            }
            levelOutsideBand = !isLevelInBand(level, band);
            if (levelOutsideBand && input.levelNote.trim() === '') {
                errors.push({
                    message: `Level ${level} is outside this role's range (${formatBand(band)}). Add a note saying why.`,
                    clause: 'Sch 1',
                });
            }
        }
    }

    if (payBasis === 'salary') {
        if (!(input.annualSalary > 0)) {
            errors.push({ message: 'Enter the annual salary.', clause: 'cl 2.2' });
        }
        if (input.exclusionReason === '') {
            errors.push({
                message: 'Say why this contract is outside the EA: managerial, or paid above the EA\'s highest rate.',
                clause: 'cl 2.2',
            });
        }
        if (input.usesWageScheme) {
            errors.push({
                message: 'Apprentice, trainee and supported-wage schedules apply only under the EA.',
                clause: 'Sch 4–6',
            });
        }

        const threshold = salaryThreshold(input.eaTopAnnualRate, employmentStatus, input.contractedWeeklyHours);
        if (threshold != null && input.annualSalary > 0 && input.annualSalary <= threshold) {
            if (input.exclusionReason === 'above_threshold') {
                warnings.push({
                    message: `cl 2.2(b) only excludes someone paid more than the EA's highest rate${employmentStatus === 'Part-Time' ? ' (pro rata)' : ''}. At this salary they are probably covered by the EA.`,
                    clause: 'cl 2.2(b)',
                });
            } else if (input.exclusionReason === 'managerial') {
                warnings.push({
                    message: `This pays no more than an EA Level 7 earns${employmentStatus === 'Part-Time' ? ' (pro rata)' : ''}. Check the role really is managerial.`,
                    clause: 'cl 2.2(a)',
                });
            }
        }
    }

    return { errors, warnings, levelOutsideBand };
}

function basisNotAllowed(employmentStatus: string, payBasis: PayBasis, isSecurityRole: boolean): PayIssue {
    if (employmentStatus === 'Casual') {
        return { message: 'A casual is always paid at an EA level.', clause: 'Sch 2 §1' };
    }
    if (payBasis === 'salary') {
        return {
            message: 'Salaried engagements are Full-Time or Part-Time only — Flexible Part-Time has no guaranteed weekly hours.',
            clause: 'cl 12.4(b)',
        };
    }
    if (payBasis === 'eba_security_annualised') {
        return isSecurityRole
            ? { message: 'Annualised Security pay is for Full-Time engagements only.', clause: 'Sch 2 §2' }
            : { message: 'Annualised pay applies only to Security roles.', clause: 'Sch 3 §1.1' };
    }
    // eba_level on a Full-Time Security engagement.
    return {
        message: 'Full-Time Security are paid the annualised Security rate, not the Schedule 2 §1 rate.',
        clause: 'Sch 2 §1–2',
    };
}

/** cl 2.2(b) threshold for this engagement: the EA top rate, pro rata for Part-Time. */
function salaryThreshold(top: number | null, employmentStatus: string, weeklyHours: number): number | null {
    if (top == null) return null;
    if (employmentStatus === 'Part-Time') {
        return weeklyHours > 0 ? top * (weeklyHours / ORDINARY_WEEK_HOURS) : null;
    }
    return top;
}

// ── Engagement (cl 13 multi-hire) ──────────────────────────────────────────

export interface HeldContract {
    status: string | null;
    employment_status: string | null;
    role_id?: string | null;
}

export interface EngagementEvaluation {
    kind: 'primary' | 'multi_hire';
    errors: PayIssue[];
}

/**
 * A casual engagement taken by someone who already holds an Active permanent
 * contract is a multi-hire (cl 13.1): the Team Member asks for it on a Request
 * to Multi-Hire form, and the work must be outside their usual job.
 */
export function evaluateEngagement(
    employmentStatus: string,
    roleId: string,
    held: readonly HeldContract[],
    requestRef: string,
): EngagementEvaluation {
    const permanent = held.filter(c =>
        c.status === 'Active' && !!c.employment_status && c.employment_status !== 'Casual');
    if (employmentStatus !== 'Casual' || permanent.length === 0) {
        return { kind: 'primary', errors: [] };
    }
    const errors: PayIssue[] = [];
    if (roleId && permanent.some(c => c.role_id === roleId)) {
        errors.push({
            message: 'A multi-hire engagement must be work outside the person\'s usual job — pick a different role.',
            clause: 'cl 13.1(a)',
        });
    }
    if (requestRef.trim() === '') {
        errors.push({
            message: 'Record the Request to Multi-Hire form reference — the Team Member asks for a multi-hire engagement.',
            clause: 'cl 13.1(d)',
        });
    }
    return { kind: 'multi_hire', errors };
}

// ── Rates ──────────────────────────────────────────────────────────────────

/** Structural subset of payroll's EbaRateRow / EbaRateSet. */
export interface EbaRateLike {
    classification: string;
    employmentBasis: 'permanent' | 'casual' | 'annualised';
    ordinaryHourlyRate: number;
    paidHourlyRate: number;
}

export interface EbaRateSetLike {
    effectiveFrom: string;
    rates: readonly EbaRateLike[];
}

/** eba_rate key for a level: L0 is 'TRAINEE'; annualised Security is 'SECURITY_LEVEL_n'. */
export function ebaClassificationKey(level: number, payBasis: PayBasis): string {
    if (payBasis === 'eba_security_annualised') return `SECURITY_LEVEL_${level}`;
    return level === 0 ? 'TRAINEE' : `LEVEL_${level}`;
}

/** The latest rate for this classification and basis in force on a date. */
export function resolveEbaRate(
    schedule: readonly EbaRateSetLike[],
    classification: string,
    employmentBasis: EbaRateLike['employmentBasis'],
    onDate: string,
): EbaRateLike | null {
    let found: EbaRateLike | null = null;
    let foundFrom = '';
    for (const set of schedule) {
        if (set.effectiveFrom > onDate || set.effectiveFrom < foundFrom) continue;
        const row = set.rates.find(r => r.classification === classification && r.employmentBasis === employmentBasis);
        if (row) {
            found = row;
            foundFrom = set.effectiveFrom;
        }
    }
    return found;
}

/**
 * The EA's highest annual rate under the reading used for cl 2.2(b) warnings:
 * the Level 7 ordinary rate for a full year of 38-hour weeks. (The other
 * reading — Full-Time Security Level 6 annualised — is higher.)
 */
export function eaTopAnnualRate(schedule: readonly EbaRateSetLike[], onDate: string): number | null {
    const l7 = resolveEbaRate(schedule, 'LEVEL_7', 'permanent', onDate);
    return l7 ? round2(l7.ordinaryHourlyRate * ORDINARY_WEEK_HOURS * WEEKS_PER_YEAR) : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
