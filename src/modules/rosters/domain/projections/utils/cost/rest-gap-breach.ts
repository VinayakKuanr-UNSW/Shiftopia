/**
 * cl 40.1 — insufficient rest between shifts.
 *
 * "A Team Member will be entitled to a minimum break of ten (10) hours
 * between the completion of work on the one day and the commencement of
 * work on the next day. If on the instructions of the Employer such a Team
 * Member resumes or continues work without having had ten (10) hours off
 * duty, the Team Member shall be paid double time until being released from
 * duty..."
 *
 * Single source of truth for the BREACH DETECTION shared by the payroll
 * period aggregator (`payroll/domain/aggregatePeriodGrossPay.ts`) and the
 * live roster/timesheet cost pipeline (compliance audit finding —
 * 2026-08-02: this rule previously existed only in the payroll aggregator,
 * which has no production caller, so a forced early recall never triggered
 * the double-time floor anywhere a manager or the AutoScheduler could see
 * it). Each consumer applies its OWN dollar floor using its own priced
 * result shape — this module only answers "which shift breached, and by how
 * many minutes short of the floor."
 *
 * The gap is measured from the last WORKED shift with real clock times — a
 * leave/absence day has no times and IS rest, so it advances nothing and
 * never anchors or breaches the gap. Same-day pairs are split-shift /
 * multi-hire territory (cl 39 / 40.3), not this day-to-day rule, so only
 * gaps that cross a calendar-day boundary are checked. Applies to every
 * Team Member, including casuals (cl 40.1 has no employment-type carve-out).
 *
 * Known limitation: cl 40.2 lets the Employer and Team Member agree in
 * writing to an 8-hour break instead of 10 — there is no "agreed break"
 * field on either shift shape today, so both consumers default to the full
 * 10-hour (600-minute) floor. A caller may override `minGapMinutes` when
 * that agreement is known.
 */

export interface RestGapCandidate {
  id: string;
  employeeId: string;
  shiftDate: string;
  startTime?: string | null;
  endTime?: string | null;
  /** True for a genuine worked attendance with real clock times — false for
   *  leave/absence/no-show/cancelled entries, which never anchor or breach. */
  isWorkedWithTimes: boolean;
}

/** cl 40.1 — the default minimum rest gap (10h = 600min). */
export const DEFAULT_MIN_REST_GAP_MINUTES = 600;

function hmToMinutes(hm?: string | null): number {
  if (!hm) return 0;
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Absolute start/end minutes for a shift (day-based offset, overnight-aware). */
function shiftInterval(s: RestGapCandidate): { startAbs: number; endAbs: number } {
  const dayMs = Date.parse(s.shiftDate + 'T00:00:00');
  const base = Number.isNaN(dayMs) ? 0 : Math.round(dayMs / 86_400_000) * 1440;
  const start = hmToMinutes(s.startTime);
  let end = hmToMinutes(s.endTime);
  if (end <= start) end += 1440; // cross-midnight
  return { startAbs: base + start, endAbs: base + end };
}

/**
 * Returns `shiftId -> shortfallMinutes` (how many minutes short of the floor
 * the actual gap was) for every shift that resumed work without the minimum
 * rest gap from the employee's own immediately preceding WORKED shift on a
 * DIFFERENT calendar day. Grouped per employee; ordered by date then start
 * time within each employee.
 */
export function detectRestGapBreaches(
  shifts: RestGapCandidate[],
  minGapMinutes: number = DEFAULT_MIN_REST_GAP_MINUTES,
): Map<string, number> {
  const breaches = new Map<string, number>();

  const byEmployee = new Map<string, RestGapCandidate[]>();
  for (const s of shifts) {
    const list = byEmployee.get(s.employeeId) ?? [];
    list.push(s);
    byEmployee.set(s.employeeId, list);
  }

  for (const list of byEmployee.values()) {
    const ordered = [...list].sort((a, b) =>
      a.shiftDate === b.shiftDate
        ? (a.startTime ?? '').localeCompare(b.startTime ?? '')
        : a.shiftDate.localeCompare(b.shiftDate),
    );

    let lastWorked = -1;
    for (let i = 0; i < ordered.length; i++) {
      if (!ordered[i].isWorkedWithTimes) continue; // leave/no-times never anchors or breaches

      if (lastWorked >= 0 && ordered[lastWorked].shiftDate !== ordered[i].shiftDate) {
        const prevEnd = shiftInterval(ordered[lastWorked]).endAbs;
        const curStart = shiftInterval(ordered[i]).startAbs;
        const gap = curStart - prevEnd;

        // Overlaps (< 0) are data errors owned by the no-overlap compliance rule.
        if (gap >= 0 && gap < minGapMinutes) {
          breaches.set(ordered[i].id, minGapMinutes - gap);
        }
      }

      lastWorked = i;
    }
  }

  return breaches;
}
