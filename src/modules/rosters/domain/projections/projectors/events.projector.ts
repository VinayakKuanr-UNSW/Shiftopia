/**
 * Events Mode Projector (Worker-Safe)
 *
 * Transforms a flat WorkerShiftDTO[] + optional WorkerEventDTO[] into an EventsProjection.
 * NO React, NO DOM, NO raw Shift entities. Runs natively inside Web Worker.
 */

import type { EventsProjection, ProjectedEvent } from '../types';
import type { WorkerShiftDTO, WorkerEventDTO, ProjectedShiftResult } from '../worker/protocol';
import { computeBiddingUrgency, isOnBidding } from '../../bidding-urgency';
import { GROUP_COLORS, UNASSIGNED_COLORS, ALL_GROUP_TYPES } from '../constants';
import { minutesToHours } from '../utils/duration';
import { getCachedCost, makeCacheKey } from '../cache/projection.cache';
import { ZERO_COST_BREAKDOWN } from '../utils/cost/constants';
import { coverageHealth } from '../utils/coverage';
import { determineShiftState } from '../../shift-state.utils';

// ── Helpers ───────────────────────────────────────────────────────────────────

const NO_EVENT_ID   = '__no_event__';
const NO_EVENT_NAME = 'No Event';

function resolveEmployeeName(shift: WorkerShiftDTO): string | null {
  if (shift.employeeFirstName || shift.employeeLastName) {
    return `${shift.employeeFirstName ?? ''} ${shift.employeeLastName ?? ''}`.trim() || null;
  }
  if (shift.assignedEmployeeId) return 'Assigned';
  return null;
}

function toProjectedShift(shift: WorkerShiftDTO): ProjectedShiftResult {
  const isAssigned = !!shift.assignedEmployeeId;
  const netMinutes = shift.netLengthMinutes ?? shift.scheduledLengthMinutes;
  
  const key = makeCacheKey(shift.id, shift.updatedAtMs);
  const detail = isAssigned ? (getCachedCost(key) ?? ZERO_COST_BREAKDOWN) : ZERO_COST_BREAKDOWN;
  const estimatedCost = detail.totalCost;

  const groupType = shift.groupType ?? null;
  const colors = groupType && ALL_GROUP_TYPES.includes(groupType)
    ? GROUP_COLORS[groupType]
    : UNASSIGNED_COLORS;

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
    estimatedCost,
    costBreakdown: {
      base: detail.ordinaryCost,
      penalty: detail.penaltyCost,
      overtime: detail.overtimeCost,
      allowance: detail.allowanceCost ?? 0,
      leave: 0,
    },
    detailedCost: detail,
    stateId,
    roleName: shift.roleName ?? 'Shift',
    roleId: shift.roleId,
    levelName: shift.levelName ?? '',
    levelNumber: shift.levelNumber ?? 0,
    levelId: shift.remunerationLevelId,
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
    pay: estimatedCost,
    status: shift.isCancelled ? 'Draft' : (shift.assignedEmployeeId ? (shift.isDraft ? 'Draft' : 'Assigned') : 'Open'),
    lifecycleStatus: shift.isPublished ? 'published' : 'draft',
    assignmentStatus: shift.assignedEmployeeId ? 'assigned' : 'unassigned',
    fulfillmentStatus: shift.fulfillmentStatus,
  };
}

function buildProjectedEvent(
  eventId:   string,
  eventName: string,
  eventDate: string | null,
  startTime: string,
  endTime:   string,
  location:  string,
  shifts:    ProjectedShiftResult[],
): ProjectedEvent {
  const assigned = shifts.filter(s => !!s.employeeId).length;
  const totalMins = shifts.reduce((acc, s) => acc + s.netMinutes, 0);
  return {
    eventId,
    eventName,
    eventDate,
    startTime,
    endTime,
    location,
    // Cast to any for internal projection pipeline, useRosterProjections maps the raw property back
    shifts: shifts as any,
    totalHours:    minutesToHours(totalMins),
    assignedCount: assigned,
    totalCount:    shifts.length,
    coverage:      coverageHealth(assigned, shifts.length),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface EventsProjectorContext {
  events?: WorkerEventDTO[];
}

export function projectEvents(
  shifts:  WorkerShiftDTO[],
  ctx:     EventsProjectorContext = {},
): EventsProjection {
  const { events = [] } = ctx;

  const eventShiftsMap = new Map<string, ProjectedShiftResult[]>();
  const eventMeta      = new Map<string, WorkerEventDTO>();

  events.forEach(ev => {
    eventShiftsMap.set(ev.id, []);
    eventMeta.set(ev.id, ev);
  });

  shifts.forEach(shift => {
    const ps       = toProjectedShift(shift);
    const eventIds = shift.eventIds ?? [];

    if (eventIds.length === 0) {
      if (!eventShiftsMap.has(NO_EVENT_ID)) {
        eventShiftsMap.set(NO_EVENT_ID, []);
      }
      eventShiftsMap.get(NO_EVENT_ID)!.push(ps);
      return;
    }

    eventIds.forEach(eid => {
      if (!eventShiftsMap.has(eid)) {
        eventShiftsMap.set(eid, []);
      }
      eventShiftsMap.get(eid)!.push(ps);
    });
  });

  const projectedEvents: ProjectedEvent[] = [];

  eventShiftsMap.forEach((pShifts, eid) => {
    if (eid === NO_EVENT_ID) return;

    const meta  = eventMeta.get(eid);
    const event = buildProjectedEvent(
      eid,
      meta?.name       ?? 'Unknown Event',
      meta?.eventDate  ?? null,
      meta?.startTime  ?? '',
      meta?.endTime    ?? '',
      meta?.location   ?? '',
      pShifts,
    );
    projectedEvents.push(event);
  });

  projectedEvents.sort((a, b) => {
    if (a.eventDate && b.eventDate) {
      const dateCmp = a.eventDate.localeCompare(b.eventDate);
      if (dateCmp !== 0) return dateCmp;
    }
    if (a.eventDate && !b.eventDate) return -1;
    if (!a.eventDate && b.eventDate)  return 1;
    return a.eventName.localeCompare(b.eventName);
  });

  const noEventShifts = eventShiftsMap.get(NO_EVENT_ID);
  if (noEventShifts && noEventShifts.length > 0) {
    projectedEvents.push(
      buildProjectedEvent(NO_EVENT_ID, NO_EVENT_NAME, null, '', '', '', noEventShifts),
    );
  }

  return {
    events: projectedEvents,
    stats: {
      totalShifts: 0,
      assignedShifts: 0,
      openShifts: 0,
      publishedShifts: 0,
      totalNetMinutes: 0,
      estimatedCost: 0,
      costBreakdown: { base: 0, penalty: 0, overtime: 0, allowance: 0, leave: 0 },
    },
  };
}
