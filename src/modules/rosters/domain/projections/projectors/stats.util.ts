/**
 * Top-level ProjectionStats aggregation (worker-safe)
 *
 * Computes the projection's summary stats from already-projected shifts —
 * counts and hours. No labour cost: money is shown in Gross Pay alone
 * (decision 2026-10-09).
 *
 * Cancelled shifts are passed through into the projection so the UI can
 * render them, but they are excluded from every stat.
 */

import type { ProjectionStats } from '../types';
import type { ProjectedShiftResult } from '../worker/protocol';

export function statsFromProjectedShifts(
  shifts: ProjectedShiftResult[],
): ProjectionStats {
  const live = shifts.filter(s => !s.isCancelled);

  let totalNetMinutes = 0;
  let assignedShifts  = 0;
  let publishedShifts = 0;

  for (const s of live) {
    totalNetMinutes += s.netMinutes;
    if (s.employeeId)  assignedShifts++;
    if (s.isPublished) publishedShifts++;
  }

  return {
    totalShifts:    live.length,
    assignedShifts,
    openShifts:     live.length - assignedShifts,
    publishedShifts,
    totalNetMinutes,
  };
}
