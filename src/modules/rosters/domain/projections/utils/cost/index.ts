
import { CostCalculatorOptions, ShiftCostBreakdown, ShiftPayTermsField } from './types';
import * as StandardEngine from './standard';
import * as SecurityEngine from './security';
import { Shift } from '../../../shift.entity';
import type { AwardContext } from './award-context';
import { buildAwardContext } from './award-context';
import { resolveShiftAllowances } from './shift-allowances';
import { isSecurityRoleName } from '@/modules/compliance/security-role';

/**
 * Dispatcher for cost estimation.
 * Selects the appropriate engine (Standard vs Security) based on the shift context.
 *
 * Phase 3: All dispatch functions now accept an optional AwardContext.
 * When provided, per-shift holiday/date lookups become O(1) map reads.
 */

function isSecurityShift(options: CostCalculatorOptions | any): boolean {
  // If it's the raw options object
  if (options.isSecurityRole) return true;
  
  // Check if it's a Shift entity passed to the legacy wrappers
  const shift = options as Shift;
  if (isSecurityRoleName(shift.roles?.name)) return true;
  
  return false;
}

// Compliance audit finding (2026-08-02, Schedule 1): every caller that fails
// to resolve a classification level from `extractLevel()` silently falls
// through to the engine's Level-1-casual default rate, with no visibility.
// De-duplicated per distinct unmatched role name so a large roster run (many
// shifts sharing one unrecognised role) logs once, not once per shift.
const warnedUnclassifiedRoles = new Set<string>();

export function extractLevel(roleName?: string | null): string | undefined {
  if (!roleName) return undefined;

  // 1. Check for explicit level shorthand L1, L2, TM1..7, etc.
  const match = roleName.match(/(?:L|Level\s*|TM\s*)(\d)/i);
  if (match) return `LEVEL_${match[1]}`;

  // 2. Trainee detection (Maps to WAGE_RATES.TRAINEE)
  if (roleName.toLowerCase().includes('trainee')) return 'TRAINEE';

  // 3. Common Role Mappings for ICC Sydney
  const name = roleName.toLowerCase();
  if (name.includes('supervisor')) return 'LEVEL_5';
  if (name.includes('team leader') || name.includes('shift leader')) return 'LEVEL_4';
  if (name.includes('officer')) return 'LEVEL_2';
  if (name.includes('attendant') || name.includes('crew')) return 'LEVEL_2';
  if (name.includes('assistant')) return 'LEVEL_1';
  if (name.includes('manager')) return 'LEVEL_7';

  // A real role name was supplied but none of the keyword patterns above
  // matched it — every caller resolves this `undefined` to the engine's
  // default rate (Level 1 casual), which is a silent Schedule 1
  // misclassification risk, not a benign "no role yet" case.
  if (!warnedUnclassifiedRoles.has(roleName)) {
    warnedUnclassifiedRoles.add(roleName);
    console.warn(
      `[cost/extractLevel] Role "${roleName}" did not match any Schedule 1 classification ` +
      'keyword — pricing will silently fall back to the default (Level 1 casual) rate. ' +
      'Add a keyword mapping or, preferably, resolve this role\'s classification_level explicitly ' +
      'instead of inferring it from the name.',
    );
  }

  return undefined;
}

/**
 * Resolve a shift's Schedule 1 classification.
 *
 * PREFERS the stored `remuneration_level`, which is real data, over
 * `extractLevel(role_name)`, which keyword-matches a free-text string and
 * returns undefined for anything it doesn't recognise ("Team Member" among
 * them) — silently pricing at the default Level 1 casual rate. The level only
 * became reliable once 20260806120100 made template-generated shifts inherit
 * `remuneration_level` from their template row; before that it was always NULL,
 * which is why the name-guess was the only signal available.
 */
function resolveClassificationLevel(
  remunerationLevel: unknown,
  roleName?: string | null,
): string | undefined {
  return levelClassification(remunerationLevel) ?? extractLevel(roleName);
}

/**
 * The engine's classification key for a stored level. Level 0 is the
 * Introductory level, stored as 'TRAINEE' in the rate schedule (eba_rate) —
 * it used to fall through to the role-name guess here. NULL/blank ⇒ undefined
 * (Number(null) is 0, so it must be ruled out before converting).
 */
export function levelClassification(level: unknown): string | undefined {
  if (level === null || level === undefined || level === '') return undefined;
  const lvl = Number(level);
  if (!Number.isInteger(lvl)) return undefined;
  if (lvl === 0) return 'TRAINEE';
  if (lvl >= 1 && lvl <= 7) return `LEVEL_${lvl}`;
  return undefined;
}

/** Roles already warned about a missing employment target (once per process). */
const warnedMissingTarget = new Set<string>();

/**
 * Normalise a shift's employment target into the engine's vocabulary.
 *
 * `shifts.target_employment_type` is NOT NULL as of 20260806120100, so a missing
 * value here means a synthetic/preview object, never a persisted shift. It used
 * to default to `'Casual'`, which silently priced 156 of 156 prod shifts at the
 * loaded casual rate on nothing more than an absent field. That assumption is
 * gone: an unknown target is reported and left undefined, so the engine prices
 * it as permanent rather than inventing a 25% loading.
 */
function resolveEmploymentType(empType?: string | null): string | undefined {
  if (empType === 'FT' || /full/i.test(empType || '')) return 'Full-Time';
  if (empType === 'PT' || /part/i.test(empType || '')) return 'Part-Time';
  if (empType) return empType;

  const key = 'missing-target';
  if (!warnedMissingTarget.has(key)) {
    warnedMissingTarget.add(key);
    console.warn(
      '[cost/resolveEmploymentType] A shift reached the cost engine with no ' +
      'target_employment_type. Every persisted shift must declare one ' +
      '(shifts.target_employment_type is NOT NULL) — pricing must not be guessed. ' +
      'Pass the shift\'s target, or the assigned employee\'s employment type.',
    );
  }
  return undefined;
}

/** The engine inputs that depend on WHO works a shift, and on what terms. */
export interface ShiftPayInputs {
  employmentType?: CostCalculatorOptions['employmentType'];
  classificationLevel?: string;
  higherDutiesLevel?: string;
  isSecurityRole: boolean;
  /** Set for a salaried contract: price as hours × this rate, no EA terms. */
  salaryHourlyRate?: number | null;
}

/**
 * Resolve those inputs for one shift — the same rule the budget
 * (internal.shift_cost) and payroll (shiftPayTerms.ts) apply.
 *
 * With `payTerms` (the `shift_pay_terms` computed field — the linked contract's
 * terms on the shift date): the contract level is the classification and a
 * higher shift level is cl 29 higher duties, which the engine prices on the
 * whole shift with a 4-hour minimum; annualised Security is Full-Time Security
 * whatever the role is called; a salary is priced on its hourly equivalent.
 *
 * Without them (unassigned, or a viewer who may not see the contract): the
 * shift's own level and employment target, else the role-name guess. No
 * per-shift rate override in either case — someone on a level is paid that
 * level (decision 2026-10-08; the SQL ignores them too).
 */
export function resolveShiftPayInputs(src: {
  payTerms?: ShiftPayTermsField | null;
  remunerationLevel?: unknown;
  targetEmploymentType?: string | null;
  roleName?: string | null;
  /** Explicit higher-duties level from a caller that already knows it. */
  higherDutiesLevel?: string;
}): ShiftPayInputs {
  const terms = src.payTerms;
  if (terms) {
    if (terms.pay_basis === 'salary') {
      return {
        employmentType: resolveEmploymentType(terms.employment_type ?? src.targetEmploymentType) as ShiftPayInputs['employmentType'],
        isSecurityRole: false,
        salaryHourlyRate: terms.base_rate,
      };
    }
    const higherDutiesLevel = terms.higher_duties ? levelClassification(terms.paid_level) : undefined;
    if (terms.pay_basis === 'eba_security_annualised') {
      return {
        employmentType: 'Full-Time',
        isSecurityRole: true,
        classificationLevel: levelClassification(terms.substantive_level),
        higherDutiesLevel,
      };
    }
    return {
      employmentType: resolveEmploymentType(terms.employment_type ?? src.targetEmploymentType) as ShiftPayInputs['employmentType'],
      isSecurityRole: isSecurityRoleName(src.roleName),
      classificationLevel: levelClassification(terms.substantive_level),
      higherDutiesLevel,
    };
  }
  return {
    employmentType: resolveEmploymentType(src.targetEmploymentType) as ShiftPayInputs['employmentType'],
    isSecurityRole: isSecurityRoleName(src.roleName),
    classificationLevel: resolveClassificationLevel(src.remunerationLevel, src.roleName),
    higherDutiesLevel: src.higherDutiesLevel,
  };
}

/** Minutes worked from start/end when no net length is stored. */
function minutesFromTimes(shift: {
  start_time?: string | null; end_time?: string | null;
  unpaid_break_minutes?: number | null; is_overnight?: boolean | null;
}): number {
  const toMin = (t?: string | null) => {
    const [h, m] = String(t ?? '').split(':').map(Number);
    return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : NaN;
  };
  const start = toMin(shift.start_time);
  let end = toMin(shift.end_time);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (shift.is_overnight || end <= start) end += 1440;
  return Math.max(0, end - start - (shift.unpaid_break_minutes ?? 0));
}

/**
 * A shift worked on a salaried contract: hours × the salary's hourly
 * equivalent, no EA loadings, penalties or overtime (internal.shift_cost's
 * salary branch). Budget cost, flagged `payBasis: 'salary'` for pay views.
 */
export function salariedShiftBreakdown(
  netMinutes: number | null | undefined,
  hourlyRate: number | null | undefined,
  shift: Parameters<typeof minutesFromTimes>[0] = {},
): ShiftCostBreakdown {
  const minutes = netMinutes ?? minutesFromTimes(shift);
  const hours = Math.max(0, minutes) / 60;
  const rate = Number(hourlyRate) || 0;
  const cost = Math.round(hours * rate * 100) / 100;
  return {
    totalCost: cost,
    ordinaryCost: cost,
    overtimeCost: 0,
    penaltyCost: 0,
    allowanceCost: 0,
    ordinaryHours: hours,
    overtimeHours: 0,
    breakdown: {
      baseRate: rate,
      ordinaryRate: rate,
      penaltyRate: rate,
      isCasual: false,
      nightHours: 0,
      nightAllowanceCost: 0,
    },
    payBasis: 'salary',
  };
}

export function estimateDetailedShiftCost(
  options: CostCalculatorOptions & { isSecurityRole?: boolean },
  ctx?: AwardContext,
): ShiftCostBreakdown {
  if (isSecurityShift(options)) {
    return SecurityEngine.estimateDetailedShiftCost(options, ctx);
  }
  return StandardEngine.estimateDetailedShiftCost(options, ctx);
}

export function estimateShiftCost(
  options: CostCalculatorOptions & { isSecurityRole?: boolean },
  ctx?: AwardContext,
): number {
  if (isSecurityShift(options)) {
    return SecurityEngine.estimateShiftCost(options, ctx);
  }
  return StandardEngine.estimateShiftCost(options, ctx);
}

// Legacy wrappers to maintain compatibility with existing call sites
export function estimateCostFromShift(shift: any, netMinutesOverride?: number): number {
  // No trailing `?? 0`: when neither an override nor a stored net-length is
  // available, `mins` must stay `undefined` so estimateShiftCost's own
  // start/end-time fallback runs — coercing to a synthetic 0 here would read
  // as "genuinely zero minutes worked" and zero out the estimate.
  const mins = netMinutesOverride ?? shift.net_length_minutes;
  const pay = resolveShiftPayInputs({
    payTerms: shift.shift_pay_terms,
    remunerationLevel: shift.remuneration_level,
    targetEmploymentType: shift.target_employment_type,
    roleName: shift.roles?.name,
    higherDutiesLevel: shift.higherDutiesLevel,
  });
  if (pay.salaryHourlyRate !== undefined) {
    return salariedShiftBreakdown(mins, pay.salaryHourlyRate, shift).totalCost;
  }
  return estimateShiftCost({
    netMinutes: mins,
    start_time: shift.start_time,
    end_time: shift.end_time,
    rate: null,
    scheduled_length_minutes: shift.scheduled_length_minutes ?? 0,
    is_overnight: shift.is_overnight,
    is_cancelled: shift.is_cancelled,
    shift_date: shift.shift_date,
    allowances: resolveShiftAllowances(shift),
    isAnnualLeave: shift.isAnnualLeave,
    isPersonalLeave: shift.isPersonalLeave,
    isCarerLeave: shift.isCarerLeave,
    previousWage: shift.previousWage,
    // cl 36.1 — the engine's start/end fallback can only net out the unpaid meal
    // break if it is told about it. Omitting this key silently PAID the break on
    // every caller that relies on that fallback.
    unpaid_break_minutes: shift.unpaid_break_minutes,
    employmentType: pay.employmentType,
    isSecurityRole: pay.isSecurityRole,
    classificationLevel: pay.classificationLevel,
    // cl 42 weekly OT is cross-shift context this single-shift wrapper can't
    // derive; pass it through only if a caller has already computed it. Undefined
    // ⇒ no weekly OT (unchanged legacy behaviour).
    priorOrdinaryHoursThisWeek: shift.priorOrdinaryHoursThisWeek,
    higherDutiesLevel: pay.higherDutiesLevel,
  } as any);
}

/**
 * Simple in-memory cache for cost calculations.
 * Since Shift objects from TanStack Query are referentially stable for a given data version,
 * we can use a WeakMap to cache costs without leaking memory.
 */
const costCache = new WeakMap<any, ShiftCostBreakdown>();

export function estimateDetailedCostFromShift(shift: any, netMinutesOverride?: number): ShiftCostBreakdown {
  // If we have a cached result and no override is provided, return it.
  // We only cache if no override is provided to ensure accuracy.
  if (!netMinutesOverride && costCache.has(shift)) {
    return costCache.get(shift)!;
  }

  // See estimateCostFromShift above: no trailing `?? 0`, for the same reason.
  const mins = netMinutesOverride ?? shift.net_length_minutes ?? shift.netLengthMinutes;
  const roleName = shift.roles?.name || shift.roleName;
  const empType = shift.target_employment_type || shift.employmentType;
  const pay = resolveShiftPayInputs({
    payTerms: shift.shift_pay_terms,
    remunerationLevel: shift.remuneration_level,
    targetEmploymentType: empType,
    roleName,
    higherDutiesLevel: shift.higherDutiesLevel,
  });

  if (pay.salaryHourlyRate !== undefined) {
    const salaried = salariedShiftBreakdown(mins, pay.salaryHourlyRate, shift);
    if (!netMinutesOverride) costCache.set(shift, salaried);
    return salaried;
  }

  const result = estimateDetailedShiftCost({
    netMinutes: mins,
    start_time: shift.start_time,
    end_time: shift.end_time,
    rate: null,
    scheduled_length_minutes: shift.scheduled_length_minutes ?? 0,
    is_overnight: shift.is_overnight,
    is_cancelled: shift.is_cancelled,
    shift_date: shift.shift_date,
    allowances: resolveShiftAllowances(shift),
    isAnnualLeave: shift.isAnnualLeave,
    isPersonalLeave: shift.isPersonalLeave,
    isCarerLeave: shift.isCarerLeave,
    previousWage: shift.previousWage,
    // See estimateCostFromShift — without this the unpaid meal break is paid.
    unpaid_break_minutes: shift.unpaid_break_minutes,
    employmentType: pay.employmentType,
    isSecurityRole: pay.isSecurityRole,
    classificationLevel: pay.classificationLevel,
    // See estimateCostFromShift — cross-shift weekly-OT context is only forwarded
    // when a caller has already computed it; undefined leaves weekly OT off.
    priorOrdinaryHoursThisWeek: shift.priorOrdinaryHoursThisWeek,
    higherDutiesLevel: pay.higherDutiesLevel,
    is_training_shift: shift.is_training,
  } as any);

  // Cache the result if no override was used
  if (!netMinutesOverride) {
    costCache.set(shift, result);
  }

  return result;
}

// Re-export AwardContext builder for use by projectors and pipeline
export { buildAwardContext } from './award-context';
export type { AwardContext } from './award-context';
