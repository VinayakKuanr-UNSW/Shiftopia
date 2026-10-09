/**
 * LabourCostView — the period's labour cost by department, sub-department,
 * role or employee, against department budgets (see domain/labourCost.ts).
 * Replaces the roster planner's Cost / Budget / Left footer and the Insights
 * labour-cost figures.
 *
 * Dark-first, light-mode safe: semantic tokens, or colour utilities paired
 * with a dark: counterpart.
 */

import React, { useMemo, useState } from 'react';
import { cn } from '@/modules/core/lib/utils';
import { formatCost } from '@/modules/rosters/domain/projections/utils/cost';
import type { ShiftPayLedgerRow } from '../model/pay-ledger.types';
import { computeLabourCost, type LabourCostGroup, type LabourCostGrouping } from '../domain/labourCost';
import type { LabourCostContext } from '../data/labourCost.read.api';

export interface LabourCostViewProps {
  rows: ShiftPayLedgerRow[];
  periodStart: string;
  periodEnd: string;
  context?: LabourCostContext;
  isLoading?: boolean;
  error?: unknown;
}

const GROUPINGS: { value: LabourCostGrouping; label: string }[] = [
  { value: 'department', label: 'Department' },
  { value: 'subDepartment', label: 'Sub-department' },
  { value: 'role', label: 'Role' },
  { value: 'employee', label: 'Employee' },
];

function formatHours(hours: number): string {
  return `${Math.round(hours * 10) / 10}h`;
}

const Tile: React.FC<{ label: string; value: string; detail?: string; tone?: string }> = ({ label, value, detail, tone }) => (
  <div className="min-w-0 rounded-2xl border border-border/60 bg-background/60 px-4 py-3">
    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className={cn('mt-1 text-xl font-bold tabular-nums text-foreground', tone)}>{value}</p>
    {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
  </div>
);

const LEFT_NEGATIVE = 'text-rose-700 dark:text-rose-400';
const LEFT_POSITIVE = 'text-emerald-700 dark:text-emerald-400';

const GroupRow: React.FC<{ g: LabourCostGroup; showBudget: boolean; isTotal?: boolean }> = ({ g, showBudget, isTotal }) => {
  const left = g.budget != null ? g.budget - g.scheduled : null;
  const cell = 'whitespace-nowrap px-3 py-2.5 text-right tabular-nums';
  return (
    <tr className={cn('border-b border-border/30', isTotal && 'border-t-2 border-t-border font-bold')}>
      <td className={cn('max-w-[240px] truncate px-3 py-2.5', isTotal ? 'text-foreground' : 'font-semibold text-foreground')} title={g.label}>
        {g.label}
      </td>
      <td className={cn(cell, 'text-muted-foreground')}>{g.shifts}</td>
      <td className={cn(cell, g.uncosted > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>{g.uncosted || '—'}</td>
      <td className={cn(cell, 'text-muted-foreground')}>{formatHours(g.hours)}</td>
      <td className={cn(cell, 'text-foreground')}>{formatCost(g.scheduled)}</td>
      <td className={cn(cell, 'text-foreground')}>{formatCost(g.actual)}</td>
      <td className={cn(cell, 'text-foreground')}>{formatCost(g.billable)}</td>
      {showBudget && (
        <>
          <td className={cn(cell, 'text-muted-foreground')}>{g.budget ? formatCost(g.budget) : '—'}</td>
          <td className={cn(cell, left == null || !g.budget ? 'text-muted-foreground' : left < 0 ? LEFT_NEGATIVE : LEFT_POSITIVE)}>
            {left == null || !g.budget ? '—' : formatCost(left)}
          </td>
        </>
      )}
    </tr>
  );
};

export const LabourCostView: React.FC<LabourCostViewProps> = ({
  rows,
  periodStart,
  periodEnd,
  context,
  isLoading = false,
  error,
}) => {
  const [groupBy, setGroupBy] = useState<LabourCostGrouping>('department');
  const result = useMemo(() => computeLabourCost({
    rows,
    periodStart,
    periodEnd,
    groupBy,
    departmentNames: context?.departmentNames,
    subDepartmentNames: context?.subDepartmentNames,
    budgets: context?.budgets,
  }), [rows, periodStart, periodEnd, groupBy, context]);

  if (isLoading) {
    return <div className="rounded-xl border border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">Loading labour cost…</div>;
  }
  if (error) {
    return (
      <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-8 text-center text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
        Failed to load labour cost for this period.
      </div>
    );
  }

  const { total } = result;
  // Budgets are kept per department, so they only add up at that grouping.
  const showBudget = groupBy === 'department';
  const budget = context ? [...context.budgets.values()].reduce((s, v) => s + v, 0) : 0;
  const left = budget - total.scheduled;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">
          Labour cost <span className="font-mono text-sm text-muted-foreground">{periodStart} → {periodEnd}</span>
        </h2>
        {total.uncosted > 0 && (
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {total.uncosted} shift{total.uncosted === 1 ? '' : 's'} not costed — assign an employee with a contract to cost them.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Scheduled cost" value={formatCost(total.scheduled)} detail={`${total.shifts} shifts · ${formatHours(total.hours)}`} />
        <Tile label="Billable cost" value={formatCost(total.billable)} detail={`Actual ${formatCost(total.actual)}`} />
        <Tile label="Budget" value={budget > 0 ? formatCost(budget) : '—'} detail={budget > 0 ? 'Pro-rated to this period' : 'No budget overlaps this period'} />
        <Tile
          label="Left"
          value={budget > 0 ? formatCost(left) : '—'}
          detail={budget > 0 ? 'Budget less scheduled cost' : undefined}
          tone={budget > 0 ? (left < 0 ? LEFT_NEGATIVE : LEFT_POSITIVE) : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Group labour cost by">
        {GROUPINGS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setGroupBy(value)}
            aria-pressed={groupBy === value}
            className={cn(
              'h-9 rounded-lg border px-3 text-xs font-semibold transition-colors',
              groupBy === value
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {result.groups.length === 0 ? (
        <div className="rounded-xl border border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">No shifts in this period.</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/40">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left">{GROUPINGS.find((g) => g.value === groupBy)?.label}</th>
                  <th className="px-3 py-2 text-right">Shifts</th>
                  <th className="px-3 py-2 text-right">Not costed</th>
                  <th className="px-3 py-2 text-right">Hours</th>
                  <th className="px-3 py-2 text-right">Scheduled</th>
                  <th className="px-3 py-2 text-right">Actual</th>
                  <th className="px-3 py-2 text-right">Billable</th>
                  {showBudget && (
                    <>
                      <th className="px-3 py-2 text-right">Budget</th>
                      <th className="px-3 py-2 text-right">Left</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {result.groups.map((g) => <GroupRow key={g.key} g={g} showBudget={showBudget} />)}
              </tbody>
              <tfoot>
                <GroupRow g={total} showBudget={showBudget} isTotal />
              </tfoot>
            </table>
          </div>
        </div>
      )}
      {total.salary > 0 && (
        <p className="text-xs text-muted-foreground">
          Includes {formatCost(total.salary)} of salaries — each counted once for the period and split across that person's shifts by rostered hours.
        </p>
      )}
    </div>
  );
};

export default LabourCostView;
