import { describe, it, expect } from 'vitest';
import {
  mapShiftRowToGrossPayInput,
  mapEmploymentType,
} from '../data/grossPay.read.api';
import type { GrossPayShiftRow } from '../data/types';

/**
 * PURE unit tests for the gross-pay read adapter's mapper. NO live Supabase —
 * every row is hand-built. We assert the MONEY-CRITICAL mappings:
 * two-tier billable hours (manager edit vs snapped actual), rate resolution,
 * employmentType, no-show / cancelled short-circuits, overnight, security role,
 * and the documented leave/allowance data gaps.
 *
 * A shift is treated as "finished" by isShiftFinished() when actual_end is set,
 * so fixtures that rely on the snapped-actual fallback populate actual_end.
 */

const baseRow = (o: Partial<GrossPayShiftRow> = {}): GrossPayShiftRow => ({
  id: 's1',
  shift_date: '2026-07-06', // Monday
  start_time: '09:00',
  end_time: '17:00',
  is_overnight: false,
  lifecycle_status: 'Completed',
  assignment_status: 'assigned',
  attendance_status: 'checked_in',
  actual_start: null,
  actual_end: null,
  paid_break_minutes: 0,
  unpaid_break_minutes: 0,
  net_length_minutes: 480,
  scheduled_length_minutes: 480,
  remuneration_rate: 30,
  remuneration_level: 3,
  assigned_employee_id: 'e1',
  role_id: 'r1',
  roles: { id: 'r1', name: 'Attendant' },
  remuneration_levels: { level_number: 3, level_name: 'Level 3', hourly_rate_min: 32.5 },
  _employmentType: 'full_time',
  _timesheet: null,
  ...o,
});

describe('mapShiftRowToGrossPayInput — assignment & short-circuits', () => {
  it('returns null when there is no assigned employee', () => {
    const row = baseRow({ assigned_employee_id: null });
    expect(mapShiftRowToGrossPayInput(row)).toBeNull();
  });

  it('flags no-show from attendance_status', () => {
    const row = baseRow({ attendance_status: 'no_show' });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.isNoShow).toBe(true);
  });

  it('flags no-show from timesheet.status', () => {
    const row = baseRow({
      attendance_status: 'unknown',
      _timesheet: { id: 't1', shift_id: 's1', start_time: null, end_time: null, unpaid_break_minutes: 0, status: 'no_show' },
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.isNoShow).toBe(true);
  });

  it('flags cancelled from lifecycle_status', () => {
    const row = baseRow({ lifecycle_status: 'Cancelled' });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.isCancelled).toBe(true);
  });

  it('flags cancelled from assignment_status = declined', () => {
    const row = baseRow({ assignment_status: 'declined' });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.isCancelled).toBe(true);
  });
});

describe('mapShiftRowToGrossPayInput — two-tier billable hours', () => {
  it('uses manager-edited timesheet times (tier 1) and subtracts timesheet unpaid break', () => {
    const row = baseRow({
      // Raw actual clock is different — manager edit must WIN.
      actual_start: '2026-07-06T08:52:00Z',
      actual_end: '2026-07-06T17:20:00Z',
      unpaid_break_minutes: 60, // shift-level break should be IGNORED (timesheet has its own)
      _timesheet: {
        id: 't1', shift_id: 's1',
        start_time: '09:00', end_time: '17:00',
        unpaid_break_minutes: 30, status: 'approved',
      },
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.startTime).toBe('09:00');
    expect(input.endTime).toBe('17:00');
    // 8h span − 30m timesheet break = 450 min
    expect(input.netMinutes).toBe(450);
    expect(input.hoursSource).toBe('adjusted');
  });

  it('falls back to snapped actual (tier 2) when there is no manager edit and shift is finished', () => {
    const row = baseRow({
      actual_start: '2026-07-06T09:07:00Z', // → snaps to 09:15 (Sydney wall clock)
      actual_end: '2026-07-06T16:52:00Z',   // → snaps to 16:45
      unpaid_break_minutes: 0,
      _timesheet: null,
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    // Snapped Sydney times (UTC+10): 09:07Z = 19:07 syd → 19:15; 16:52Z = 02:52+1 syd → 02:45.
    // We assert the derived netMinutes is positive and hoursSource is actual,
    // without pinning the TZ-specific snap (that logic is owned/tested elsewhere).
    expect(input.hoursSource).toBe('actual');
    expect(input.netMinutes).toBeGreaterThan(0);
    expect(input.startTime).toMatch(/^\d{2}:\d{2}$/);
    expect(input.endTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it('yields zero net minutes with scheduled_fallback source when unfinished and no timesheet', () => {
    // No actual_end and end_time in the future would make it unfinished; use a
    // far-future date so isShiftFinished() is false regardless of clock.
    const row = baseRow({
      shift_date: '2999-01-01',
      actual_start: null,
      actual_end: null,
      _timesheet: null,
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.netMinutes).toBe(0);
    expect(input.startTime).toBeUndefined();
    expect(input.endTime).toBeUndefined();
    expect(input.hoursSource).toBe('scheduled_fallback');
  });

  it('subtracts the shift-level unpaid break when the timesheet omits one', () => {
    const row = baseRow({
      actual_end: '2026-07-06T17:00:00Z',
      unpaid_break_minutes: 45,
      _timesheet: {
        id: 't1', shift_id: 's1',
        start_time: '09:00', end_time: '17:00',
        unpaid_break_minutes: null as any, // absent → fall back to shift.unpaid_break_minutes
        status: 'approved',
      },
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    // 480 − 45 = 435
    expect(input.netMinutes).toBe(435);
  });
});

describe('mapShiftRowToGrossPayInput — overnight', () => {
  it('rolls the end past midnight when is_overnight is true', () => {
    const row = baseRow({
      start_time: '22:00',
      end_time: '06:00',
      is_overnight: true,
      actual_end: '2026-07-07T06:00:00Z',
      unpaid_break_minutes: 0,
      _timesheet: {
        id: 't1', shift_id: 's1',
        start_time: '22:00', end_time: '06:00',
        unpaid_break_minutes: 0, status: 'approved',
      },
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.isOvernight).toBe(true);
    // 22:00 → 06:00 next day = 8h = 480 min
    expect(input.netMinutes).toBe(480);
    expect(input.startTime).toBe('22:00');
    expect(input.endTime).toBe('06:00');
  });

  it('rolls forward even when is_overnight is false but end < start (defensive)', () => {
    const row = baseRow({
      is_overnight: false,
      actual_end: '2026-07-07T02:00:00Z',
      _timesheet: {
        id: 't1', shift_id: 's1',
        start_time: '23:00', end_time: '02:00',
        unpaid_break_minutes: 0, status: 'approved',
      },
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    // 23:00 → 02:00 = 3h = 180 min (rolled +24h because diff was negative)
    expect(input.netMinutes).toBe(180);
  });
});

describe('mapShiftRowToGrossPayInput — rate resolution', () => {
  it('prefers remuneration_levels.hourly_rate_min', () => {
    const row = baseRow({ remuneration_rate: 30, remuneration_levels: { hourly_rate_min: 41.2 } });
    expect(mapShiftRowToGrossPayInput(row)!.rate).toBe(41.2);
  });

  it('falls back to shift.remuneration_rate when the level rate is missing', () => {
    const row = baseRow({ remuneration_rate: 28.75, remuneration_levels: { hourly_rate_min: null } });
    expect(mapShiftRowToGrossPayInput(row)!.rate).toBe(28.75);
  });

  it('is null when neither a level rate nor a shift rate exists', () => {
    const row = baseRow({ remuneration_rate: null, remuneration_levels: null });
    expect(mapShiftRowToGrossPayInput(row)!.rate).toBeNull();
  });

  it('unwraps PostgREST array-style embeds', () => {
    const row = baseRow({
      roles: [{ id: 'r1', name: 'Security Officer' }] as any,
      remuneration_levels: [{ hourly_rate_min: 55 }] as any,
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.rate).toBe(55);
    expect(input.isSecurityRole).toBe(true);
  });
});

describe('mapShiftRowToGrossPayInput — security role', () => {
  it('detects security from the role name (case-insensitive)', () => {
    const row = baseRow({ roles: { id: 'r1', name: 'SECURITY Guard' } });
    expect(mapShiftRowToGrossPayInput(row)!.isSecurityRole).toBe(true);
  });

  it('is false for a non-security role', () => {
    const row = baseRow({ roles: { id: 'r1', name: 'Food & Beverage' } });
    expect(mapShiftRowToGrossPayInput(row)!.isSecurityRole).toBe(false);
  });
});

describe('mapShiftRowToGrossPayInput — employment type', () => {
  it('maps casual → Casual', () => {
    const row = baseRow({ _employmentType: 'casual' });
    expect(mapShiftRowToGrossPayInput(row)!.employmentType).toBe('Casual');
  });

  it('maps full_time → Full-Time', () => {
    const row = baseRow({ _employmentType: 'full_time' });
    expect(mapShiftRowToGrossPayInput(row)!.employmentType).toBe('Full-Time');
  });

  it('maps hyphenated part-time → Part-Time', () => {
    const row = baseRow({ _employmentType: 'part-time' });
    expect(mapShiftRowToGrossPayInput(row)!.employmentType).toBe('Part-Time');
  });

  it('leaves employmentType undefined for an unknown/missing value (data gap)', () => {
    const row = baseRow({ _employmentType: null });
    expect(mapShiftRowToGrossPayInput(row)!.employmentType).toBeUndefined();
  });
});

describe('mapEmploymentType (exported helper)', () => {
  it('handles the union + gaps', () => {
    expect(mapEmploymentType('Full-Time')).toBe('Full-Time');
    expect(mapEmploymentType('CASUAL')).toBe('Casual');
    expect(mapEmploymentType('flexible_part_time')).toBe('Flexible Part-Time');
    expect(mapEmploymentType('contractor')).toBeUndefined();
    expect(mapEmploymentType(null)).toBeUndefined();
  });
});

describe('mapShiftRowToGrossPayInput — documented data gaps', () => {
  it('never fabricates leave flags or allowances', () => {
    const input = mapShiftRowToGrossPayInput(baseRow())!;
    expect(input.isAnnualLeave).toBe(false);
    expect(input.isPersonalLeave).toBe(false);
    expect(input.isCarerLeave).toBe(false);
    expect(input.allowances).toBeUndefined();
    expect(input.higherDutiesLevel).toBeUndefined();
    expect(input.classificationLevel).toBeUndefined();
  });

  it('passes through the scheduled length and shift id / date faithfully', () => {
    const input = mapShiftRowToGrossPayInput(baseRow({ id: 'abc', shift_date: '2026-07-08' }))!;
    expect(input.shiftId).toBe('abc');
    expect(input.shiftDate).toBe('2026-07-08');
    expect(input.employeeId).toBe('e1');
    expect(input.scheduledLengthMinutes).toBe(480);
  });
});
