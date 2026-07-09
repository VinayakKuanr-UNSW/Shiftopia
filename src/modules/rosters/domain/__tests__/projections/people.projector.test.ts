import { describe, it, expect } from 'vitest';
import { projectPeople } from '../../projections/projectors/people.projector';
import type { WorkerShiftDTO, WorkerEmployeeDTO } from '../../projections/worker/protocol';
import { UNASSIGNED_BUCKET_ID } from '../../projections/constants';

// ── Fixtures ───────────────────────────────────────────────────────────────────
// projectPeople reads a subset of WorkerShiftDTO, but the type requires every
// non-optional field. This factory supplies type-correct defaults; tests
// override only what they exercise.

let _id = 0;
function makeShift(overrides: Partial<WorkerShiftDTO> = {}): WorkerShiftDTO {
  _id++;
  return {
    id: `shift-${_id}`,
    updatedAtMs: 0,
    shiftDate: '2025-03-15',
    startTime: '09:00',
    endTime: '17:00',
    isOvernight: false,
    scheduledLengthMinutes: 480,
    netLengthMinutes: 480,
    unpaidBreakMinutes: 0,
    paidBreakMinutes: 0,
    assignedEmployeeId: null,
    assignmentStatus: 'unassigned',
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
    departmentId: 'dept-1',
    subDepartmentId: null,
    roleId: 'role-1',
    roleName: 'Stage Hand',
    remunerationLevel: null,
    remunerationRate: 25,
    actualHourlyRate: null,
    levelName: null,
    levelNumber: null,
    groupType: null,
    subGroupName: null,
    employeeFirstName: null,
    employeeLastName: null,
    eventIds: [],
    targetEmploymentType: null,
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
    ...overrides,
  };
}

function makeEmployee(overrides: Partial<WorkerEmployeeDTO> = {}): WorkerEmployeeDTO {
  return {
    id: 'emp-1',
    firstName: 'Alice',
    lastName: 'Smith',
    contractedHours: 38,
    contractType: 'FT',
    ...overrides,
  };
}

// ── H2 — off-roster assignee is not dropped ────────────────────────────────────

describe('projectPeople — H2: assignee not in ctx.employees is not dropped', () => {
  it('synthesises an isOffRoster bucket containing the shift', () => {
    const shifts = [
      makeShift({
        assignedEmployeeId: 'emp-999',
        assignmentStatus: 'assigned',
        employeeFirstName: 'Bob',
        employeeLastName: 'OffPage',
      }),
    ];
    // ctx.employees deliberately does NOT include emp-999 (paginated out).
    const result = projectPeople(shifts, { employees: [makeEmployee()], rangeDays: 7 });

    const offRoster = result.employees.find(e => e.id === 'emp-999');
    expect(offRoster).toBeDefined();
    expect(offRoster!.isOffRoster).toBe(true);
    // The assigned shift survived into that bucket.
    expect(Object.values(offRoster!.shifts).flat()).toHaveLength(1);
  });

  it('leaves the Open Shifts (unassigned) bucket unaffected', () => {
    const shifts = [
      makeShift({ assignedEmployeeId: 'emp-999', assignmentStatus: 'assigned' }),
      makeShift({ assignedEmployeeId: null }), // genuinely unassigned
    ];
    const result = projectPeople(shifts, { employees: [makeEmployee()], rangeDays: 7 });

    const openBucket = result.employees.find(e => e.id === UNASSIGNED_BUCKET_ID);
    expect(openBucket).toBeDefined();
    // Only the truly-unassigned shift lands in Open Shifts — the off-roster
    // assigned shift did NOT leak into it.
    expect(Object.values(openBucket!.shifts).flat()).toHaveLength(1);
    expect(openBucket!.isOffRoster).toBeFalsy();
  });
});

// ── H3 — cancelled shifts excluded from fatigue ────────────────────────────────

describe('projectPeople — H3: cancelled shifts do not inflate fatigue', () => {
  it('a single cancelled assigned shift yields fatigueScore 0', () => {
    const shifts = [
      makeShift({ assignedEmployeeId: 'emp-1', assignmentStatus: 'assigned', isCancelled: true }),
    ];
    const result = projectPeople(shifts, { employees: [makeEmployee()], rangeDays: 7 });
    const alice = result.employees.find(e => e.id === 'emp-1')!;
    expect(alice.fatigueScore).toBe(0);
    // ...and cancelled hours were also excluded from currentHours.
    expect(alice.currentHours).toBe(0);
  });

  it('the SAME shift non-cancelled yields fatigueScore > 0', () => {
    const shifts = [
      makeShift({ assignedEmployeeId: 'emp-1', assignmentStatus: 'assigned', isCancelled: false }),
    ];
    const result = projectPeople(shifts, { employees: [makeEmployee()], rangeDays: 7 });
    const alice = result.employees.find(e => e.id === 'emp-1')!;
    expect(alice.fatigueScore).toBeGreaterThan(0);
    expect(alice.currentHours).toBeGreaterThan(0);
  });
});

// ── M2 — casual contract fabrication ───────────────────────────────────────────

describe('projectPeople — M2: casuals are not measured against a phantom 38h', () => {
  it('CASUAL with contracted_weekly_hours 38 → contractedHours 0, utilization 0', () => {
    const shifts = [
      makeShift({ assignedEmployeeId: 'emp-1', assignmentStatus: 'assigned' }),
    ];
    const result = projectPeople(shifts, {
      employees: [makeEmployee({ contractType: 'CASUAL', contractedHours: 38 })],
      rangeDays: 7,
    });
    const casual = result.employees.find(e => e.id === 'emp-1')!;
    expect(casual.contractedHours).toBe(0);
    expect(casual.periodContractedHours).toBe(0);
    expect(casual.utilization).toBe(0);
    expect(casual.overHoursWarning).toBe(false);
  });

  it('an FT employee with 38 keeps 38 and a real utilization', () => {
    const shifts = [
      makeShift({ assignedEmployeeId: 'emp-1', assignmentStatus: 'assigned' }),
    ];
    const result = projectPeople(shifts, {
      employees: [makeEmployee({ contractType: 'FT', contractedHours: 38 })],
      rangeDays: 7,
    });
    const ft = result.employees.find(e => e.id === 'emp-1')!;
    expect(ft.contractedHours).toBe(38);
    expect(ft.periodContractedHours).toBe(38);
    expect(ft.utilization).toBeGreaterThan(0);
  });
});

// ── H1 — employeeId is populated ───────────────────────────────────────────────

describe('projectPeople — H1: employeeId is populated on projected employees', () => {
  it('uses the DTO employeeId when present', () => {
    const shifts = [makeShift({ assignedEmployeeId: 'emp-1', assignmentStatus: 'assigned' })];
    const result = projectPeople(shifts, {
      employees: [makeEmployee({ id: 'emp-1', employeeId: 'STAFF-007' })],
      rangeDays: 7,
    });
    const emp = result.employees.find(e => e.id === 'emp-1')!;
    expect(emp.employeeId).toBe('STAFF-007');
  });

  it('falls back to id when employeeId is absent', () => {
    const shifts = [makeShift({ assignedEmployeeId: 'emp-1', assignmentStatus: 'assigned' })];
    const result = projectPeople(shifts, {
      employees: [makeEmployee({ id: 'emp-1', employeeId: null })],
      rangeDays: 7,
    });
    const emp = result.employees.find(e => e.id === 'emp-1')!;
    expect(emp.employeeId).toBe('emp-1');
    expect(emp.employeeId).toBeTruthy();
  });
});
