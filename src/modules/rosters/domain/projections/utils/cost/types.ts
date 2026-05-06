
import type { Shift } from '../../../shift.entity';

export interface ShiftCostBreakdown {
  totalCost: number;
  ordinaryCost: number;
  overtimeCost: number;
  penaltyCost: number;
  allowanceCost?: number;
  ordinaryHours: number;
  overtimeHours: number;
  breakdown: {
    baseRate: number;
    ordinaryRate: number;
    penaltyRate: number;
    isCasual: boolean;
    isApprentice?: boolean;
    isTrainee?: boolean;
    nightHours?: number;
    nightAllowanceCost?: number;
  };
}

export interface CostCalculatorOptions {
  netMinutes: number;
  start_time: string;
  end_time: string;
  rate: number | null;
  scheduled_length_minutes: number;
  is_overnight: boolean;
  is_cancelled: boolean;
  shift_date: string;
  allowances?: {
    meal?: boolean;
    firstAid?: boolean;
    proteinSpill?: boolean;
    splitShift?: boolean;
  };
  isAnnualLeave?: boolean;
  isPersonalLeave?: boolean;
  isCarerLeave?: boolean;
  previousWage?: number;
  employmentType?: 'Full-Time' | 'Part-Time' | 'Casual' | 'Flexible Part-Time';
  isSecurityRole?: boolean;
  
  // Apprentice Support (Schedule 4)
  is_apprentice?: boolean;
  apprentice_type?: 'standard' | 'adult' | 'school_based';
  apprentice_year?: number;
  has_completed_year_12?: boolean;

  // Trainee Support (Schedule 5)
  is_trainee?: boolean;
  trainee_category?: 'junior' | 'adult' | 'school_based';
  trainee_level?: 'A' | 'B';
  trainee_exit_year?: number;
  trainee_years_out?: number;
  trainee_aqf_level?: number;
  trainee_year?: number;
  is_training_on_job?: boolean;
  prefers_sba_loading?: boolean;

  // SWS Support (Schedule 6)
  is_sws?: boolean;
  sws_capacity_percentage?: number;
  is_sws_trial?: boolean;
  sws_trial_start_date?: string;
}

export interface CostEngine {
  estimateDetailedShiftCost(options: CostCalculatorOptions): ShiftCostBreakdown;
  estimateShiftCost(options: CostCalculatorOptions): number;
}
