/**
 * Labour cost — the shift pay ledger rolled up by department, sub-department,
 * role or employee, against department budgets. It replaces the roster
 * planner's Cost / Budget / Left footer, the planner mode headers and the
 * Insights labour-cost figures (decision 2026-10-09: money lives in Gross Pay
 * alone), and it sums the SAME ledger rows the Shifts tab lists, so the two
 * tabs cannot disagree.
 *
 * Two differences from the old planner footer, both deliberate:
 *   • An unassigned shift is NOT costed. Pay depends on the assignee's
 *     contract, so there is nothing to price; it is counted as uncosted.
 *   • A salary is a period cost, not a per-shift one: each salaried employee's
 *     salary for the period (annual ÷ 52 per week) is counted once and split
 *     across their shifts by rostered hours. It is the same in all three
 *     columns, because it is paid whatever hours are worked.
 */

import type { ShiftPayLedgerRow } from '../model/pay-ledger.types';

export type LabourCostGrouping = 'department' | 'subDepartment' | 'role' | 'employee';

export interface LabourCostGroup {
  key: string;
  label: string;
  /** Costed shifts — priced or salaried. */
  shifts: number;
  /** Shifts that cannot be costed yet: unassigned, or no contract. */
  uncosted: number;
  /** Rostered hours of the costed shifts. */
  hours: number;
  scheduled: number;
  actual: number;
  billable: number;
  /** The salary share included in each of scheduled / actual / billable. */
  salary: number;
  /** Pro-rated department budget — department grouping only. */
  budget: number | null;
}

export interface LabourCostResult {
  groups: LabourCostGroup[];
  total: LabourCostGroup;
}

export interface LabourCostInput {
  rows: readonly ShiftPayLedgerRow[];
  periodStart: string;   // YYYY-MM-DD, inclusive
  periodEnd: string;
  groupBy: LabourCostGrouping;
  departmentNames?: ReadonlyMap<string, string>;
  subDepartmentNames?: ReadonlyMap<string, string>;
  /** Department id → budget pro-rated to the period (see prorateBudgets). */
  budgets?: ReadonlyMap<string, number>;
}

export interface DepartmentBudgetRow {
  dept_id: string;
  period_start: string;
  period_end: string;
  budgeted_cost: number | string | null;
}

function round2(x: number): number {
  const v = Math.round(x * 100) / 100;
  return v === 0 ? 0 : v;
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Inclusive day count of a YYYY-MM-DD range (0 when inverted). */
export function daysInclusive(start: string, end: string): number {
  return Math.max(0, dayNumber(end) - dayNumber(start) + 1);
}

/**
 * Each budget pro-rated to the days it overlaps [start, end] — the rule the
 * planner footer applied in SQL (get_roster_planner_stats).
 */
export function prorateBudgets(
  rows: readonly DepartmentBudgetRow[],
  start: string,
  end: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of rows) {
    const span = daysInclusive(b.period_start, b.period_end);
    const overlapStart = b.period_start > start ? b.period_start : start;
    const overlapEnd = b.period_end < end ? b.period_end : end;
    const overlap = daysInclusive(overlapStart, overlapEnd);
    if (span === 0 || overlap === 0) continue;
    const amount = (Number(b.budgeted_cost) || 0) * (overlap / span);
    out.set(b.dept_id, (out.get(b.dept_id) ?? 0) + amount);
  }
  for (const [k, v] of out) out.set(k, round2(v));
  return out;
}

/** Each salaried row's share of its employee's salary for the period. */
function salaryShares(rows: readonly ShiftPayLedgerRow[], weeks: number): Map<string, number> {
  const byEmployee = new Map<string, ShiftPayLedgerRow[]>();
  for (const r of rows) {
    if (r.state !== 'priced' || r.scheduled?.kind !== 'salaried' || !r.employeeId) continue;
    const list = byEmployee.get(r.employeeId);
    if (list) list.push(r);
    else byEmployee.set(r.employeeId, [r]);
  }
  const shares = new Map<string, number>();
  for (const list of byEmployee.values()) {
    const annual = list.find((r) => (r.annualSalary ?? 0) > 0)?.annualSalary ?? 0;
    const periodSalary = (annual / 52) * weeks;
    const hoursOf = (r: ShiftPayLedgerRow) => (r.scheduled?.kind === 'salaried' ? r.scheduled.hours : 0);
    const totalHours = list.reduce((s, r) => s + hoursOf(r), 0);
    for (const r of list) {
      const share = totalHours > 0 ? hoursOf(r) / totalHours : 1 / list.length;
      shares.set(r.shiftId, periodSalary * share);
    }
  }
  return shares;
}

function groupKey(row: ShiftPayLedgerRow, input: LabourCostInput): { key: string; label: string } {
  switch (input.groupBy) {
    case 'department': {
      const id = row.departmentId ?? '';
      return { key: id || 'none', label: input.departmentNames?.get(id) ?? (id ? 'Unknown department' : 'No department') };
    }
    case 'subDepartment': {
      const id = row.subDepartmentId ?? '';
      return { key: id || 'none', label: input.subDepartmentNames?.get(id) ?? (id ? 'Unknown sub-department' : 'No sub-department') };
    }
    case 'role':
      return { key: row.roleName ?? 'none', label: row.roleName ?? 'No role' };
    case 'employee':
      return row.employeeId
        ? { key: row.employeeId, label: row.employeeName ?? row.employeeId }
        : { key: 'none', label: 'Unassigned' };
  }
}

function emptyGroup(key: string, label: string, withBudget: boolean): LabourCostGroup {
  return {
    key, label, shifts: 0, uncosted: 0, hours: 0,
    scheduled: 0, actual: 0, billable: 0, salary: 0,
    budget: withBudget ? 0 : null,
  };
}

export function computeLabourCost(input: LabourCostInput): LabourCostResult {
  const withBudget = input.groupBy === 'department';
  const weeks = daysInclusive(input.periodStart, input.periodEnd) / 7;
  const shares = salaryShares(input.rows, weeks);
  const groups = new Map<string, LabourCostGroup>();
  const groupFor = (key: string, label: string) => {
    let g = groups.get(key);
    if (!g) {
      g = emptyGroup(key, label, withBudget);
      groups.set(key, g);
    }
    return g;
  };

  for (const row of input.rows) {
    if (row.state === 'cancelled') continue;
    const { key, label } = groupKey(row, input);
    const g = groupFor(key, label);
    if (row.state !== 'priced') {
      g.uncosted += 1;
      continue;
    }
    g.shifts += 1;
    const scheduled = row.scheduled;
    if (scheduled?.kind === 'priced' || scheduled?.kind === 'salaried') g.hours += scheduled.hours;
    const salary = shares.get(row.shiftId) ?? 0;
    g.salary += salary;
    g.scheduled += salary + (scheduled?.kind === 'priced' ? scheduled.amount : 0);
    g.actual += salary + (row.actual?.kind === 'priced' ? row.actual.amount : 0);
    g.billable += salary + (row.billable?.kind === 'priced' ? row.billable.amount : 0);
  }

  if (withBudget && input.budgets) {
    for (const [deptId, amount] of input.budgets) {
      const g = groupFor(deptId, input.departmentNames?.get(deptId) ?? 'Unknown department');
      g.budget = (g.budget ?? 0) + amount;
    }
  }

  const list = [...groups.values()];
  for (const g of list) {
    g.hours = round2(g.hours);
    g.scheduled = round2(g.scheduled);
    g.actual = round2(g.actual);
    g.billable = round2(g.billable);
    g.salary = round2(g.salary);
    if (g.budget != null) g.budget = round2(g.budget);
  }
  list.sort((a, b) => b.scheduled - a.scheduled || a.label.localeCompare(b.label));

  const total = emptyGroup('total', 'Total', withBudget);
  for (const g of list) {
    total.shifts += g.shifts;
    total.uncosted += g.uncosted;
    total.hours += g.hours;
    total.scheduled += g.scheduled;
    total.actual += g.actual;
    total.billable += g.billable;
    total.salary += g.salary;
    if (g.budget != null) total.budget = (total.budget ?? 0) + g.budget;
  }
  total.hours = round2(total.hours);
  total.scheduled = round2(total.scheduled);
  total.actual = round2(total.actual);
  total.billable = round2(total.billable);
  total.salary = round2(total.salary);
  if (total.budget != null) total.budget = round2(total.budget);

  return { groups: list, total };
}
