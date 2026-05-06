
/**
 * Cost estimation utilities - Dispatcher
 * 
 * Separates Security logic from Standard ICC Sydney logic.
 * Security: Building Services -> Security
 */

export * from './cost/index';
export * from './cost/types';
export * from './cost/constants';

import { 
  estimateShiftCost as dispatcherEstimateShiftCost,
  estimateDetailedShiftCost as dispatcherEstimateDetailedShiftCost,
  estimateCostFromShift as dispatcherEstimateCostFromShift,
  estimateDetailedCostFromShift as dispatcherEstimateDetailedCostFromShift
} from './cost/index';
import { CostCalculatorOptions } from './cost/types';

// Multi-argument wrapper for backward compatibility
export function estimateShiftCost(
  netMinutes: number, 
  start_time: string, 
  end_time: string, 
  rate: number | null, 
  scheduled_length_minutes: number, 
  is_overnight: boolean, 
  is_cancelled: boolean, 
  shift_date: string, 
  allowances?: any,
  isAnnualLeave?: boolean, 
  isPersonalLeave?: boolean, 
  isCarerLeave?: boolean, 
  previousWage?: number,
  employmentType?: any,
  isSecurityRole?: boolean,
): number {
  return dispatcherEstimateShiftCost({
    netMinutes,
    start_time,
    end_time,
    rate,
    scheduled_length_minutes,
    is_overnight,
    is_cancelled,
    shift_date,
    allowances,
    isAnnualLeave,
    isPersonalLeave,
    isCarerLeave,
    previousWage,
    employmentType,
    isSecurityRole
  } as any);
}

export function estimateDetailedShiftCost(
  netMinutes: number,
  start_time: string,
  end_time: string,
  rate: number | null,
  scheduled_length_minutes: number,
  is_overnight: boolean,
  is_cancelled: boolean,
  shift_date: string,
  allowances?: any,
  isAnnualLeave?: boolean,
  isPersonalLeave?: boolean,
  isCarerLeave?: boolean,
  previousWage?: number,
  employmentType?: any,
  isSecurityRole?: boolean,
): any {
  return dispatcherEstimateDetailedShiftCost({
    netMinutes,
    start_time,
    end_time,
    rate,
    scheduled_length_minutes,
    is_overnight,
    is_cancelled,
    shift_date,
    allowances,
    isAnnualLeave,
    isPersonalLeave,
    isCarerLeave,
    previousWage,
    employmentType,
    isSecurityRole
  } as any);
}

export const estimateCostFromShift = dispatcherEstimateCostFromShift;
export const estimateDetailedCostFromShift = dispatcherEstimateDetailedCostFromShift;

export function formatCost(amount: number, currency = 'AUD'): string {
  return amount.toLocaleString('en-AU', {
    style:    'currency',
    currency,
    maximumFractionDigits: 2,
  });
}
