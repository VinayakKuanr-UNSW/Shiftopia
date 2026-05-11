
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
  const mins = netMinutesOverride ?? shift.net_length_minutes ?? 0;
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
    employmentType: shift.target_employment_type,
    isSecurityRole: shift.roles?.name?.toLowerCase().includes('security'),
    classificationLevel: extractLevel(shift.roles?.name)
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

  const mins = netMinutesOverride ?? shift.net_length_minutes ?? shift.netLengthMinutes ?? 0;
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
    employmentType: (empType === 'FT' || /full/i.test(empType)) ? 'Full-Time' : (empType === 'PT' || /part/i.test(empType)) ? 'Part-Time' : (empType || 'Casual'),
    isSecurityRole: roleName?.toLowerCase().includes('security'),
    classificationLevel: extractLevel(roleName)
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
