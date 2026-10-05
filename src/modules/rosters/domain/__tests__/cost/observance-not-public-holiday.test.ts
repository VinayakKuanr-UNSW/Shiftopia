import { describe, it, expect } from 'vitest';
import { estimateDetailedShiftCost } from '../../projections/utils/cost/standard';
import { estimateDetailedShiftCost as estimateDetailedSecurityShiftCost } from '../../projections/utils/cost/security';
import { buildAwardContext, getDateFacts } from '../../projections/utils/cost/award-context';
import type { CostCalculatorOptions } from '../../projections/utils/cost/types';

/**
 * Mother's Day, Father's Day and the NSW August Bank Holiday are NOT public
 * holidays and attract no public-holiday penalty.
 *
 * The cost engine used to ask the raw `date-holidays` instance
 * (`hd.isHoliday(date)`), which is truthy for its `observance` and `bank` rows
 * as well as `public` ones — so all three days were priced at public-holiday
 * rates, every year, across the standard engine, the security engine, gross pay
 * and leave gross pay. Every caller now goes through `isPublicHolidayISO`,
 * which is public-only.
 *
 * Each case pairs the day against the SAME weekday a week later, so Saturday /
 * Sunday penalties cancel out and only the public-holiday treatment is left.
 */

const base = (o: Partial<CostCalculatorOptions>): CostCalculatorOptions => ({
  netMinutes: 480,
  start_time: '09:00',
  end_time: '17:00',
  rate: 30,
  scheduled_length_minutes: 480,
  is_overnight: false,
  is_cancelled: false,
  shift_date: '2026-06-29',
  employmentType: 'Full-Time',
  ...o,
});

/** [label, the observance/bank day, an ordinary control day on the same weekday] */
const CASES: Array<[string, string, string]> = [
  ["Mother's Day",              '2026-05-10', '2026-05-17'], // both Sunday
  ['NSW August Bank Holiday',   '2026-08-03', '2026-08-10'], // both Monday
  ["Father's Day",              '2026-09-06', '2026-09-13'], // both Sunday
];

describe.each(CASES)('%s is not a public holiday', (label, day, control) => {
  it('carries no public-holiday hours in the standard engine', () => {
    const onDay = estimateDetailedShiftCost(base({ shift_date: day }));
    const onControl = estimateDetailedShiftCost(base({ shift_date: control }));

    // Assert the field exists before reading it — `?.phHours ?? 0` would pass
    // vacuously if the engine ever stopped populating the breakdown.
    expect(onDay.penaltyBreakdown).toBeDefined();
    expect(onDay.penaltyBreakdown!.phHours).toBe(0);
    expect(onDay.penaltyBreakdown!.phCost).toBe(0);
    expect(onDay.totalCost).toBeCloseTo(onControl.totalCost, 6);
  });

  it('carries no public-holiday hours in the security engine', () => {
    const onDay = estimateDetailedSecurityShiftCost(base({ shift_date: day }));
    const onControl = estimateDetailedSecurityShiftCost(base({ shift_date: control }));

    expect(onDay.totalCost).toBeCloseTo(onControl.totalCost, 6);
  });

  it('is flagged as an ordinary day by the pre-baked award context', () => {
    const ctx = buildAwardContext([day, control]);
    expect(getDateFacts(ctx, day).isPublicHoliday).toBe(false);
    expect(getDateFacts(ctx, control).isPublicHoliday).toBe(false);
  });
});

describe('real public holidays are still priced as such', () => {
  // The guard against "fixed it by making everything false".
  it('Anzac Day and its NSW substitute day both carry the penalty', () => {
    const ctx = buildAwardContext(['2026-04-25', '2026-04-27', '2026-04-20']);
    expect(getDateFacts(ctx, '2026-04-25').isPublicHoliday).toBe(true); // Anzac Day (Sat)
    expect(getDateFacts(ctx, '2026-04-27').isPublicHoliday).toBe(true); // NSW substitute (Mon)
    expect(getDateFacts(ctx, '2026-04-20').isPublicHoliday).toBe(false); // ordinary Monday

    const holiday = estimateDetailedShiftCost(base({ shift_date: '2026-04-27' }));
    const ordinary = estimateDetailedShiftCost(base({ shift_date: '2026-04-20' }));
    expect(holiday.totalCost).toBeGreaterThan(ordinary.totalCost);
  });
});
