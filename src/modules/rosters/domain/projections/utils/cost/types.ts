
import type { Shift } from '../../shift.entity';

export interface ShiftCostBreakdown {
  baseCost: number;
  penaltyCost: number;
  overtimeCost: number;
  allowanceCost: number;
  leaveLoadingCost: number;
  totalCost: number;
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
  employmentType?: 'FT' | 'PT' | 'Casual' | 'Unassigned' | null;
}

export interface CostEngine {
  estimateDetailedShiftCost(options: CostCalculatorOptions): ShiftCostBreakdown;
  estimateShiftCost(options: CostCalculatorOptions): number;
}
