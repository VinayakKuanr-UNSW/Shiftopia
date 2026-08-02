/**
 * cl 39.1 / 39.4 / 28.4 — split-shift allowance eligibility.
 *
 * Single source of truth shared by the payroll period aggregator
 * (`payroll/domain/aggregatePeriodGrossPay.ts`) and the live roster/timesheet
 * cost pipeline (`pipeline/runProjectionPipeline.ts`, `projectors/shared.ts`),
 * so the two can never disagree about which shift of a same-day pair earns
 * the $11.13 allowance (compliance audit finding — 2026-08-02: the detection
 * logic previously existed only in the payroll aggregator, which has no
 * production caller, so the allowance was effectively unreachable from the
 * roster grid / AutoScheduler / timesheets).
 *
 * A split shift is a Part-Time or Flexible Part-Time member's (cl 39.1 —
 * Casual and Full-Time are excluded) two WORKED engagements on the same
 * calendar day with a gap of no more than three (3) hours between them
 * (cl 39.4). Only the LATER shift of each qualifying pair is marked — the
 * allowance is one $11.13 payment for the day's split pattern, not one per
 * segment.
 *
 * Known limitation (mirrors the compliance engine's own documented gap):
 * there is no live `shift_type` field to positively exclude a same-day
 * MULTI-HIRE pairing, which cl 39.4 also excludes from "split shift." A
 * multi-hire pair could therefore be mis-flagged here until that field
 * exists in production (same caveat as the cl 13.1(f) multi-hire
 * minimum-engagement floor).
 */

export interface SplitShiftCandidate {
  /** Stable identifier for the shift — the value returned in the marked set. */
  id: string;
  /** The employee this shift is assigned to. Required — grouping is per (employee, date). */
  employeeId: string;
  shiftDate: string;
  startTime?: string | null;
  endTime?: string | null;
  employmentType?: string | null;
  /** True for a leave/absence entry — these are not a worked engagement. */
  isLeave?: boolean;
}

/** cl 39.4 — the maximum gap that still qualifies as a split shift. */
export const MAX_SPLIT_SHIFT_GAP_MINUTES = 180;

function isCasual(employmentType?: string | null): boolean {
  return /casual/i.test(employmentType || '');
}

function hmToMinutes(hm?: string | null): number {
  if (!hm) return 0;
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Returns the set of shift IDs that qualify for the cl 28.4 split-shift
 * allowance across ANY number of employees — grouped by (employeeId,
 * shiftDate) so two different employees who each work one shift on the same
 * day are never mistaken for a split-shift pair.
 */
export function detectSplitShiftEligibleIds(shifts: SplitShiftCandidate[]): Set<string> {
  const isEligibleCandidate = (s: SplitShiftCandidate): boolean =>
    !isCasual(s.employmentType)
    && s.employmentType !== 'Full-Time'
    && !!s.startTime && !!s.endTime
    && !s.isLeave;

  const byEmployeeDate = new Map<string, SplitShiftCandidate[]>();
  for (const s of shifts) {
    if (!isEligibleCandidate(s)) continue;
    const key = `${s.employeeId}::${s.shiftDate}`;
    const list = byEmployeeDate.get(key) ?? [];
    list.push(s);
    byEmployeeDate.set(key, list);
  }

  const marked = new Set<string>();
  for (const dayShifts of byEmployeeDate.values()) {
    if (dayShifts.length < 2) continue;
    const sorted = [...dayShifts].sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    for (let i = 1; i < sorted.length; i++) {
      const gap = hmToMinutes(sorted[i].startTime) - hmToMinutes(sorted[i - 1].endTime);
      if (gap >= 0 && gap <= MAX_SPLIT_SHIFT_GAP_MINUTES) {
        marked.add(sorted[i].id);
      }
    }
  }
  return marked;
}
