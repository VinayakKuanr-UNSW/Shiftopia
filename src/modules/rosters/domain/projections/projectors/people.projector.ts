/**
 * People Mode Projector
 *
 * Transforms a flat Shift[] + optional EmployeeRecord[] into a PeopleProjection.
 *
 * Design:
 *  - Each known employee gets a row, even with zero shifts in the window.
 *    This lets PeopleModeGrid render empty rows for fully-available staff.
 *  - Shifts with no assigned_employee_id land in a single "Open Shifts" bucket
 *    (id = UNASSIGNED_BUCKET_ID) that always sorts last.
 *  - scheduledHours counts only non-cancelled shifts.
 *  - overHoursWarning is true when scheduledHours > contractedHours and
 *    contractedHours > 0.  contractedHours defaults to 0 when unknown
 *    (the hook layer can pass real contracted hours from a separate query).
 *  - Avatar URLs are generated via dicebearUrl() — consistent with GroupMode.
 */

import type { Shift } from '../../shift.entity';
import type { EmployeeRecord, PeopleProjection, ProjectedEmployee, ProjectedShift } from '../types';
import { computeBiddingUrgency, isOnBidding } from '../../bidding-urgency';
import { UNASSIGNED_BUCKET_ID, dicebearUrl } from '../constants';
import { netMinutesFromShift, minutesToHours } from '../utils/duration';
import { estimateCostFromShift } from '../utils/cost';
import { determineShiftState } from '../../shift-state.utils';
import { GROUP_COLORS, UNASSIGNED_COLORS } from '../constants';
import { ALL_GROUP_TYPES } from '../constants';
import { buildStats } from './shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toProjectedShift(shift: Shift): ProjectedShift {
  const netMinutes    = netMinutesFromShift(shift);
  const estimatedCost = estimateCostFromShift(shift, netMinutes);
  const detail        = estimateDetailedCostFromShift(shift, netMinutes);
  const groupType     = shift.group_type ?? null;
  const colors        = groupType
    ? (ALL_GROUP_TYPES.includes(groupType) ? GROUP_COLORS[groupType] : UNASSIGNED_COLORS)
    : UNASSIGNED_COLORS;

  const assignmentOutcome = (shift as any).assignment_outcome ??
    (shift.assigned_employee_id ? 'pending' : undefined);

  return {
    id:             shift.id,
    reactKey:       shift.id,
    date:           shift.shift_date,
    startTime:      shift.start_time,
    endTime:        shift.end_time,
    netMinutes,
    estimatedCost,
    costBreakdown: {
      base: detail.baseCost,
      penalty: detail.penaltyCost,
      overtime: detail.overtimeCost,
      allowance: detail.allowanceCost,
      leave: detail.leaveLoadingCost,
    },
    stateId:        determineShiftState(shift),
    roleName:       shift.roles?.name ?? 'Shift',
    roleId:         shift.role_id,
    levelName:      shift.remuneration_levels?.level_name ?? '',
    levelNumber:    shift.remuneration_levels?.level_number ?? 0,
    levelId:        shift.remuneration_level_id,
    groupType,
    subGroupName:   shift.sub_group_name ?? null,
    groupColors:    colors,
    employeeName:   resolveEmployeeName(shift),
    employeeId:     shift.assigned_employee_id,
    isLocked:       shift.is_locked,
    isUrgent:       isOnBidding(shift.bidding_status) && computeBiddingUrgency(shift.shift_date, shift.start_time) === 'urgent',
    isOnBidding:    isOnBidding(shift.bidding_status),
    isTrading:      !!shift.trade_requested_at,
    isCancelled:    shift.is_cancelled,
    isPublished:    shift.lifecycle_status === 'Published',
    isDraft:        shift.lifecycle_status === 'Draft',
    raw:            shift,
  };
}

function resolveEmployeeName(shift: Shift): string | null {
  const profile = (shift as any).assigned_profiles ?? (shift as any).profiles;
  if (profile?.first_name || profile?.last_name) {
    return `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null;
  }
  if (shift.assigned_employee_id) return 'Assigned';
  return null;
}

function makeEmployee(
  id: string,
  name: string,
  contractedHours: number,
  avatarUrl: string,
): ProjectedEmployee {
  return { id, name, avatarUrl, contractedHours, scheduledHours: 0, overHoursWarning: false, shiftsByDate: {} };
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface PeopleProjectorContext {
  employees?: EmployeeRecord[];
  /** If not provided, contractedHours defaults to 0 for all employees */
  contractedHoursMap?: Record<string, number>;
}

export function projectPeople(
  shifts:  Shift[],
  ctx:     PeopleProjectorContext = {},
): PeopleProjection {
  const { employees = [], contractedHoursMap = {} } = ctx;

  // ─── 1. Seed known employees ─────────────────────────────────────────────
  const empMap = new Map<string, ProjectedEmployee>();

  employees.forEach(emp => {
    const name = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || 'Unknown';
    empMap.set(emp.id, makeEmployee(
      emp.id,
      name,
      contractedHoursMap[emp.id] ?? 0,
      dicebearUrl(emp.first_name ?? emp.id),
    ));
  });

  // ─── 2. Walk shifts, bucket by employee ──────────────────────────────────
  shifts.forEach(shift => {
    const targetId = shift.assigned_employee_id ?? UNASSIGNED_BUCKET_ID;

    if (!empMap.has(targetId)) {
      if (targetId === UNASSIGNED_BUCKET_ID) {
        empMap.set(UNASSIGNED_BUCKET_ID, makeEmployee(
          UNASSIGNED_BUCKET_ID,
          'Open Shifts',
          0,
          dicebearUrl('unassigned', 'shapes'),
        ));
      } else {
        // Employee not in the known list (different org, historical shift, etc.)
        const profile = (shift as any).assigned_profiles ?? (shift as any).profiles;
        const firstName = profile?.first_name ?? 'Assigned';
        const lastName  = profile?.last_name  ?? '';
        empMap.set(targetId, makeEmployee(
          targetId,
          `${firstName} ${lastName}`.trim(),
          contractedHoursMap[targetId] ?? 0,
          dicebearUrl(targetId),
        ));
      }
    }

    const emp = empMap.get(targetId)!;
    const ps  = toProjectedShift(shift);

    if (!emp.shiftsByDate[shift.shift_date]) {
      emp.shiftsByDate[shift.shift_date] = [];
    }
    emp.shiftsByDate[shift.shift_date].push(ps);

    // Accumulate scheduled hours for non-cancelled assigned shifts
    if (!shift.is_cancelled && shift.assigned_employee_id) {
      emp.scheduledHours = Math.round(
        (emp.scheduledHours + minutesToHours(netMinutesFromShift(shift))) * 100,
      ) / 100;
    }
  });

  // ─── 3. Compute overHoursWarning + sort ──────────────────────────────────
  const empArray = [...empMap.values()];
  empArray.forEach(emp => {
    emp.overHoursWarning = emp.contractedHours > 0 && emp.scheduledHours > emp.contractedHours;
  });

  // Unassigned bucket always sorts last; the rest sort by name
  empArray.sort((a, b) => {
    if (a.id === UNASSIGNED_BUCKET_ID) return 1;
    if (b.id === UNASSIGNED_BUCKET_ID) return -1;
    return a.name.localeCompare(b.name);
  });

  return {
    employees: empArray,
    stats:     buildStats(shifts),
  };
}
