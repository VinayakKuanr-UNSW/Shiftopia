import { describe, it, expect } from 'vitest';
import { getSwsTrialStatus } from '../swsTrial';

describe('getSwsTrialStatus (Schedule 6 §1.10, audit M-3)', () => {
  const asOf = new Date('2026-07-28T00:00:00');

  it('is not overrun within the first 12 weeks', () => {
    const status = getSwsTrialStatus(
      { isSws: true, isSwsTrial: true, swsTrialStartDate: '2026-06-01' },
      asOf,
    );
    expect(status.onTrial).toBe(true);
    expect(status.overrun).toBe(false);
  });

  it('is overrun once 12 weeks have elapsed', () => {
    const status = getSwsTrialStatus(
      { isSws: true, isSwsTrial: true, swsTrialStartDate: '2026-04-01' }, // ~17 weeks before asOf
      asOf,
    );
    expect(status.overrun).toBe(true);
    expect(status.weeksElapsed).toBeGreaterThanOrEqual(12);
  });

  it('is overrun exactly at the 12-week mark', () => {
    const start = new Date('2026-07-28T00:00:00');
    start.setDate(start.getDate() - 12 * 7);
    const startStr = start.toISOString().slice(0, 10);
    const status = getSwsTrialStatus({ isSws: true, isSwsTrial: true, swsTrialStartDate: startStr }, asOf);
    expect(status.overrun).toBe(true);
  });

  it('is not "on trial" when is_sws_trial is false, even if is_sws is true', () => {
    const status = getSwsTrialStatus(
      { isSws: true, isSwsTrial: false, swsTrialStartDate: '2026-01-01' },
      asOf,
    );
    expect(status.onTrial).toBe(false);
    expect(status.overrun).toBe(false);
  });

  it('is not "on trial" when is_sws is false', () => {
    const status = getSwsTrialStatus(
      { isSws: false, isSwsTrial: true, swsTrialStartDate: '2026-01-01' },
      asOf,
    );
    expect(status.onTrial).toBe(false);
  });

  it('handles a missing start date without throwing (never flags overrun)', () => {
    const status = getSwsTrialStatus({ isSws: true, isSwsTrial: true, swsTrialStartDate: null }, asOf);
    expect(status.onTrial).toBe(true);
    expect(status.overrun).toBe(false);
    expect(status.capReachedOn).toBeNull();
  });
});
