/**
 * Shared projector utilities
 *
 * Functions used by multiple projectors — kept here to avoid circular imports.
 * Pure functions, no React, no side effects.
 */

import type { Shift } from '../../shift.entity';
import type { ProjectionStats } from '../types';
import { netMinutesFromShift } from '../utils/duration';
import { estimateDetailedCostFromShift } from '../utils/cost';

/**
 * Compute the top-level ProjectionStats bag from a flat Shift array.
 * Called by every projector so the returned `stats` field is consistent
 * across all four modes regardless of which projector is active.
 */
export function buildStats(shifts: Shift[]): ProjectionStats {
  const nonCancelled = shifts.filter(s => !s.is_cancelled);

  let totalNetMinutes = 0;
  let estimatedCost   = 0;
  const costBreakdown = {
    base: 0,
    penalty: 0,
    overtime: 0,
    allowance: 0,
    leave: 0,
  };

  for (const shift of nonCancelled) {
    const mins = netMinutesFromShift(shift);
    totalNetMinutes += mins;
    
    const detail = estimateDetailedCostFromShift(shift, mins);
    estimatedCost += detail.totalCost;
    costBreakdown.base += detail.baseCost;
    costBreakdown.penalty += detail.penaltyCost;
    costBreakdown.overtime += detail.overtimeCost;
    costBreakdown.allowance += detail.allowanceCost;
    costBreakdown.leave += detail.leaveLoadingCost;
  }

  return {
    totalShifts:    nonCancelled.length,
    assignedShifts: nonCancelled.filter(s => !!s.assigned_employee_id).length,
    openShifts:     nonCancelled.filter(s => !s.assigned_employee_id).length,
    publishedShifts: nonCancelled.filter(s => s.lifecycle_status === 'Published').length,
    totalNetMinutes,
    estimatedCost:  Math.round(estimatedCost * 100) / 100,
    costBreakdown,
  };
}
