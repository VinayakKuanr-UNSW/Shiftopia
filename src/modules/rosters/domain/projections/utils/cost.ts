
/**
 * Cost estimation utilities - Dispatcher
 * 
 * Separates Security logic from Standard ICC Sydney logic.
 * Security: Building Services -> Security
 */

// Re-export everything except the ones we override
export * from './cost/types';
export * from './cost/constants';

import { 
  estimateShiftCost as dispatcherEstimateShiftCost,
  estimateDetailedShiftCost as dispatcherEstimateDetailedShiftCost,
  estimateCostFromShift as dispatcherEstimateCostFromShift,
  estimateDetailedCostFromShift as dispatcherEstimateDetailedCostFromShift
} from './cost/index';

// Re-export these names explicitly to avoid any 'export *' ambiguity
export { 
  estimateCostFromShift, 
  estimateDetailedCostFromShift,
  extractLevel
} from './cost/index';

// Multi-argument wrapper for backward compatibility - OVERRIDES the one in index.ts
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
  is_apprentice?: boolean,
  apprentice_type?: any,
  apprentice_year?: number,
  has_completed_year_12?: boolean,
  is_trainee?: boolean,
  trainee_category?: any,
  trainee_level?: any,
  trainee_exit_year?: number,
  trainee_years_out?: number,
  trainee_aqf_level?: number,
  trainee_year?: number,
  is_training_on_job?: boolean,
  prefers_sba_loading?: boolean,
  is_sws?: boolean,
  sws_capacity_percentage?: number,
  is_sws_trial?: boolean,
  sws_trial_start_date?: string,
  classificationLevel?: string
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
    isSecurityRole,
    is_apprentice,
    apprentice_type,
    apprentice_year,
    has_completed_year_12,
    is_trainee,
    trainee_category,
    trainee_level,
    trainee_exit_year,
    trainee_years_out,
    trainee_aqf_level,
    trainee_year,
    is_training_on_job,
    prefers_sba_loading,
    is_sws,
    sws_capacity_percentage,
    is_sws_trial,
    sws_trial_start_date,
    classificationLevel
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
  is_apprentice?: boolean,
  apprentice_type?: any,
  apprentice_year?: number,
  has_completed_year_12?: boolean,
  is_trainee?: boolean,
  trainee_category?: any,
  trainee_level?: any,
  trainee_exit_year?: number,
  trainee_years_out?: number,
  trainee_aqf_level?: number,
  trainee_year?: number,
  is_training_on_job?: boolean,
  prefers_sba_loading?: boolean,
  is_sws?: boolean,
  sws_capacity_percentage?: number,
  is_sws_trial?: boolean,
  sws_trial_start_date?: string,
  classificationLevel?: string
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
    isSecurityRole,
    is_apprentice,
    apprentice_type,
    apprentice_year,
    has_completed_year_12,
    is_trainee,
    trainee_category,
    trainee_level,
    trainee_exit_year,
    trainee_years_out,
    trainee_aqf_level,
    trainee_year,
    is_training_on_job,
    prefers_sba_loading,
    is_sws,
    sws_capacity_percentage,
    is_sws_trial,
    sws_trial_start_date,
    classificationLevel
  } as any);
}

export function formatCost(amount: number, currency = 'AUD'): string {
  return amount.toLocaleString('en-AU', {
    style:    'currency',
    currency,
    maximumFractionDigits: 2,
  });
}
