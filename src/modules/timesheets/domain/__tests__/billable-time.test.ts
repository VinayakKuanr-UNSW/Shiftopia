import { describe, it, expect } from 'vitest';
import {
  snapToQuarterHour,
  resolveBillableSide,
  calculateNetMinutes,
  isShiftFinished,
} from '../billable-time';

describe('snapToQuarterHour', () => {
  it('rounds to the nearest 15-minute boundary, seconds participating', () => {
    expect(snapToQuarterHour('09:07:00')).toBe('09:00');
    expect(snapToQuarterHour('09:08:00')).toBe('09:15');
    expect(snapToQuarterHour('09:07:59')).toBe('09:15');
    expect(snapToQuarterHour('09:52:00')).toBe('09:45');
    expect(snapToQuarterHour('09:54:00')).toBe('10:00');
  });

  it('wraps the hour on overflow, including across midnight', () => {
    expect(snapToQuarterHour('23:54:00')).toBe('00:00');
  });

  it('returns null for falsy or unparseable input', () => {
    expect(snapToQuarterHour(null)).toBeNull();
    expect(snapToQuarterHour(undefined)).toBeNull();
    expect(snapToQuarterHour('not-a-time')).toBeNull();
  });
});

describe('resolveBillableSide', () => {
  it('prefers the manual (timesheet) value regardless of finished state', () => {
    expect(resolveBillableSide('09:00', null, false)).toEqual({ hhmm: '09:00', source: 'manual' });
    expect(resolveBillableSide('09:00', '2024-01-01T09:07:00Z', true)).toEqual({ hhmm: '09:00', source: 'manual' });
  });

  it('treats blank sentinels ("NIL", "-", "—") as no manual value', () => {
    expect(resolveBillableSide('NIL', null, true)).toEqual({ hhmm: null, source: 'missing' });
    expect(resolveBillableSide('-', null, false)).toEqual({ hhmm: null, source: null });
  });

  it('falls through to snapped actual only once the shift is finished', () => {
    expect(resolveBillableSide(null, '2024-01-01T09:07:00Z', false)).toEqual({ hhmm: null, source: null });
    const finished = resolveBillableSide(null, '09:07:00', true);
    expect(finished.source).toBe('snapped');
    expect(finished.hhmm).toBe('09:00');
  });

  // The core of the AUDIT FIX: a finished shift with no manual edit and no
  // actual clock time (forgot to clock out) must be a distinct 'missing'
  // state — NOT silently treated the same as "not finished yet".
  it('reports "missing" — not null — when finished with neither a manual nor an actual value', () => {
    expect(resolveBillableSide(null, null, true)).toEqual({ hhmm: null, source: 'missing' });
    expect(resolveBillableSide(undefined, undefined, true)).toEqual({ hhmm: null, source: 'missing' });
  });
});

describe('calculateNetMinutes', () => {
  it('returns null when either side is unresolved', () => {
    expect(calculateNetMinutes({ hhmm: null, source: 'missing' }, { hhmm: '17:00', source: 'manual' }, 0)).toBeNull();
    expect(calculateNetMinutes({ hhmm: '09:00', source: 'manual' }, { hhmm: null, source: null }, 0)).toBeNull();
  });

  it('computes a same-day span minus the unpaid break', () => {
    const start = { hhmm: '09:00', source: 'manual' as const };
    const end = { hhmm: '17:00', source: 'manual' as const };
    expect(calculateNetMinutes(start, end, 30)).toBe(450); // 8h − 30m
  });

  it('rolls +24h purely from the sign of the resolved times, no external flag needed', () => {
    const start = { hhmm: '22:00', source: 'manual' as const };
    const end = { hhmm: '06:00', source: 'manual' as const };
    expect(calculateNetMinutes(start, end, 0)).toBe(480); // 8h overnight
  });

  it('does NOT roll forward when the resolved span does not cross midnight, even if the shift was scheduled overnight', () => {
    // This is exactly the scenario that used to be broken via `row.is_overnight`
    // being OR'd into the rollover check in the payroll adapter: the resolved
    // (approved) times here are same-day, so no rollover should apply.
    const start = { hhmm: '22:00', source: 'manual' as const };
    const end = { hhmm: '23:30', source: 'manual' as const };
    expect(calculateNetMinutes(start, end, 0)).toBe(90);
  });

  it('never returns negative minutes', () => {
    const start = { hhmm: '09:00', source: 'manual' as const };
    const end = { hhmm: '09:10', source: 'manual' as const };
    expect(calculateNetMinutes(start, end, 60)).toBe(0);
  });
});

describe('isShiftFinished', () => {
  it('is finished whenever actual_end is present, regardless of scheduled end', () => {
    expect(isShiftFinished('2999-01-01', '09:00', '17:00', '2999-01-01T10:00:00Z')).toBe(true);
  });

  it('is finished once the scheduled end has passed even with no actual_end', () => {
    expect(isShiftFinished('2024-01-01', '09:00', '17:00', null)).toBe(true);
  });

  it('is NOT finished before the scheduled end with no actual_end', () => {
    expect(isShiftFinished('2999-01-01', '09:00', '17:00', null)).toBe(false);
  });
});
