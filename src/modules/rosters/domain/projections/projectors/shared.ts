/**
 * Shared projector utilities
 *
 * Functions used by multiple projectors — kept here to avoid circular imports.
 * Pure functions, no React, no side effects.
 *
 * No labour cost: money is shown in Gross Pay alone (decision 2026-10-09), so
 * the roster projections count shifts and hours only.
 */

import type { Shift } from '../../shift.entity';
import type { ProjectionStats } from '../types';
import { netMinutesFromShift } from '../utils/duration';

/**
 * Compute the top-level ProjectionStats bag from a flat Shift array.
 * Called by every projector so the returned `stats` field is consistent
 * across all four modes regardless of which projector is active.
 */
export function buildStats(shifts: Shift[]): ProjectionStats {
  const nonCancelled = shifts.filter(s => !s.is_cancelled);
  const assignedShifts = nonCancelled.filter(s => !!s.assigned_employee_id);
  const totalNetMinutes = nonCancelled.reduce((sum, s) => sum + netMinutesFromShift(s), 0);

  return {
    totalShifts:    nonCancelled.length,
    assignedShifts: assignedShifts.length,
    openShifts:     nonCancelled.length - assignedShifts.length,
    publishedShifts: nonCancelled.filter(s => ['Published', 'InProgress', 'Completed'].includes(s.lifecycle_status)).length,
    totalNetMinutes,
  };
}
