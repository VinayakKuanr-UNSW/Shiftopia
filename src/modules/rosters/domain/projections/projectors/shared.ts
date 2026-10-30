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
import type { WorkerShiftDTO, ProjectedShiftResult } from '../worker/protocol';
import { computeBiddingUrgency, isOnBidding } from '../../bidding-urgency';
import { minutesToHours } from '../utils/duration';
import { determineShiftState } from '../../shift-state.utils';

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

// ── Worker shift → projected shift (every mode) ───────────────────────────────
// One mapping for the group, roles, events and people projectors, so a shift
// shows the same hours, state and flags whichever mode is open. No cost: money
// is shown in Gross Pay alone (decision 2026-10-09).

export function resolveEmployeeName(shift: WorkerShiftDTO): string | null {
  if (shift.employeeFirstName || shift.employeeLastName) {
    return `${shift.employeeFirstName ?? ''} ${shift.employeeLastName ?? ''}`.trim() || null;
  }
  if (shift.assignedEmployeeId) return 'Assigned';
  return null;
}

export function toProjectedShift(shift: WorkerShiftDTO): ProjectedShiftResult {
  const netMinutes = shift.netLengthMinutes ?? shift.scheduledLengthMinutes;

  const groupType = shift.groupType ?? null;

  const stateId = determineShiftState({
    lifecycle_status: shift.lifecycleStatus as any,
    assignment_status: (shift.assignmentStatus ?? 'unassigned') as any,
    assignment_outcome: shift.assignmentOutcome as any,
    trading_status: shift.tradingStatus as any,
    is_cancelled: shift.isCancelled,
  });

  return {
    id: shift.id,
    date: shift.shiftDate,
    startTime: shift.startTime,
    endTime: shift.endTime,
    netMinutes,
    unpaidBreakMinutes: shift.unpaidBreakMinutes ?? 0,
    stateId,
    roleName: shift.roleName ?? 'Shift',
    roleId: shift.roleId,
    levelName: shift.levelName ?? '',
    levelNumber: shift.levelNumber ?? 0,
    levelId: shift.remunerationLevel !== null && shift.remunerationLevel !== undefined ? shift.remunerationLevel.toString() : null,
    groupType,
    subGroupName: shift.subGroupName ?? shift.rosterSubgroupName ?? null,
    groupColorKey: groupType ?? 'unassigned',
    employeeName: resolveEmployeeName(shift),
    employeeId: shift.assignedEmployeeId,
    isLocked: shift.isLocked,
    isUrgent: isOnBidding(shift.biddingStatus) && computeBiddingUrgency(shift.shiftDate, shift.startTime) === 'urgent',
    isOnBidding: isOnBidding(shift.biddingStatus),
    isTrading: !!shift.tradeRequestedAt,
    isCancelled: shift.isCancelled,
    isPublished: shift.isPublished,
    isDraft: shift.isDraft,
    
    role: shift.roleName ?? 'Shift',
    hours: minutesToHours(netMinutes),
    status: shift.isCancelled ? 'Draft' : (shift.assignedEmployeeId ? (shift.isDraft ? 'Draft' : 'Assigned') : 'Open'),
    lifecycleStatus: shift.isPublished ? 'published' : 'draft',
    assignmentStatus: shift.assignedEmployeeId ? 'assigned' : 'unassigned',
    fulfillmentStatus: shift.fulfillmentStatus,
  };
}
