/**
 * The shift pay ledger — see model/pay-ledger.types.ts for what it is and why.
 *
 * `buildShiftPayLedger` is pure over hydrated shift rows; `getShiftPayLedger`
 * fetches them. Each priceable shift is mapped three times through the SAME
 * mapper the pay run uses (`mapShiftRowToGrossPayInput`), differing only in
 * the window priced, and each column is sequenced per employee by the period
 * aggregator — so the Billable column is, shift for shift, what the pay run
 * computes for the same set of shifts.
 */

import {
  calculateNetMinutes,
  clockToWallTime,
  isShiftFinished,
  resolveBillableSide,
} from '@/modules/timesheets/domain/billable-time';
import {
  computeEmployeePeriodGrossPay,
  isoWeekKey,
  type PeriodBounds,
} from '../domain/aggregatePeriodGrossPay';
import type { GrossPayShiftInput } from '../domain/computeShiftGrossPay';
import type { ShiftGrossPay } from '../model/gross-pay.types';
import type {
  LedgerCell,
  LedgerColumn,
  LedgerRowState,
  ShiftPayLedgerRow,
} from '../model/pay-ledger.types';
import type { GrossPayShiftRow } from './types';
import {
  fetchHydratedShiftRows,
  mapShiftRowToGrossPayInput,
  type GrossPayPeriodBounds,
  type PricingWindow,
} from './grossPay.read.api';

const COLUMNS: readonly LedgerColumn[] = ['scheduled', 'actual', 'billable'];
const FINAL_TIMESHEET = new Set(['approved', 'locked']);

function firstEmbed<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v.length > 0 ? v[0] : null;
  return v ?? null;
}

function isNoShow(row: GrossPayShiftRow): boolean {
  return (row.attendance_status ?? '').toLowerCase() === 'no_show'
    || (row._timesheet?.status ?? '').toLowerCase() === 'no_show';
}

/** Cancelled before anything else: assigning a cancelled shift is not the fix. */
export function ledgerRowState(row: GrossPayShiftRow): LedgerRowState {
  if (row.lifecycle_status === 'Cancelled' || row.is_cancelled) return 'cancelled';
  const assignment = (row.assignment_status ?? '').toLowerCase();
  if (!row.assigned_employee_id || assignment === 'unassigned' || assignment === 'declined') {
    return 'unassigned';
  }
  if (!row._payContract && row._hasActiveContract === false) return 'no_contract';
  return 'priced';
}

/** A window from two wall-clock times, or null when either is missing. */
function windowFrom(
  start: string | null,
  end: string | null,
  unpaidBreakMinutes: number,
  hoursSource: PricingWindow['hoursSource'],
): PricingWindow | null {
  if (!start || !end) return null;
  const net = calculateNetMinutes(
    { hhmm: start, source: null },
    { hhmm: end, source: null },
    unpaidBreakMinutes,
  );
  if (net === null) return null;
  return { startTime: start, endTime: end, rawNetMinutes: net, hoursSource };
}

function isFinished(row: GrossPayShiftRow): boolean {
  return isShiftFinished(row.shift_date, row.start_time ?? '', row.end_time ?? '', row.actual_end);
}

/** Actual: the raw clock window, or why there isn't one. */
function actualWindow(row: GrossPayShiftRow): PricingWindow | LedgerCell {
  if (isNoShow(row)) return { kind: 'no_show' };
  const start = clockToWallTime(row.actual_start);
  const end = clockToWallTime(row.actual_end);
  // The break taken is recorded on the timesheet; absent that, the rostered one.
  const unpaidBreak = row._timesheet?.unpaid_break_minutes ?? row.unpaid_break_minutes ?? 0;
  const window = windowFrom(start, end, unpaidBreak, 'actual');
  if (window) return window;
  if (isFinished(row)) return { kind: 'no_clock' };
  return start ? { kind: 'in_progress' } : { kind: 'not_worked_yet' };
}

/** Billable: priced by the mapper's own resolution, or why it can't be yet. */
function billableOutcome(row: GrossPayShiftRow): 'price' | LedgerCell {
  if (isNoShow(row)) return { kind: 'no_show' };
  const ts = row._timesheet ?? null;
  const finished = isFinished(row);
  const start = resolveBillableSide(ts?.start_time, row.actual_start, finished);
  const end = resolveBillableSide(ts?.end_time, row.actual_end, finished);
  if (start.hhmm && end.hhmm) return 'price';
  if (start.source === 'missing' || end.source === 'missing') return { kind: 'no_clock' };
  return row.actual_start ? { kind: 'in_progress' } : { kind: 'not_worked_yet' };
}

function cellFrom(result: ShiftGrossPay | undefined): LedgerCell {
  // Every input handed to the aggregator comes back; a miss is a bug, and a
  // blank cell must not read as "$0 owed".
  if (!result) throw new Error('shift pay ledger: priced shift missing from aggregation');
  if (result.payBasis === 'salary' && !result.isLeave) {
    return { kind: 'salaried', hours: result.salariedHours ?? 0 };
  }
  return { kind: 'priced', amount: result.grossPay, hours: result.paidHours, lines: result.lines };
}

/**
 * One ledger row per shift dated inside `bounds`. Rows dated before it (from
 * the period's ISO week) are priced only to seed weekly overtime and the
 * rest-gap sweep, exactly as the pay run's lead-in does, and are not returned.
 */
export function buildShiftPayLedger(
  rows: readonly GrossPayShiftRow[],
  bounds: PeriodBounds,
): ShiftPayLedgerRow[] {
  const leadInStart = isoWeekKey(bounds.periodStart);
  const queued: Record<LedgerColumn, Map<string, GrossPayShiftInput[]>> = {
    scheduled: new Map(), actual: new Map(), billable: new Map(),
  };
  const queue = (column: LedgerColumn, input: GrossPayShiftInput | null) => {
    if (!input) return;
    const list = queued[column].get(input.employeeId);
    if (list) list.push(input);
    else queued[column].set(input.employeeId, [input]);
  };

  const ledger: ShiftPayLedgerRow[] = [];
  const pendingCells = new Map<string, Partial<Record<LedgerColumn, LedgerCell>>>();

  for (const row of rows) {
    if (row.shift_date < leadInStart || row.shift_date > bounds.periodEnd) continue;
    const inPeriod = row.shift_date >= bounds.periodStart;
    const state = ledgerRowState(row);
    const cells: Partial<Record<LedgerColumn, LedgerCell>> = {};

    if (state === 'priced') {
      const scheduled = windowFrom(
        clockToWallTime(row.start_time),
        clockToWallTime(row.end_time),
        row.unpaid_break_minutes ?? 0,
        'scheduled',
      );
      // A no-show was still rostered: the Scheduled figure prices the roster.
      if (scheduled) queue('scheduled', mapShiftRowToGrossPayInput(row, { ...scheduled, ignoreNoShow: true }));
      else cells.scheduled = { kind: 'not_worked_yet' };

      const actual = actualWindow(row);
      if ('kind' in actual) cells.actual = actual;
      else queue('actual', mapShiftRowToGrossPayInput(row, actual));

      const billable = billableOutcome(row);
      if (billable === 'price') queue('billable', mapShiftRowToGrossPayInput(row));
      else cells.billable = billable;
    }

    if (!inPeriod) continue;
    pendingCells.set(row.id, cells);

    const role = firstEmbed(row.roles);
    const profile = firstEmbed<any>((row as any).assigned_profiles);
    const subgroup = firstEmbed<any>((row as any).roster_subgroup);
    const tsStatus = row._timesheet?.status ?? null;
    ledger.push({
      shiftId: row.id,
      shiftDate: row.shift_date,
      startTime: clockToWallTime(row.start_time),
      endTime: clockToWallTime(row.end_time),
      employeeId: state === 'unassigned' ? null : row.assigned_employee_id,
      employeeName: state !== 'unassigned' && profile
        ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || undefined
        : undefined,
      roleName: role?.name ?? undefined,
      groupName: subgroup?.roster_group?.name ?? undefined,
      subGroupName: subgroup?.name ?? undefined,
      organizationId: row.organization_id ?? null,
      departmentId: row.department_id ?? null,
      subDepartmentId: row.sub_department_id ?? null,
      lifecycleStatus: row.lifecycle_status ?? null,
      timesheetStatus: tsStatus,
      fsm: {
        lifecycle_status: row.lifecycle_status ?? '',
        assignment_status: row.assignment_status ?? '',
        assignment_outcome: (row as any).assignment_outcome ?? null,
        trading_status: (row as any).trading_status ?? null,
        is_cancelled: !!row.is_cancelled,
      },
      state,
      billableFinal: FINAL_TIMESHEET.has((tsStatus ?? '').toLowerCase()),
    });
  }

  // Price each column per employee, in shift order, over the same lead-in.
  const priced: Record<LedgerColumn, Map<string, ShiftGrossPay>> = {
    scheduled: new Map(), actual: new Map(), billable: new Map(),
  };
  for (const column of COLUMNS) {
    for (const [employeeId, inputs] of queued[column]) {
      const period = computeEmployeePeriodGrossPay(employeeId, inputs, bounds, { leadInStart });
      for (const s of period.shifts) priced[column].set(s.shiftId, s);
    }
  }

  for (const entry of ledger) {
    if (entry.state !== 'priced') continue;
    const cells = pendingCells.get(entry.shiftId) ?? {};
    for (const column of COLUMNS) {
      entry[column] = cells[column] ?? cellFrom(priced[column].get(entry.shiftId));
    }
    // Pay terms are the same in every column; read them off whichever priced.
    const any = priced.billable.get(entry.shiftId)
      ?? priced.scheduled.get(entry.shiftId)
      ?? priced.actual.get(entry.shiftId);
    entry.payBasis = any?.payBasis;
    entry.employmentType = any?.employmentType;
    entry.isSecurityRole = any?.isSecurityRole;
    if (any?.payBasis === 'salary') {
      entry.annualSalary = any.annualSalary;
      entry.contractedWeeklyHours = any.contractedWeeklyHours;
    }
  }

  return ledger;
}

/**
 * Every shift in the period and scope — all lifecycle states, assigned or not
 * — priced into the ledger. Fetches from the Monday of the period's first week
 * so weekly overtime is seeded by the days before the period, as the pay run is.
 */
export async function getShiftPayLedger(bounds: GrossPayPeriodBounds): Promise<ShiftPayLedgerRow[]> {
  const rows = await fetchHydratedShiftRows(
    { ...bounds, periodStart: isoWeekKey(bounds.periodStart) },
    { allShifts: true },
  );
  return buildShiftPayLedger(rows, bounds);
}
