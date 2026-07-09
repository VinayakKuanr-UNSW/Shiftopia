/**
 * GrossPayPeriodView — presentational summary of one pay period's gross pay,
 * one row per employee, each expandable into its itemised earnings breakdown
 * (reuses EarningsLinesTable).
 *
 * GROSS estimate only — a prominent banner makes clear this excludes PAYG tax
 * and superannuation and is NOT a payslip of record.
 *
 * Dark-first, light-mode safe: every colour utility is paired with a light
 * counterpart.
 */

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import type { PeriodGrossPay } from '../model/gross-pay.types';
import { formatCost } from '../../rosters/domain/projections/utils/cost';
import { EarningsLinesTable } from './EarningsLinesTable';

export interface GrossPayPeriodViewProps {
  periods: PeriodGrossPay[];
  /** Period bounds (YYYY-MM-DD, inclusive) for the header. */
  periodStart: string;
  periodEnd: string;
  /**
   * Optional employee-id → display-name map. When absent, the employeeId is
   * shown (this surface is presentational and does not fetch profiles).
   */
  employeeNames?: Record<string, string>;
  isLoading?: boolean;
  error?: unknown;
  className?: string;
}

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded}h`;
}

const DISCLAIMER =
  'GROSS estimate — excludes PAYG tax, superannuation & is not a payslip of record.';

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

  const toggle = (employeeId: string) =>
    setExpanded((prev) => ({ ...prev, [employeeId]: !prev[employeeId] }));

  const totals = useMemo(() => {
    return periods.reduce(
      (acc, p) => {
        acc.grossPay += p.grossPay;
        acc.paidHours += p.paidHours;
        acc.shiftCount += p.shiftCount;
        return acc;
      },
      { grossPay: 0, paidHours: 0, shiftCount: 0 },
    );
  }, [periods]);

  return (
    <div className={'flex flex-col gap-4 ' + (className ?? '')}>
      {/* ── Disclaimer banner ─────────────────────────────────────────── */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
      >
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-sm font-medium leading-snug">{DISCLAIMER}</p>
      </div>

      {/* ── Period header + roll-up totals ────────────────────────────── */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Pay period{' '}
          <span className="font-mono text-sm text-slate-600 dark:text-slate-300">
            {periodStart} → {periodEnd}
          </span>
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {periods.length} employee{periods.length === 1 ? '' : 's'} ·{' '}
          {formatHours(totals.paidHours)} paid ·{' '}
          <span className="font-semibold text-slate-900 dark:text-white">
            {formatCost(totals.grossPay)}
          </span>{' '}
          gross
        </p>
      </div>

      {/* ── States ────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white/60 px-4 py-8 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-400">
          Loading gross pay…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-8 text-center text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
          Failed to load gross pay for this period.
        </div>
      ) : periods.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white/60 px-4 py-8 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-400">
          No gross pay records for this period.
        </div>
      ) : (
        /* ── Per-employee list ───────────────────────────────────────── */
        <ul className="flex flex-col gap-2">
          {periods.map((period) => {
            const isOpen = !!expanded[period.employeeId];
            const name =
              employeeNames?.[period.employeeId] ?? period.employeeId;
            const contentId = `gross-pay-detail-${period.employeeId}`;

            return (
              <li
                key={period.employeeId}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white/70 dark:border-white/10 dark:bg-slate-900/40"
              >
                <button
                  type="button"
                  onClick={() => toggle(period.employeeId)}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                >
                  <span className="text-slate-400 dark:text-slate-500" aria-hidden="true">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </span>

                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-white">
                    {name}
                  </span>

                  <span className="hidden text-sm text-slate-500 dark:text-slate-400 sm:inline">
                    {period.shiftCount} shift{period.shiftCount === 1 ? '' : 's'}
                  </span>

                  <span className="hidden text-sm tabular-nums text-slate-600 dark:text-slate-300 sm:inline">
                    {formatHours(period.paidHours)}
                  </span>

                  <span className="w-24 text-right font-semibold tabular-nums text-slate-900 dark:text-white">
                    {formatCost(period.grossPay)}
                  </span>
                </button>

                {isOpen && (
                  <div
                    id={contentId}
                    className="border-t border-slate-200 px-4 py-3 dark:border-white/10"
                  >
                    <EarningsLinesTable period={period} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default GrossPayPeriodView;
