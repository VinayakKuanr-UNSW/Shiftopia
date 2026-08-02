import { describe, it, expect } from 'vitest';
import { runProjectionPipeline } from '../../projections/pipeline/runProjectionPipeline';
import type { WorkerShiftDTO, ProjectionRequest } from '../../projections/worker/protocol';

/**
 * cl 40.1 rest-gap double-time — production wiring test. Compliance audit
 * finding (2026-08-02): a forced early recall never triggered the
 * double-time floor anywhere the roster grid or AutoScheduler could see it
 * — the rule existed only in the payroll period aggregator, which has no
 * production caller. `runProjectionPipeline` now applies it automatically.
 *
 * Dates: 2026-07-06 = Monday, 2026-07-07 = Tuesday (EA 2025 baseline rate
 * era; neither is an NSW public holiday). Shift times are deliberately kept
 * outside the 22:00-06:00 night window so the cl 43 night allowance doesn't
 * interact with the numbers being asserted here.
 */

let idc = 0;
function dto(o: Partial<WorkerShiftDTO>): WorkerShiftDTO {
  return {
    id: `s${idc++}`,
    updatedAtMs: 1,
    shiftDate: '2026-07-06',
    startTime: '09:00',
    endTime: '17:00',
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
    targetEmploymentType: 'Full-Time',
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
    nowIso: '2026-07-06T00:00:00.000Z',
  };
}

describe('cl 40.1 rest-gap double-time — pipeline auto-derivation (production wiring)', () => {
  it('floors the breach shift to double time when resumed with less than 10h rest', () => {
    idc = 0;
    const shifts = [
      dto({ shiftDate: '2026-07-06', startTime: '12:00', endTime: '21:00' }), // Mon 9h, ends 21:00
      dto({ shiftDate: '2026-07-07', startTime: '06:00', endTime: '14:00' }), // Tue 8h — 9h gap, breach
    ];
    const res = runProjectionPipeline(request(shifts));
    expect(res).not.toBeNull();
    // Shift A: 9h @ 30 = 270 (no OT, no penalty, weekday). Shift B priced normally: 8h @ 30 = 240.
    // Rest-gap floor on B: effective 30/hr < double-time 60/hr -> top-up (60-30)*8 = 240.
    expect(res!.stats.costBreakdown.base).toBeCloseTo(270 + 240, 5); // 510
    expect(res!.stats.costBreakdown.penalty).toBeCloseTo(240, 5); // the double-time top-up
    expect(res!.stats.estimatedCost).toBeCloseTo(270 + 240 + 240, 5); // 750
  });

  it('does not apply the floor when the gap is a full 10h or more', () => {
    idc = 0;
    const shifts = [
      dto({ shiftDate: '2026-07-06', startTime: '09:00', endTime: '17:00' }), // ends 17:00
      // starts 08:00 next day = 15h gap, and stays outside the 22:00-06:00
      // night window so this test isolates the rest-gap clause only.
      dto({ shiftDate: '2026-07-07', startTime: '08:00', endTime: '16:00' }),
    ];
    const res = runProjectionPipeline(request(shifts));
    expect(res!.stats.costBreakdown.penalty).toBe(0);
  });

  it('does not check the gap between two shifts on the SAME day', () => {
    idc = 0;
    const shifts = [
      dto({ shiftDate: '2026-07-06', startTime: '06:00', endTime: '10:00' }),
      dto({ shiftDate: '2026-07-06', startTime: '10:30', endTime: '14:00' }), // 30min gap, same day
    ];
    const res = runProjectionPipeline(request(shifts));
    expect(res!.stats.costBreakdown.penalty).toBe(0);
  });

  it('never confuses two different employees\' consecutive shifts', () => {
    idc = 0;
    const shifts = [
      dto({ assignedEmployeeId: 'E1', shiftDate: '2026-07-06', startTime: '12:00', endTime: '21:00' }),
      dto({ assignedEmployeeId: 'E2', shiftDate: '2026-07-07', startTime: '06:00', endTime: '14:00' }),
    ];
    const res = runProjectionPipeline(request(shifts));
    expect(res!.stats.costBreakdown.penalty).toBe(0);
  });

  it('applies to casuals too (cl 40.1 has no employment-type carve-out)', () => {
    idc = 0;
    const shifts = [
      dto({
        shiftDate: '2026-07-06', startTime: '12:00', endTime: '21:00',
        targetEmploymentType: 'Casual', actualHourlyRate: 37.5, remunerationRate: 37.5,
      }),
      dto({
        shiftDate: '2026-07-07', startTime: '06:00', endTime: '14:00',
        targetEmploymentType: 'Casual', actualHourlyRate: 37.5, remunerationRate: 37.5,
      }),
    ];
    const res = runProjectionPipeline(request(shifts));
    expect(res!.stats.costBreakdown.penalty).toBeGreaterThan(0);
  });

  it('does not poison the per-shift cache for an unrelated re-projection of the same shift', () => {
    idc = 0;
    const breachPair = [
      dto({ id: 'fixed-a', shiftDate: '2026-07-06', startTime: '12:00', endTime: '21:00' }),
      dto({ id: 'fixed-b', shiftDate: '2026-07-07', startTime: '06:00', endTime: '14:00' }),
    ];
    const first = runProjectionPipeline(request(breachPair));
    expect(first!.stats.costBreakdown.penalty).toBeGreaterThan(0);

    // Same shift id, now standalone (no preceding shift) — must not still
    // carry a stale double-time top-up from the earlier projection.
    const standalone = [dto({ id: 'fixed-b', shiftDate: '2026-07-07', startTime: '06:00', endTime: '14:00' })];
    const second = runProjectionPipeline(request(standalone));
    expect(second!.stats.costBreakdown.penalty).toBe(0);
  });
});
