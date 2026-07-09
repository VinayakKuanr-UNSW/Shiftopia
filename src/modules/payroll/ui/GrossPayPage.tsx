/**
 * GrossPayPage — container page for the gross-pay surface. Owns a simple pay-
 * period selector, calls the `useGrossPay` container hook, and renders the
 * results through GrossPayPeriodView.
 *
 * GROSS pay only. Not a payslip of record (banner lives in GrossPayPeriodView).
 *
 * ROUTE: register at /payroll or similar. The router is a shared file that
 * another lane owns — this page is exported but intentionally NOT wired into
 * the route table here.
 *
 * Dark-first, light-mode safe: every colour utility is paired with a light
 * counterpart.
 */

import React, { useMemo, useState } from 'react';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { Wallet } from 'lucide-react';
import type { PeriodBounds } from '../domain/aggregatePeriodGrossPay';
import { useGrossPay } from '../state/useGrossPay';
import { GrossPayPeriodView } from './GrossPayPeriodView';

export interface GrossPayPageProps {
  /**
   * Optional fixed period bounds. When omitted the page shows its own
   * date-range selector (defaulting to the current Monday-anchored week).
   */
  bounds?: PeriodBounds;
  /** Optional employee-id → display-name map handed to the view. */
  employeeNames?: Record<string, string>;
}

/** Current Monday-anchored ISO week as inclusive YYYY-MM-DD bounds. */
function currentWeekBounds(): PeriodBounds {
  const now = new Date();
  return {
    periodStart: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    periodEnd: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
  };
}

export const GrossPayPage: React.FC<GrossPayPageProps> = ({ bounds, employeeNames }) => {
  const [range, setRange] = useState<PeriodBounds>(() => bounds ?? currentWeekBounds());

  // A caller-supplied fixed period locks the selector out.
  const controlled = !!bounds;
  const effectiveBounds = controlled ? bounds! : range;

  const { data, isLoading, error } = useGrossPay({ bounds: effectiveBounds });

  const periods = useMemo(() => data ?? [], [data]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200">
            <Wallet className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              Gross Pay
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Itemised gross earnings per employee, per pay period.
            </p>
          </div>
        </div>

        {!controlled && (
          <div className="flex items-end gap-2">
            <label className="flex flex-col text-xs font-medium text-slate-600 dark:text-slate-300">
              From
              <input
                type="date"
                value={range.periodStart}
                max={range.periodEnd}
                onChange={(e) =>
                  setRange((r) => ({ ...r, periodStart: e.target.value }))
                }
                className="mt-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-800 dark:text-white"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-slate-600 dark:text-slate-300">
              To
              <input
                type="date"
                value={range.periodEnd}
                min={range.periodStart}
                onChange={(e) =>
                  setRange((r) => ({ ...r, periodEnd: e.target.value }))
                }
                className="mt-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-800 dark:text-white"
              />
            </label>
          </div>
        )}
      </header>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-4 pb-6 lg:px-6">
        <GrossPayPeriodView
          periods={periods}
          periodStart={effectiveBounds.periodStart}
          periodEnd={effectiveBounds.periodEnd}
          employeeNames={employeeNames}
          isLoading={isLoading}
          error={error}
        />
      </main>
    </div>
  );
};

export default GrossPayPage;
