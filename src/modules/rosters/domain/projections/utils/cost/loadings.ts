/**
 * Rate card loadings — numeric multipliers and thresholds for one pay rate card
 * (`public.pay_rate_card_loadings`, rule_set `icc_sydney_ea`).
 *
 * The rule STRUCTURE stays in code (`standard.ts`, `security.ts`,
 * `min-engagement-floor.ts`, and SQL `fn_eba_estimate_shift_cost` /
 * `internal.shift_cost`): cl 41.4 non-cumulative maximum, conclusion-day night
 * rate, midnight splits, and the 22:00–06:00 night window. The NUMBERS come
 * from the card.
 *
 * Worker-safe — no DOM, no React, no Supabase.
 *
 * Drift guard: `rate-card-loadings.test.ts` parses `public.pay_rate_card_loadings`
 * out of `supabase/seeds/reference.sql` and asserts `ICC_SYDNEY_EA_LOADINGS`
 * matches every column on ICC Sydney's seeded cards.
 */

export interface RateCardLoadings {
  /** Casual loading fraction over ordinary rate (ICC EA: 0.25 ⇒ 1.25×). */
  casualLoading: number;
  /** Saturday penalty fraction over ordinary rate (cl 41: 0.25). */
  saturdayLoading: number;
  /** Sunday penalty fraction over ordinary rate (cl 41: 0.50). */
  sundayLoading: number;
  /** Public holiday penalty fraction over ordinary rate (cl 41: 1.50). */
  publicHolidayLoading: number;
  /** Night loading over base rate when shift concludes Mon–Thu (cl 43: 0.20). */
  nightLoadingMonThu: number;
  /** Night loading over base rate when shift concludes Fri (cl 43: 0.25). */
  nightLoadingFri: number;
  /** Night loading over base rate when shift concludes Sat/Sun (cl 43: 0.50). */
  nightLoadingSatSun: number;
  /** Annual leave loading fraction over ordinary pay (cl 44.7: 0.175). */
  annualLeaveLoading: number;
  /** Hours in the first overtime tier (cl 42.2 / Sch 3: 3). */
  overtimeFirstHours: number;
  /** Multiplier for the first overtime tier (cl 42.2: 1.5). */
  overtimeFirstMultiplier: number;
  /** Multiplier after the first overtime tier (cl 42.2: 2.0). */
  overtimeAfterMultiplier: number;
  /** Minimum multiplier for overtime hours on a public holiday (cl 42: 2.5). */
  overtimePublicHolidayMultiplier: number;
  /** Daily ordinary-hours cap before daily overtime (cl 42: 12). */
  ordinaryDailyCapHours: number;
  /** Daily ordinary-hours cap for Security shifts (Sch 2 §2 / Sch 3: 12). */
  securityOrdinaryCapHours: number;
  /** Default minimum paid engagement in minutes (cl 12: 180). */
  minEngagementMinutes: number;
  /** Sunday minimum paid engagement in minutes (cl 12.4(c)/12.5(c): 240). */
  minEngagementSundayMinutes: number;
  /** Public holiday minimum paid engagement in minutes (cl 56.2: 240). */
  minEngagementPublicHolidayMinutes: number;
  /** Training shift minimum paid engagement in minutes (120). */
  minEngagementTrainingMinutes: number;
  /** Minimum paid hours when performing higher duties (cl 29.1(a): 4). */
  higherDutiesMinHours: number;
  /** Hours past rostered finish that trigger the meal allowance (cl 28.1: 2.0). */
  mealAllowanceTriggerHours: number;
  /** Supported Wage System minimum weekly payment in dollars (Sch 6 §1.4.2: 90). */
  swsMinWeekly: number;
}

/**
 * ICC Sydney EA 2025/2026–27 numeric loadings — embedded fallback for the
 * synchronous worker engine when no card loadings are passed in `options` or
 * `AwardContext`. Machine-checked against `supabase/seeds/reference.sql`.
 */
export const ICC_SYDNEY_EA_LOADINGS: Readonly<RateCardLoadings> = Object.freeze({
  casualLoading: 0.25,
  saturdayLoading: 0.25,
  sundayLoading: 0.5,
  publicHolidayLoading: 1.5,
  nightLoadingMonThu: 0.20,
  nightLoadingFri: 0.25,
  nightLoadingSatSun: 0.50,
  annualLeaveLoading: 0.175,
  overtimeFirstHours: 3,
  overtimeFirstMultiplier: 1.5,
  overtimeAfterMultiplier: 2.0,
  overtimePublicHolidayMultiplier: 2.5,
  ordinaryDailyCapHours: 12,
  securityOrdinaryCapHours: 12,
  minEngagementMinutes: 180,
  minEngagementSundayMinutes: 240,
  minEngagementPublicHolidayMinutes: 240,
  minEngagementTrainingMinutes: 120,
  higherDutiesMinHours: 4,
  mealAllowanceTriggerHours: 2.0,
  swsMinWeekly: 90,
});

/** Column list for PostgREST selects on `public.pay_rate_card_loadings`. */
export const RATE_CARD_LOADINGS_SELECT = [
  'casual_loading',
  'saturday_loading',
  'sunday_loading',
  'public_holiday_loading',
  'night_loading_mon_thu',
  'night_loading_fri',
  'night_loading_sat_sun',
  'annual_leave_loading',
  'overtime_first_hours',
  'overtime_first_multiplier',
  'overtime_after_multiplier',
  'overtime_public_holiday_multiplier',
  'ordinary_daily_cap_hours',
  'security_ordinary_cap_hours',
  'min_engagement_minutes',
  'min_engagement_sunday_minutes',
  'min_engagement_public_holiday_minutes',
  'min_engagement_training_minutes',
  'higher_duties_min_hours',
  'meal_allowance_trigger_hours',
  'sws_min_weekly',
].join(', ');

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Map a `public.pay_rate_card_loadings` row (snake_case) to `RateCardLoadings`. */
export function mapDbLoadingsRow(row: Record<string, unknown>): RateCardLoadings {
  return {
    casualLoading: num(row.casual_loading),
    saturdayLoading: num(row.saturday_loading),
    sundayLoading: num(row.sunday_loading),
    publicHolidayLoading: num(row.public_holiday_loading),
    nightLoadingMonThu: num(row.night_loading_mon_thu),
    nightLoadingFri: num(row.night_loading_fri),
    nightLoadingSatSun: num(row.night_loading_sat_sun),
    annualLeaveLoading: num(row.annual_leave_loading),
    overtimeFirstHours: num(row.overtime_first_hours),
    overtimeFirstMultiplier: num(row.overtime_first_multiplier),
    overtimeAfterMultiplier: num(row.overtime_after_multiplier),
    overtimePublicHolidayMultiplier: num(row.overtime_public_holiday_multiplier),
    ordinaryDailyCapHours: num(row.ordinary_daily_cap_hours),
    securityOrdinaryCapHours: num(row.security_ordinary_cap_hours),
    minEngagementMinutes: num(row.min_engagement_minutes),
    minEngagementSundayMinutes: num(row.min_engagement_sunday_minutes),
    minEngagementPublicHolidayMinutes: num(row.min_engagement_public_holiday_minutes),
    minEngagementTrainingMinutes: num(row.min_engagement_training_minutes),
    higherDutiesMinHours: num(row.higher_duties_min_hours),
    mealAllowanceTriggerHours: num(row.meal_allowance_trigger_hours),
    swsMinWeekly: num(row.sws_min_weekly),
  };
}
