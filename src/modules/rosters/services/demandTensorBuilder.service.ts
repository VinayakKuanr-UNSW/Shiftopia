/**
 * demandTensorBuilder — turn a (date, scope) + existing shift list into the
 * DemandTensor[] the shift synthesizer consumes.
 *
 * Pipeline:
 *   1. Fetch venueops_events overlapping the date.
 *   2. For each (event × role) call mlClient.buildDemandAnalysis → raw tensor.
 *   3. Merge raw tensors with the same roleId + subDepartmentId by summing per slot.
 *   4. Subtract existing-shift coverage per slot → residualHeadcount.
 */

import { supabase } from '@/platform/realtime/client';
import { fromZonedTime } from 'date-fns-tz';
import type { Shift } from '../domain/shift.entity';

const ICC_TIMEZONE = 'Australia/Sydney';
import {
  DemandSlot,
  DemandTensor,
  SLOT_DURATION_MINUTES,
  SLOT_MINUTES,
  timeToMinutes,
} from '../domain/shiftSynthesizer.policy';
import type { TemplateGroupType } from '../domain/shift.entity';
import {
  buildDemandAnalysis,
  resolveMLRoleById,
  resolveMLRoleByNameFallback,
  ML_KNOWN_ROLES,
  type EventInput,
  type MLKnownRole,
} from './mlClient.service';
import { fetchRoleMLClassMap } from '../api/roleMlClass.queries';
import { createModuleLogger } from '@/modules/core/lib/logger';

const log = createModuleLogger('demandTensorBuilder');

export interface BuildScopeDemandParams {
  organizationId: string;
  date: string; // YYYY-MM-DD
  departmentId?: string;
  subDepartmentId?: string | null;
  /** Roles to generate tensors for (ML service returns per-role values keyed by name). */
  roles: Array<{ id: string; name: string; subDepartmentId: string | null }>;
  /** Existing shifts for the scope/date, used to compute residuals. */
  existingShifts: Shift[];
  /** 'convention_centre' | 'exhibition_centre' | 'theatre' — feeds buildingType. */
  buildingType: TemplateGroupType;
}

export interface ScopeDemandResult {
  tensors: DemandTensor[];
  eventCount: number;
  /** Diagnostic: true if any ML call failed. Caller can show a warning. */
  hasMlError: boolean;
}

interface VenueopsEventRow {
  event_id: string;
  name: string;
  start_date_time: string;
  end_date_time: string;
  estimated_total_attendance: number;
  event_type_name: string | null;
  venue_names: string | null;
}

async function fetchEventsForDate(date: string): Promise<VenueopsEventRow[]> {
  const dayStart = fromZonedTime(`${date}T00:00:00`, ICC_TIMEZONE).toISOString();
  const dayEnd   = fromZonedTime(`${date}T23:59:59.999`, ICC_TIMEZONE).toISOString();
  const { data, error } = await supabase
    .from('venueops_events')
    .select(
      'event_id, name, start_date_time, end_date_time, estimated_total_attendance, event_type_name, venue_names',
    )
    .lte('start_date_time', dayEnd)
    .gte('end_date_time', dayStart)
    .eq('is_canceled', false);
  if (error) {
    log.error(
      'fetchEventsForDate failed',
      { operation: 'fetchEventsForDate', date },
      error as Error,
    );
    return [];
  }
  return (data ?? []) as VenueopsEventRow[];
}

/**
 * Build an EventInput suitable for the ML service from a VenueOps row.
 * Conservative defaults are used when fields are missing.
 */
function toEventInput(
  row: VenueopsEventRow,
  buildingType: TemplateGroupType,
): EventInput {
  const start = new Date(row.start_date_time);
  return {
    eventType: (row.event_type_name as EventInput['eventType']) ?? 'Conference',
    expectedAttendance: row.estimated_total_attendance ?? 0,
    dayOfWeek: start.getUTCDay(),
    month: start.getUTCMonth() + 1,
    functionType: 'Reception',
    roomCount: 1,
    totalSqm: 0,
    roomCapacity: row.estimated_total_attendance ?? 0,
    simultaneousEventCount: 1,
    totalVenueAttendanceSameTime: row.estimated_total_attendance ?? 0,
    entryPeakFlag: false,
    exitPeakFlag: false,
    mealWindowFlag: false,
    timeSliceIndex: 0,
    timeSliceCount: SLOT_MINUTES.length,
    buildingType,
    eventId: row.event_id,
  };
}

/** Initialise a zero-headcount slot array aligned with SLOT_MINUTES. */
function emptySlots(): DemandSlot[] {
  return SLOT_MINUTES.map((start) => ({
    slotStart: start,
    slotEnd: start + SLOT_DURATION_MINUTES,
    requiredHeadcount: 0,
    residualHeadcount: 0,
    residualHeadcountInt: 0,
  }));
}

/**
 * Sum one tensor's slots into an accumulator, optionally dividing the headcount
 * by a peer count. The raw tensor indexes slots 0..timeSliceCount-1 — we remap
 * to SLOT_MINUTES (07:00 onwards).
 *
 * Divisor use-case: when N DB roles share the same ML class (e.g. 5 chef titles
 * → Food Staff), the ML's prediction is the TOTAL for that class. We split it
 * evenly across the N peer roles so total generated shifts ≈ original prediction.
 */
function mergeTensorInto(
  accumulator: DemandSlot[],
  raw: DemandTensor,
  divisor = 1,
): void {
  raw.slots.forEach((rawSlot, i) => {
    if (i >= accumulator.length) return;
    accumulator[i].requiredHeadcount += Math.round(
      rawSlot.requiredHeadcount / divisor,
    );
  });
}

/** Count existing shifts (non-cancelled) covering each 30-min slot for a role. */
export function computeExistingCoverage(
  slots: DemandSlot[],
  shifts: Shift[],
  roleId: string,
  subDepartmentId: string | null,
  buildingType: string,
): number[] {
  return slots.map((slot) => {
    let totalSlotCoverage = 0;
    for (const shift of shifts) {
      if (shift.lifecycle_status === 'Cancelled') continue;
      if (shift.role_id !== roleId) continue;
      // Exact match for sub_department_id. Treat undefined/empty as null for comparison
      const shiftSubDept = shift.sub_department_id || null;
      const targetSubDept = subDepartmentId || null;
      if (shiftSubDept !== targetSubDept) continue;

      const shiftGroup = shift.group_type || 'convention_centre';
      if (shiftGroup !== buildingType) continue;

      const shiftStart = timeToMinutes(shift.start_time);
      const shiftEnd = timeToMinutes(shift.end_time);

      // Calculate overlap between shift [shiftStart, shiftEnd] and slot [slotStart, slotEnd]
      const overlapStart = Math.max(shiftStart, slot.slotStart);
      const overlapEnd = Math.min(shiftEnd, slot.slotEnd);
      const overlapMinutes = Math.max(0, overlapEnd - overlapStart);

      if (overlapMinutes > 0) {
        // Contribution is the fraction of the slot covered by this shift
        totalSlotCoverage += overlapMinutes / (slot.slotEnd - slot.slotStart);
      }
    }
    return totalSlotCoverage;
  });
}

export async function buildScopeDemand(
  params: BuildScopeDemandParams,
): Promise<ScopeDemandResult> {
  // Map each scope role to one of the 4 ML classes via the DB-backed
  // role_ml_class_map table. Falls back to the name-based regex for roles
  // missing from the table (e.g. roles created since last regen).
  // Roles with no match are skipped with a warn — no predictions available.
  const roleMlMap = await fetchRoleMLClassMap();
  const mappedRoles = params.roles.map((r) => ({
    ...r,
    mlRole: resolveMLRoleById(r.id, roleMlMap) ?? resolveMLRoleByNameFallback(r.name),
  }));
  const knownRoles = mappedRoles.filter(
    (r): r is typeof r & { mlRole: MLKnownRole } => r.mlRole !== null,
  );
  const skippedRoles = mappedRoles
    .filter((r) => r.mlRole === null)
    .map((r) => r.name);
  const roleMapping = knownRoles.map((r) => ({
    dbName: r.name,
    mlClass: r.mlRole,
  }));

  // Count how many peer DB roles share each ML class.
  const peerCountByClass = new Map<MLKnownRole, number>();
  for (const r of knownRoles) {
    peerCountByClass.set(r.mlRole, (peerCountByClass.get(r.mlRole) ?? 0) + 1);
  }

  log.info('building scope demand', {
    operation: 'buildScopeDemand',
    date: params.date,
    organizationId: params.organizationId,
    departmentId: params.departmentId,
    subDepartmentId: params.subDepartmentId,
    roleCount: params.roles.length,
    mlMappedRoleCount: knownRoles.length,
    roleMapping,
    peerCountByClass: Object.fromEntries(peerCountByClass),
    existingShiftCount: params.existingShifts.length,
  });

  if (skippedRoles.length > 0) {
    log.warn('skipping roles without ML mapping', {
      operation: 'buildScopeDemand',
      skippedRoles,
      mlKnownRoles: [...ML_KNOWN_ROLES],
    });
  }

  const events = await fetchEventsForDate(params.date);
  log.info('events fetched', {
    operation: 'buildScopeDemand',
    date: params.date,
    eventCount: events.length,
  });

  if (events.length === 0 || knownRoles.length === 0) {
    log.warn('no events or ML-mapped roles for scope', {
      operation: 'buildScopeDemand',
      eventCount: events.length,
      roleCount: params.roles.length,
      mlMappedRoleCount: knownRoles.length,
    });
    return { tensors: [], eventCount: events.length, hasMlError: false };
  }

  let hasMlError = false;
  let mlCallCount = 0;
  // One accumulator per role — slots aligned to SLOT_MINUTES.
  const accumulators = new Map<
    string,
    { roleName: string; subDepartmentId: string; slots: DemandSlot[] }
  >();
  for (const role of knownRoles) {
    accumulators.set(role.id, {
      roleName: role.name,
      subDepartmentId: role.subDepartmentId ?? params.subDepartmentId ?? '',
      slots: emptySlots(),
    });
  }

  // Call ML once per unique (event × mlRole) and share the result across all DB
  // roles that map to the same ML class.
  for (const event of events) {
    const eventInput = toEventInput(event, params.buildingType);
    const mlCache = new Map<string, DemandTensor>();

    for (const role of knownRoles) {
      try {
        let raw = mlCache.get(role.mlRole);
        if (!raw) {
          raw = await buildDemandAnalysis(eventInput, role.mlRole);
          mlCache.set(role.mlRole, raw);
          mlCallCount++;
        }
        const acc = accumulators.get(role.id);
        const divisor = peerCountByClass.get(role.mlRole) ?? 1;
        if (acc) mergeTensorInto(acc.slots, raw, divisor);
        log.debug('ML predict ok', {
          operation: 'buildDemandAnalysis',
          eventId: event.event_id,
          dbRole: role.name,
          mlClass: role.mlRole,
          peerDivisor: divisor,
          cached: mlCache.has(role.mlRole),
        });
      } catch (err) {
        log.warn(
          'ML call failed',
          {
            operation: 'buildDemandAnalysis',
            eventId: event.event_id,
            dbRole: role.name,
            mlClass: role.mlRole,
          },
          err as Error,
        );
        hasMlError = true;
      }
    }
  }

  // Subtract existing coverage → residualHeadcount.
  const tensors: DemandTensor[] = [];
  for (const [roleId, acc] of accumulators) {
    const existing = computeExistingCoverage(
      acc.slots,
      params.existingShifts,
      roleId,
      acc.subDepartmentId,
      params.buildingType,
    );
    const slots = acc.slots.map((s, i) => {
      const residual = s.requiredHeadcount - existing[i];
      return {
        ...s,
        residualHeadcount: residual,
        residualHeadcountInt: Math.round(Math.max(0, residual)),
      };
    });
    if (
      slots.every((s) => s.requiredHeadcount === 0 && s.residualHeadcount === 0)
    )
      continue;
    tensors.push({
      roleId,
      subDepartmentId: acc.subDepartmentId,
      buildingType: params.buildingType,
      slots,
    });
  }

  const totalRequired = tensors.reduce(
    (s, t) => s + t.slots.reduce((a, b) => a + b.requiredHeadcount, 0),
    0,
  );
  const totalResidual = tensors.reduce(
    (s, t) => s + t.slots.reduce((a, b) => a + b.residualHeadcount, 0),
    0,
  );
  log.info('demand built', {
    operation: 'buildScopeDemand',
    tensorCount: tensors.length,
    totalRequired,
    totalResidual,
    mlCallCount,
    hasMlError,
  });

  return { tensors, eventCount: events.length, hasMlError };
}
