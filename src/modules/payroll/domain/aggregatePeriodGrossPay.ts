/**
 * Period aggregation — rolls per-shift gross pay up into ONE record per employee
 * per pay period, and (via computeEmployeePeriodGrossPay) sequences a whole
 * period so weekly overtime (cl 42) is driven by the REAL order of worked shifts.
 */

import type { EarningsCode, EarningsLine, PeriodGrossPay, ShiftGrossPay } from '../model/gross-pay.types';
import { computeShiftGrossPay, type GrossPayShiftInput } from './computeShiftGrossPay';

function round2(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const v = Math.round(x * 100) / 100;
  return v === 0 ? 0 : v;
}

/** Canonical payslip ordering for aggregated lines. */
const CODE_ORDER: EarningsCode[] = [
  'ordinary', 'penalty', 'overtime', 'night_allowance', 'other_allowance',
  'annual_leave', 'personal_leave', 'parental_leave', 'long_service_leave',
  'jury_duty', 'supporting_carer', 'public_holiday', 'leave_loading',
  'rest_gap_penalty',
];

/** cl 40.1 — double-time floor multiplier for rest-gap breach hours. */
const DOUBLE_TIME_MULTIPLIER = 2.0;
/** Default minimum rest gap (10h = 600min, cl 40.1). */
const DEFAULT_MIN_REST_GAP_MINUTES = 600;

export interface PeriodBounds {
  periodId?: string;
  periodStart: string; // YYYY-MM-DD, inclusive
  periodEnd: string;   // YYYY-MM-DD, inclusive
}

/**
 * The Monday-anchored ISO-week key (the week's Monday as YYYY-MM-DD). Built from
 * LOCAL date parts so it never rolls the day in AU timezones.
 */
export function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const mondayOffset = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - mondayOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isCasual(employmentType?: string): boolean {
  return /casual/i.test(employmentType || '');
}

/**
 * Aggregate already-computed per-shift gross pay for one employee into a single
 * period record. Shifts outside [periodStart, periodEnd] or for another employee
 * are ignored. Earnings lines are summed by code and returned in canonical order.
 */
export function aggregatePeriodGrossPay(
  employeeId: string,
  shifts: ShiftGrossPay[],
  bounds: PeriodBounds,
): PeriodGrossPay {
  const inPeriod = shifts.filter(
    (s) => s.employeeId === employeeId
      && s.shiftDate >= bounds.periodStart
      && s.shiftDate <= bounds.periodEnd,
  );

  const byKey = new Map<string, EarningsLine>();
  for (const s of inPeriod) {
    for (const l of s.lines) {
      const key = `${l.code}::${l.description}`;
      const cur = byKey.get(key);
      if (cur) {
        cur.amount = round2(cur.amount + l.amount);
        if (l.hours != null) cur.hours = round2((cur.hours ?? 0) + l.hours);
      } else {
        byKey.set(key, {
          code: l.code,
          description: l.description,
          amount: round2(l.amount),
          hours: l.hours != null ? round2(l.hours) : undefined,
        });
      }
    }
  }

  const lines = Array.from(byKey.values()).sort((a, b) => {
    return CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code);
  });
  const grossPay = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const paidHours = round2(inPeriod.reduce((sum, s) => sum + s.paidHours, 0));

  return {
    employeeId,
    periodId: bounds.periodId,
    periodStart: bounds.periodStart,
    periodEnd: bounds.periodEnd,
    shifts: inPeriod,
    lines,
    grossPay,
    paidHours,
    shiftCount: inPeriod.length,
  };
}

export interface PeriodConfig {
  /** Minimum rest gap in minutes (default 600 = 10h, cl 40.1). */
  minRestGapMinutes?: number;
}

/**
 * End-to-end: price every shift for ONE employee across a period and roll it up.
 *
 * Shifts are ordered by date then start time and their ordinary hours are
 * accumulated per ISO week, so `priorOrdinaryHoursThisWeek` is supplied to the
 * award engine in the correct sequence — that is what makes weekly overtime
 * (cl 42, >38h ordinary/week) correct. Casuals are excluded from weekly-OT
 * accumulation (ambiguous under the EA — see the engine). Any caller-supplied
 * `priorOrdinaryHoursThisWeek` on an input is respected as a starting offset
 * (e.g. hours already worked in a week that straddles the period boundary).
 *
 * After pricing, a rest-gap sweep detects cl 40.1 violations and applies a
 * double-time floor to shifts that started without sufficient rest.
 */
export function computeEmployeePeriodGrossPay(
  employeeId: string,
  inputs: GrossPayShiftInput[],
  bounds: PeriodBounds,
  config?: PeriodConfig,
): PeriodGrossPay {
  const ordered = inputs
    .filter((i) => i.employeeId === employeeId && i.shiftDate >= bounds.periodStart && i.shiftDate <= bounds.periodEnd)
    .sort((a, b) => (a.shiftDate === b.shiftDate
      ? (a.startTime ?? '').localeCompare(b.startTime ?? '')
      : a.shiftDate.localeCompare(b.shiftDate)));

  const weeklyOrdinary = new Map<string, number>();
  const priced: ShiftGrossPay[] = [];

  for (const input of ordered) {
    const casual = isCasual(input.employmentType);
    const week = isoWeekKey(input.shiftDate);

    // Seed the week's running total ONCE with any caller-supplied offset (hours
    // already worked earlier in a week that straddles the period boundary).
    if (!casual && !weeklyOrdinary.has(week)) {
      weeklyOrdinary.set(week, input.priorOrdinaryHoursThisWeek ?? 0);
    }

    const priorFromWeek = casual ? undefined : weeklyOrdinary.get(week)!;
    const result = computeShiftGrossPay({ ...input, priorOrdinaryHoursThisWeek: priorFromWeek });
    priced.push(result);

    // Accumulate the ordinary hours the engine actually billed (post weekly
    // reclassification) so the next shift in the week sees the running total.
    // Leave / PH-absence days are excluded: cl 42.1 overtime triggers on time
    // WORKED, so a paid absence must not push a later worked shift over the
    // 38h weekly line and spuriously reprice it as overtime.
    if (!casual && !result.isLeave) {
      weeklyOrdinary.set(week, (weeklyOrdinary.get(week) ?? 0) + (result.ordinaryHours || 0));
    }
  }

  // ── cl 40.1 rest-gap penalty sweep ─────────────────────────────────────
  // When a non-casual employee resumes work without the minimum rest gap,
  // all hours on the breach shift are paid at no less than double time.
  const minGap = config?.minRestGapMinutes ?? DEFAULT_MIN_REST_GAP_MINUTES;
  applyRestGapPenalty(priced, ordered, minGap);

  return aggregatePeriodGrossPay(employeeId, priced, bounds);
}

/**
 * Parse HH:MM → minutes-since-midnight. Returns 0 for malformed input.
 */
function hmToMinutes(hm?: string): number {
  if (!hm) return 0;
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Absolute start/end minutes for a shift input (day-based offset). Handles
 * cross-midnight: if end ≤ start, end is pushed +1440.
 */
function shiftInterval(input: GrossPayShiftInput): { startAbs: number; endAbs: number } {
  const dayMs = Date.parse(input.shiftDate + 'T00:00:00');
  const base = Number.isNaN(dayMs) ? 0 : Math.round(dayMs / 86_400_000) * 1440;
  const start = hmToMinutes(input.startTime);
  let end = hmToMinutes(input.endTime);
  if (end <= start) end += 1440; // cross-midnight
  return { startAbs: base + start, endAbs: base + end };
}

/** A priced shift is a real WORKED attendance only if it has clock times and paid hours. */
function isWorkedWithTimes(input: GrossPayShiftInput, result: ShiftGrossPay): boolean {
  return !result.isLeave
    && result.paidHours > 0
    && !!input.startTime
    && !!input.endTime;
}

/**
 * cl 40.1: a member who resumes work without the minimum break (10h; 8h by
 * written agreement / multi-hire via `minGapMinutes`) is paid DOUBLE TIME until
 * released from duty — modelled as a whole-shift floor of 2× the ordinary rate,
 * added as a `rest_gap_penalty` line for the shortfall.
 *
 * The gap is measured from the last WORKED shift with real clock times — a
 * synthesised leave/PH day has no times (its interval would fabricate a
 * midnight "end" and poison the gap) and an absence IS rest, so leave days
 * advance nothing. Same-day pairs are split-shift / multi-hire territory
 * (cl 39 / 40.3), not the cl 40.1 day-to-day break. Applies to casuals too —
 * cl 40.1 covers every Team Member; the 2× floor is on the DE-LOADED ordinary
 * rate (the loading is absorbed, mirroring the cl 42.2 overtime treatment),
 * taken from the PRICED result so it works when the input rate was null
 * (classification-resolved live path).
 */
function applyRestGapPenalty(
  priced: ShiftGrossPay[],
  ordered: GrossPayShiftInput[],
  minGapMinutes: number,
): void {
  if (priced.length < 2) return;

  let lastWorked = -1; // index of the last real worked-with-times shift
  for (let i = 0; i < priced.length; i++) {
    if (!isWorkedWithTimes(ordered[i], priced[i])) continue; // leave/no-times never triggers or anchors

    if (lastWorked >= 0 && ordered[lastWorked].shiftDate !== ordered[i].shiftDate) {
      const prevEnd = shiftInterval(ordered[lastWorked]).endAbs;
      const curStart = shiftInterval(ordered[i]).startAbs;
      const gap = curStart - prevEnd;

      // Overlaps (< 0) are data errors owned by the no-overlap compliance rule.
      if (gap >= 0 && gap < minGapMinutes) {
        const hours = priced[i].paidHours;
        const ordinaryRate = priced[i].ordinaryRate ?? 0;
        const effectiveRate = hours > 0 ? priced[i].grossPay / hours : 0;
        const doubleTimeRate = DOUBLE_TIME_MULTIPLIER * ordinaryRate;

        if (ordinaryRate > 0 && effectiveRate < doubleTimeRate) {
          const penalty = round2((doubleTimeRate - effectiveRate) * hours);
          if (penalty > 0) {
            priced[i].lines.push({
              code: 'rest_gap_penalty',
              description: 'Insufficient rest break — double time (cl 40.1)',
              hours,
              amount: penalty,
            });
            priced[i].grossPay = round2(priced[i].grossPay + penalty);
            priced[i].restGapPenaltyAmount = penalty;
          }
        }
      }
    }

    lastWorked = i;
  }
}
