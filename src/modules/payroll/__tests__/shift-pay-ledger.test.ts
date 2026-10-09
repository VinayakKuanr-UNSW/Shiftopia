import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildShiftPayLedger, ledgerRowState } from '../data/shiftPayLedger';
import { mapShiftRowToGrossPayInput } from '../data/grossPay.read.api';
import { computeShiftGrossPay } from '../domain/computeShiftGrossPay';
import { summarizeShiftPayLedger } from '../domain/summarizeShiftPayLedger';
import type { GrossPayShiftRow, GrossPayTimesheetRow } from '../data/types';
import type { LedgerCell, ShiftPayLedgerRow } from '../model/pay-ledger.types';
import type { ShiftPayContract } from '../domain/shiftPayTerms';

/**
 * The ledger is the only place a shift's pay is shown, so every row state and
 * every column is pinned here. Expected dollars come from the SAME engine
 * priced directly — these tests pin the wiring (which window, which state),
 * not the rates, which have their own goldens.
 *
 * Week of Mon 2026-07-06; the clock is pinned (isShiftFinished reads it).
 */

const WEEK = { periodStart: '2026-07-06', periodEnd: '2026-07-12' };

const row = (o: Partial<GrossPayShiftRow> = {}): GrossPayShiftRow => ({
  id: 's1',
  shift_date: '2026-07-06',
  start_time: '09:00:00',
  end_time: '17:00:00',
  is_overnight: false,
  lifecycle_status: 'Completed',
  assignment_status: 'assigned',
  attendance_status: 'checked_in',
  actual_start: null,
  actual_end: null,
  unpaid_break_minutes: 30,
  scheduled_length_minutes: 480,
  remuneration_level: 3,
  target_employment_type: 'Casual',
  assigned_employee_id: 'e1',
  roles: { id: 'r1', name: 'Attendant' },
  remuneration_levels: { level_number: 3, level_name: 'Level 3' },
  _employmentType: 'casual',
  _hasActiveContract: true,
  _timesheet: null,
  ...o,
});

const timesheet = (o: Partial<GrossPayTimesheetRow> = {}): GrossPayTimesheetRow => ({
  id: 't1', shift_id: 's1', start_time: null, end_time: null, unpaid_break_minutes: null, status: 'submitted', ...o,
});

/** Sydney wall-clock on a July (AEST, UTC+10) date as an ISO instant. */
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const utc = new Date(`${date}T00:00:00Z`);
  utc.setUTCMinutes(h * 60 + m - 600);
  return utc.toISOString();
};

const priced = (cell: LedgerCell | undefined) => {
  expect(cell?.kind).toBe('priced');
  return cell as Extract<LedgerCell, { kind: 'priced' }>;
};

const only = (rows: ShiftPayLedgerRow[]) => {
  expect(rows).toHaveLength(1);
  return rows[0];
};

/** What the engine pays for a row on a given window, priced on its own. */
const direct = (r: GrossPayShiftRow, start: string, end: string, netMinutes: number) =>
  computeShiftGrossPay(mapShiftRowToGrossPayInput(r, {
    startTime: start, endTime: end, rawNetMinutes: netMinutes, hoursSource: 'scheduled', ignoreNoShow: true,
  })!).grossPay;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-01T00:00:00Z')); // the whole week is over
});
afterEach(() => vi.useRealTimers());

describe('row states — only an assigned shift with a contract is priced', () => {
  it('unassigned: no figures and no employee', () => {
    const r = only(buildShiftPayLedger([row({ assigned_employee_id: null, assignment_status: 'unassigned' })], WEEK));
    expect(r.state).toBe('unassigned');
    expect(r.employeeId).toBeNull();
    expect(r.scheduled).toBeUndefined();
    expect(r.actual).toBeUndefined();
    expect(r.billable).toBeUndefined();
  });

  it('a declined assignment still has an employee id but is unassigned', () => {
    expect(ledgerRowState(row({ assignment_status: 'declined' }))).toBe('unassigned');
  });

  it('cancelled wins over unassigned — assigning a cancelled shift is not the fix', () => {
    expect(ledgerRowState(row({ lifecycle_status: 'Cancelled', assigned_employee_id: null }))).toBe('cancelled');
    expect(ledgerRowState(row({ is_cancelled: true }))).toBe('cancelled');
  });

  it('no contract at all: NO CONTRACT, not priced on a guess', () => {
    const r = only(buildShiftPayLedger([row({ _payContract: null, _hasActiveContract: false })], WEEK));
    expect(r.state).toBe('no_contract');
    expect(r.billable).toBeUndefined();
  });

  it('an active but unlinked contract is still priced (as the pay run prices it)', () => {
    const r = only(buildShiftPayLedger([row({ _payContract: null, _hasActiveContract: true })], WEEK));
    expect(r.state).toBe('priced');
  });
});

describe('the three windows', () => {
  it('Scheduled prices the roster; Actual the raw clock; Billable the snapped clock', () => {
    const r = row({ actual_start: at('2026-07-06', '08:53'), actual_end: at('2026-07-06', '17:07') });
    const out = only(buildShiftPayLedger([r], WEEK));

    // Roster 09:00–17:00 less 30 min = 7.5h; the clock snaps to the same window.
    expect(priced(out.scheduled).amount).toBe(direct(r, '09:00', '17:00', 450));
    expect(priced(out.billable).amount).toBe(priced(out.scheduled).amount);
    // 08:53–17:07 less 30 min = 7h44m, to the minute.
    expect(priced(out.actual).amount).toBe(direct(r, '08:53', '17:07', 464));
    expect(priced(out.actual).amount).toBeGreaterThan(priced(out.billable).amount);
  });

  it('Billable follows a manager edit; final only once approved', () => {
    const edited = (status: string) => row({
      actual_start: at('2026-07-06', '09:00'),
      actual_end: at('2026-07-06', '17:00'),
      _timesheet: timesheet({ start_time: '10:00', end_time: '14:00', unpaid_break_minutes: 0, status }),
    });
    const pending = only(buildShiftPayLedger([edited('submitted')], WEEK));
    expect(priced(pending.billable).amount).toBe(direct(edited('submitted'), '10:00', '14:00', 240));
    expect(pending.billableFinal).toBe(false);
    expect(only(buildShiftPayLedger([edited('approved')], WEEK)).billableFinal).toBe(true);
  });

  it('not started: Scheduled priced, the rest not worked yet', () => {
    vi.setSystemTime(new Date(at('2026-07-06', '07:00')));
    const out = only(buildShiftPayLedger([row({ lifecycle_status: 'Published' })], WEEK));
    expect(out.scheduled?.kind).toBe('priced');
    expect(out.actual).toEqual({ kind: 'not_worked_yet' });
    expect(out.billable).toEqual({ kind: 'not_worked_yet' });
  });

  it('clocked in, shift still running: in progress', () => {
    vi.setSystemTime(new Date(at('2026-07-06', '13:00')));
    const out = only(buildShiftPayLedger([row({ lifecycle_status: 'InProgress', actual_start: at('2026-07-06', '09:02') })], WEEK));
    expect(out.actual).toEqual({ kind: 'in_progress' });
    expect(out.billable).toEqual({ kind: 'in_progress' });
  });

  it('over with a missing clock-out: flagged, never priced off the roster', () => {
    const out = only(buildShiftPayLedger([row({ actual_start: at('2026-07-06', '09:00') })], WEEK));
    expect(out.actual).toEqual({ kind: 'no_clock' });
    expect(out.billable).toEqual({ kind: 'no_clock' });
  });

  it('no-show: the roster is still priced, nothing is owed', () => {
    const out = only(buildShiftPayLedger([row({ attendance_status: 'no_show' })], WEEK));
    expect(out.scheduled?.kind).toBe('priced');
    expect(out.actual).toEqual({ kind: 'no_show' });
    expect(out.billable).toEqual({ kind: 'no_show' });
  });

  it('salaried contract: no per-shift pay in any column, hours kept', () => {
    const salary: ShiftPayContract = {
      payBasis: 'salary', level: null, annualSalary: 95000, employmentStatus: 'Full-Time',
      contractedWeeklyHours: 38, usesWageScheme: false,
    };
    const out = only(buildShiftPayLedger([row({
      target_employment_type: 'FT', _employmentType: 'full_time', user_contract_id: 'c1', _payContract: salary,
      actual_start: at('2026-07-06', '09:00'), actual_end: at('2026-07-06', '17:00'),
    })], WEEK));
    expect(out.payBasis).toBe('salary');
    expect(out.scheduled).toEqual({ kind: 'salaried', hours: 7.5 });
    expect(out.actual).toEqual({ kind: 'salaried', hours: 7.5 });
    expect(out.billable).toEqual({ kind: 'salaried', hours: 7.5 });
  });
});

describe('cross-shift rules land on the right shift', () => {
  // Full-time, 8h a day with no break: 40h by Friday, so the week passes 38h on
  // Friday and only Friday carries overtime (cl 42).
  const ftDay = (id: string, date: string): GrossPayShiftRow => row({
    id, shift_date: date, unpaid_break_minutes: 0,
    target_employment_type: 'FT', _employmentType: 'full_time',
  });
  const days = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
  const week = days.map((d, i) => ftDay(`d${i}`, d));

  it('weekly overtime goes on the shift that crosses 38h', () => {
    const out = buildShiftPayLedger(week, WEEK);
    const mon = priced(out[0].scheduled);
    const fri = priced(out[4].scheduled);
    expect(fri.amount).toBeGreaterThan(mon.amount);
    expect(fri.lines.some((l) => l.code === 'overtime')).toBe(true);
    expect(mon.lines.some((l) => l.code === 'overtime')).toBe(false);
  });

  it('a period starting mid-week is seeded by the days before it, which it does not list', () => {
    const fromWednesday = buildShiftPayLedger(week, { periodStart: '2026-07-08', periodEnd: '2026-07-12' });
    expect(fromWednesday.map((r) => r.shiftId)).toEqual(['d2', 'd3', 'd4']);
    const whole = buildShiftPayLedger(week, WEEK);
    expect(priced(fromWednesday[2].scheduled).amount).toBe(priced(whole[4].scheduled).amount);
  });
});

describe('summary', () => {
  it('totals each column and says what each total is over', () => {
    const worked = row({ id: 'w', actual_start: at('2026-07-06', '09:00'), actual_end: at('2026-07-06', '17:00'),
      _timesheet: timesheet({ shift_id: 'w', status: 'approved' }) });
    const unverified = row({ id: 'u', shift_date: '2026-07-07', actual_start: at('2026-07-07', '09:00'), actual_end: at('2026-07-07', '17:00') });
    const missing = row({ id: 'm', shift_date: '2026-07-08' });
    const open = row({ id: 'o', assigned_employee_id: null, assignment_status: 'unassigned' });
    const gone = row({ id: 'c', lifecycle_status: 'Cancelled' });
    const ledger = buildShiftPayLedger([worked, unverified, missing, open, gone], WEEK);
    const s = summarizeShiftPayLedger(ledger);

    expect(s.shiftCount).toBe(5);
    expect(s.unassigned).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.scheduled.priced).toBe(3);
    expect(s.billable.priced).toBe(2);
    expect(s.billable.pending).toBe(1);
    const byId = new Map(ledger.map((r) => [r.shiftId, r]));
    expect(s.payable).toBe(priced(byId.get('w')!.billable).amount);
    expect(s.unverified).toBe(priced(byId.get('u')!.billable).amount);
    expect(s.billable.total).toBe(Math.round((s.payable + s.unverified) * 100) / 100);
  });
});
