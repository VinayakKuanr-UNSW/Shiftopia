/**
 * Events Mode Projector
 *
 * Transforms a flat Shift[] + optional EventRecord[] into an EventsProjection.
 *
 * Design:
 *  - A shift may appear in multiple events (shift.event_ids: string[]).
 *    Each event gets its own fully-resolved shifts list.  This mirrors how
 *    EventsModeView renders: shifts repeated per event card, not de-duped.
 *  - Shifts with no event_ids (or empty array) land in a synthetic
 *    "No Event" bucket (eventId = '__no_event__').
 *  - Events from EventRecord[] are included even when they have zero shifts
 *    so the UI can render an empty event card with a "no shifts" state.
 *  - Events are sorted by eventDate asc, then by eventName.  The no-event
 *    bucket always sorts last.
 *  - Coverage is computed per-event (assigned / total shifts in that event).
 */

import type { Shift } from '../../shift.entity';
import type {
  EventRecord,
  EventsProjection,
  ProjectedEvent,
  ProjectedShift,
} from '../types';
import { GROUP_COLORS, UNASSIGNED_COLORS, ALL_GROUP_TYPES } from '../constants';
import { netMinutesFromShift, minutesToHours } from '../utils/duration';
import { estimateCostFromShift } from '../utils/cost';
import { coverageHealth } from '../utils/coverage';
import { determineShiftState } from '../../shift-state.utils';
import { buildStats } from './shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

const NO_EVENT_ID   = '__no_event__';
const NO_EVENT_NAME = 'No Event';

function toProjectedShift(shift: Shift): ProjectedShift {
  const netMinutes    = netMinutesFromShift(shift);
  const estimatedCost = estimateCostFromShift(shift, netMinutes);
  const groupType     = shift.group_type ?? null;
  const colors        = groupType && ALL_GROUP_TYPES.includes(groupType)
    ? GROUP_COLORS[groupType]
    : UNASSIGNED_COLORS;

  return {
    id:             shift.id,
    reactKey:       shift.id,
    date:           shift.shift_date,
    startTime:      shift.start_time,
    endTime:        shift.end_time,
    netMinutes,
    estimatedCost,
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
    isUrgent:       shift.bidding_status === 'on_bidding_urgent',
    isOnBidding:    shift.bidding_status !== 'not_on_bidding',
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

function buildProjectedEvent(
  eventId:   string,
  eventName: string,
  eventDate: string | null,
  startTime: string,
  endTime:   string,
  location:  string,
  shifts:    ProjectedShift[],
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
    shifts,
    totalHours:    minutesToHours(totalMins),
    assignedCount: assigned,
    totalCount:    shifts.length,
    coverage:      coverageHealth(assigned, shifts.length),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface EventsProjectorContext {
  events?: EventRecord[];
}

export function projectEvents(
  shifts:  Shift[],
  ctx:     EventsProjectorContext = {},
): EventsProjection {
  const { events = [] } = ctx;

  // ─── 1. Seed event map from EventRecord[] ─────────────────────────────────
  // eventId → accumulated ProjectedShift[]
  const eventShiftsMap = new Map<string, ProjectedShift[]>();
  const eventMeta      = new Map<string, EventRecord>();

  events.forEach(ev => {
    eventShiftsMap.set(ev.id, []);
    eventMeta.set(ev.id, ev);
  });

  // ─── 2. Route each shift to its events ───────────────────────────────────
  shifts.forEach(shift => {
    const ps       = toProjectedShift(shift);
    const eventIds = shift.event_ids ?? [];

    if (eventIds.length === 0) {
      // No event → no-event bucket
      if (!eventShiftsMap.has(NO_EVENT_ID)) {
        eventShiftsMap.set(NO_EVENT_ID, []);
      }
      eventShiftsMap.get(NO_EVENT_ID)!.push(ps);
      return;
    }

    eventIds.forEach(eid => {
      if (!eventShiftsMap.has(eid)) {
        // Ad-hoc event referenced by a shift but absent from EventRecord[]
        eventShiftsMap.set(eid, []);
      }
      eventShiftsMap.get(eid)!.push(ps);
    });
  });

  // ─── 3. Build ProjectedEvent[] ────────────────────────────────────────────
  const projectedEvents: ProjectedEvent[] = [];

  eventShiftsMap.forEach((pShifts, eid) => {
    if (eid === NO_EVENT_ID) return; // handled separately below

    const meta  = eventMeta.get(eid);
    const event = buildProjectedEvent(
      eid,
      meta?.name       ?? 'Unknown Event',
      meta?.event_date ?? null,
      meta?.start_time ?? '',
      meta?.end_time   ?? '',
      meta?.location   ?? '',
      pShifts,
    );
    projectedEvents.push(event);
  });

  // Sort by eventDate asc, then by name
  projectedEvents.sort((a, b) => {
    if (a.eventDate && b.eventDate) {
      const dateCmp = a.eventDate.localeCompare(b.eventDate);
      if (dateCmp !== 0) return dateCmp;
    }
    if (a.eventDate && !b.eventDate) return -1;
    if (!a.eventDate && b.eventDate)  return 1;
    return a.eventName.localeCompare(b.eventName);
  });

  // Append no-event bucket last
  const noEventShifts = eventShiftsMap.get(NO_EVENT_ID);
  if (noEventShifts && noEventShifts.length > 0) {
    projectedEvents.push(
      buildProjectedEvent(NO_EVENT_ID, NO_EVENT_NAME, null, '', '', '', noEventShifts),
    );
  }

  return {
    events: projectedEvents,
    stats:  buildStats(shifts),
  };
}
