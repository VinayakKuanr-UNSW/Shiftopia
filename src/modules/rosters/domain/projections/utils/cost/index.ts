
import { CostCalculatorOptions, ShiftCostBreakdown } from './types';
import * as StandardEngine from './standard';
import * as SecurityEngine from './security';
import { Shift } from '../../../shift.entity';

/**
 * Dispatcher for cost estimation.
 * Selects the appropriate engine (Standard vs Security) based on the shift context.
 */

function isSecurityShift(options: CostCalculatorOptions | any): boolean {
  // If it's the raw options object
  if (options.isSecurityRole) return true;
  
  // Check if it's a Shift entity passed to the legacy wrappers
  const shift = options as Shift;
  if (shift.roles?.name?.toLowerCase().includes('security')) return true;
  
  return false;
}

export function estimateDetailedShiftCost(options: CostCalculatorOptions & { isSecurityRole?: boolean }): ShiftCostBreakdown {
  if (isSecurityShift(options)) {
    return SecurityEngine.estimateDetailedShiftCost(options);
  }
  return StandardEngine.estimateDetailedShiftCost(options);
}

export function estimateShiftCost(options: CostCalculatorOptions & { isSecurityRole?: boolean }): number {
  if (isSecurityShift(options)) {
    return SecurityEngine.estimateShiftCost(options);
  }
  return StandardEngine.estimateShiftCost(options);
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
    isSecurityRole: shift.roles?.name?.toLowerCase().includes('security')
  } as any);
}

export function estimateDetailedCostFromShift(shift: any, netMinutesOverride?: number): ShiftCostBreakdown {
  const mins = netMinutesOverride ?? shift.net_length_minutes ?? 0;
  return estimateDetailedShiftCost({
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
    isSecurityRole: shift.roles?.name?.toLowerCase().includes('security')
  } as any);
}
