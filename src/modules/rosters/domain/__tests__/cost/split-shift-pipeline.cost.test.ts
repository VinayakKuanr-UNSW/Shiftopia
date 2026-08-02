import { describe, it, expect } from 'vitest';
import { runProjectionPipeline } from '../../projections/pipeline/runProjectionPipeline';
import type { WorkerShiftDTO, ProjectionRequest } from '../../projections/worker/protocol';

/**
 * Split-shift allowance (cl 28.4/39) — production wiring test. Compliance
 * audit finding (2026-08-02): the roster/AutoScheduler cost pipeline could
 * PRICE the $11.13 allowance but nothing ever DETECTED a qualifying same-day
 * pair and set `allowances.splitShift`, so it was never actually reachable
 * from a live roster. `runProjectionPipeline` now derives it automatically.
 *
 * Date: 2026-06-29 = Monday, EA 2025 baseline rate era (before the
 * 6 Jul 2026 FY26/27 +5.1% increase bumps the split-shift allowance from
 * $11.13 to $11.70) — not an NSW public holiday.
 */

let idc = 0;
function dto(o: Partial<WorkerShiftDTO>): WorkerShiftDTO {
  return {
    id: `s${idc++}`,
    updatedAtMs: 1,
    shiftDate: '2026-06-29',
    startTime: '09:00',
    endTime: '13:00',
    isOvernight: false,
    scheduledLengthMinutes: 0,
    netLengthMinutes: null, // derived from start/end so per-test time overrides take effect
    unpaidBreakMinutes: 0,
    paidBreakMinutes: 0,
    assignedEmployeeId: 'E1',
    assignmentStatus: 'assigned',
    assignmentOutcome: null,
    lifecycleStatus: 'Published',
    isCancelled: false,
    isLocked: false,
    isPublished: true,
    isDraft: false,
    biddingStatus: 'not_on_bidding',
    tradeRequestedAt: null,
    tradingStatus: null,
    organizationId: null,
    departmentId: 'd1',
    subDepartmentId: null,
    roleId: null,
    roleName: 'Attendant',
    remunerationLevel: null,
    remunerationRate: 30,
    actualHourlyRate: 30,
    levelName: null,
    levelNumber: null,
    groupType: null,
    subGroupName: null,
    employeeFirstName: 'Test',
    employeeLastName: 'User',
    eventIds: [],
    targetEmploymentType: 'Part-Time',
    allowances: null,
    rosterSubgroupId: null,
    rosterSubgroupName: null,
    rosterGroupName: null,
    rosterGroupExternalId: null,
    displayOrder: 0,
    notes: null,
    startAt: null,
    endAt: null,
    fulfillmentStatus: 'none',
    requiredSkills: [],
    ...o,
  };
}

function request(shifts: WorkerShiftDTO[]): ProjectionRequest {
  return {
    requestId: 1,
    mode: 'people',
    shifts,
    employees: [],
    roles: [],
    levels: [],
    events: [],
    rosterStructures: [],
    filters: {
      roleId: null, skillIds: [], lifecycleStatus: 'all', assignmentStatus: 'all',
      assignmentOutcome: 'all', biddingStatus: 'all', tradingStatus: 'all',
      stateId: null, searchQuery: '',
    },
    nowIso: '2026-06-29T00:00:00.000Z',
  };
}

describe('split-shift allowance — pipeline auto-derivation (production wiring)', () => {
  it('adds the $11.13 allowance once for a same-day PT pair with a ≤3h gap', () => {
    idc = 0;
    const shifts = [
      dto({ startTime: '08:00', endTime: '11:00' }),
      dto({ startTime: '13:00', endTime: '17:00' }), // 2h gap
    ];
    const res = runProjectionPipeline(request(shifts));
    expect(res).not.toBeNull();
    // 3h + 4h = 7h @ 30 = 210 base, plus one $11.13 allowance.
    expect(res!.stats.costBreakdown.base).toBeCloseTo(210, 5);
    expect(res!.stats.costBreakdown.allowance).toBeCloseTo(11.13, 5);
    expect(res!.stats.estimatedCost).toBeCloseTo(210 + 11.13, 5);
  });

  it('does not add the allowance when the gap exceeds 3h', () => {
    idc = 0;
    const shifts = [
      dto({ startTime: '08:00', endTime: '11:00' }),
      dto({ startTime: '15:00', endTime: '19:00' }), // 4h gap
    ];
    const res = runProjectionPipeline(request(shifts));
    expect(res!.stats.costBreakdown.allowance).toBe(0);
  });

  it('does not add the allowance for Casual or Full-Time employees', () => {
    idc = 0;
    const casualShifts = [
      dto({ startTime: '08:00', endTime: '11:00', targetEmploymentType: 'Casual', actualHourlyRate: 37.5, remunerationRate: 37.5 }),
      dto({ startTime: '13:00', endTime: '17:00', targetEmploymentType: 'Casual', actualHourlyRate: 37.5, remunerationRate: 37.5 }),
    ];
    const casualRes = runProjectionPipeline(request(casualShifts));
    expect(casualRes!.stats.costBreakdown.allowance).toBe(0);

    idc = 0;
    const ftShifts = [
      dto({ startTime: '08:00', endTime: '11:00', targetEmploymentType: 'Full-Time' }),
      dto({ startTime: '13:00', endTime: '17:00', targetEmploymentType: 'Full-Time' }),
    ];
    const ftRes = runProjectionPipeline(request(ftShifts));
    expect(ftRes!.stats.costBreakdown.allowance).toBe(0);
  });

  it('never confuses two different employees each working one shift the same day', () => {
    idc = 0;
    const shifts = [
      dto({ assignedEmployeeId: 'E1', startTime: '08:00', endTime: '11:00' }),
      dto({ assignedEmployeeId: 'E2', startTime: '13:00', endTime: '17:00' }),
    ];
    const res = runProjectionPipeline(request(shifts));
    expect(res!.stats.costBreakdown.allowance).toBe(0);
  });

  it('does not poison the per-shift cache for an unrelated re-projection of the same non-split shift', () => {
    idc = 0;
    // First projection: a genuine split pair.
    const splitShifts = [
      dto({ id: 'fixed-1', startTime: '08:00', endTime: '11:00' }),
      dto({ id: 'fixed-2', startTime: '13:00', endTime: '17:00' }),
    ];
    const first = runProjectionPipeline(request(splitShifts));
    expect(first!.stats.costBreakdown.allowance).toBeCloseTo(11.13, 5);

    // Second projection: the SAME shift id, but now standalone (no pair) —
    // must NOT still read the split-shift-adjusted cached result.
    const standalone = [dto({ id: 'fixed-2', startTime: '13:00', endTime: '17:00' })];
    const second = runProjectionPipeline(request(standalone));
    expect(second!.stats.costBreakdown.allowance).toBe(0);
  });
});
