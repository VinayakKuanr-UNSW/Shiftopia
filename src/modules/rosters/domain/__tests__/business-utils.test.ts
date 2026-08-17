import { describe, expect, it } from 'vitest';

import {
  minutesToTime,
  resolveAvailabilityBatch,
  resolveAvailabilityForDay,
  timeToMinutes,
  toEmployeeAvailability,
} from '../availabilityResolution';
import type { RawAvailability } from '../availabilityResolution.types';
import {
  calculateFatigueAccumulation,
  calculateFatigueWithRecovery,
  calculateShiftHours,
} from '../projections/utils/fatigue';
import {
  calculateGroupInequality,
  calculateUtilization,
  getUtilizationStatus,
} from '../projections/utils/fairness';
import {
  canDeleteShift,
  canEditShift,
} from '../policies/canEditShift.policy';

const availabilityRule = (
  overrides: Partial<RawAvailability> = {},
): RawAvailability => ({
  id: 'availability-1',
  profile_id: 'employee-1',
  start_date: '2026-08-01',
  end_date: '2026-08-31',
  start_time: '09:00:00',
  end_time: '17:00:00',
  availability_type: 'available',
  is_recurring: false,
  recurrence_rule: null,
  reason: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

describe('availability resolution', () => {
  it('converts between display times and timeline minutes', () => {
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('17:00:00')).toBe(1020);
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(1440)).toBe('24:00');
  });

  it('returns an explicit no-data result when no rule applies', () => {
    expect(resolveAvailabilityForDay(
      'employee-1',
      new Date('2026-09-01T00:00:00'),
      [availabilityRule()],
    )).toEqual({
      profileId: 'employee-1',
      date: '2026-09-01',
      segments: [],
      isFullyAvailable: false,
      isFullyUnavailable: false,
      hasData: false,
    });
  });

  it('recognises full-day availability and midnight as end of day', () => {
    const resolved = resolveAvailabilityForDay(
      'employee-1',
      new Date('2026-08-03T00:00:00'),
      [availabilityRule({
        start_time: null,
        end_time: '00:00:00',
      })],
    );

    expect(resolved.segments).toEqual([{
      startTime: '00:00',
      endTime: '24:00',
      type: 'available',
      reason: undefined,
    }]);
    expect(resolved.isFullyAvailable).toBe(true);
    expect(resolved.isFullyUnavailable).toBe(false);
  });

  it('splits overlaps using priority and merges adjacent winning segments', () => {
    const resolved = resolveAvailabilityForDay(
      'employee-1',
      new Date('2026-08-03T00:00:00'),
      [
        availabilityRule(),
        availabilityRule({
          id: 'availability-2',
          start_time: '12:00:00',
          end_time: '13:00:00',
          availability_type: 'unavailable',
          reason: 'medical appointment',
        }),
      ],
    );

    expect(resolved.segments).toEqual([
      {
        startTime: '09:00',
        endTime: '12:00',
        type: 'available',
        reason: undefined,
      },
      {
        startTime: '12:00',
        endTime: '13:00',
        type: 'unavailable',
        reason: 'medical appointment',
      },
      {
        startTime: '13:00',
        endTime: '17:00',
        type: 'available',
        reason: undefined,
      },
    ]);
  });

  it('uses the latest rule when priorities tie', () => {
    const resolved = resolveAvailabilityForDay(
      'employee-1',
      new Date('2026-08-03T00:00:00'),
      [
        availabilityRule({ reason: 'old' }),
        availabilityRule({
          id: 'availability-new',
          reason: 'latest',
          created_at: '2026-08-02T00:00:00.000Z',
        }),
      ],
    );

    expect(resolved.segments).toEqual([{
      startTime: '09:00',
      endTime: '17:00',
      type: 'available',
      reason: 'latest',
    }]);
  });

  it('expands weekly recurrence and resolves profile/date batches', () => {
    const recurring = availabilityRule({
      is_recurring: true,
      recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,WE',
    });
    const batch = resolveAvailabilityBatch(
      ['employee-1', 'employee-2'],
      new Date('2026-08-03T00:00:00'),
      new Date('2026-08-04T00:00:00'),
      [recurring],
    );

    expect(batch.get('employee-1')?.get('2026-08-03')?.hasData).toBe(true);
    expect(batch.get('employee-1')?.get('2026-08-04')?.hasData).toBe(false);
    expect(batch.get('employee-2')?.get('2026-08-03')?.hasData).toBe(false);
  });

  it('adapts resolved segments into available and unavailable windows', () => {
    const adapted = toEmployeeAvailability({
      profileId: 'employee-1',
      date: '2026-08-03',
      segments: [
        {
          startTime: '09:00',
          endTime: '12:00',
          type: 'preferred',
        },
        {
          startTime: '12:00',
          endTime: '13:00',
          type: 'limited',
        },
      ],
      isFullyAvailable: false,
      isFullyUnavailable: false,
      hasData: true,
    });

    expect(adapted.availableWindows).toEqual([
      { start: '09:00', end: '12:00' },
    ]);
    expect(adapted.unavailableWindows).toEqual([
      { start: '12:00', end: '13:00' },
    ]);
  });
});

describe('fatigue and fairness calculations', () => {
  it('calculates net shift hours for normal and overnight shifts', () => {
    expect(calculateShiftHours()).toBe(0);
    expect(calculateShiftHours('09:00', '17:00', 30)).toBe(7.5);
    expect(calculateShiftHours('22:00', '06:00', 60)).toBe(7);
  });

  it('weights overnight work more heavily than daytime work', () => {
    const daytime = calculateFatigueAccumulation({
      start_time: '10:00',
      end_time: '16:00',
    });
    const overnight = calculateFatigueAccumulation({
      start_time: '00:00',
      end_time: '06:00',
    });

    expect(daytime).toBeGreaterThan(0);
    expect(overnight).toBeGreaterThan(daytime);
    expect(calculateFatigueAccumulation({
      start_time: '00:00',
      end_time: '00:00',
    })).toBeGreaterThan(overnight);
  });

  it('filters the seven-day window, applies recovery and projects a candidate', () => {
    const result = calculateFatigueWithRecovery([
      {
        shift_date: '2026-07-20',
        start_time: '09:00',
        end_time: '17:00',
        unpaid_break_minutes: 30,
      },
      {
        shift_date: '2026-08-01',
        start_time: '09:00',
        end_time: '17:00',
        unpaid_break_minutes: 30,
      },
      {
        shift_date: '2026-08-02',
        start_time: '09:00',
        end_time: '17:00',
        unpaid_break_minutes: 30,
      },
    ], '2026-08-03', {
      start_time: '22:00',
      end_time: '06:00',
      unpaid_break_minutes: 0,
    });

    // The 2026-07-20 shift is outside the 7-day window and must not contribute.
    const withoutStaleShift = calculateFatigueWithRecovery([
      { shift_date: '2026-08-01', start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 30 },
      { shift_date: '2026-08-02', start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 30 },
    ], '2026-08-03', {
      start_time: '22:00',
      end_time: '06:00',
      unpaid_break_minutes: 0,
    });
    expect(result).toEqual(withoutStaleShift);

    // `peak` is the reading at the end of the last shift, before any rest.
    expect(result.peak).toBeGreaterThan(0);

    // `current` is measured at the reference instant, so it decays with rest.
    // The last shift ends 2026-08-02 17:00 and the window closes at the end of
    // 2026-08-03 — 31 hours later — which at RECOVERY_UNITS_PER_HOUR (a full
    // OK-band recovery per 11h minimum break) is well past full recovery.
    //
    // The mobile branch asserted `current > 0` here. That encodes the bug fixed
    // in audit F-03: recovery used to be applied only *between* shifts and never
    // from the last shift to the reference instant, which made `current` a
    // duplicate of `peak` and turned decay into a step function. Asserting it
    // again would re-pin the defect.
    expect(result.current).toBeLessThan(result.peak);
    expect(result.current).toBe(0);

    // The candidate is projected from the pre-decay state, so it still adds load.
    expect(result.projected).toBeGreaterThan(result.current);
  });

  it('calculates utilization, inequality and status boundaries', () => {
    expect(calculateUtilization(20, 40)).toBe(50);
    expect(calculateUtilization(20, 0)).toBe(0);
    expect(calculateGroupInequality([])).toBe(0);
    expect(calculateGroupInequality([
      {
        employeeId: 'a',
        contractedHours: 40,
        scheduledHours: 40,
      },
      {
        employeeId: 'b',
        contractedHours: 20,
        scheduledHours: 10,
      },
    ])).toBe(25);
    expect(getUtilizationStatus(79)).toBe('under');
    expect(getUtilizationStatus(80)).toBe('ideal');
    expect(getUtilizationStatus(105)).toBe('ideal');
    expect(getUtilizationStatus(106)).toBe('over');
    expect(getUtilizationStatus(120)).toBe('over');
    expect(getUtilizationStatus(121)).toBe('critical');
  });
});

describe('shift editing policies', () => {
  it('locks published rosters and published shifts', () => {
    expect(canEditShift({
      shiftId: 'shift-1',
      isDraft: true,
      status: 'draft',
      rosterStatus: 'published',
    })).toMatchObject({ canEdit: false });
    expect(canEditShift({
      shiftId: 'shift-1',
      isDraft: false,
      status: 'published',
      rosterStatus: 'draft',
    })).toMatchObject({ canEdit: false });
  });

  it('allows draft edits and enforces the corresponding delete rules', () => {
    const draft = {
      shiftId: 'shift-1',
      isDraft: true,
      status: 'draft',
      rosterStatus: 'draft' as const,
    };

    expect(canEditShift(draft)).toEqual({ canEdit: true });
    expect(canDeleteShift(draft)).toEqual({ canEdit: true });
    expect(canDeleteShift({
      ...draft,
      rosterStatus: 'published',
    })).toMatchObject({ canEdit: false });
    expect(canDeleteShift({
      ...draft,
      isDraft: false,
      status: 'published',
    })).toMatchObject({ canEdit: false });
  });
});
