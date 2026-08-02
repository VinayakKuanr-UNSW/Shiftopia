import { describe, it, expect } from 'vitest';
import {
  snapToQuarterHour,
  resolveBillableSide,
  calculateNetMinutes,
  isShiftFinished,
  applyMinEngagementFloor,
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

describe('applyMinEngagementFloor', () => {
  it('tops up a standard weekday shift below the 3h floor', () => {
    const result = applyMinEngagementFloor(75, {}); // 1h15
    expect(result).toEqual({ netMinutes: 180, requiredMins: 180, wasToppedUp: true });
  });

  it('leaves a shift at/above the floor untouched', () => {
    expect(applyMinEngagementFloor(180, {})).toEqual({ netMinutes: 180, requiredMins: 180, wasToppedUp: false });
    expect(applyMinEngagementFloor(240, {})).toEqual({ netMinutes: 240, requiredMins: 180, wasToppedUp: false });
  });

  it('applies the 4h Sunday/PH floor', () => {
    expect(applyMinEngagementFloor(100, { isSunday: true })).toEqual({ netMinutes: 240, requiredMins: 240, wasToppedUp: true });
    expect(applyMinEngagementFloor(100, { isPublicHoliday: true })).toEqual({ netMinutes: 240, requiredMins: 240, wasToppedUp: true });
  });

  it('applies the 2h training floor, winning over the Sunday/PH uplift', () => {
    const result = applyMinEngagementFloor(60, { isTraining: true, isSunday: true });
    expect(result).toEqual({ netMinutes: 120, requiredMins: 120, wasToppedUp: true });
  });

  // The function itself has no no-show/cancelled concept — a genuine no-show
  // (no manual override, no actual clock) never resolves a billable window in
  // the first place, so callers never invoke this function for it at all
  // (they gate on calculateNetMinutes returning null upstream, not on
  // attendance_status/lifecycle_status here). A manual billable override on a
  // shift STILL flagged no-show/cancelled must still get the floor:
  it('floors a resolved window even when the shift carries a no-show/cancelled flag elsewhere', () => {
    // e.g. attendance_status='no_show' but a manager entered a manual 7:15-9:45
    // override anyway — that resolved 2h30m window must still hit the 3h floor.
    expect(applyMinEngagementFloor(150, {})).toEqual({ netMinutes: 180, requiredMins: 180, wasToppedUp: true });
  });

  // F-locked 2026-07-28: shares resolvePaymentMinEngagementMinutes() with the
  // cost engines (standard.ts/security.ts) — Full-Time is exempt entirely,
  // and Plain Part-Time doesn't get the Sunday/PH exception.
  it('Full-Time gets no floor at all — a short shift stays as clocked', () => {
    const result = applyMinEngagementFloor(60, { employmentType: 'Full-Time', isSunday: true });
    expect(result).toEqual({ netMinutes: 60, requiredMins: 0, wasToppedUp: false });
  });

  it('plain Part-Time on a Sunday floors at 3h, not 4h (no Sunday exception)', () => {
    const result = applyMinEngagementFloor(100, { employmentType: 'Part-Time', isSunday: true });
    expect(result).toEqual({ netMinutes: 180, requiredMins: 180, wasToppedUp: true });
  });

  it('Casual on a Sunday floors at 4h', () => {
    const result = applyMinEngagementFloor(100, { employmentType: 'Casual', isSunday: true });
    expect(result).toEqual({ netMinutes: 240, requiredMins: 240, wasToppedUp: true });
  });

  it('Security role uses the Schedule 3 tiers (Part-Time has no Sunday exception either)', () => {
    const result = applyMinEngagementFloor(100, { employmentType: 'Part-Time', isSecurityRole: true, isSunday: true });
    expect(result).toEqual({ netMinutes: 180, requiredMins: 180, wasToppedUp: true });
  });

  it('is duration-based off whatever net was already resolved, not re-anchored to any clock time', () => {
    // A late clock-in (billable start already accounts for this upstream) —
    // the floor only ever compares the resolved duration, never a clock time.
    const result = applyMinEngagementFloor(45, {}); // e.g. 2:15pm-3:00pm, late start
    expect(result.netMinutes).toBe(180);
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
