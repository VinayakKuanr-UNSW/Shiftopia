/**
 * Shift pay terms — WHICH level, basis and rate an assigned shift is paid on.
 *
 * TS copy of `internal.resolve_pay_terms` and `hr.contract_pay_terms_on`
 * (migration 20261008104434_shift_pricing_on_contract_terms). The SQL copy
 * prices roster budgets; this one feeds payroll. `shiftPayTerms.test.ts` pins
 * both to the same golden values taken from the live SQL function — change one
 * copy and that test tells you to change the other.
 *
 * The rule (user decision 2026-10-08): someone on a level is paid that level.
 *   • eba_level — paid at the HIGHER of the contract level and the shift level.
 *     A shift level above the contract level is higher duties (cl 29), which
 *     the engine prices on the whole shift with a 4-hour minimum (cl 29.1(a)).
 *     Apprentice / trainee / supported-wage contracts get no uplift — their
 *     rates come from Schedules 4–6, not the level table.
 *   • eba_security_annualised — Full-Time Security, Sch 2 §2: the annualised
 *     rate exists for Levels 3–6 only, so a shift above Level 6 is not higher
 *     duties for them.
 *   • salary — outside the EA (cl 2.2): no level. The hourly equivalent
 *     (salary / 52 / weekly hours) is a BUDGET figure; payroll pays the salary,
 *     not the shift.
 *   • No contract — the shift's own level and employment target.
 */

import type { PayBasis } from '@/modules/users/domain/contractPayTerms';
import { resolveRateSet } from '@/modules/rosters/domain/projections/utils/cost/rate-schedule';

/** The Full-Time ordinary week a salary is divided by (cl 34). */
const FULL_TIME_WEEK_HOURS = 38;

/** `public.fn_normalize_employment_type` — anything unrecognised is Casual. */
export function normalizeEmploymentType(value: string | null | undefined): 'FT' | 'PT' | 'Casual' {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'ft': case 'full-time': case 'full_time': case 'fulltime': case 'full time': case 'full':
      return 'FT';
    case 'pt': case 'part-time': case 'part_time': case 'parttime': case 'part time': case 'part':
    case 'flexible part-time': case 'flexible part_time': case 'flexible parttime': case 'flexible part time':
      return 'PT';
    default:
      return 'Casual';
  }
}

/** One row of `hr.contract_pay_terms`. */
export interface ContractPayTermsRow {
  contract_id: string;
  effective_from: string; // YYYY-MM-DD
  pay_basis: PayBasis;
  remuneration_level: number | null;
  annual_salary: number | null;
}

/**
 * `hr.contract_pay_terms_on` — the terms in force on `date`: the latest change
 * on or before it, else (a date before the first change) the earliest.
 */
export function contractPayTermsOn<T extends Pick<ContractPayTermsRow, 'effective_from'>>(
  history: readonly T[],
  date: string,
): T | null {
  let onOrBefore: T | null = null;
  let earliest: T | null = null;
  for (const row of history) {
    if (!earliest || row.effective_from < earliest.effective_from) earliest = row;
    if (row.effective_from <= date && (!onOrBefore || row.effective_from > onOrBefore.effective_from)) {
      onOrBefore = row;
    }
  }
  return onOrBefore ?? earliest;
}

/** The linked contract's terms on the shift date. */
export interface ShiftPayContract {
  payBasis: PayBasis;
  level: number | null;
  annualSalary: number | null;
  /** hr.user_contracts.employment_status — 'Full-Time', 'Casual', … */
  employmentStatus: string | null;
  contractedWeeklyHours: number | null;
  /** Apprentice, trainee or supported wage (Schedules 4–6). */
  usesWageScheme: boolean;
}

export interface ShiftPayTermsInput {
  shiftDate: string;
  shiftLevel: number | null;
  /** shifts.target_employment_type — 'FT' | 'PT' | 'Casual'. */
  shiftEmploymentType: string | null;
  /** NULL when the shift is unassigned or its link is not the assignee's. */
  contract: ShiftPayContract | null;
}

export interface ShiftPayTerms {
  payBasis: PayBasis;
  /** 'FT' | 'PT' | 'Casual' — the shift's target, else the contract's. */
  employmentType: string;
  /** The contract's level (the shift's own when there is no contract); NULL for salary. */
  substantiveLevel: number | null;
  /** The level the shift is paid at; NULL for salary. */
  paidLevel: number | null;
  /** paidLevel > substantiveLevel — cl 29 applies. */
  higherDuties: boolean;
  /**
   * Hourly rate the shift is priced from: the casual-loaded or permanent EA
   * rate, the Sch 2 §2 annualised rate, or the salary's hourly equivalent.
   * NULL when the shift cannot be priced.
   */
  baseRate: number | null;
}

/** GREATEST() — NULLs ignored, NULL only when every argument is NULL. */
function greatest(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

export function resolveShiftPayTerms(input: ShiftPayTermsInput): ShiftPayTerms {
  const { shiftDate, shiftLevel, contract } = input;
  const payBasis: PayBasis = contract?.payBasis ?? 'eba_level';
  const employmentType = input.shiftEmploymentType
    ? input.shiftEmploymentType
    : normalizeEmploymentType(contract?.employmentStatus);
  const substantive = contract ? contract.level : shiftLevel;

  let paidLevel: number | null;
  if (payBasis === 'salary') {
    paidLevel = null;
  } else if (payBasis === 'eba_security_annualised') {
    paidLevel = shiftLevel != null && shiftLevel >= 3 && shiftLevel <= 6
      && substantive != null && shiftLevel > substantive
      ? shiftLevel
      : substantive;
  } else if (!contract || contract.usesWageScheme) {
    paidLevel = substantive;
  } else {
    paidLevel = greatest(substantive, shiftLevel ?? substantive);
  }

  const higherDuties = paidLevel != null && substantive != null && paidLevel > substantive;
  const rateSet = resolveRateSet(shiftDate);

  let baseRate: number | null = null;
  if (payBasis === 'salary') {
    const weekHours = employmentType === 'FT' ? FULL_TIME_WEEK_HOURS : contract?.contractedWeeklyHours;
    baseRate = contract?.annualSalary != null
      ? contract.annualSalary / 52 / (weekHours ? weekHours : FULL_TIME_WEEK_HOURS)
      : null;
  } else if (payBasis === 'eba_security_annualised') {
    const key = `level${paidLevel}` as keyof typeof rateSet.security.annualisedHourly;
    baseRate = paidLevel != null ? (rateSet.security.annualisedHourly[key] ?? null) : null;
  } else if (paidLevel != null) {
    const rates = rateSet.wageRates[(paidLevel === 0 ? 'TRAINEE' : `LEVEL_${paidLevel}`) as keyof typeof rateSet.wageRates];
    baseRate = rates ? (employmentType === 'Casual' ? rates.casual : rates.permanent) : null;
  }

  return {
    payBasis,
    employmentType,
    substantiveLevel: payBasis === 'salary' ? null : substantive,
    paidLevel,
    higherDuties,
    baseRate,
  };
}

/** The engine's classification key for a level: Level 0 is 'TRAINEE'. */
export function classificationForLevel(level: number | null): string | undefined {
  if (level == null || !Number.isFinite(level)) return undefined;
  return level === 0 ? 'TRAINEE' : `LEVEL_${level}`;
}
