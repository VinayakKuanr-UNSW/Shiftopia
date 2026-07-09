import { describe, it, expect } from 'vitest';
import { estimateDetailedShiftCost } from '../../projections/utils/cost/standard';
import type { CostCalculatorOptions } from '../../projections/utils/cost/types';
import { runProjectionPipeline } from '../../projections/pipeline/runProjectionPipeline';
import type { WorkerShiftDTO, ProjectionRequest } from '../../projections/worker/protocol';

/**
 * Weekly overtime (cl. 42) — the ordinary hours that push a member's running
 * weekly ordinary total past 38h become overtime instead of ordinary.
 *
 * Two layers are tested:
 *   1. ENGINE — estimateDetailedShiftCost with an explicit
 *      `priorOrdinaryHoursThisWeek`, incl. the safe-by-default no-op and the
 *      casual exclusion.
 *   2. PIPELINE — runProjectionPipeline accumulates prior ordinary hours per
 *      employee / ISO week and feeds them to the engine (the production wiring).
 *
 * Dates: 2026-07-06=Mon … 2026-07-10=Fri (one ISO week, none are PH).
 */

const base = (o: Partial<CostCalculatorOptions>): CostCalculatorOptions => ({
  netMinutes: 480,
  start_time: '09:00',
  end_time: '17:00',
  rate: 30,
  scheduled_length_minutes: 480,
  is_overnight: false,
  is_cancelled: false,
  shift_date: '2026-07-06', // Monday
  employmentType: 'Full-Time',
  ...o,
});

describe('weekly OT — engine (cl. 42)', () => {
  it('is a NO-OP when priorOrdinaryHoursThisWeek is undefined (safe-by-default)', () => {
    const r = estimateDetailedShiftCost(base({}));
    expect(r.ordinaryHours).toBe(8);
    expect(r.overtimeHours).toBe(0);
    expect(r.totalCost).toBeCloseTo(240, 5); // 8h @ 30
  });

  it('prior = 0 is identical to undefined', () => {
    const a = estimateDetailedShiftCost(base({}));
    const b = estimateDetailedShiftCost(base({ priorOrdinaryHoursThisWeek: 0 }));
    expect(b.ordinaryHours).toBe(a.ordinaryHours);
    expect(b.overtimeHours).toBe(a.overtimeHours);
    expect(b.totalCost).toBeCloseTo(a.totalCost, 5);
  });

  it('splits the shift at the 38h weekly line — prior 34h ⇒ 4h ordinary + 4h OT', () => {
    // ordinaryRoom = 38 − 34 = 4 ⇒ 4h stay ordinary, 4h spill to OT.
    const r = estimateDetailedShiftCost(base({ priorOrdinaryHoursThisWeek: 34 }));
    expect(r.ordinaryHours).toBe(4);
    expect(r.overtimeHours).toBe(4);
    // ordinary 4h @ 30 = 120; OT 4h non-PH tiered (3h@1.5 + 1h@2.0) = 6.5 → *30 = 195.
    expect(r.ordinaryCost).toBeCloseTo(120, 5);
    expect(r.overtimeCost).toBeCloseTo((3 * 1.5 + 1 * 2.0) * 30, 5); // 195
    expect(r.totalCost).toBeCloseTo(315, 5);
  });

  it('prior >= 38h ⇒ the whole shift is overtime', () => {
    const r = estimateDetailedShiftCost(base({ priorOrdinaryHoursThisWeek: 40 }));
    expect(r.ordinaryHours).toBe(0);
    expect(r.overtimeHours).toBe(8);
    // 3h@1.5 + 5h@2.0 = 14.5 → *30 = 435.
    expect(r.overtimeCost).toBeCloseTo((3 * 1.5 + 5 * 2.0) * 30, 5);
    expect(r.totalCost).toBeCloseTo(435, 5);
  });

  it('stacks on top of DAILY overtime — daily OT and weekly OT both land in OT', () => {
    // net 10h, scheduled 8h ⇒ 2h daily OT, 8h daily ordinary. prior 34 ⇒ 4h of
    // that ordinary stays ordinary, 4h spills. finalOrdinary 4h, finalOT 2+4 = 6h.
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 600, scheduled_length_minutes: 480,
        start_time: '09:00', end_time: '19:00',
        priorOrdinaryHoursThisWeek: 34,
      }),
    );
    expect(r.ordinaryHours).toBe(4);
    expect(r.overtimeHours).toBe(6);
    expect(r.ordinaryCost).toBeCloseTo(120, 5);              // 4h @ 30
    expect(r.overtimeCost).toBeCloseTo((3 * 1.5 + 3 * 2.0) * 30, 5); // 3h@1.5+3h@2.0 = 10.5 → 315
    expect(r.totalCost).toBeCloseTo(435, 5);
  });

  it('is OFF for casuals even when a prior total is supplied (ambiguous under the EA)', () => {
    const r = estimateDetailedShiftCost(
      base({
        employmentType: 'Casual', rate: 37.5, // casual base (ordinary 30)
        priorOrdinaryHoursThisWeek: 40,
      }),
    );
    // No weekly OT for casuals: 8h ordinary @ loaded casual weekday rate = 300.
    expect(r.ordinaryHours).toBe(8);
    expect(r.overtimeHours).toBe(0);
    expect(r.totalCost).toBeCloseTo(8 * 37.5, 5); // 300
  });
});

// ── Pipeline integration ──────────────────────────────────────────────────────

let idc = 0;
function dto(o: Partial<WorkerShiftDTO>): WorkerShiftDTO {
  return {
    id: `s${idc++}`,
    updatedAtMs: 1,
    shiftDate: '2026-07-06',
    startTime: '09:00',
    endTime: '17:00',
    isOvernight: false,
    scheduledLengthMinutes: 480,
    netLengthMinutes: 480,
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

describe('weekly OT — pipeline accumulation (production wiring)', () => {
  it('accumulates prior ordinary hours across a FT member\'s week and spills past 38h', () => {
    idc = 0;
    // 5 weekday 8h shifts Mon–Fri (same ISO week) = 40h ordinary before weekly OT.
    const dates = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
    const shifts = dates.map(d => dto({ shiftDate: d }));

    const res = runProjectionPipeline(request(shifts));
    expect(res).not.toBeNull();

    // Shifts 1–4 (prior 0/8/16/24) stay ordinary: 4 × 8h @ 30 = 960 (32h).
    // Shift 5 (prior 32, room 6): 6h ordinary @30 = 180; 2h OT @1.5 = 90.
    //   base ordinary total = 960 + 180 = 1140; overtime = 90.
    expect(res!.stats.costBreakdown.base).toBeCloseTo(1140, 4);
    expect(res!.stats.costBreakdown.overtime).toBeCloseTo(90, 4);
    // total = 1140 base + 90 OT = 1230.
    expect(res!.stats.estimatedCost).toBeCloseTo(1230, 4);
  });

  it('does NOT accumulate across DIFFERENT ISO weeks (each week resets to 0)', () => {
    idc = 0;
    // Two weeks, 5×8h each — every shift under 38h/week ⇒ zero weekly OT.
    const wk1 = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'];
    const wk2 = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'];
    const shifts = [...wk1, ...wk2].map(d => dto({ shiftDate: d }));

    const res = runProjectionPipeline(request(shifts));
    // 8 shifts × 8h @ 30 = 1920 ordinary, no OT (each week peaks at 32h).
    expect(res!.stats.costBreakdown.overtime).toBeCloseTo(0, 4);
    expect(res!.stats.costBreakdown.base).toBeCloseTo(1920, 4);
  });

  it('leaves casual members untouched — no weekly OT even past 38h in a week', () => {
    idc = 0;
    const dates = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
    const shifts = dates.map(d => dto({
      shiftDate: d, targetEmploymentType: 'Casual', actualHourlyRate: 37.5, remunerationRate: 37.5,
    }));

    const res = runProjectionPipeline(request(shifts));
    // 5 × 8h @ loaded casual 37.5 = 1500 ordinary, no OT.
    expect(res!.stats.costBreakdown.overtime).toBeCloseTo(0, 4);
    expect(res!.stats.costBreakdown.base).toBeCloseTo(1500, 4);
  });
});
