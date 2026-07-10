import {
  hd, SATURDAY, SUNDAY, CASUAL_LOADING, TIME_AND_HALF_MULTIPLIER,
  TIME_AND_HALF_HOURS_CAP, DOUBLE_TIME_MULTIPLIER, DOUBLE_TIME_AND_HALF_MULTIPLIER,
  ANNUAL_LEAVE_LOADING, ZERO_COST_BREAKDOWN,
} from './constants';
import { CostCalculatorOptions, ShiftCostBreakdown } from './types';
import { resolveRateSet, type RateSet, type WageRateTable } from './rate-schedule';
import type { AwardContext } from './award-context';
import { getDateFacts, parseTimeToMinutes, fastNightMinutes } from './award-context';

/**
 * SECURITY COST ENGINE (Schedule 3 — Security Arrangements)
 *
 *   • Annualised FULL-TIME security (Sch 2 §2): the annualised hourly rate is
 *     paid for all rostered hours IN LIEU of penalties, night allowances and
 *     leave loading (§4.1(b)) — no weekend/PH/night terms apply. Overtime beyond
 *     rostered hours / the 12h cap is paid on the ORDINARY hourly rate (§4.2).
 *   • PART-TIME / CASUAL event security (§5/§6): weekend & PH penalties mirror
 *     cl 41 (§6.2), the cl 43 night allowance applies (§6.2(d) non-cumulative),
 *     overtime is 150% first THREE hours then 200% with the casual loading
 *     absorbed (§6.3(c)), and ordinary spans crossing midnight are priced per
 *     calendar day.
 *
 * Accounting identity (Security): totalCost = ordinaryCost + penaltyCost +
 * overtimeCost + allowanceCost, where ordinaryCost is the base earnings at the
 * paid (loaded) rate, penaltyCost the ADDITIVE weekend/PH term, and
 * allowanceCost the night-shift allowance.
 *
 * Performance: mandatory AwardContext for O(1) date lookups; integer minute
 * arithmetic; no allocations beyond the ≤2 day segments.
 */

const ORDINARY_HOURS_CAP_SECURITY = 12.0;

function isSecurityAnnualised(rate: number, annualisedHourly: Record<string, number>): boolean {
  return Object.values(annualisedHourly).includes(rate);
}

function toOrdinaryRate(casualRate: number): number {
  return Math.round((casualRate / CASUAL_LOADING) * 100) / 100;
}

// cl 41 / Sch 3 §6.2 penalty loading over the ordinary-time rate (excluding the
// casual loading, which the paid base rate already carries).
function penaltyLoading(day: number, isHoliday: boolean): number {
  if (isHoliday) return 1.5;         // PH: 250% permanent / 275% casual
  if (day === SATURDAY) return 0.25; // 125% / 150%
  if (day === SUNDAY) return 0.5;    // 150% / 175%
  return 0;
}

// cl 43 night-shift allowance, keyed off the shift's CONCLUSION day. Casual
// rates include the 25% casual loading (the caller subtracts it before adding
// on top of the loaded base).
function nightAllowanceMultiplier(conclusionDay: number, isCasual: boolean): number {
  if (isCasual) {
    if (conclusionDay >= 1 && conclusionDay <= 4) return 0.45;
    if (conclusionDay === 5) return 0.50;
    return 0.75;
  }
  if (conclusionDay >= 1 && conclusionDay <= 4) return 0.20;
  if (conclusionDay === 5) return 0.25;
  return 0.50;
}

/** Next calendar day as YYYY-MM-DD from LOCAL parts (mirrors standard.ts). */
function addOneDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Resolve the security member's paid rate when no explicit rate is supplied:
 * full-time + Level 3–6 ⇒ the annualised hourly rate (Sch 2 §2); otherwise the
 * Schedule 2 §1 wage table (casual vs permanent column) — effective-dated.
 */
function resolveSecurityRate(
  rateSet: RateSet,
  classificationLevel: string | undefined,
  isFullTime: boolean,
  isCasualType: boolean,
): number | null {
  if (!classificationLevel) return null;
  const key = classificationLevel.toUpperCase().replace(/\s+/g, '_');
  if (isFullTime) {
    const m = key.match(/^LEVEL_([3-6])$/);
    if (m) {
      const annualised = rateSet.security.annualisedHourly[`level${m[1]}` as keyof RateSet['security']['annualisedHourly']];
      if (Number.isFinite(annualised)) return annualised;
    }
  }
  const rates = rateSet.wageRates[key as keyof WageRateTable];
  if (!rates) return null;
  return isCasualType ? rates.casual : rates.permanent;
}

export function estimateDetailedShiftCost(
  options: CostCalculatorOptions,
  ctx?: AwardContext,
): ShiftCostBreakdown {
  // A cancelled shift is not worked and carries no labour cost (audit Phase 1).
  if (options.is_cancelled) return ZERO_COST_BREAKDOWN;

  const { netMinutes, rate, shift_date, is_overnight, previousWage, employmentType } = options;

  const isLeave = !!(options.isAnnualLeave || options.isPersonalLeave || options.isCarerLeave);
  const isCasualType = /casual/i.test(employmentType || '');
  const isFullTimeType = /full/i.test(employmentType || '');

  // Casuals accrue no paid leave — their 25% loading is paid in lieu — so a
  // leave-flagged casual security shift costs nothing (audit Phase 3).
  if (isLeave && isCasualType) return ZERO_COST_BREAKDOWN;

  // audit Phase 2: security annualised/ordinary rates are effective-dated.
  const rateSet = resolveRateSet(shift_date);

  let effectiveRate = rate ?? NaN;
  if (!Number.isFinite(effectiveRate) || effectiveRate <= 0) {
    // No explicit rate — resolve from the classification via the effective-dated
    // schedule (annualised for FT L3–6; Sch 2 §1 casual/permanent otherwise).
    effectiveRate =
      resolveSecurityRate(rateSet, options.classificationLevel, isFullTimeType, isCasualType)
      ?? rateSet.defaultRate;
  }

  // ── Higher duties (cl 29) — same MAX semantics as the Standard engine ─────
  // The nominated higher grade resolves through the SAME security rate path
  // (annualised for FT L3–6, Sch 2 §1 otherwise) and only ever RAISES the rate.
  let higherDutiesApplied = false;
  if (options.higherDutiesLevel) {
    const hdRate = resolveSecurityRate(rateSet, options.higherDutiesLevel, isFullTimeType, isCasualType);
    if (hdRate != null && Number.isFinite(hdRate) && hdRate > effectiveRate) {
      effectiveRate = hdRate;
      higherDutiesApplied = true;
    }
  }

  const isAnnualised = isSecurityAnnualised(effectiveRate, rateSet.security.annualisedHourly);
  const isCasual = !isAnnualised && isCasualType;

  let ordinaryRate = effectiveRate;
  if (isAnnualised) {
    ordinaryRate = rateSet.security.ordinaryFromAnnualised[effectiveRate] ?? effectiveRate;
  } else if (isCasual) {
    ordinaryRate = toOrdinaryRate(effectiveRate);
  }
  if (isNaN(ordinaryRate)) ordinaryRate = effectiveRate;

  const finalEffectiveRate = (previousWage != null && previousWage > effectiveRate) ? previousWage : effectiveRate;

  // ── Date facts (Phase 3) ───────────────────────────────────────────────
  let isHoliday: boolean;
  let shiftDay: number;
  if (ctx) {
    const facts = getDateFacts(ctx, shift_date);
    isHoliday = facts.isPublicHoliday;
    shiftDay = facts.dayOfWeek;
  } else {
    isHoliday = !!hd.isHoliday(shift_date);
    shiftDay = new Date(shift_date + 'T00:00:00').getDay();
  }

  // Schedule 3 §3.2 / §5.3: security meal breaks are PAID — price the full span.
  let calculatedMinutes = netMinutes;
  let startMins: number | null = null;
  if (options.start_time && options.end_time) {
    startMins = parseTimeToMinutes(String(options.start_time).substring(0, 5));
    let endMins = parseTimeToMinutes(String(options.end_time).substring(0, 5));
    if (is_overnight || endMins <= startMins) endMins += 1440;
    calculatedMinutes = endMins - startMins;
  }

  const netHours = Math.max(0, (calculatedMinutes || 0) / 60);

  // ── Overtime split (§4.2 / §6.3) ─────────────────────────────────────────
  // Overtime is triggered past the 12h daily cap only. §4.2(a)/§6.3(a) also
  // deem time "in excess of rostered hours" overtime, but security prices the
  // FULL clock span (paid meal breaks), so span-vs-scheduled comparisons would
  // misfire whenever the two inputs disagree; FT security rosters are even-time
  // 12h shifts, so the cap and the roster coincide in practice.
  const overtimeHours = Math.max(0, netHours - ORDINARY_HOURS_CAP_SECURITY);
  const ordinaryHours = Math.max(0, netHours - overtimeHours);

  // ── Per-day ordinary segments (penalty + night, §6.2 / cl 41 / cl 43) ─────
  // Annualised FT: the salary absorbs penalties, night allowances and leave
  // loading (§4.1(b)) — no penalty/night terms at all.
  const segStart = startMins ?? 0;
  const ordinaryEndMins = segStart + ordinaryHours * 60;
  const otEndMins = ordinaryEndMins + overtimeHours * 60;

  const nextDay = (shiftDay + 1) % 7;
  let nextIsHoliday = false;
  if (ordinaryEndMins > 1440 || otEndMins > 1440) {
    const nextStr = addOneDay(shift_date);
    nextIsHoliday = ctx ? getDateFacts(ctx, nextStr).isPublicHoliday : !!hd.isHoliday(nextStr);
  }

  interface Seg { fromMins: number; toMins: number; day: number; isHoliday: boolean; }
  const segments: Seg[] = ordinaryEndMins <= 1440
    ? [{ fromMins: segStart, toMins: ordinaryEndMins, day: shiftDay, isHoliday }]
    : [
        { fromMins: segStart, toMins: 1440, day: shiftDay, isHoliday },
        { fromMins: 1440, toMins: ordinaryEndMins, day: nextDay, isHoliday: nextIsHoliday },
      ];

  const startPenaltyLoad = penaltyLoading(shiftDay, isHoliday);

  // cl 43 conclusion day + casual-loading-included handling (see standard.ts).
  const concludesNextDay = ordinaryEndMins > 1440 || otEndMins > 1440;
  const conclusionDay = concludesNextDay ? nextDay : shiftDay;
  const nightLoadOverBase =
    nightAllowanceMultiplier(conclusionDay, isCasual) - (isCasual ? 0.25 : 0);
  const hasTimes = startMins != null;

  let penaltyCost = 0;
  let nightAllowanceCost = 0;
  let nightHours = 0;
  if (!isAnnualised) {
    for (const seg of segments) {
      const segHours = Math.max(0, (seg.toMins - seg.fromMins) / 60);
      const segLoad = penaltyLoading(seg.day, seg.isHoliday);
      penaltyCost += segHours * ordinaryRate * segLoad;

      if (hasTimes) {
        const segNightHours = fastNightMinutes(seg.fromMins, seg.toMins) / 60;
        if (segNightHours > 0) {
          nightHours += segNightHours;
          // §6.2(d) / cl 41.4: penalties are not cumulative on the night
          // allowance — only the excess over the day's penalty is payable.
          nightAllowanceCost += segNightHours * ordinaryRate * Math.max(0, nightLoadOverBase - segLoad);
        }
      }
    }
  }

  let ordinaryCost = ordinaryHours * finalEffectiveRate;

  // ── Leave (annual / personal / carer) — non-annualised permanents ─────────
  // Annualised FT is salaried (leave already within the salary) and falls
  // through to normal pricing. Non-annualised: annual leave = the greater of
  // base + 17.5% loading (cl 44.7) or the as-worked penalty value; personal /
  // carer = ordinary base. No OT, no floor, no night allowance.
  if (isLeave && !isAnnualised) {
    const leaveBase = ordinaryHours * finalEffectiveRate;
    const leaveTotal = options.isAnnualLeave
      ? Math.max(leaveBase * (1 + ANNUAL_LEAVE_LOADING), leaveBase + penaltyCost + nightAllowanceCost)
      : leaveBase;
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return {
      totalCost: r2(leaveTotal),
      ordinaryCost: r2(leaveTotal),
      overtimeCost: 0,
      penaltyCost: 0,
      allowanceCost: 0,
      ordinaryHours,
      overtimeHours: 0,
      breakdown: {
        baseRate: finalEffectiveRate,
        ordinaryRate,
        penaltyRate: finalEffectiveRate,
        isCasual,
        isApprentice: false,
        isTrainee: false,
        nightHours: 0,
        nightAllowanceCost: 0,
      },
    };
  }

  // ── Minimum engagement (Sch 3 §5.2(e) / §5.3(e)) — PT & casual only ───────
  // 4h on a Sunday or PH, 3h otherwise. Top-up hours are paid but not worked:
  // priced at the engagement-day rate, no night allowance.
  let paidOrdinaryHours = ordinaryHours;
  if (!isAnnualised && netHours > 0) {
    const floorHours = (isHoliday || shiftDay === SUNDAY) ? 4 : 3;
    if (paidOrdinaryHours < floorHours) {
      const topUp = floorHours - paidOrdinaryHours;
      ordinaryCost += topUp * finalEffectiveRate;
      penaltyCost += topUp * ordinaryRate * startPenaltyLoad;
      paidOrdinaryHours = floorHours;
    }
  }

  // ── Higher-duties minimum (cl 29.1(a)) — parity with the Standard engine ──
  // Under 4h of uplifted work pays a 4-hour minimum at the higher rate.
  if (higherDutiesApplied && netHours > 0 && paidOrdinaryHours < 4) {
    const topUp = 4 - paidOrdinaryHours;
    ordinaryCost += topUp * finalEffectiveRate;
    penaltyCost += topUp * ordinaryRate * startPenaltyLoad;
    paidOrdinaryHours = 4;
  }

  // ── Overtime (§4.2 / §6.3) — 150% first THREE hours, 200% after ───────────
  // Casual loading absorbed (§6.3(c)) ⇒ multipliers apply to the ordinary rate.
  // PH overtime floors at 250% per hour actually ON the PH day (parity with the
  // Standard engine's cl 42 day-split).
  let overtimeCost = 0;
  if (overtimeHours > 0) {
    interface OtSeg { hours: number; isHoliday: boolean; }
    let otSegs: OtSeg[];
    if (hasTimes && otEndMins > 1440 && ordinaryEndMins < otEndMins) {
      const splitAt = Math.max(ordinaryEndMins, 1440);
      const beforeH = Math.max(0, (Math.min(1440, otEndMins) - ordinaryEndMins)) / 60;
      const afterH = Math.max(0, (otEndMins - splitAt)) / 60;
      otSegs = [];
      if (beforeH > 0) otSegs.push({ hours: beforeH, isHoliday });
      if (afterH > 0) otSegs.push({ hours: afterH, isHoliday: nextIsHoliday });
    } else {
      otSegs = [{ hours: overtimeHours, isHoliday }];
    }

    let cum = 0;
    for (const seg of otSegs) {
      const th = Math.max(0, Math.min(cum + seg.hours, TIME_AND_HALF_HOURS_CAP) - Math.min(cum, TIME_AND_HALF_HOURS_CAP));
      const dt = Math.max(0, (cum + seg.hours) - Math.max(cum, TIME_AND_HALF_HOURS_CAP));
      const tieredCostHours = th * TIME_AND_HALF_MULTIPLIER + dt * DOUBLE_TIME_MULTIPLIER;
      const phCostHours = seg.hours * DOUBLE_TIME_AND_HALF_MULTIPLIER;
      overtimeCost += (seg.isHoliday ? Math.max(tieredCostHours, phCostHours) : tieredCostHours) * ordinaryRate;
      cum += seg.hours;
    }
  }

  const allowanceCost = nightAllowanceCost;
  const total = ordinaryCost + penaltyCost + overtimeCost + allowanceCost;

  const penaltyRate = isAnnualised
    ? finalEffectiveRate
    : finalEffectiveRate + ordinaryRate * startPenaltyLoad;

  return {
    totalCost: Math.round(total * 100) / 100,
    ordinaryCost: Math.round(ordinaryCost * 100) / 100,
    overtimeCost: Math.round(overtimeCost * 100) / 100,
    penaltyCost: Math.round(penaltyCost * 100) / 100,
    allowanceCost: Math.round(allowanceCost * 100) / 100,
    ordinaryHours: paidOrdinaryHours,
    overtimeHours,
    breakdown: {
      baseRate: finalEffectiveRate,
      ordinaryRate,
      penaltyRate,
      isCasual,
      isApprentice: false,
      isTrainee: false,
      nightHours,
      nightAllowanceCost: Math.round(nightAllowanceCost * 100) / 100,
    },
  };
}

export function estimateShiftCost(options: CostCalculatorOptions, ctx?: AwardContext): number {
  return estimateDetailedShiftCost(options, ctx).totalCost;
}
