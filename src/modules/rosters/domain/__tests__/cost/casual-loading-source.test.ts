import { describe, expect, it } from 'vitest';
import { estimateDetailedCostFromShift } from '@/modules/rosters/domain/projections/utils/cost';
import { resolveRateSet } from '@/modules/rosters/domain/projections/utils/cost/rate-schedule';

/**
 * Casual loading has to follow the SHIFT, not the person.
 *
 * Found in prod 2026-08-20: an employee holding one Full-Time Security L7
 * contract alongside four Casual ones has `profiles.employment_type =
 * 'Full-Time'`. Their Casual Team Leader shift — `target_employment_type =
 * 'Casual'`, Level 4 — was priced at the permanent rate because three UI
 * callers fed the engine the profile scalar instead of the shift's own basis.
 *
 * The engine was never wrong. Its inputs were.
 */

const CASUAL_TEAM_LEADER = {
  shift_date: '2026-08-20',
  start_time: '05:30',
  end_time: '16:30',
  unpaid_break_minutes: 30,
  remuneration_level: 4,
  roles: { name: 'Team Leader' },
  is_training: false,
};

describe('casual loading is priced off the shift, not the profile', () => {
  it('charges the loaded casual rate for a Casual-target shift', () => {
    const rates = resolveRateSet(CASUAL_TEAM_LEADER.shift_date).wageRates;
    // The two rates must actually differ, or this test proves nothing.
    expect(rates.LEVEL_4.casual).toBeGreaterThan(rates.LEVEL_4.permanent);

    const casual = estimateDetailedCostFromShift({
      ...CASUAL_TEAM_LEADER,
      employmentType: 'Casual',
    } as never);
    const permanent = estimateDetailedCostFromShift({
      ...CASUAL_TEAM_LEADER,
      employmentType: 'Full-Time',
    } as never);

    expect(casual.breakdown.isCasual).toBe(true);
    expect(permanent.breakdown.isCasual).toBe(false);

    // 25% loading — the whole point.
    expect(casual.breakdown.baseRate).toBeCloseTo(rates.LEVEL_4.casual, 2);
    expect(permanent.breakdown.baseRate).toBeCloseTo(rates.LEVEL_4.permanent, 2);
    expect(casual.totalCost).toBeGreaterThan(permanent.totalCost);
  });

  it('reads the basis off target_employment_type when a shift row is passed whole', () => {
    // How every caller now supplies it: spread the row, and the engine's own
    // `resolveEmploymentType` picks `target_employment_type` up.
    const priced = estimateDetailedCostFromShift({
      ...CASUAL_TEAM_LEADER,
      target_employment_type: 'Casual',
    } as never);

    expect(priced.breakdown.isCasual).toBe(true);
  });

  it('does not invent a loading when the basis is genuinely unknown', () => {
    // The old default was 'Casual', which priced 156 of 156 prod shifts at the
    // loaded rate on nothing but an absent field. Unknown must mean permanent.
    const priced = estimateDetailedCostFromShift({ ...CASUAL_TEAM_LEADER } as never);

    expect(priced.breakdown.isCasual).toBe(false);
  });
});
