import { describe, it, expect } from 'vitest';
import { estimateDetailedShiftCost, layWorkedMinutes } from '../../projections/utils/cost/standard';
import { estimateDetailedCostFromShift } from '@/modules/rosters/domain/projections/utils/cost';
import type { CostCalculatorOptions } from '../../projections/utils/cost/types';

/**
 * Pay prices the hours WORKED around the rostered meal break.
 *
 * cl 43 pays the night rate on ordinary hours worked 22:00–06:00, and cl 41
 * pays the weekend / public-holiday loading on hours worked ON that day. Both
 * depend on where the unpaid meal break sits. The engine used to lay every
 * worked minute from the start and put the break at the END, so a break taken
 * at 18:00 priced the same as one at 22:00.
 *
 * Dates: 2026-08-06 = Thursday, 2026-07-04 = Saturday (neither a NSW holiday).
 */

const base = (o: Partial<CostCalculatorOptions>): CostCalculatorOptions => ({
  netMinutes: 480,
  start_time: '14:00',
  end_time: '22:30',
  rate: 30,
  scheduled_length_minutes: 510,
  is_overnight: false,
  is_cancelled: false,
  shift_date: '2026-08-06',
  employmentType: 'Full-Time',
  unpaid_break_minutes: 30,
  ...o,
});

describe('layWorkedMinutes', () => {
  it('without a break is one span from the start (the legacy layout)', () => {
    expect(layWorkedMinutes(840, 480, 0, null, 0)).toEqual({ ordinary: [[840, 1320]], overtime: [] });
  });

  it('jumps the break: 14:00 start, break 18:00–18:30, 8h worked ends 22:30', () => {
    expect(layWorkedMinutes(840, 480, 0, 1080, 30)).toEqual({
      ordinary: [[840, 1080], [1110, 1350]],
      overtime: [],
    });
  });

  it('splits overtime when the break falls inside it', () => {
    // 08:00 start, 2h ordinary, 2h OT, break at 11:00 (an hour into the OT).
    expect(layWorkedMinutes(480, 120, 120, 660, 30)).toEqual({
      ordinary: [[480, 600]],
      overtime: [[600, 660], [690, 750]],
    });
  });
});

describe('cl 43 night rate follows the break (acceptance case)', () => {
  it('Thu 14:00–22:30, break at 22:00 ⇒ no night hours', () => {
    const r = estimateDetailedShiftCost(base({ break_start: '22:00' }));
    expect(r.breakdown.nightHours).toBe(0);
  });

  it('Thu 14:00–22:30, break at 18:00 ⇒ 0.5 night hours (22:00–22:30 worked)', () => {
    const r = estimateDetailedShiftCost(base({ break_start: '18:00:00' }));
    expect(r.breakdown.nightHours).toBe(0.5);
  });

  it('the earlier break costs more, and the same hours are paid either way', () => {
    const late = estimateDetailedShiftCost(base({ break_start: '22:00' }));
    const early = estimateDetailedShiftCost(base({ break_start: '18:00' }));
    expect(early.totalCost).toBeGreaterThan(late.totalCost);
    expect(early.ordinaryHours).toBe(late.ordinaryHours);
  });

  it('no break window prices exactly as before (break laid at the end)', () => {
    const legacy = estimateDetailedShiftCost(base({}));
    const atEnd = estimateDetailedShiftCost(base({ break_start: '22:00' }));
    expect(legacy.totalCost).toBe(atEnd.totalCost);
  });
});

describe('cl 41 day loadings follow a break across midnight', () => {
  // Sat 20:00 – Sun 04:30, 30m break, 8h worked.
  const overnight = (break_start?: string) => estimateDetailedShiftCost(base({
    shift_date: '2026-07-04', start_time: '20:00', end_time: '04:30', is_overnight: true,
    break_start,
  }));

  it('break at the end: 4h Saturday, 4h Sunday', () => {
    const r = overnight(undefined);
    expect(r.penaltyBreakdown?.satHours).toBe(4);
    expect(r.penaltyBreakdown?.sunHours).toBe(4);
  });

  it('break 23:45–00:15: 3.75h Saturday, 4.25h Sunday', () => {
    const r = overnight('23:45');
    expect(r.penaltyBreakdown?.satHours).toBe(3.75);
    expect(r.penaltyBreakdown?.sunHours).toBe(4.25);
  });

  it('break wholly after midnight (00:15) resolves to the next day, not before the start', () => {
    const r = overnight('00:15');
    // 20:00–00:15 worked = 4h Sat + 0.25h Sun, then 00:45–04:30 = 3.75h Sun.
    expect(r.penaltyBreakdown?.satHours).toBe(4);
    expect(r.penaltyBreakdown?.sunHours).toBe(4);
    expect(r.ordinaryHours + r.overtimeHours).toBe(8);
  });
});

describe('the shift adapter forwards the break window', () => {
  const shift = (break_start: string | null) => ({
    shift_date: '2026-08-06',
    start_time: '14:00:00',
    end_time: '22:30:00',
    break_start,
    break_end: null,
    net_length_minutes: 480,
    scheduled_length_minutes: 510,
    unpaid_break_minutes: 30,
    remuneration_level: 2,
    target_employment_type: 'Casual',
    roles: { name: 'Team Member' },
  });

  it('a card priced from a shift row sees the 18:00 break', () => {
    const r = estimateDetailedCostFromShift(shift('18:00:00') as never);
    expect(r.breakdown.nightHours).toBe(0.5);
  });

  it('and the 22:00 break', () => {
    const r = estimateDetailedCostFromShift(shift('22:00:00') as never);
    expect(r.breakdown.nightHours).toBe(0);
  });
});
