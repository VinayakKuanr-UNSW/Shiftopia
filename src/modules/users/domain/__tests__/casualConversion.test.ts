import { describe, it, expect } from 'vitest';
import { getCasualConversionStatus } from '../casualConversion';

describe('getCasualConversionStatus (Fair Work Act s15A / cl 12.5(g))', () => {
  const asOf = new Date('2026-07-28T00:00:00');

  it('is not eligible before 6 months on an Active casual contract', () => {
    const status = getCasualConversionStatus(
      { employmentStatus: 'Casual', contractStatus: 'Active', startDate: '2026-03-01' },
      asOf,
    );
    expect(status.isCasual).toBe(true);
    expect(status.eligible).toBe(false);
  });

  it('becomes eligible exactly at the 6-month mark', () => {
    const status = getCasualConversionStatus(
      { employmentStatus: 'Casual', contractStatus: 'Active', startDate: '2026-01-28' },
      asOf,
    );
    expect(status.eligible).toBe(true);
    // Compare local date parts, not toISOString() (which is UTC and would
    // be timezone-flaky around local midnight on this system's machine TZ).
    expect(status.eligibleFrom?.getFullYear()).toBe(2026);
    expect(status.eligibleFrom?.getMonth()).toBe(6); // 0-indexed: July
    expect(status.eligibleFrom?.getDate()).toBe(28);
  });

  it('is not eligible the day before the 6-month mark', () => {
    const status = getCasualConversionStatus(
      { employmentStatus: 'Casual', contractStatus: 'Active', startDate: '2026-01-29' },
      asOf,
    );
    expect(status.eligible).toBe(false);
  });

  it('never eligible for a Full-Time contract', () => {
    const status = getCasualConversionStatus(
      { employmentStatus: 'Full-Time', contractStatus: 'Active', startDate: '2020-01-01' },
      asOf,
    );
    expect(status.isCasual).toBe(false);
    expect(status.eligible).toBe(false);
  });

  it('never eligible for an inactive (ended) casual contract', () => {
    const status = getCasualConversionStatus(
      { employmentStatus: 'Casual', contractStatus: 'Ended', startDate: '2020-01-01' },
      asOf,
    );
    expect(status.isCasual).toBe(false);
    expect(status.eligible).toBe(false);
  });

  it('handles a missing start_date without throwing', () => {
    const status = getCasualConversionStatus(
      { employmentStatus: 'Casual', contractStatus: 'Active', startDate: null },
      asOf,
    );
    expect(status.eligible).toBe(false);
    expect(status.eligibleFrom).toBeNull();
  });
});
