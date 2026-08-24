import { describe, it, expect } from 'vitest';
import { buildShiftCardPay } from '../shift-card-pay';
import { resolveRateSet } from '@/modules/rosters/domain/projections/utils/cost/rate-schedule';

/**
 * The shift from the reported bug: Theatre / Set-up / Team Member,
 * 05:30–16:30 with a 30m unpaid break (gross 11h, net 10h30m), Level 2,
 * CASUAL target. Tuesday 25 Aug 2026, so the FY2026/27 rate set applies.
 */
const L2_CASUAL_SHIFT = {
  id: 'shift-1',
  shift_date: '2026-08-25',
  start_time: '05:30',
  end_time: '16:30',
  unpaid_break_minutes: 30,
  paid_break_minutes: 30,
  net_length_minutes: 630,
  scheduled_length_minutes: 660,
  is_overnight: false,
  is_cancelled: false,
  remuneration_level: 2,
  remuneration_rate: null,
  target_employment_type: 'Casual',
  roles: { name: 'Team Member' },
};

describe('buildShiftCardPay', () => {
  it('prices off the shift\'s own level and employment target, not the engine default', () => {
    const { estimatedPay } = buildShiftCardPay(L2_CASUAL_SHIFT);

    const rates = resolveRateSet('2026-08-25');
    const l2Casual = rates.wageRates.LEVEL_2.casual;

    // Guard the premise: the default and the correct rate must differ, or this
    // test cannot detect the regression it exists for.
    expect(l2Casual).not.toBe(rates.defaultRate);

    // 10.5 ordinary hours at the L2 CASUAL rate is the floor of the estimate.
    // The old code priced every card at `defaultRate` ($33.70) with
    // `isCasual` false — $353.85 ordinary — which is below this.
    const ordinaryAtL2Casual = 10.5 * l2Casual;
    const total = Number(estimatedPay!.replace('$', ''));

    expect(total).toBeGreaterThanOrEqual(ordinaryAtL2Casual);
    expect(total).toBeGreaterThan(10.5 * rates.defaultRate);
  });

  it('reconciles: the breakdown lines sum to the headline figure', () => {
    const { estimatedPay, estimatedPayBreakdown } = buildShiftCardPay(L2_CASUAL_SHIFT);

    const headline = Number(estimatedPay!.replace('$', ''));
    const sum = estimatedPayBreakdown!.reduce((acc, l) => acc + l.amount, 0);

    // The old hand-rolled tooltip pushed BOTH `penaltyCost` (a legacy alias for
    // the night allowance) and `allowanceCost` (which already contains it), so
    // it over-summed by exactly the night allowance — $357.22 headline vs
    // $360.59 in the tooltip on the reported shift.
    expect(sum).toBeCloseTo(headline, 2);
  });

  it('does not bill the night allowance twice, nor label it a meal allowance', () => {
    const { estimatedPayBreakdown } = buildShiftCardPay(L2_CASUAL_SHIFT);
    const descriptions = estimatedPayBreakdown!.map(l => l.description);

    // 05:30–06:00 is 30 min of night-shift hours (cl 43), and there is no
    // overtime here so cl 28.1 cannot have produced a meal allowance.
    expect(descriptions.filter(d => /night/i.test(d))).toHaveLength(1);
    expect(descriptions.some(d => /meal/i.test(d))).toBe(false);
  });

  it('applies the casual loading as its own line', () => {
    const { estimatedPayBreakdown } = buildShiftCardPay(L2_CASUAL_SHIFT);
    expect(estimatedPayBreakdown!.some(l => /casual loading/i.test(l.description))).toBe(true);
  });

  it('prices a permanent target differently from a casual one', () => {
    const casual = buildShiftCardPay(L2_CASUAL_SHIFT).estimatedPay;
    const permanent = buildShiftCardPay({
      ...L2_CASUAL_SHIFT,
      target_employment_type: 'Full-Time',
    }).estimatedPay;

    // The whole point of `target_employment_type` being the pricing basis.
    expect(casual).not.toBe(permanent);
    expect(Number(casual!.replace('$', ''))).toBeGreaterThan(Number(permanent!.replace('$', '')));
  });

  it('returns empty props rather than a wrong number when there is no shift', () => {
    expect(buildShiftCardPay(null)).toEqual({});
    expect(buildShiftCardPay(undefined)).toEqual({});
  });
});
