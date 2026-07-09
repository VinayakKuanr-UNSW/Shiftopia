
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
  classificationLevel?: string;

  // ── Higher duties (cl 29) ────────────────────────────────────────────────
  // Classification the member is TEMPORARILY performing above their substantive
  // grade for this shift. When it resolves (via the same wageRates lookup as
  // classificationLevel) to a HIGHER rate than the substantive base, the whole
  // shift is priced at the higher rate — max(substantive, higherDuties), never
  // underpay. Only affects the classification/rate path (not apprentice /
  // trainee / SWS). Key form matches classificationLevel (e.g. 'LEVEL_5').
  higherDutiesLevel?: string;

  // ── Weekly overtime (cl 42) ──────────────────────────────────────────────
  // Ordinary hours this member has ALREADY accumulated earlier in the same ISO
  // week (Mon-anchored), BEFORE this shift, from prior shifts ordered by
  // date/time. When provided (non-casual only), the ordinary hours on THIS shift
  // that push the running weekly total past 38h are re-priced as overtime rather
  // than ordinary. UNDEFINED / null ⇒ weekly OT is OFF and behaviour is exactly
  // as before (safe-by-default). Casual weekly OT is ambiguous under the EA, so
  // it is deliberately not applied even when a value is supplied for a casual.
  priorOrdinaryHoursThisWeek?: number;
}

export interface CostEngine {
  estimateDetailedShiftCost(options: CostCalculatorOptions): ShiftCostBreakdown;
  estimateShiftCost(options: CostCalculatorOptions): number;
}
