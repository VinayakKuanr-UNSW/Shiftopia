
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
  /** AUDIT FIX L4: per-day-type hour/cost split populated by both engines, so
   *  the line-item decomposition reads it instead of re-deriving from scratch. */
  penaltyBreakdown?: {
    satHours: number; sunHours: number; phHours: number;
    satCost: number; sunCost: number; phCost: number;
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
  /**
   * Unpaid meal break (cl 36.1), in minutes. Only consulted by the Standard
   * engine's OWN start/end-time fallback derivation (when `netMinutes` isn't
   * supplied) — every caller that already computes `netMinutes` itself must
   * subtract the break there instead (the "single source of truth" contract
   * on `netMinutes` below). Security shifts never subtract this: Sch.3
   * §3.2/§5.3 meal breaks are PAID, so `cost/security.ts` deliberately never
   * reads this field (compliance audit finding — 2026-08-02).
   */
  unpaid_break_minutes?: number;
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
  /**
   * cl 46 / NES Div 11 — family & domestic violence leave. PAID for CASUALS too
   * (cl 46.6: "paid for the hours the Team Member is rostered on the day the
   * leave is taken") — the only leave flag that must NOT zero out a casual.
   * Priced flat: permanents at the de-loaded ordinary rate (like personal
   * leave); casuals at their loaded base rate (the 25% loading is part of a
   * casual's ordinary rate, cl 12.5(b)). No penalties, no leave loading, no
   * min-engagement floor, no overtime.
   */
  isFdvLeave?: boolean;
  previousWage?: number;
  employmentType?: 'Full-Time' | 'Part-Time' | 'Casual' | 'Flexible Part-Time';
  isSecurityRole?: boolean;
  /**
   * True when this occurrence is a TRAINING shift (`shifts.is_training`) —
   * drops the minimum-engagement PAYMENT floor to 2h, mirroring the
   * scheduling-time rule. NOT the same concept as `is_trainee` below (a
   * Schedule 5 Trainee WAGE CLASSIFICATION) — a trainee can work a
   * non-training shift, and a non-trainee can work a training shift.
   */
  is_training_shift?: boolean;
  
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

  // ── SWS minimum weekly payment (Schedule 6 cl 1.4.2) ─────────────────────────
  // The SWS floor of $90/week is a WEEKLY minimum, which a per-shift engine can
  // only enforce when told the member's total ordinary hours rostered across the
  // whole (ISO) week. Given that, the floor becomes an equivalent hourly rate
  // (SWS_MIN_WEEKLY / swsWeeklyHours) and the SWS base rate is lifted to the
  // greater of it and the assessed-capacity rate. UNDEFINED / null / ≤0 ⇒ the
  // floor is a no-op (safe-by-default) and the assessed-capacity rate stands —
  // exactly the prior behaviour. Only meaningful when `is_sws` is set.
  swsWeeklyHours?: number;

  // ── Higher duties (cl 29) ────────────────────────────────────────────────
  // Classification the member is TEMPORARILY performing above their substantive
  // grade for this shift. When it resolves (via the same wageRates lookup as
  // classificationLevel) to a HIGHER rate than the substantive base, the whole
  // shift is priced at the higher rate — max(substantive, higherDuties), never
  // underpay. Only affects the classification/rate path (not apprentice /
  // trainee / SWS). Key form matches classificationLevel (e.g. 'LEVEL_5').
  higherDutiesLevel?: string;

  // ── Multi-hire engagements (cl 13.1(e)) ──────────────────────────────────
  // A genuinely separate same-day hire (typically a different role) gets a
  // reduced 2h minimum engagement instead of the standard 3h/4h floor, but
  // ONLY when it commences within one (1) hour of the Team Member's usual
  // rostered finish time (cl 13.1(e))— see `multiHireStartsWithinUsualFinishWindow`
  // below. Mirrors `V8Shift.shift_type` in the compliance engine (audit M-1)
  // — NOT yet populated by any live adapter (no `shifts.shift_type` column
  // exists), so this is currently a no-op in production; wired ahead of the
  // data existing, same pattern as the H-13 payroll-export writers.
  shift_type?: 'NORMAL' | 'MULTI_HIRE';
  /**
   * cl 13.1(e)'s precondition for the multi-hire 2h floor. Only consulted
   * when `shift_type === 'MULTI_HIRE'`. Like `shift_type` itself, nothing
   * currently populates this (it requires knowing the employee's OTHER
   * engagement's finish time on the same day, a cross-shift lookup not yet
   * wired anywhere) — compliance audit finding (2026-08-02): previously the
   * 2h floor applied to every multi-hire engagement unconditionally,
   * regardless of this precondition.
   */
  multiHireStartsWithinUsualFinishWindow?: boolean;

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
