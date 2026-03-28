/**
 * Roles Mode Projector
 *
 * Transforms a flat Shift[] + optional RoleRecord[] / LevelRecord[] into a
 * RolesProjection structured as:
 *
 *   Level (e.g. "Level 3 – Technician")
 *     └─ Role (e.g. "Stage Hand")
 *          └─ shiftsByDate: { '2025-03-15': [ProjectedShift, …], … }
 *
 * Design:
 *  - Levels without any shifts are omitted (they clutter the view).
 *  - Roles without a remuneration_level_id appear in `unassignedRoles`.
 *  - Roles are seeded from RoleRecord[] first so even empty roles appear when
 *    the RoleRecord list is passed.  Ad-hoc role_id / role_name combos found
 *    only on shifts are appended.
 *  - Levels are sorted by level_number asc; roles within each level by name.
 *  - theatre accent = red (via GROUP_COLORS / UNASSIGNED_COLORS from constants).
 *  - levelColorClass() is the single authoritative colour mapper for level badges.
 */

import type { Shift } from '../../shift.entity';
import type {
  RoleRecord,
  LevelRecord,
  RolesProjection,
  ProjectedLevel,
  ProjectedRole,
  ProjectedShift,
} from '../types';
import { computeBiddingUrgency, isOnBidding } from '../../bidding-urgency';
import { GROUP_COLORS, UNASSIGNED_COLORS, ALL_GROUP_TYPES, levelColorClass } from '../constants';
import { netMinutesFromShift, minutesToHours } from '../utils/duration';
import { estimateCostFromShift } from '../utils/cost';
import { determineShiftState } from '../../shift-state.utils';
import { buildStats } from './shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toProjectedShift(shift: Shift): ProjectedShift {
  const netMinutes = netMinutesFromShift(shift);
  const estimatedCost = estimateCostFromShift(shift, netMinutes);
  const groupType = shift.group_type ?? null;
  const colors = groupType && ALL_GROUP_TYPES.includes(groupType)
    ? GROUP_COLORS[groupType]
    : UNASSIGNED_COLORS;

  return {
    id: shift.id,
    reactKey: shift.id,
    date: shift.shift_date,
    startTime: shift.start_time,
    endTime: shift.end_time,
    netMinutes,
    estimatedCost,
    stateId: determineShiftState(shift),
    roleName: shift.roles?.name ?? 'Shift',
    roleId: shift.role_id,
    levelName: shift.remuneration_levels?.level_name ?? '',
    levelNumber: shift.remuneration_levels?.level_number ?? 0,
    levelId: shift.remuneration_level_id,
    groupType,
    subGroupName: shift.sub_group_name ?? null,
    groupColors: colors,
    employeeName: resolveEmployeeName(shift),
    employeeId: shift.assigned_employee_id,
    isLocked: shift.is_locked,
    isUrgent: isOnBidding(shift.bidding_status) && computeBiddingUrgency(shift.shift_date, shift.start_time) === 'urgent',
    isOnBidding: isOnBidding(shift.bidding_status),
    isTrading: !!shift.trade_requested_at,
    isCancelled: shift.is_cancelled,
    isPublished: shift.lifecycle_status === 'Published',
    isDraft: shift.lifecycle_status === 'Draft',
    raw: shift,
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

// Immutable role accumulator — mutated only during projection build
type RoleAccum = {
  id: string;
  name: string;
  code: string;
  /** roleId → date → ProjectedShift[] */
  shiftsByDate: Map<string, ProjectedShift[]>;
};

function emptyRoleAccum(id: string, name: string, code: string): RoleAccum {
  return { id, name, code, shiftsByDate: new Map() };
}

function finaliseRole(r: RoleAccum): ProjectedRole {
  const shiftsByDate: Record<string, ProjectedShift[]> = {};
  let totalMins = 0;
  let totalCost = 0;

  r.shiftsByDate.forEach((dayShifts, date) => {
    shiftsByDate[date] = dayShifts;
    dayShifts.forEach(s => {
      totalMins += s.netMinutes;
      totalCost += s.estimatedCost;
    });
  });

  return {
    id: r.id,
    name: r.name,
    code: r.code,
    shiftsByDate,
    totalHours: minutesToHours(totalMins),
    totalCost: Math.round(totalCost * 100) / 100,
  };
}

function addShiftToRole(accum: RoleAccum, shift: Shift, ps: ProjectedShift): void {
  const date = shift.shift_date;
  if (!accum.shiftsByDate.has(date)) accum.shiftsByDate.set(date, []);
  accum.shiftsByDate.get(date)!.push(ps);
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface RolesProjectorContext {
  roles?: RoleRecord[];
  levels?: LevelRecord[];
}

export function projectRoles(
  shifts: Shift[],
  ctx: RolesProjectorContext = {},
): RolesProjection {
  const { roles = [], levels = [] } = ctx;

  // ─── 1. Build lookup maps from context ────────────────────────────────────
  // levelId → LevelRecord
  const levelById = new Map<string, LevelRecord>(levels.map(l => [l.id, l]));
  // roleId  → RoleRecord
  const roleById = new Map<string, RoleRecord>(roles.map(r => [r.id, r]));

  // ─── 2. Accumulators ──────────────────────────────────────────────────────
  //  levelId → roleId → RoleAccum
  const levelRoleMap = new Map<string, Map<string, RoleAccum>>();
  //  roleId → RoleAccum  (no level)
  const unassignedRoleMap = new Map<string, RoleAccum>();

  // Seed known roles into their respective level buckets
  roles.forEach(role => {
    const roleAccum = emptyRoleAccum(role.id, role.name, role.code ?? '');
    if (role.remuneration_level_id) {
      const lid = role.remuneration_level_id;
      if (!levelRoleMap.has(lid)) levelRoleMap.set(lid, new Map());
      levelRoleMap.get(lid)!.set(role.id, roleAccum);
    } else {
      unassignedRoleMap.set(role.id, roleAccum);
    }
  });

  // ─── 3. Route each shift ─────────────────────────────────────────────────
  shifts.forEach(shift => {
    const ps = toProjectedShift(shift);
    const roleId = shift.role_id ?? 'unknown';
    const roleName = shift.roles?.name ?? 'Unnamed Role';
    // Use the shift's own level first; fall back to the role definition's level
    const levelId = shift.remuneration_level_id
      ?? roleById.get(roleId)?.remuneration_level_id
      ?? null;

    if (levelId) {
      if (!levelRoleMap.has(levelId)) levelRoleMap.set(levelId, new Map());
      const roleMap = levelRoleMap.get(levelId)!;
      if (!roleMap.has(roleId)) {
        const knownRole = roleById.get(roleId);
        roleMap.set(
          roleId,
          emptyRoleAccum(roleId, knownRole?.name ?? roleName, knownRole?.code ?? ''),
        );
      }
      addShiftToRole(roleMap.get(roleId)!, shift, ps);
    } else {
      if (!unassignedRoleMap.has(roleId)) {
        const knownRole = roleById.get(roleId);
        unassignedRoleMap.set(
          roleId,
          emptyRoleAccum(roleId, knownRole?.name ?? roleName, knownRole?.code ?? ''),
        );
      }
      addShiftToRole(unassignedRoleMap.get(roleId)!, shift, ps);
    }
  });

  // ─── 4. Build ProjectedLevel[] ────────────────────────────────────────────
  //  Collect all levelIds seen (from context + from shifts)
  const allLevelIds = new Set<string>([
    ...levels.map(l => l.id),
    ...levelRoleMap.keys(),
  ]);

  const projectedLevels: ProjectedLevel[] = [];

  allLevelIds.forEach(levelId => {
    const roleMap = levelRoleMap.get(levelId);
    if (!roleMap || roleMap.size === 0) return; // skip levels with no roles
    // Skip levels where no role has actual shifts (seeded-but-empty roles don't count)
    const hasAnyShifts = [...roleMap.values()].some(r => r.shiftsByDate.size > 0);
    if (!hasAnyShifts) return;

    const levelMeta = levelById.get(levelId);
    const levelNumber = levelMeta?.level_number ?? 0;

    // Include all seeded roles for this level, regardless of having shifts
    const projectedRoles: ProjectedRole[] = [...roleMap.values()]
      .map(finaliseRole)
      .sort((a, b) => a.name.localeCompare(b.name));

    // Allow levels to render even if they only contain empty roles
    // if (projectedRoles.length === 0) return;

    const totalHours = projectedRoles.reduce((acc, r) => acc + r.totalHours, 0);
    const totalCost = projectedRoles.reduce((acc, r) => acc + r.totalCost, 0);

    projectedLevels.push({
      id: levelId,
      name: levelMeta?.level_name ?? `Level ${levelNumber}`,
      levelNumber,
      colorClass: levelColorClass(levelNumber),
      roles: projectedRoles,
      totalHours: Math.round(totalHours * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
    });
  });

  // Sort levels by level_number asc
  projectedLevels.sort((a, b) => a.levelNumber - b.levelNumber);

  const unassignedRoles: ProjectedRole[] = [...unassignedRoleMap.values()]
    .map(finaliseRole)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    levels: projectedLevels,
    unassignedRoles,
    stats: buildStats(shifts),
  };
}
