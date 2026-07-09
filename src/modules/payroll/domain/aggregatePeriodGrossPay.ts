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
  'annual_leave', 'personal_leave', 'leave_loading',
];

export interface PeriodBounds {
  periodId?: string;
  periodStart: string; // YYYY-MM-DD, inclusive
  periodEnd: string;   // YYYY-MM-DD, inclusive
}

const WEEKLY_ORDINARY_THRESHOLD = 38; // cl 42 — ordinary hours per week

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

  const byCode = new Map<EarningsCode, EarningsLine>();
  for (const s of inPeriod) {
    for (const l of s.lines) {
      const cur = byCode.get(l.code);
      if (cur) {
        cur.amount = round2(cur.amount + l.amount);
        if (l.hours != null) cur.hours = round2((cur.hours ?? 0) + l.hours);
      } else {
        byCode.set(l.code, {
          code: l.code,
          description: l.description,
          amount: round2(l.amount),
          hours: l.hours != null ? round2(l.hours) : undefined,
        });
      }
    }
  }

  const lines = CODE_ORDER.filter((c) => byCode.has(c)).map((c) => byCode.get(c)!);
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
 */
export function computeEmployeePeriodGrossPay(
  employeeId: string,
  inputs: GrossPayShiftInput[],
  bounds: PeriodBounds,
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
    if (!casual) {
      weeklyOrdinary.set(week, (weeklyOrdinary.get(week) ?? 0) + (result.ordinaryHours || 0));
    }
  }

  return aggregatePeriodGrossPay(employeeId, priced, bounds);
}
