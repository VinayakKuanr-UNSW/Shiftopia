import { describe, it, expect } from 'vitest';
import { runProjectionPipeline } from '../runProjectionPipeline';
import type { WorkerShiftDTO, ProjectionRequest } from '../../worker/protocol';

function makeDto(overrides: Partial<WorkerShiftDTO>): WorkerShiftDTO {
  return {
    id: overrides.id ?? 'shift-1',
    updatedAtMs: 1000,
    shiftDate: overrides.shiftDate ?? '2026-10-23',
    startTime: overrides.startTime ?? '09:00',
    endTime: overrides.endTime ?? '17:00',
    isOvernight: false,
    scheduledLengthMinutes: 480,
    netLengthMinutes: 480,
    unpaidBreakMinutes: 30,
    paidBreakMinutes: 0,
    assignedEmployeeId: overrides.assignedEmployeeId ?? null,
    assignmentStatus: overrides.assignmentStatus ?? 'unassigned',
    assignmentOutcome: overrides.assignmentOutcome ?? null,
    lifecycleStatus: overrides.lifecycleStatus ?? 'Draft',
    isCancelled: overrides.isCancelled ?? false,
    isLocked: false,
    isPublished: overrides.isPublished ?? false,
    isDraft: overrides.isDraft ?? true,
    biddingStatus: overrides.biddingStatus ?? 'not_on_bidding',
    tradeRequestedAt: null,
    tradingStatus: overrides.tradingStatus ?? null,
    organizationId: 'org-1',
    departmentId: 'dept-1',
    subDepartmentId: 'sub-1',
    roleId: 'role-1',
    roleName: 'Event Setup Team Member',
    remunerationLevel: 4,
    levelName: 'Level 4',
    levelNumber: 4,
    groupType: 'convention_centre',
    subGroupName: 'AM Base',
    employeeFirstName: overrides.employeeFirstName ?? null,
    employeeLastName: overrides.employeeLastName ?? null,
    eventIds: [],
    requiredSkills: [],
    rosterSubgroupId: null,
    rosterSubgroupName: null,
    rosterGroupName: null,
    rosterGroupExternalId: null,
    displayOrder: 0,
    notes: null,
    startAt: null,
    endAt: null,
    fulfillmentStatus: 'none',
    ...overrides,
  };
}

function makeRequest(shifts: WorkerShiftDTO[], filterOverrides: Partial<ProjectionRequest['filters']> = {}): ProjectionRequest {
  return {
    requestId: 1,
    mode: 'group',
    shifts,
    employees: [],
    roles: [],
    levels: [],
    events: [],
    rosterStructures: [
      {
        groups: [
          {
            name: 'Convention Centre',
            externalId: 'convention_centre',
            subGroups: [
              { id: 'sg-1', name: 'AM Base', sortOrder: 0 },
            ],
          },
        ],
      },
    ],
    filters: {
      roleId: null,
      skillIds: [],
      lifecycleStatus: 'all',
      assignmentStatus: 'all',
      assignmentOutcome: 'all',
      biddingStatus: 'all',
      tradingStatus: 'all',
      stateId: null,
      searchQuery: '',
      ...filterOverrides,
    },
    nowIso: '2026-10-23T00:00:00.000Z',
  };
}

describe('runProjectionPipeline - filter functionality', () => {
  const s1Draft = makeDto({
    id: 's1-draft',
    lifecycleStatus: 'Draft',
    assignmentStatus: 'unassigned',
    isCancelled: false,
  });

  const s2DraftAssigned = makeDto({
    id: 's2-draft-assigned',
    lifecycleStatus: 'Draft',
    assignmentStatus: 'assigned',
    assignedEmployeeId: 'emp-1',
    isCancelled: false,
  });

  const s4Confirmed = makeDto({
    id: 's4-confirmed',
    lifecycleStatus: 'Published',
    assignmentStatus: 'assigned',
    assignmentOutcome: 'confirmed',
    assignedEmployeeId: 'emp-2',
    isCancelled: false,
  });

  const s15Cancelled = makeDto({
    id: 's15-cancelled',
    lifecycleStatus: 'Cancelled',
    assignmentStatus: 'unassigned',
    isCancelled: true,
  });

  const allMockShifts = [s1Draft, s2DraftAssigned, s4Confirmed, s15Cancelled];

  it('filters shifts by stateId (e.g. S15 - Cancelled)', () => {
    const req = makeRequest(allMockShifts, { stateId: 'S15' });
    const res = runProjectionPipeline(req);

    expect(res).not.toBeNull();
    expect(res!.group).not.toBeNull();

    // Verify projected group contains ONLY the S15 shift
    const conventionGroup = res!.group!.groups.find(g => g.type === 'convention_centre');
    expect(conventionGroup).toBeDefined();

    const amBase = conventionGroup!.subGroups.find(sg => sg.name === 'AM Base');
    expect(amBase).toBeDefined();

    const shiftsOnDate = amBase!.shiftsByDate['2026-10-23'] || [];
    expect(shiftsOnDate).toHaveLength(1);
    expect(shiftsOnDate[0].id).toBe('s15-cancelled');
    expect(shiftsOnDate[0].stateId).toBe('S15');
  });

  it('filters shifts by stateId (S1 - Draft)', () => {
    const req = makeRequest(allMockShifts, { stateId: 'S1' });
    const res = runProjectionPipeline(req);

    const conventionGroup = res!.group!.groups.find(g => g.type === 'convention_centre');
    const amBase = conventionGroup!.subGroups.find(sg => sg.name === 'AM Base');
    const shiftsOnDate = amBase!.shiftsByDate['2026-10-23'] || [];

    expect(shiftsOnDate).toHaveLength(1);
    expect(shiftsOnDate[0].id).toBe('s1-draft');
    expect(shiftsOnDate[0].stateId).toBe('S1');
  });

  it('filters shifts by lifecycleStatus: cancelled', () => {
    const req = makeRequest(allMockShifts, { lifecycleStatus: 'cancelled' });
    const res = runProjectionPipeline(req);

    const conventionGroup = res!.group!.groups.find(g => g.type === 'convention_centre');
    const amBase = conventionGroup!.subGroups.find(sg => sg.name === 'AM Base');
    const shiftsOnDate = amBase!.shiftsByDate['2026-10-23'] || [];

    expect(shiftsOnDate).toHaveLength(1);
    expect(shiftsOnDate[0].id).toBe('s15-cancelled');
  });

  it('returns all shifts when stateId is "all" or null', () => {
    const req = makeRequest(allMockShifts, { stateId: 'all' });
    const res = runProjectionPipeline(req);

    const conventionGroup = res!.group!.groups.find(g => g.type === 'convention_centre');
    const amBase = conventionGroup!.subGroups.find(sg => sg.name === 'AM Base');
    const shiftsOnDate = amBase!.shiftsByDate['2026-10-23'] || [];

    expect(shiftsOnDate).toHaveLength(4);
  });
});
