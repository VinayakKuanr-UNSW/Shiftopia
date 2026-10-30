import { describe, it, expect } from 'vitest';
import { estimateDetailedShiftCost } from '../../projections/utils/cost/standard';
import type { CostCalculatorOptions } from '../../projections/utils/cost/types';

/**
 * Weekly overtime (cl. 42) — the ordinary hours that push a member's running
 * weekly ordinary total past 38h become overtime instead of ordinary.
 *
 * The ENGINE is tested here — estimateDetailedShiftCost with an explicit
 * `priorOrdinaryHoursThisWeek`, incl. the safe-by-default no-op and the casual
 * exclusion. The production wiring that accumulates prior hours per employee
 * and ISO week is the payroll aggregator (gross-pay.test.ts, and the shift pay
 * ledger in shift-pay-ledger.test.ts); the roster projection no longer prices
 * shifts (decision 2026-10-09: money is shown in Gross Pay alone).
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
  shift_date: '2026-06-29', // Monday (before the 6 Jul 2026 FY26/27 +5.1% increase)
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
    // 2h of DAILY OT past the rostered finish also triggers the cl 28.1 meal allowance.
    expect(r.allowanceCost).toBeCloseTo(13.61, 5);
    expect(r.totalCost).toBeCloseTo(435 + 13.61, 5);
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
