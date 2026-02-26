/**
 * Group Mode Projector
 *
 * Transforms a flat Shift[] + optional RosterStructure[] into a GroupProjection.
 *
 * Design:
 *  - Always emits the canonical 3 groups (convention_centre, exhibition_centre,
 *    theatre) even when they have zero shifts — GroupModeView relies on a
 *    stable structure to render empty cells.
 *  - Sub-groups are seeded from rosterStructures (the API-backed skeleton)
 *    first, then ad-hoc sub-groups from shifts are appended.
 *  - Shifts with no group_type go into the virtual "unassigned" group.
 *  - isLocked is read from shift.is_locked (already set by the API layer).
 *    The roster_management rule (locked once shift has started) is encoded
 *    server-side; the projector does not duplicate that logic.
 */

import type { Shift, TemplateGroupType } from '../../shift.entity';
import type { RosterStructure }          from '../../../model/roster.types';
import type {
  ProjectedShift,
  ProjectedSubGroup,
  ProjectedGroup,
  GroupProjection,
  GroupStats,
  SubGroupStats,
} from '../types';
import { GROUP_COLORS, UNASSIGNED_COLORS, GROUP_DISPLAY_NAMES, ALL_GROUP_TYPES } from '../constants';
import { netMinutesFromShift, minutesToHours }   from '../utils/duration';
import { estimateCostFromShift }                 from '../utils/cost';
import { coverageHealth }                        from '../utils/coverage';
import { determineShiftState }                   from '../../shift-state.utils';
import { buildStats }                            from './shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveEmployeeName(shift: Shift): string | null {
  const profile = (shift as any).assigned_profiles ?? (shift as any).profiles;
  if (profile?.first_name || profile?.last_name) {
    return `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null;
  }
  if (shift.assigned_employee_id) return 'Assigned';
  return null;
}

function toProjectedShift(shift: Shift): ProjectedShift {
  const netMinutes     = netMinutesFromShift(shift);
  const estimatedCost  = estimateCostFromShift(shift, netMinutes);
  const groupType      = shift.group_type ?? null;
  const colors         = groupType ? (GROUP_COLORS[groupType] ?? UNASSIGNED_COLORS) : UNASSIGNED_COLORS;
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

function subGroupStats(shifts: ProjectedShift[]): SubGroupStats {
  const assigned  = shifts.filter(s => !!s.employeeId).length;
  const netMins   = shifts.reduce((acc, s) => acc + s.netMinutes, 0);
  const cost      = shifts.reduce((acc, s) => acc + s.estimatedCost, 0);
  return {
    totalShifts:    shifts.length,
    assignedShifts: assigned,
    totalHours:     minutesToHours(netMins),
    estimatedCost:  Math.round(cost * 100) / 100,
  };
}

function groupStatsFrom(subGroups: ProjectedSubGroup[]): GroupStats {
  const allShifts = subGroups.flatMap(sg =>
    Object.values(sg.shiftsByDate).flat()
  );
  const assigned  = allShifts.filter(s => !!s.employeeId).length;
  const netMins   = allShifts.reduce((acc, s) => acc + s.netMinutes, 0);
  const cost      = allShifts.reduce((acc, s) => acc + s.estimatedCost, 0);
  return {
    totalShifts:    allShifts.length,
    assignedShifts: assigned,
    subGroupCount:  subGroups.length,
    totalHours:     minutesToHours(netMins),
    estimatedCost:  Math.round(cost * 100) / 100,
  };
}

// ── Canonical group key from TemplateGroupType ────────────────────────────────

function toGroupKey(externalId: string | null, name: string): TemplateGroupType | null {
  if (externalId && ALL_GROUP_TYPES.includes(externalId as TemplateGroupType)) {
    return externalId as TemplateGroupType;
  }
  const normalised = name.trim().toLowerCase().replace(/\s+/g, '_');
  if (ALL_GROUP_TYPES.includes(normalised as TemplateGroupType)) {
    return normalised as TemplateGroupType;
  }
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface GroupProjectorContext {
  rosterStructures?: RosterStructure[];
}

export function projectGroup(
  shifts:  Shift[],
  ctx:     GroupProjectorContext = {},
): GroupProjection {

  // ─── 1. Build subgroup skeleton from rosterStructures ───────────────────
  //   key:  group canonical type → subgroup name → subgroup id
  type SubGroupEntry = { id: string; name: string; sortOrder: number };
  const skeleton = new Map<TemplateGroupType | 'unassigned', Map<string, SubGroupEntry>>();

  // Always seed the 3 canonical groups
  ALL_GROUP_TYPES.forEach(type => skeleton.set(type, new Map()));
  skeleton.set('unassigned', new Map());

  (ctx.rosterStructures ?? []).forEach(roster => {
    roster.groups.forEach(group => {
      const type = toGroupKey(group.externalId, group.name);
      const key  = type ?? 'unassigned';
      if (!skeleton.has(key)) skeleton.set(key, new Map());
      const subMap = skeleton.get(key)!;
      group.subGroups.forEach(sg => {
        if (!subMap.has(sg.name)) {
          subMap.set(sg.name, { id: sg.id, name: sg.name, sortOrder: sg.sortOrder });
        }
      });
    });
  });

  // ─── 2. Project each shift ───────────────────────────────────────────────
  const projectedByGroupAndSubGroup = new Map<
    TemplateGroupType | 'unassigned',
    Map<string, Map<string, ProjectedShift[]>>  // subGroupName → date → shifts
  >();

  skeleton.forEach((_, gk) => projectedByGroupAndSubGroup.set(gk, new Map()));

  shifts.forEach(shift => {
    const groupKey: TemplateGroupType | 'unassigned' =
      (shift.group_type && ALL_GROUP_TYPES.includes(shift.group_type))
        ? shift.group_type
        : 'unassigned';

    const subGroupName = shift.sub_group_name?.trim() || 'General';
    const date         = shift.shift_date;

    const groupMap     = projectedByGroupAndSubGroup.get(groupKey)!;
    if (!groupMap.has(subGroupName)) groupMap.set(subGroupName, new Map());
    const dateMap      = groupMap.get(subGroupName)!;
    if (!dateMap.has(date)) dateMap.set(date, []);
    dateMap.get(date)!.push(toProjectedShift(shift));
  });

  // ─── 3. Assemble ProjectedGroups (canonical order) ──────────────────────
  const groupOrder: (TemplateGroupType | 'unassigned')[] = [
    ...ALL_GROUP_TYPES,
    'unassigned',
  ];

  const groups: ProjectedGroup[] = groupOrder.map(groupKey => {
    const colors  = groupKey === 'unassigned'
      ? UNASSIGNED_COLORS
      : GROUP_COLORS[groupKey as TemplateGroupType];
    const name    = GROUP_DISPLAY_NAMES[groupKey as keyof typeof GROUP_DISPLAY_NAMES];

    const skeletonSubGroups = skeleton.get(groupKey) ?? new Map<string, SubGroupEntry>();
    const shiftSubGroups    = projectedByGroupAndSubGroup.get(groupKey) ?? new Map();

    // Merge: skeleton names first (preserving sortOrder), then ad-hoc names
    const allSubGroupNames = new Set([
      ...[...skeletonSubGroups.values()]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(sg => sg.name),
      ...shiftSubGroups.keys(),
    ]);

    const subGroups: ProjectedSubGroup[] = [...allSubGroupNames].map(sgName => {
      const dateMap  = shiftSubGroups.get(sgName) ?? new Map<string, ProjectedShift[]>();
      const shiftsByDate: Record<string, ProjectedShift[]> = {};
      dateMap.forEach((dayShifts, date) => { shiftsByDate[date] = dayShifts; });

      const allShifts  = Object.values(shiftsByDate).flat();
      const assigned   = allShifts.filter(s => !!s.employeeId).length;
      const sgId       = skeletonSubGroups.get(sgName)?.id ?? `adhoc-${groupKey}-${sgName}`;

      return {
        id:           sgId,
        name:         sgName,
        shiftsByDate,
        coverage:     coverageHealth(assigned, allShifts.length),
        stats:        subGroupStats(allShifts),
      };
    });

    return {
      id:        groupKey,
      name,
      type:      groupKey,
      colors,
      subGroups,
      stats:     groupStatsFrom(subGroups),
    };
  });

  // Filter out the unassigned group if it's completely empty
  const finalGroups = groups.filter(g =>
    g.type !== 'unassigned' ||
    g.subGroups.some(sg => Object.keys(sg.shiftsByDate).length > 0)
  );

  return {
    groups: finalGroups,
    stats:  buildStats(shifts),
  };
}
