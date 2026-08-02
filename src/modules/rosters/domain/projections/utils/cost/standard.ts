import { CostCalculatorOptions, ShiftCostBreakdown } from './types';
import {
  hd, ORDINARY_HOURS_CAP, SATURDAY, SUNDAY, ANNUAL_LEAVE_LOADING,
  MEAL_ALLOWANCE_OVERTIME_THRESHOLD_HOURS,
} from './constants';
import { resolveRateSet, type WageRateTable } from './rate-schedule';
import { resolvePaymentMinEngagementMinutes } from './min-engagement-floor';
import { getTraineeBaseRate } from './trainee_matrix';
import { getApprenticeMultiplier, SWS_MIN_WEEKLY } from './apprentice_matrix';
import type { AwardContext } from './award-context';
import { getDateFacts, parseTimeToMinutes, fastNightMinutes } from './award-context';

/**
 * Standard ICC Sydney Cost Engine
 * Handles General Event Staff, Apprentices (Sched 4), Trainees (Sched 5), and SWS (Sched 6)
 *
 * Performance:
 *   - Uses mandatory AwardContext for O(1) date lookups (built once per projection).
 *   - Uses pure integer arithmetic for all time calculations.
 *   - ZERO allocations in the hot loop.
 */

// cl 42 weekly ordinary-hours threshold: ordinary hours averaging beyond 38 per
// week attract overtime. Kept local to the Standard engine (constants.ts owns the
// per-DAY ordinary cap ORDINARY_HOURS_CAP = 12; this is the per-WEEK line).
const ORDINARY_HOURS_CAP_WEEKLY = 38;

// cl 43.1 / 43.2 — the night-shift allowance rate is keyed off the day the
// SHIFT CONCLUDES ("for Night Shift Hours worked where the shift concludes on
// …"), not the day each night hour happens to be worked. The casual rates
// (43.2) explicitly INCLUDE the 25% casual loading — the caller must subtract
// that loading before stacking this on the already-loaded casual base.
function getNightAllowanceMultiplier(conclusionDay: number, isCasual: boolean): number {
  // 0 = Sunday, 1 = Monday, etc.
  if (isCasual) {
    if (conclusionDay >= 1 && conclusionDay <= 4) return 0.45; // Mon-Thu
    if (conclusionDay === 5) return 0.50; // Fri
    return 0.75; // Sat (6), Sun (0)
  } else {
    if (conclusionDay >= 1 && conclusionDay <= 4) return 0.20; // Mon-Thu
    if (conclusionDay === 5) return 0.25; // Fri
    return 0.50; // Sat (6), Sun (0)
  }
}

// ── cl 41 penalty loading OVER the ordinary-time rate ────────────────────────
// The weekend / public-holiday loading as a fraction of the DE-LOADED ordinary
// rate, EXCLUDING the permanent 25% casual loading (which is carried separately
// by baseMult). Saturday +25%, Sunday +50%, public holiday +150%. These are the
// loadings that compete with the night-shift allowance under cl 41.4.
function penaltyLoading(day: number, isHoliday: boolean): number {
  if (isHoliday) return 1.5;         // public holiday: 250% vs 100% ordinary
  if (day === SATURDAY) return 0.25; // 125%
  if (day === SUNDAY) return 0.5;    // 150%
  return 0;                          // Mon–Fri ordinary
}

/** One calendar-day slice of a shift's ordinary span. */
interface DaySeg { fromMins: number; toMins: number; day: number; isHoliday: boolean; }

/**
 * Split a shift's ordinary span [startMins, endMins) at midnight (1440) so each
 * calendar day is priced on its own day-of-week + public-holiday status. The
 * ordinary cap is 12h and start < 24:00, so there are at most two segments.
 */
function splitOrdinaryAtMidnight(
  startMins: number,
  endMins: number,
  startDay: number,
  startIsHoliday: boolean,
  nextDay: number,
  nextIsHoliday: boolean,
): DaySeg[] {
  if (endMins <= 1440) {
    return [{ fromMins: startMins, toMins: endMins, day: startDay, isHoliday: startIsHoliday }];
  }
  return [
    { fromMins: startMins, toMins: 1440, day: startDay, isHoliday: startIsHoliday },
    { fromMins: 1440, toMins: endMins, day: nextDay, isHoliday: nextIsHoliday },
  ];
}

/**
 * The next calendar day as YYYY-MM-DD, built from LOCAL date parts (never
 * toISOString(), which would roll the day backwards in AU timezones). Only
 * called for shifts whose ordinary hours actually cross midnight.
 */
function addOneDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Zero-allocation helper for empty/NaN results ─────────────────────────────

const ZERO_RESULT: ShiftCostBreakdown = Object.freeze({
  totalCost: 0, ordinaryCost: 0, overtimeCost: 0, penaltyCost: 0,
  allowanceCost: 0, ordinaryHours: 0, overtimeHours: 0,
  breakdown: Object.freeze({ baseRate: 0, ordinaryRate: 0, penaltyRate: 0, isCasual: false, nightHours: 0, nightAllowanceCost: 0 }),
}) as ShiftCostBreakdown;

// Round a dollar amount to whole cents (standard payroll rounding) and
// normalise -0 → 0. audit Phase 1: the Standard engine previously returned raw
// floats while the Security engine already rounded — both now share one policy.
function round2(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const v = Math.round(x * 100) / 100;
  return v === 0 ? 0 : v;
}

/**
 * Main cost calculation entry point.
 */
export function estimateDetailedShiftCost(
  options: CostCalculatorOptions,
  ctx?: AwardContext,
): ShiftCostBreakdown {
  // A cancelled shift is not worked and carries no labour cost (audit Phase 1).
  if (options.is_cancelled) return ZERO_RESULT;

  const { netMinutes, rate, is_overnight, employmentType } = options;
  
  // Force shift_date to a YYYY-MM-DD string
  let shift_date = options.shift_date;
  if (shift_date && typeof shift_date === 'object' && (shift_date as any) instanceof Date) {
    shift_date = ((shift_date as any) as Date).toISOString().split('T')[0];
  } else if (typeof shift_date === 'string' && shift_date.includes('T')) {
    shift_date = shift_date.split('T')[0];
  }
  
  // ── Date facts (Phase 3) ───────────────────────────────────────────────
  let isHoliday: boolean;
  let dayOfWeek: number;

  if (ctx) {
    const facts = getDateFacts(ctx, shift_date);
    isHoliday = facts.isPublicHoliday;
    dayOfWeek = facts.dayOfWeek;
  } else {
    isHoliday = !!hd.isHoliday(shift_date);
    const dateObj = new Date(shift_date + 'T00:00:00');
    dayOfWeek = isNaN(dateObj.getTime()) ? 1 : dateObj.getDay();
  }

  const isCasual = /casual/i.test(employmentType || '');
  // AMBIGUITY (documented per audit — L3): cl 42.1 names only "full-time and
  // part-time" for the "excess of rostered hours ⇒ overtime" trigger. This
  // regex silently groups Flexible Part-Time with Part-Time. This is a
  // defensible reading (Flexible Part-Time is a sub-type of Part-Time under
  // cl 12.4), but the EA is not explicit. Kept as-is until the parties clarify.
  const isPartTime = /part/i.test(employmentType || '');
  
  // audit Phase 2: rates & allowances are effective-dated — resolve the set in
  // force on this shift's date so cl 25.1 CPI increases are data, not code.
  const rateSet = resolveRateSet(shift_date);

  let baseRate = rate;

  // ── 2. Base Rate Resolution ─────────────────────────────────────────
  // If the rate is missing (null, 0, or undefined) or set to the sentinel 24.1,
  // we attempt to resolve it via classification level mapping.
  if ((!baseRate || Number(baseRate) === 24.1) && options.classificationLevel) {
    const levelKey = options.classificationLevel.toUpperCase().replace(/\s+/g, '_') as keyof WageRateTable;
    const rates = rateSet.wageRates[levelKey];
    if (rates) {
      baseRate = isCasual ? rates.casual : rates.permanent;
    }
  }

  baseRate = (baseRate === null || baseRate === undefined || isNaN(Number(baseRate))) ? rateSet.defaultRate : Number(baseRate);

  // ── Higher duties (cl 29) ──────────────────────────────────────────────
  // A member temporarily performing work of a HIGHER classification is paid at
  // the higher grade's rate. We resolve the nominated `higherDutiesLevel` via the
  // SAME effective-dated wageRates lookup (choosing the casual vs permanent
  // column exactly as the substantive path does) and take the GREATER of the two
  // — higher duties never REDUCE pay (cl 29 is a top-up, never a demotion).
  //
  // AMBIGUITY (documented per audit — "identify, pick safest"): cl 29 is silent
  // on whether the higher rate covers the WHOLE shift or only the HOURS actually
  // spent on the higher-grade work (with a minimum engagement at the higher grade
  // in some readings). We take the WHOLE-SHIFT-at-the-higher-rate reading: it is
  // the simplest, never underpays the member, and needs no extra per-shift
  // hours-split input. The partial-hours / cl-29-minimum-engagement reading would
  // require an additional "higher-duties minutes" field and is not modelled here.
  // This applies ONLY to the classification/rate path — apprentice, trainee and
  // SWS branches below intentionally ignore higher duties (their rates are
  // schedule-derived, not classification-graded).
  let higherDutiesApplied = false;
  if (options.higherDutiesLevel && !options.is_sws && !options.is_trainee && !options.is_apprentice) {
    const hdKey = options.higherDutiesLevel.toUpperCase().replace(/\s+/g, '_') as keyof WageRateTable;
    const hdRates = rateSet.wageRates[hdKey];
    if (hdRates) {
      const hdRate = isCasual ? hdRates.casual : hdRates.permanent;
      if (Number.isFinite(hdRate) && hdRate > baseRate) {
        baseRate = hdRate;
        higherDutiesApplied = true;
      }
    }
  }

  if (options.is_sws) {
    const capacity = options.sws_capacity_percentage || 100;
    baseRate = baseRate * (capacity / 100);

    // cl 1.4.2 — SWS minimum weekly payment ($90/wk). The floor is WEEKLY, so the
    // per-shift engine can only enforce it when the caller supplies the member's
    // total ordinary hours for the (ISO) week. Then the weekly floor is an
    // equivalent hourly rate (SWS_MIN_WEEKLY / swsWeeklyHours) and we lift the
    // assessed-capacity rate to the greater of the two — so pricing every one of
    // the week's ordinary hours at this rate yields at least $90 for the week,
    // never below. Undefined / non-positive weekly hours ⇒ no-op (safe-by-default;
    // the floor stays the documented un-modelled gap until weekly hours are fed
    // in, mirroring the weekly-overtime `priorOrdinaryHoursThisWeek` contract).
    const swsWeeklyHours = options.swsWeeklyHours;
    if (typeof swsWeeklyHours === 'number' && Number.isFinite(swsWeeklyHours) && swsWeeklyHours > 0) {
      const floorHourly = SWS_MIN_WEEKLY / swsWeeklyHours;
      if (floorHourly > baseRate) baseRate = floorHourly;
    }
  }
  else if (options.is_trainee) {
    baseRate = getTraineeBaseRate({
      category: options.trainee_category || 'junior',
      level: options.trainee_level || 'A',
      exitYear: (options.trainee_exit_year as any) || 12,
      yearsOut: options.trainee_years_out || 0,
      aqfLevel: (options.trainee_aqf_level as any) || 3,
      yearOfTraineeship: options.trainee_year || 1,
      isPartTime
    }, shift_date); // effective-dated (Schedule 5 CPI uplift, cl 25.1)

    if (isPartTime && options.is_training_on_job) {
      baseRate *= 0.8;
    }

    if (options.trainee_category === 'school_based' && options.prefers_sba_loading) {
      baseRate *= 1.25;
    }
  } 
  else if (options.is_apprentice) {
    baseRate *= getApprenticeMultiplier(options, rateSet);
  }

  const ordinaryRate = isCasual ? baseRate / 1.25 : baseRate;
  if (isNaN(ordinaryRate)) return ZERO_RESULT;

  // ── Net minutes calculation (Pure integer arithmetic) ──────────────────
  // `netMinutes` is the ONE source of truth here — every caller (confirmed
  // across the codebase) either supplies it explicitly (including a genuine
  // 0) or omits it entirely to request the schedule-derived estimate below.
  // No other field name is ever populated on `options`, so no further
  // fallback chain is needed; an explicit 0 must be respected as-is, since
  // treating it as "missing" would fall through to the start/end recompute
  // and misread equal start/end times as a midnight rollover (a full 24h).
  let calculatedMins = typeof netMinutes === 'number' ? netMinutes : Number(netMinutes);

  if (calculatedMins == null || isNaN(calculatedMins) || calculatedMins < 0) {
    if (options.start_time && options.end_time) {
      const sTime = String(options.start_time).substring(0, 5);
      const eTime = String(options.end_time).substring(0, 5);
      const sMins = parseTimeToMinutes(sTime);
      let eMins = parseTimeToMinutes(eTime);
      if (eMins <= sMins || is_overnight) eMins += 1440;
      // cl 36.1 — the unpaid meal break is deducted here ONLY: a caller that
      // already supplies `netMinutes` is expected to have net'd it out itself
      // (see the "single source of truth" note above). Compliance audit
      // finding: this fallback previously priced the FULL clock span,
      // silently paying out an unpaid break whenever a caller didn't
      // pre-compute netMinutes (e.g. the AutoScheduler greedy-fallback cost
      // estimate — fixed at its call site too).
      calculatedMins = Math.max(0, eMins - sMins - (options.unpaid_break_minutes || 0));
    } else {
      calculatedMins = 0;
    }
  }

  const netHours = Math.max(0, (calculatedMins || 0) / 60);

  // ── Overtime (Clause 42) — computed BEFORE ordinary so the two never overlap ─
  // FT/PT: overtime is time beyond the rostered hours OR beyond the 12h/day
  // ordinary cap. Casuals: overtime only past the 12h/day ordinary cap.
  const scheduledHours = (options.scheduled_length_minutes || 0) / 60;
  let dailyOvertimeHours: number;
  if (!isCasual && scheduledHours > 0) {
    dailyOvertimeHours = Math.max(0, netHours - scheduledHours, netHours - ORDINARY_HOURS_CAP);
  } else {
    dailyOvertimeHours = Math.max(0, netHours - ORDINARY_HOURS_CAP);
  }

  // Ordinary hours are what remains after removing DAILY overtime — never counted
  // as both. The old `Math.min(netHours, 12)` billed hours between scheduled and
  // 12 as ordinary AND overtime whenever netHours > scheduledHours (a systematic
  // FT/PT over-count). For the normal path (netHours <= scheduledHours) this is
  // identical to the old value, so projection totals are unchanged there.
  const dailyOrdinaryHours = Math.max(0, netHours - dailyOvertimeHours);

  // ── Weekly overtime (cl 42) — SAFE-BY-DEFAULT ──────────────────────────────
  // When the pipeline supplies `priorOrdinaryHoursThisWeek` (the ordinary hours
  // this member already banked earlier in the same ISO week), any of THIS shift's
  // ordinary hours that push the running weekly ordinary total past 38h are
  // re-priced as overtime instead of ordinary. The hours MOVE from ordinary into
  // overtime — they are never counted in both, so nothing is double-paid.
  //
  //   ordinaryRoom = max(0, 38 − priorOrdinary)
  //   weeklyOrdinary = min(dailyOrdinary, ordinaryRoom)   (stays ordinary)
  //   weeklyOT = dailyOrdinary − weeklyOrdinary           (spills to OT)
  //   finalOvertimeHours = dailyOvertime + weeklyOT
  //
  // Applied to non-casual members only. AMBIGUITY (documented per audit): the EA
  // 38h weekly-average overtime trigger is a full-/part-time provision; whether a
  // casual's marginal hours count toward the same 38h line is unsettled, so we
  // default casual weekly OT OFF even if a prior-hours value is passed. When
  // `priorOrdinaryHoursThisWeek` is undefined/null the whole block is a no-op and
  // behaviour is exactly as before.
  const weeklyEnabled =
    !isCasual &&
    options.priorOrdinaryHoursThisWeek !== undefined &&
    options.priorOrdinaryHoursThisWeek !== null &&
    Number.isFinite(options.priorOrdinaryHoursThisWeek);

  let ordinaryHours = dailyOrdinaryHours;
  let overtimeHours = dailyOvertimeHours;
  if (weeklyEnabled) {
    const prior = Math.max(0, Number(options.priorOrdinaryHoursThisWeek));
    const ordinaryRoom = Math.max(0, ORDINARY_HOURS_CAP_WEEKLY - prior);
    const weeklyOrdinary = Math.min(dailyOrdinaryHours, ordinaryRoom);
    const weeklyOT = dailyOrdinaryHours - weeklyOrdinary;
    ordinaryHours = weeklyOrdinary;
    overtimeHours = dailyOvertimeHours + weeklyOT;
  }

  // ── Penalty & night-shift cost, split at midnight (cl 41 / 43 / 41.4) ─────
  // An overnight shift's ordinary hours can fall on two calendar days carrying
  // different weekend / public-holiday penalties. The old engine priced the WHOLE
  // shift at the START date's day-of-week, so e.g. the Sunday-morning half of a
  // Saturday-night shift was under-penalised, and a crossing into/out of a public
  // holiday was missed entirely. We now split the ordinary span at midnight and
  // price each calendar-day segment on its own day + holiday status.
  //
  // cl 41.4 (loadings NOT cumulative): where a night hour ALSO attracts a
  // weekend/PH penalty, only the GREATER of the two loadings is paid — not their
  // sum, and (correcting the earlier over-conservative stance) not zero. On a
  // public holiday the +150% penalty always exceeds the night allowance, so the
  // allowance falls away there; on Saturday/Sunday the higher of the two wins.
  //
  // The night-allowance RATE is keyed off the day the shift CONCLUDES (cl 43.1 /
  // 43.2 wording: "where the shift concludes on …") — one rate for the whole
  // shift's night hours. The cl 41.4 MAX comparison stays per SEGMENT, because
  // the competing weekend/PH penalty genuinely varies by the calendar day each
  // hour is worked on.
  const baseMult = isCasual ? 1.25 : 1.0; // permanent 25% casual loading, if any
  const hasTimes = !!options.start_time;

  let startMins = 0;
  let ordinaryEndMins = ordinaryHours * 60; // no start_time ⇒ single same-day span
  if (hasTimes) {
    startMins = parseTimeToMinutes(String(options.start_time).substring(0, 5));
    ordinaryEndMins = startMins + ordinaryHours * 60;
  }

  // The overtime span begins where ordinary ends and runs for `overtimeHours`.
  // Its tail can cross midnight independently of the ordinary hours (cl 42
  // day-split, below), so the next-day holiday status may be needed even when the
  // ORDINARY span stayed same-day. Resolve it whenever either span crosses 1440.
  const otEndMins = hasTimes ? ordinaryEndMins + overtimeHours * 60 : ordinaryEndMins;

  // Next calendar day's facts — needed when ordinary OR the overtime tail crosses
  // midnight. Reuses the addOneDay + next-day lookup pattern from the ordinary split.
  const nextDay = (dayOfWeek + 1) % 7;
  let nextIsHoliday = false;
  if (ordinaryEndMins > 1440 || otEndMins > 1440) {
    const nextStr = addOneDay(shift_date);
    nextIsHoliday = ctx ? getDateFacts(ctx, nextStr).isPublicHoliday : !!hd.isHoliday(nextStr);
  }

  const segments = splitOrdinaryAtMidnight(
    startMins, ordinaryEndMins, dayOfWeek, isHoliday, nextDay, nextIsHoliday,
  );

  // Engagement-day penalty rate — representative for the breakdown and used to
  // price minimum-payment top-up hours (which are paid but not worked).
  const startPenaltyRate = ordinaryRate * (baseMult + penaltyLoading(dayOfWeek, isHoliday));

  // cl 43 conclusion day: the day the WHOLE shift ends (overtime tail included).
  const concludesNextDay = ordinaryEndMins > 1440 || otEndMins > 1440;
  const conclusionDay = concludesNextDay ? nextDay : dayOfWeek;
  // cl 43.2: the casual night rates (45/50/75%) INCLUDE the 25% casual loading,
  // which the ordinary cost below already carries via baseMult — subtract it so
  // the loading is never paid twice. FT/PT rates (43.1) carry no loading.
  const nightLoadOverBase =
    (getNightAllowanceMultiplier(conclusionDay, isCasual) || 0) - (isCasual ? 0.25 : 0);

  let ordinaryCost = 0;
  let nightAllowanceCost = 0;
  let nightHours = 0;
  // AUDIT FIX L4: accumulate per-day-type splits so the line-item decomposition
  // can read engine data instead of re-deriving from scratch.
  let pbSatH = 0, pbSunH = 0, pbPhH = 0;
  let pbSatC = 0, pbSunC = 0, pbPhC = 0;
  for (const seg of segments) {
    const segHours = Math.max(0, (seg.toMins - seg.fromMins) / 60);
    const segPenaltyLoad = penaltyLoading(seg.day, seg.isHoliday);
    const segPenaltyCost = segHours * ordinaryRate * segPenaltyLoad;
    ordinaryCost += segHours * ordinaryRate * (baseMult + segPenaltyLoad);

    // L4: per-day-type accumulation.
    if (seg.isHoliday) { pbPhH += segHours; pbPhC += segPenaltyCost; }
    else if (seg.day === SATURDAY) { pbSatH += segHours; pbSatC += segPenaltyCost; }
    else if (seg.day === SUNDAY) { pbSunH += segHours; pbSunC += segPenaltyCost; }

    if (hasTimes) {
      // Worked night hours in this segment (22:00–06:00 window, integer overlap).
      const segNightHours = fastNightMinutes(seg.fromMins, seg.toMins) / 60;
      if (segNightHours > 0) {
        nightHours += segNightHours;
        // cl 41.4 MAX: only the excess of the night loading over the day's penalty
        // loading is additionally payable (weekday ⇒ full allowance; PH ⇒ 0).
        nightAllowanceCost += segNightHours * ordinaryRate * Math.max(0, nightLoadOverBase - segPenaltyLoad);
      }
    }
  }

  // ── Leave pay (annual / personal / carer / FDV) ──────────────────────────
  // A leave-flagged shift is NOT worked: it attracts no overtime, no fixed
  // (meal / first-aid / protein-spill / split) allowances and no minimum-
  // engagement top-up. Casuals accrue no paid annual/personal/carer leave —
  // their 25% loading is paid in lieu (cl. 11 / NES) — so those casual leave
  // days cost nothing. EXCEPTION: family & domestic violence leave (cl 46 /
  // NES Div 11) IS paid for casuals — cl 46.6 pays "the hours the Team Member
  // is rostered on the day that the leave is taken".
  //   • Annual leave (cl. 44.7): the EA's printed clause is an additive
  //     formula — ordinary rate + 17.5% loading. The "greater of ordinary ×
  //     1.175 OR as-worked-with-penalties" comparison below is a DELIBERATE
  //     BETTER-OFF-OVERALL policy, NOT the EA's own wording (AUDIT M1). If
  //     leadership confirms it should be the flat formula, simplify to
  //     `ordinaryLeavePay * (1 + ANNUAL_LEAVE_LOADING)` and remove the MAX.
  //   • Personal / carer's leave (NES ss96–99): paid at the ORDINARY base rate
  //     for the ordinary hours — no loading, no penalties (those attach to
  //     actual attendance).
  //   • FDV leave (cl 46.6 / NES s106B): paid at the FULL rate "worked out as
  //     if the employee had worked" the rostered hours — the AS-WORKED value
  //     including weekend/PH penalties, the night allowance and (for casuals,
  //     via baseMult) the 25% loading. That is exactly the
  //     `ordinaryCost + nightAllowanceCost` lump the annual-leave greater-of
  //     already compares against. No 17.5% loading, no floor, no OT.
  if (options.isAnnualLeave || options.isPersonalLeave || options.isCarerLeave || options.isFdvLeave) {
    if (isCasual && !options.isFdvLeave) return ZERO_RESULT;
    const leaveHours = ordinaryHours; // rostered ordinary hours (no floor, no OT)
    const ordinaryLeavePay = leaveHours * ordinaryRate;
    const leaveTotal = options.isAnnualLeave
      ? Math.max(ordinaryLeavePay * (1 + ANNUAL_LEAVE_LOADING), ordinaryCost + nightAllowanceCost)
      : options.isFdvLeave
        ? ordinaryCost + nightAllowanceCost // NES s106B as-worked full rate
        : ordinaryLeavePay;
    return {
      totalCost: round2(leaveTotal),
      ordinaryCost: round2(leaveTotal),
      overtimeCost: 0,
      penaltyCost: 0,
      allowanceCost: 0,
      ordinaryHours: leaveHours,
      overtimeHours: 0,
      breakdown: {
        baseRate: baseRate || 0,
        ordinaryRate: ordinaryRate || 0,
        penaltyRate: startPenaltyRate || 0,
        isCasual,
        isApprentice: !!options.is_apprentice,
        isTrainee: !!options.is_trainee,
        nightHours: 0,
        nightAllowanceCost: 0,
      },
    };
  }

  // ── Minimum-payment floor (cl. 12.3(e) / 12.4(c) / 12.5(c) / 56.2) ───────
  // A part-time / flexi / casual engagement is PAID for at least the minimum
  // hours even when fewer are worked (e.g. sent home early, or a casual reports
  // to a changed/cancelled start under cl. 38.3). Full-time members are weekly-
  // salaried with no per-engagement minimum and are excluded. Top-up hours are
  // paid but not worked, so they carry the engagement-day penalty rate and no
  // night allowance. Threshold logic (employment-type/Sunday/PH/training/
  // multi-hire nuance) lives in `resolvePaymentMinEngagementMinutes` — the
  // SAME function the timesheets billable floor uses, so this engine and the
  // displayed billable hours can never disagree (F-locked 2026-07-28).
  const isMultiHire = options.shift_type === 'MULTI_HIRE';
  let paidOrdinaryHours = ordinaryHours;
  if (netHours > 0) {
    const floorMinutes = resolvePaymentMinEngagementMinutes({
      employmentType,
      isSecurityRole: false,
      isTraining: options.is_training_shift,
      isSunday: dayOfWeek === SUNDAY,
      isPublicHoliday: isHoliday,
      isMultiHire,
      multiHireStartsWithinUsualFinishWindow: options.multiHireStartsWithinUsualFinishWindow,
    });
    if (floorMinutes != null) {
      const floorHours = floorMinutes / 60;
      if (paidOrdinaryHours < floorHours) {
        ordinaryCost += (floorHours - paidOrdinaryHours) * startPenaltyRate;
        paidOrdinaryHours = floorHours;
      }
    }
  }

  // ── Higher-duties minimum (cl 29.1(a)) ───────────────────────────────────
  // Performing higher duties for LESS than 4 hours entitles the member to
  // payment at the higher rate for four (4) hours. Under the whole-shift-at-the-
  // higher-rate reading above, that means a worked-and-uplifted shift shorter
  // than 4h is topped up to 4 paid hours at the (already-uplifted) engagement-day
  // rate. Applies to every employment type — cl 29 is not limited to PT/casual.
  if (higherDutiesApplied && netHours > 0 && paidOrdinaryHours < 4) {
    ordinaryCost += (4 - paidOrdinaryHours) * startPenaltyRate;
    paidOrdinaryHours = 4;
  }

  // Representative penalty rate for the breakdown (engagement-day rate).
  const penaltyRate = startPenaltyRate;

  // 5. Overtime cost (Clause 42) — overtimeHours already computed above.
  // Standard OT tiers by POSITION in the overtime run: 1.5x for the first 3h,
  // 2.0x thereafter (the loading is absorbed into the casual rate via ordinaryRate).
  // Public-holiday OT is 2.5x (double time and a half).
  //
  // OVERNIGHT DAY-SPLIT (cl 42): an overnight shift whose overtime tail crosses
  // midnight can have OT hours land on a DIFFERENT calendar day — and only the
  // hours actually ON a public-holiday day should attract the 2.5x PH rate. We
  // therefore split the OT span [ordinaryEndMins, otEndMins) at 1440 (reusing the
  // same addOneDay + next-day holiday lookup as the ordinary split) and price each
  // day-segment on its own holiday status, while keeping the cumulative 1.5/2.0
  // tiering by OT position across the whole run. For a PH hour we pay
  // MAX(tiered, 2.5x) so the PH rate is a floor, never a discount.
  const otTieredRate = (cumBeforeH: number, cumAfterH: number): number => {
    // Mean tiered multiplier for the OT sub-span spanning cumulative positions
    // [cumBeforeH, cumAfterH) hours into the run: 1.5x below 3h, 2.0x above.
    const th = Math.max(0, Math.min(cumAfterH, 3) - Math.min(cumBeforeH, 3));
    const dt = Math.max(0, cumAfterH - Math.max(cumBeforeH, 3));
    return th * 1.5 + dt * 2.0; // hours-weighted (returns cost-hours, not a rate)
  };

  let overtimeCost = 0;
  if (overtimeHours > 0) {
    // Build OT day-segments from the OT time span so PH status is per calendar day.
    // Without times we cannot split — price the whole run on the start-date PH flag.
    interface OtSeg { hours: number; isHoliday: boolean; }
    let otSegs: OtSeg[];
    if (hasTimes && otEndMins > 1440 && ordinaryEndMins < otEndMins) {
      const splitAt = Math.max(ordinaryEndMins, 1440); // OT may start after midnight
      const beforeH = Math.max(0, (Math.min(1440, otEndMins) - ordinaryEndMins)) / 60;
      const afterH = Math.max(0, (otEndMins - splitAt)) / 60;
      otSegs = [];
      if (beforeH > 0) otSegs.push({ hours: beforeH, isHoliday });          // start day
      if (afterH > 0) otSegs.push({ hours: afterH, isHoliday: nextIsHoliday }); // next day
    } else {
      // Same-day OT (or no times): the whole run sits on the start date.
      otSegs = [{ hours: overtimeHours, isHoliday }];
    }

    let cum = 0; // cumulative OT hours already priced (drives the 1.5/2.0 tiering)
    for (const seg of otSegs) {
      const tieredCostHours = otTieredRate(cum, cum + seg.hours);
      const phCostHours = seg.hours * 2.5;
      // cl 42 PH OT is a floor: MAX(tiered, 2.5x) per PH hour; plain tiered otherwise.
      overtimeCost += (seg.isHoliday ? Math.max(tieredCostHours, phCostHours) : tieredCostHours) * ordinaryRate;
      cum += seg.hours;
    }
  }

  // ── 6. Fixed allowances (Clause 28 / Schedule 2 §3) ──────────────────────
  // Previously `options.allowances` was accepted but NEVER applied, so meal /
  // first-aid / protein-spill / split-shift allowances reached no cost total.
  let otherAllowanceCost = 0;
  const al = options.allowances;

  // cl 28.1 — the meal allowance is an AUTOMATIC entitlement when 2+ hours of
  // overtime are worked immediately after the rostered finish, not payable only
  // when the employer provides a suitable meal. It is derived from DAILY
  // overtime (the hours actually past the rostered finish / 12h cap) — weekly
  // >38h reclassification is not "after the rostered finishing time". An
  // explicit `allowances.meal === false` means "meal was provided" (opt-out);
  // `meal: true` still forces it regardless of overtime.
  // AUDIT FIX M-5: `dailyOvertimeHours` for a CASUAL is only hours past the 12h
  // daily cap (see the cl 42 block above), because casual OT *pay* is
  // genuinely capped-only under the EA. But cl 28.1's meal-allowance trigger
  // is about hours worked past the ROSTERED finish, not about how those hours
  // get PAID — so a casual working 2h+ past their own rostered finish but
  // still under the 12h cap was never getting the allowance. Compute the
  // trigger separately from the pay-rate classification: whichever is larger
  // of (hours past the 12h cap) or (hours past the rostered finish).
  const mealTriggerHours = scheduledHours > 0
    ? Math.max(dailyOvertimeHours, netHours - scheduledHours)
    : dailyOvertimeHours;
  const mealPayable =
    al?.meal === true ||
    (al?.meal !== false && mealTriggerHours >= MEAL_ALLOWANCE_OVERTIME_THRESHOLD_HOURS);
  if (mealPayable) otherAllowanceCost += rateSet.allowances.meal;                            // per occasion (cl. 28.1)

  if (al) {
    // AUDIT FIX L-1: price off `paidOrdinaryHours` (post minimum-engagement
    // floor) not the pre-floor `ordinaryHours` — a topped-up engagement is
    // PAID for the floor hours, so the per-hour first-aid allowance should
    // track what's actually paid, consistent with every other per-hour cost
    // in this function running after the floor is applied.
    if (al.firstAid) otherAllowanceCost += rateSet.allowances.firstAidPerHour * paidOrdinaryHours; // per ordinary hour worked (cl. 28.2)
    if (al.proteinSpill) otherAllowanceCost += rateSet.allowances.proteinSpill;             // per shift (cl. 28.3)
    // cl 39.1 / 28.4 — split shifts (and therefore the allowance) apply only
    // to Part-Time and Flexible Part-Time Team Members; Casual is excluded
    // by cl 39.1 and Full-Time never works a "split shift" under the EBA's
    // own definition. Audit M-6: this previously excluded only Casual,
    // which would have let the allowance leak to Full-Time if the flag were
    // ever set for one.
    if (al.splitShift && !isCasual && options.employmentType !== 'Full-Time') {
      otherAllowanceCost += rateSet.allowances.splitShift;                                  // per shift (cl. 28.4)
    }
  }

  const allowanceCost = nightAllowanceCost + otherAllowanceCost;

  const totalCost = (ordinaryCost || 0) + (overtimeCost || 0) + (allowanceCost || 0);

  return {
    totalCost: round2(totalCost),
    ordinaryCost: round2(ordinaryCost),
    overtimeCost: round2(overtimeCost),
    penaltyCost: round2(nightAllowanceCost), // night-shift allowance (Approximation)
    allowanceCost: round2(allowanceCost),
    ordinaryHours: paidOrdinaryHours || 0,
    overtimeHours: overtimeHours || 0,
    breakdown: {
      baseRate: baseRate || 0,
      ordinaryRate: ordinaryRate || 0,
      penaltyRate: penaltyRate || 0,
      isCasual,
      isApprentice: !!options.is_apprentice,
      isTrainee: !!options.is_trainee,
      nightHours: nightHours || 0,
      nightAllowanceCost: round2(nightAllowanceCost)
    },
    // AUDIT FIX L4: single source of truth for day-type splits.
    penaltyBreakdown: {
      satHours: pbSatH, sunHours: pbSunH, phHours: pbPhH,
      satCost: round2(pbSatC), sunCost: round2(pbSunC), phCost: round2(pbPhC),
    },
  };
}

export function estimateShiftCost(options: CostCalculatorOptions, ctx?: AwardContext): number {
  return estimateDetailedShiftCost(options, ctx).totalCost;
}

function toOrdinaryRate(rate: number): number {
  return rate / 1.25;
}
