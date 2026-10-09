import { describe, it, expect } from 'vitest';
import { computeLabourCost, daysInclusive, prorateBudgets } from '../domain/labourCost';
import type { LedgerCell, ShiftPayLedgerRow } from '../model/pay-ledger.types';

const priced = (amount: number, hours = 8): LedgerCell => ({ kind: 'priced', amount, hours, lines: [] });
const salaried = (hours: number): LedgerCell => ({ kind: 'salaried', hours });

const row = (o: Partial<ShiftPayLedgerRow>): ShiftPayLedgerRow => ({
  shiftId: 's', shiftDate: '2026-07-06', startTime: '09:00', endTime: '17:00',
  employeeId: 'e1', employeeName: 'Sam', roleName: 'Usher',
  departmentId: 'd1', subDepartmentId: 'sd1',
  lifecycleStatus: 'Published', timesheetStatus: null,
  fsm: { lifecycle_status: 'Published', assignment_status: 'assigned', assignment_outcome: null, trading_status: null, is_cancelled: false },
  state: 'priced', billableFinal: false,
  scheduled: priced(200), actual: { kind: 'not_worked_yet' }, billable: { kind: 'not_worked_yet' },
  ...o,
});

const WEEK = { periodStart: '2026-07-06', periodEnd: '2026-07-12' };

describe('prorateBudgets', () => {
  it('pro-rates each budget by the days it overlaps the window', () => {
    // A 30-day June+July budget of $3,000 overlapping 7 days of the window.
    const out = prorateBudgets([{ dept_id: 'd1', period_start: '2026-06-20', period_end: '2026-07-19', budgeted_cost: 3000 }], '2026-07-06', '2026-07-12');
    expect(out.get('d1')).toBe(700);
  });

  it('ignores budgets outside the window and sums overlapping ones', () => {
    const out = prorateBudgets([
      { dept_id: 'd1', period_start: '2026-07-01', period_end: '2026-07-07', budgeted_cost: 700 }, // 2 of 7 days
      { dept_id: 'd1', period_start: '2026-07-08', period_end: '2026-07-14', budgeted_cost: '1400' }, // 5 of 7 days
      { dept_id: 'd2', period_start: '2026-08-01', period_end: '2026-08-31', budgeted_cost: 9999 },
    ], '2026-07-06', '2026-07-12');
    expect(out.get('d1')).toBe(1200);
    expect(out.has('d2')).toBe(false);
  });

  it('counts days inclusively', () => {
    expect(daysInclusive('2026-07-06', '2026-07-12')).toBe(7);
    expect(daysInclusive('2026-07-12', '2026-07-06')).toBe(0);
  });
});

describe('computeLabourCost', () => {
  it('sums each column from the ledger and counts what could not be costed', () => {
    const result = computeLabourCost({
      ...WEEK, groupBy: 'department',
      departmentNames: new Map([['d1', 'Events']]),
      rows: [
        row({ shiftId: 'a', scheduled: priced(200), actual: priced(210), billable: priced(205) }),
        row({ shiftId: 'b', scheduled: priced(100, 4) }),
        row({ shiftId: 'u', state: 'unassigned', employeeId: null, scheduled: undefined, actual: undefined, billable: undefined }),
        row({ shiftId: 'c', state: 'cancelled', scheduled: undefined, actual: undefined, billable: undefined }),
      ],
    });
    expect(result.groups).toHaveLength(1);
    const g = result.groups[0];
    expect(g.label).toBe('Events');
    expect(g.shifts).toBe(2);
    expect(g.uncosted).toBe(1); // cancelled is neither costed nor uncosted
    expect(g.hours).toBe(12);
    expect(g.scheduled).toBe(300);
    expect(g.actual).toBe(210);
    expect(g.billable).toBe(205);
  });

  it('counts a salary once per period, split across the shifts by rostered hours', () => {
    // $52,000 a year = $1,000 a week; 6h + 2h rostered ⇒ $750 + $250.
    const salary = (id: string, hours: number, dept: string) => row({
      shiftId: id, departmentId: dept, payBasis: 'salary', annualSalary: 52000,
      scheduled: salaried(hours), actual: salaried(hours), billable: salaried(hours),
    });
    const result = computeLabourCost({
      ...WEEK, groupBy: 'department',
      rows: [salary('x', 6, 'd1'), salary('y', 2, 'd2')],
    });
    const byKey = new Map(result.groups.map((g) => [g.key, g]));
    expect(byKey.get('d1')!.scheduled).toBe(750);
    expect(byKey.get('d2')!.scheduled).toBe(250);
    expect(byKey.get('d1')!.billable).toBe(750);
    expect(result.total.salary).toBe(1000);
  });

  it('shows budgets, including for a budgeted department with no shifts', () => {
    const result = computeLabourCost({
      ...WEEK, groupBy: 'department',
      rows: [row({ shiftId: 'a', scheduled: priced(300) })],
      budgets: new Map([['d1', 500], ['d9', 100]]),
    });
    const byKey = new Map(result.groups.map((g) => [g.key, g]));
    expect(byKey.get('d1')!.budget).toBe(500);
    expect(byKey.get('d9')!.budget).toBe(100);
    expect(byKey.get('d9')!.shifts).toBe(0);
    expect(result.total.budget).toBe(600);
  });

  it('has no budget outside the department grouping', () => {
    const result = computeLabourCost({ ...WEEK, groupBy: 'role', rows: [row({})], budgets: new Map([['d1', 500]]) });
    expect(result.groups[0].budget).toBeNull();
    expect(result.total.budget).toBeNull();
  });

  it('groups unassigned shifts together by employee', () => {
    const result = computeLabourCost({
      ...WEEK, groupBy: 'employee',
      rows: [row({ shiftId: 'u', state: 'unassigned', employeeId: null, scheduled: undefined })],
    });
    expect(result.groups[0].label).toBe('Unassigned');
    expect(result.groups[0].uncosted).toBe(1);
  });
});
