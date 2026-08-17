
import { CostCalculatorOptions, ShiftCostBreakdown } from './types';
import * as StandardEngine from './standard';
import * as SecurityEngine from './security';
import { Shift } from '../../../shift.entity';
import type { AwardContext } from './award-context';
import { buildAwardContext } from './award-context';

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
  if (shift.roles?.name?.toLowerCase().includes('security')) return true;
  
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

  // 1. Check for explicit level shorthand L1, L2, etc.
  const match = roleName.match(/(?:L|Level\s*)(\d)/i);
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
  const lvl = Number(remunerationLevel);
  if (Number.isInteger(lvl) && lvl >= 1 && lvl <= 7) return `LEVEL_${lvl}`;
  return extractLevel(roleName);
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
  return estimateShiftCost({
    netMinutes: mins,
    start_time: shift.start_time,
    end_time: shift.end_time,
    rate: shift.remuneration_rate,
    scheduled_length_minutes: shift.scheduled_length_minutes ?? 0,
    is_overnight: shift.is_overnight,
    is_cancelled: shift.is_cancelled,
    shift_date: shift.shift_date,
    allowances: shift.allowances,
    isAnnualLeave: shift.isAnnualLeave,
    isPersonalLeave: shift.isPersonalLeave,
    isCarerLeave: shift.isCarerLeave,
    previousWage: shift.previousWage,
    // cl 36.1 — the engine's start/end fallback can only net out the unpaid meal
    // break if it is told about it. Omitting this key silently PAID the break on
    // every caller that relies on that fallback.
    unpaid_break_minutes: shift.unpaid_break_minutes,
    employmentType: shift.target_employment_type,
    isSecurityRole: shift.roles?.name?.toLowerCase().includes('security'),
    classificationLevel: resolveClassificationLevel(shift.remuneration_level, shift.roles?.name),
    // cl 42 weekly OT is cross-shift context this single-shift wrapper can't
    // derive; pass it through only if a caller has already computed it. Undefined
    // ⇒ no weekly OT (unchanged legacy behaviour).
    priorOrdinaryHoursThisWeek: shift.priorOrdinaryHoursThisWeek,
    higherDutiesLevel: shift.higherDutiesLevel,
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
  
  const result = estimateDetailedShiftCost({
    netMinutes: mins,
    start_time: shift.start_time,
    end_time: shift.end_time,
    rate: shift.actual_hourly_rate || shift.remuneration_rate,
    scheduled_length_minutes: shift.scheduled_length_minutes ?? 0,
    is_overnight: shift.is_overnight,
    is_cancelled: shift.is_cancelled,
    shift_date: shift.shift_date,
    allowances: shift.allowances,
    isAnnualLeave: shift.isAnnualLeave,
    isPersonalLeave: shift.isPersonalLeave,
    isCarerLeave: shift.isCarerLeave,
    previousWage: shift.previousWage,
    // See estimateCostFromShift — without this the unpaid meal break is paid.
    unpaid_break_minutes: shift.unpaid_break_minutes,
    employmentType: resolveEmploymentType(empType),
    isSecurityRole: roleName?.toLowerCase().includes('security'),
    classificationLevel: resolveClassificationLevel(shift.remuneration_level, roleName),
    // See estimateCostFromShift — cross-shift weekly-OT context is only forwarded
    // when a caller has already computed it; undefined leaves weekly OT off.
    priorOrdinaryHoursThisWeek: shift.priorOrdinaryHoursThisWeek,
    higherDutiesLevel: shift.higherDutiesLevel,
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
