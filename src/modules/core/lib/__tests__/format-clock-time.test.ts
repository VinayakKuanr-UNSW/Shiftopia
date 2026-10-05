import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { formatClockTime } from '@/modules/core/lib/date.utils';

// Prove the conversion from a viewer OUTSIDE Sydney — in Sydney a browser-local
// read is accidentally right and proves nothing.
const tz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'UTC'; });
afterAll(() => { process.env.TZ = tz; });

describe('formatClockTime', () => {
  it('renders a timestamptz punch in Sydney, not UTC and not browser-local', () => {
    // The exact prod row: shown as 00:25 on the Rosters drill-down, 10:25 AM on
    // My Attendance. 10:25 AM is correct — AEST is UTC+10.
    expect(formatClockTime('2026-08-20T00:25:05.674742+00:00')).toBe('10:25 AM');
  });

  it('accepts the space-separated form Postgres also emits', () => {
    expect(formatClockTime('2026-08-20 00:25:05.674742+00')).toBe('10:25 AM');
  });

  it('leaves a naive wall-clock string alone — it is already Sydney', () => {
    // Converting "05:30" would move an authored roster time by the offset.
    expect(formatClockTime('05:30:00')).toBe('5:30 AM');
    expect(formatClockTime('16:30')).toBe('4:30 PM');
  });

  it('passes an already-formatted value straight through', () => {
    expect(formatClockTime('10:25 AM')).toBe('10:25 AM');
  });

  it('returns the fallback for empty, dash and unparseable input', () => {
    expect(formatClockTime(null)).toBeNull();
    expect(formatClockTime('-')).toBeNull();
    expect(formatClockTime('nonsense', 'h:mm a', '—')).toBe('—');
  });
});
