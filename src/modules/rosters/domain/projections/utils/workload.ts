/**
 * Workload utilities — the SINGLE source of truth for utilization and fatigue
 * scoring across People Mode.
 *
 * Two code paths render the same `ProjectedEmployee.utilization` / `fatigueScore`:
 *   1. people.projector.ts        — runs inside the worker, per shift chunk
 *   2. projection.worker.pool.ts  — merges chunk partials on the main thread
 *
 * Historically each computed utilization with its own formula (one divided
 * hours by minutes — a 60× unit bug). Both now call the helpers below so the
 * number is identical regardless of how the pool split the work.
 */

import { calculateFatigueWithRecovery } from './fatigue';

const DAYS_PER_WEEK = 7;

/**
 * Contracted hours scaled to the visible period.
 *
 * `contracted_weekly_hours` is a WEEKLY figure (e.g. 38), but `currentHours`
 * sums every shift in the visible range — a week, a month, etc. To compare
 * like-for-like we scale the weekly contract by the number of days on screen.
 *
 * The effective days are floored at ONE WEEK: scaling a weekly contract down
 * to a sub-week window (e.g. Day view, rangeDays=1 → 38/7 ≈ 5.4h) makes a
 * single legitimate 8h shift read as heavily over-utilized (~147%). A weekly
 * floor keeps utilization meaningful on short ranges while leaving Week (7)
 * and Month (28–31) untouched. Also falls back to a 7-day window when
 * `rangeDays` is missing so a stray caller never divides by zero.
 */
export function periodContractedHours(
  contractedWeeklyHours: number | undefined | null,
  rangeDays: number | undefined,
): number {
  if (!contractedWeeklyHours || contractedWeeklyHours <= 0) return 0;
  const days = rangeDays && rangeDays > 0 ? Math.max(rangeDays, DAYS_PER_WEEK) : DAYS_PER_WEEK;
  return contractedWeeklyHours * (days / DAYS_PER_WEEK);
}

/**
 * Period-aware utilization %. Returns 0 when there is no contract to measure
 * against (e.g. the unassigned "Open Shifts" bucket).
 */
export function computeUtilizationPct(
  currentHours: number,
  contractedWeeklyHours: number | undefined | null,
  rangeDays: number | undefined,
): number {
  const periodContract = periodContractedHours(contractedWeeklyHours, rangeDays);
  if (periodContract <= 0) return 0;
  return (currentHours / periodContract) * 100;
}

/** True when scheduled hours exceed the period-scaled contract. */
export function isOverContractedHours(
  currentHours: number,
  contractedWeeklyHours: number | undefined | null,
  rangeDays: number | undefined,
): boolean {
  const periodContract = periodContractedHours(contractedWeeklyHours, rangeDays);
  return periodContract > 0 && currentHours > periodContract;
}

type FatigueShift = {
  shift_date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes?: number | null;
};

/**
 * Peak projected fatigue across the employee's roster.
 *
 * `calculateFatigueWithRecovery` measures fatigue in a trailing 7-day window
 * ending at its `referenceDate`. Anchoring that to "today" (as the projector
 * used to) reads 0 for any roster planned in the future. Instead we anchor the
 * window to each shift's own date — matching the auto-scheduler's convention
 * (AutoSchedulerPanel uses `proposal.shiftDate`) — and take the worst point.
 *
 * `history` is the set of shifts in the 7 days BEFORE the visible window. It is
 * fed in as recovery/accumulation context ONLY: it makes each visible day's
 * 7-day trailing window complete regardless of the view zoom (Day/3D would
 * otherwise be starved of prior-week shifts and under-count fatigue), but it is
 * never itself a reference date — we only report the peak on days actually shown.
 * The mapped array is built once (not per reference date) to avoid O(D×N) allocs.
 *
 * `history` is REQUIRED (audit F-22): it defaulted to `[]`, and two of the three
 * call sites silently took that default despite the paragraph above explaining
 * why they must not. Pass `[]` explicitly when you genuinely have no history —
 * that way it is a decision, not an omission.
 */
export function computePeakFatigue(
  shifts: FatigueShift[],
  history: FatigueShift[],
): number {
  if (shifts.length === 0) return 0;
  const referenceDates = Array.from(new Set(shifts.map((s) => s.shift_date)));
  const normalize = (s: FatigueShift) => ({
    shift_date: s.shift_date,
    start_time: s.start_time,
    end_time: s.end_time,
    unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
  });
  const mapped = history.length > 0
    ? [...history.map(normalize), ...shifts.map(normalize)]
    : shifts.map(normalize);
  let peak = 0;
  for (const referenceDate of referenceDates) {
    // `peak`, not `current`: this metric is "how bad does this roster get for
    // this person", so it must read the maximum reached on each day, NOT the
    // value after resting to midnight. `current` now decays to the reference
    // instant (audit F-03) and is the right reading for "as of now" — they are
    // deliberately different numbers.
    const { peak: dayPeak } = calculateFatigueWithRecovery(mapped, referenceDate);
    if (dayPeak > peak) peak = dayPeak;
  }
  return peak;
}
