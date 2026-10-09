/**
 * GrossPayPeriodView — the pay run: one row per employee for the period, each
 * expandable into its itemised earnings (EarningsLinesTable). This is where a
 * salary, leave pay and time in lieu appear — they belong to the period, not
 * to a shift, so the per-shift ledger (ShiftPayLedgerView) cannot show them.
 *
 * GROSS estimate only — a prominent banner makes clear this excludes PAYG tax
 * and superannuation and is NOT a payslip of record.
 *
 * Dark-first, light-mode safe: semantic tokens, or colour utilities paired
 * with a dark: counterpart.
 */

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import type { PeriodGrossPay } from '../model/gross-pay.types';
import { formatCost } from '../../rosters/domain/projections/utils/cost';
import { EarningsLinesTable } from './EarningsLinesTable';
import { cn } from '@/modules/core/lib/utils';

export interface GrossPayPeriodViewProps {
  periods: PeriodGrossPay[];
  /** Period bounds (YYYY-MM-DD, inclusive) for the header. */
  periodStart: string;
  periodEnd: string;
  /**
   * Optional employee-id → display-name map. When absent, the name carried on
   * the employee's shifts is used, else the id.
   */
  employeeNames?: Record<string, string>;
  isLoading?: boolean;
  error?: unknown;
  className?: string;
}

function formatHours(hours: number): string {
  return `${Math.round(hours * 100) / 100}h`;
}

const DISCLAIMER =
  'GROSS estimate — excludes PAYG tax, superannuation & is not a payslip of record.';

function employeeName(p: PeriodGrossPay, names?: Record<string, string>): string {
  return names?.[p.employeeId]
    ?? p.shifts.find((s) => s.employeeName)?.employeeName
    ?? p.employeeId;
}

export const GrossPayPeriodView: React.FC<GrossPayPeriodViewProps> = ({
  periods,
  periodStart,
  periodEnd,
  employeeNames,
  isLoading = false,
  error,
  className,
}) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const sorted = useMemo(
    () => [...periods].sort((a, b) => employeeName(a, employeeNames).localeCompare(employeeName(b, employeeNames))),
    [periods, employeeNames],
  );

  const totals = useMemo(() => periods.reduce(
    (acc, p) => {
      acc.grossPay += p.grossPay;
      acc.paidHours += p.paidHours;
      return acc;
    },
    { grossPay: 0, paidHours: 0 },
  ), [periods]);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
      >
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-sm font-medium leading-snug">{DISCLAIMER}</p>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">
          Pay run <span className="font-mono text-sm text-muted-foreground">{periodStart} → {periodEnd}</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          {periods.length} employee{periods.length === 1 ? '' : 's'} · {formatHours(totals.paidHours)} paid ·{' '}
          <span className="font-semibold text-foreground">{formatCost(totals.grossPay)}</span> gross
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
          Loading gross pay…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-8 text-center text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
          Failed to load gross pay for this period.
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
          No gross pay records for this period.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/40">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="w-10 px-3 py-2" aria-label="Expand" />
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2 text-right">Shifts</th>
                  <th className="px-3 py-2 text-right">Paid hours</th>
                  <th className="px-3 py-2">Salary</th>
                  <th className="px-3 py-2 text-right">Gross pay</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const isOpen = !!expanded[p.employeeId];
                  const salaried = p.salariedHours != null;
                  return (
                    <React.Fragment key={p.employeeId}>
                      <tr
                        onClick={() => toggle(p.employeeId)}
                        className={cn('cursor-pointer border-b border-border/30 transition-colors hover:bg-muted/20', isOpen && 'bg-muted/10')}
                      >
                        <td className="px-3 py-2.5 text-center text-muted-foreground">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggle(p.employeeId); }}
                            aria-expanded={isOpen}
                            aria-label={isOpen ? 'Hide earnings' : 'Show earnings'}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted/40"
                          >
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-foreground">{employeeName(p, employeeNames)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{p.shiftCount}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatHours(p.paidHours)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {salaried
                            ? `${formatHours(p.salariedHours ?? 0)} worked${p.timeInLieuHours ? ` · ${formatHours(p.timeInLieuHours)} time in lieu` : ''}`
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">{formatCost(p.grossPay)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-border/30 bg-muted/5">
                          <td />
                          <td colSpan={5} className="px-3 py-4">
                            <div className="max-w-3xl">
                              <EarningsLinesTable period={p} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default GrossPayPeriodView;
