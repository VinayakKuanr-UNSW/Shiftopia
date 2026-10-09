import { describe, it, expect } from 'vitest';
import {
  mapShiftRowToGrossPayInput,
  mapEmploymentType,
  payContractOn,
} from '../data/grossPay.read.api';
import type { GrossPayShiftRow } from '../data/types';
import type { ShiftPayContract } from '../domain/shiftPayTerms';
import { computeShiftGrossPay } from '../domain/computeShiftGrossPay';

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
  remuneration_level: 3,
  assigned_employee_id: 'e1',
  role_id: 'r1',
  roles: { id: 'r1', name: 'Attendant' },
  remuneration_levels: { level_number: 3, level_name: 'Level 3' },
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

  // REGRESSION: attendance_status='no_show' does NOT mean "no billable window
  // exists" — a manager can enter a manual timesheet override on a shift still
  // flagged no-show (e.g. correcting a bad flag, or paying verified off-system
  // work). That resolved window must still get the EBA minimum-engagement
  // floor; it must not be silently skipped just because isNoShow is also true.
  it('still floors a manually-entered billable window on a no-show-flagged shift', () => {
    const row = baseRow({
      attendance_status: 'no_show',
      actual_start: null,
      actual_end: null,
      _employmentType: 'casual', // the payment floor is PT/casual-only — see below
      _timesheet: {
        id: 't1', shift_id: 's1',
        start_time: '07:15', end_time: '09:45', // 2h30m manual override
        unpaid_break_minutes: 30, status: 'approved',
      },
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.isNoShow).toBe(true);
    // 2h30m − 30m break = 2h net, below the 3h standard floor → topped up to 180.
    expect(input.netMinutes).toBe(180);
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

  it('yields scheduled net minutes with scheduled_fallback source when unfinished and no timesheet', () => {
    // No actual_end and end_time in the future would make it unfinished; use a
    // far-future date so isShiftFinished() is false regardless of clock.
    const row = baseRow({
      shift_date: '2999-01-01',
      actual_start: null,
      actual_end: null,
      _timesheet: null,
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.netMinutes).toBe(480);
    expect(input.startTime).toBe('09:00');
    expect(input.endTime).toBe('17:00');
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

  // AUDIT FIX: `row.is_overnight` describes the ORIGINAL schedule, not
  // necessarily the times a manager ends up approving. Previously the diff
  // was rolled +24h whenever `row.is_overnight` was true REGARDLESS of the
  // sign of the resolved diff, so a shift scheduled overnight but corrected
  // (or clocked out early) to a same-day span got a fabricated extra day of
  // pay. The rollover must be a pure sign check on the RESOLVED times.
  it('does NOT roll forward when is_overnight is stale (schedule was overnight, approved times are not)', () => {
    const row = baseRow({
      start_time: '22:00',
      end_time: '06:00',
      is_overnight: true, // stale — describes the original roster, not this approval
      unpaid_break_minutes: 0,
      _timesheet: {
        id: 't1', shift_id: 's1',
        // Manager corrected the timesheet to an early finish BEFORE midnight
        // (e.g. the event was cancelled) — this span does not cross midnight.
        start_time: '22:00', end_time: '23:30',
        unpaid_break_minutes: 0, status: 'approved',
      },
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.isOvernight).toBe(true); // still carried through as scheduling metadata
    // 22:00 → 23:30 = 1.5h = 90 min (proves no bogus +1440 rollover — the old
    // code forced that here, which would yield 1530, not this). Stays at the
    // raw 90 min, un-floored: baseRow() defaults to Full-Time, which the EBA
    // minimum-engagement PAYMENT floor exempts entirely (weekly-salaried, no
    // per-engagement minimum) — see the Casual/Part-Time floor coverage in
    // billable-time.test.ts and min-engagement-floor.test.ts instead.
    expect(input.netMinutes).toBe(90);
  });
});

describe('mapShiftRowToGrossPayInput — hours provenance (AUDIT FIX)', () => {
  // A shift can be "finished" (isShiftFinished) purely because the SCHEDULED
  // end passed, even though the employee only ever clocked IN and never
  // clocked OUT (forgot to tap out). Pricing must not mislabel that as
  // 'actual' — half the billable window in that case is a schedule fallback,
  // not real attendance.
  it('labels hoursSource "scheduled_fallback" (not "actual") when only the clock-in is real', () => {
    const row = baseRow({
      shift_date: '2024-01-01', // safely in the past regardless of test run date
      actual_start: '2024-01-01T09:07:00Z',
      actual_end: null, // never clocked out
      _timesheet: null,
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.hoursSource).toBe('scheduled_fallback');
    // End falls back to the scheduled end time (17:00) for the estimate.
    expect(input.endTime).toBe('17:00');
  });

  it('labels hoursSource "actual" only once BOTH sides snapped from real clock data', () => {
    const row = baseRow({
      shift_date: '2024-01-01',
      actual_start: '2024-01-01T09:07:00Z',
      actual_end: '2024-01-01T17:10:00Z',
      _timesheet: null,
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.hoursSource).toBe('actual');
  });
});

describe('mapShiftRowToGrossPayInput — rate & classification resolution', () => {
  // MONEY-CRITICAL. hourly_rate_min is the PERMANENT band minimum — feeding it
  // as the paid rate de-loaded casuals off an unloaded rate (~20% underpay) and
  // bypassed the effective-dated EBA schedule. The adapter now derives the
  // classification and lets the award engine resolve the Schedule 2 rate.
  it('derives classificationLevel from level_number and leaves rate null (engine resolves the EBA rate)', () => {
    const input = mapShiftRowToGrossPayInput(baseRow())!;
    expect(input.rate).toBeNull();
    expect(input.classificationLevel).toBe('LEVEL_3');
  });

  it('maps level 0 to TRAINEE', () => {
    const row = baseRow({
      remuneration_levels: { level_number: 0, level_name: 'Introductory' },
    });
    expect(mapShiftRowToGrossPayInput(row)!.classificationLevel).toBe('TRAINEE');
  });

  it('has no per-shift rate override — a stray remuneration_rate on the row is ignored when level is present', () => {
    // User decision 2026-10-08: someone on a level is paid that level. The SQL
    // budget (fn_eba_resolve_shift_rate called with NULL overrides) agrees.
    const row = { ...baseRow(), remuneration_rate: 99 } as GrossPayShiftRow;
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.rate).toBeNull();
    expect(input.classificationLevel).toBe('LEVEL_3');
  });

  it('uses remuneration_rate only as a last resort (unlinked row without a level)', () => {
    const row = baseRow({ remuneration_level: null, remuneration_levels: null, remuneration_rate: 41.2 });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.rate).toBe(41.2);
    expect(input.classificationLevel).toBeUndefined();
  });

  it('is null when there is no level and no level rate', () => {
    const row = baseRow({ remuneration_level: null, remuneration_levels: null });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.rate).toBeNull();
    expect(input.classificationLevel).toBeUndefined();
  });

  it('unwraps PostgREST array-style embeds', () => {
    const row = baseRow({
      remuneration_level: null,
      roles: [{ id: 'r1', name: 'Security Officer' }] as any,
      remuneration_levels: [{ level_number: 5 }] as any,
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.rate).toBeNull();
    expect(input.classificationLevel).toBe('LEVEL_5');
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
    // classificationLevel is DERIVED from the row's level_number — not fabricated.
    expect(input.classificationLevel).toBe('LEVEL_3');
  });

  it('passes through the scheduled length and shift id / date faithfully', () => {
    const input = mapShiftRowToGrossPayInput(baseRow({ id: 'abc', shift_date: '2026-07-08' }))!;
    expect(input.shiftId).toBe('abc');
    expect(input.shiftDate).toBe('2026-07-08');
    expect(input.employeeId).toBe('e1');
    expect(input.scheduledLengthMinutes).toBe(480);
  });
});

// ── Pay on the CONTRACT's terms (Phase 4, 2026-10-08) ──────────────────────
// Expected dollars are internal.shift_cost on prod for the same shifts (the
// roster budget), so these double as payroll ↔ budget parity checks.
describe('mapShiftRowToGrossPayInput — paid on the linked contract', () => {
  const casualContract = (level: number, extra: Partial<ShiftPayContract> = {}): ShiftPayContract => ({
    payBasis: 'eba_level',
    level,
    annualSalary: null,
    employmentStatus: 'Casual',
    contractedWeeklyHours: null,
    usesWageScheme: false,
    ...extra,
  });

  // Thursday 09:00–12:00, manager-approved times (deterministic billable window).
  const thursday3h = (o: Partial<GrossPayShiftRow>): GrossPayShiftRow => baseRow({
    shift_date: '2026-10-08',
    start_time: '09:00',
    end_time: '12:00',
    net_length_minutes: 180,
    scheduled_length_minutes: 180,
    target_employment_type: 'Casual',
    user_contract_id: 'c1',
    _employmentType: 'full_time', // the profile — must NOT decide the basis
    _timesheet: { id: 't1', shift_id: 's1', start_time: '09:00', end_time: '12:00', unpaid_break_minutes: 0, status: 'approved' },
    ...o,
  });
  const pay = (row: GrossPayShiftRow) => computeShiftGrossPay(mapShiftRowToGrossPayInput(row)!);

  it('an L7 casual on an L4 shift is paid at L7 (budget: 134.76)', () => {
    const row = thursday3h({ remuneration_level: 4, remuneration_levels: { level_number: 4 }, _payContract: casualContract(7) });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.classificationLevel).toBe('LEVEL_7');
    expect(input.higherDutiesLevel).toBeUndefined();
    expect(input.employmentType).toBe('Casual');
    expect(pay(row).grossPay).toBe(134.76);
  });

  it('an L4 casual doing 3h of L6 work gets 4h at L6 — cl 29.1(a) (budget: 172.48)', () => {
    const row = thursday3h({ remuneration_level: 6, remuneration_levels: { level_number: 6 }, _payContract: casualContract(4) });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.classificationLevel).toBe('LEVEL_4');
    expect(input.higherDutiesLevel).toBe('LEVEL_6');
    const result = pay(row);
    expect(result.paidHours).toBe(4);
    expect(result.grossPay).toBe(172.48);
  });

  it('the same higher duties on a Saturday for 2h (budget: 206.98)', () => {
    const row = thursday3h({
      shift_date: '2026-10-10', end_time: '11:00', net_length_minutes: 120, scheduled_length_minutes: 120,
      _timesheet: { id: 't1', shift_id: 's1', start_time: '09:00', end_time: '11:00', unpaid_break_minutes: 0, status: 'approved' },
      remuneration_level: 6, remuneration_levels: { level_number: 6 }, _payContract: casualContract(4),
    });
    expect(pay(row).grossPay).toBe(206.98);
  });

  it('no higher duties for a wage-scheme contract (Schedules 4–6 set the rate)', () => {
    const row = thursday3h({
      remuneration_level: 6, remuneration_levels: { level_number: 6 },
      _payContract: casualContract(3, { usesWageScheme: true }),
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.classificationLevel).toBe('LEVEL_3');
    expect(input.higherDutiesLevel).toBeUndefined();
  });

  it('the ROLE level is never higher duties any more', () => {
    const row = thursday3h({
      roles: { id: 'r1', name: 'Supervisor', remuneration_level: 7 },
      remuneration_level: 4, remuneration_levels: { level_number: 4 }, _payContract: casualContract(4),
    });
    expect(mapShiftRowToGrossPayInput(row)!.higherDutiesLevel).toBeUndefined();
  });

  it('a salaried shift adds no per-shift pay but keeps the worked hours', () => {
    const row = thursday3h({
      target_employment_type: 'FT',
      end_time: '17:00', net_length_minutes: 480, scheduled_length_minutes: 480,
      _timesheet: { id: 't1', shift_id: 's1', start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 0, status: 'approved' },
      _payContract: { payBasis: 'salary', level: null, annualSalary: 95000, employmentStatus: 'Full-Time', contractedWeeklyHours: 38, usesWageScheme: false },
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.payBasis).toBe('salary');
    const result = pay(row);
    expect(result.grossPay).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.paidHours).toBe(0);
    expect(result.salariedHours).toBe(8);
    expect(result.payBasis).toBe('salary');
  });

  it('a salaried Part-Timer gets no minimum-engagement floor', () => {
    const row = thursday3h({
      target_employment_type: 'PT',
      end_time: '10:00', net_length_minutes: 60, scheduled_length_minutes: 60,
      _timesheet: { id: 't1', shift_id: 's1', start_time: '09:00', end_time: '10:00', unpaid_break_minutes: 0, status: 'approved' },
      _payContract: { payBasis: 'salary', level: null, annualSalary: 78000, employmentStatus: 'Part-Time', contractedWeeklyHours: 30, usesWageScheme: false },
    });
    expect(mapShiftRowToGrossPayInput(row)!.netMinutes).toBe(60);
  });

  it('annualised Security is priced as Full-Time Security whatever the role is called', () => {
    const row = thursday3h({
      target_employment_type: 'FT',
      roles: { id: 'r1', name: 'Venue Supervisor' },
      remuneration_level: 5, remuneration_levels: { level_number: 5 },
      _payContract: { payBasis: 'eba_security_annualised', level: 4, annualSalary: null, employmentStatus: 'Full-Time', contractedWeeklyHours: 42, usesWageScheme: false },
    });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.isSecurityRole).toBe(true);
    expect(input.employmentType).toBe('Full-Time');
    expect(input.classificationLevel).toBe('LEVEL_4');
    expect(input.higherDutiesLevel).toBe('LEVEL_5');
  });

  it('annualised Security higher duties on a Saturday: 4h at the L5 annualised rate, no weekend loading', () => {
    // internal.shift_cost: span 3h x $38.95 + 1h cl 29.1(a) top-up x $38.95 = 155.80.
    // The annualised rate absorbs weekend penalties (Sch 2 §2 / Sch 3 §4.1(b)).
    const row = thursday3h({
      shift_date: '2026-10-10',
      target_employment_type: 'FT',
      roles: { id: 'r1', name: 'Security Officer' },
      remuneration_level: 5, remuneration_levels: { level_number: 5 },
      _payContract: { payBasis: 'eba_security_annualised', level: 4, annualSalary: null, employmentStatus: 'Full-Time', contractedWeeklyHours: 42, usesWageScheme: false },
    });
    expect(pay(row).grossPay).toBe(155.8);
  });

  it('a Flexible Part-Time contract keeps its flexible basis on a PT shift', () => {
    const row = thursday3h({
      target_employment_type: 'PT',
      _payContract: casualContract(3, { employmentStatus: 'Flexible Part-Time' }),
    });
    expect(mapShiftRowToGrossPayInput(row)!.employmentType).toBe('Flexible Part-Time');
  });
});

describe('mapShiftRowToGrossPayInput — unlinked shift', () => {
  it('takes the employment basis from the shift target, not the profile', () => {
    const row = baseRow({ target_employment_type: 'Casual', _employmentType: 'full_time' });
    expect(mapShiftRowToGrossPayInput(row)!.employmentType).toBe('Casual');
  });

  it('pays the shift level, with no higher duties', () => {
    const row = baseRow({ roles: { id: 'r1', name: 'Supervisor', remuneration_level: 7 } });
    const input = mapShiftRowToGrossPayInput(row)!;
    expect(input.classificationLevel).toBe('LEVEL_3');
    expect(input.higherDutiesLevel).toBeUndefined();
    expect(input.payBasis).toBeUndefined();
  });
});

describe('payContractOn — the linked contract on the shift date', () => {
  const contract = {
    id: 'c1', user_id: 'e1', employment_status: 'Casual', remuneration_level: 6,
    pay_basis: 'eba_level', annual_salary: null, contracted_weekly_hours: null,
    is_apprentice: false, is_trainee: false, is_sws: false,
  };
  const history = [
    { contract_id: 'c1', effective_from: '2026-01-01', pay_basis: 'eba_level' as const, remuneration_level: 4, annual_salary: null },
    { contract_id: 'c1', effective_from: '2026-09-01', pay_basis: 'eba_level' as const, remuneration_level: 6, annual_salary: null },
  ];

  it('uses the level in force on the shift date, not today’s', () => {
    expect(payContractOn(contract, history, '2026-08-15').level).toBe(4);
    expect(payContractOn(contract, history, '2026-10-08').level).toBe(6);
  });

  it('falls back to the contract’s current terms with no readable history', () => {
    expect(payContractOn(contract, [], '2026-08-15').level).toBe(6);
  });

  it('flags apprentice / trainee / SWS as a wage scheme', () => {
    expect(payContractOn({ ...contract, is_trainee: true }, [], '2026-10-08').usesWageScheme).toBe(true);
  });
});
