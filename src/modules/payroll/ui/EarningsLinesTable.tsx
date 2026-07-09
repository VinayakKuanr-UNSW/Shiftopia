/**
 * EarningsLinesTable — pure/presentational render of a PeriodGrossPay's
 * aggregated earnings lines (code → description, hours, amount) with a gross
 * total row.
 *
 * GROSS pay only. This is NOT a payslip of record — PAYG withholding,
 * superannuation and net disbursement are handled by a certified payroll
 * provider (see model/gross-pay.types.ts).
 *
 * Dark-first, light-mode safe: every colour utility is paired with a light
 * counterpart (no bare text-white / bg-black).
 */

import React from 'react';
import type { PeriodGrossPay, EarningsLine } from '../model/gross-pay.types';
import { formatCost } from '../../rosters/domain/projections/utils/cost';

export interface EarningsLinesTableProps {
  period: PeriodGrossPay;
  /** Optional extra classes on the wrapping <table>. */
  className?: string;
}

function formatHours(hours: number | undefined): string {
  if (hours == null) return '—';
  // Trim a trailing .0 so whole hours read cleanly (7.5h, 8h).
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded}h`;
}

/**
 * Presentational table. Takes a fully-computed PeriodGrossPay via props and
 * renders its already-aggregated `lines` plus a gross total footer row.
 */
export const EarningsLinesTable: React.FC<EarningsLinesTableProps> = ({ period, className }) => {
  const { lines, grossPay } = period;

  return (
    <table
      className={
        'w-full text-sm border-collapse ' + (className ?? '')
      }
      aria-label="Gross earnings breakdown"
    >
      <thead>
        <tr className="border-b border-slate-200 dark:border-white/10 text-left">
          <th
            scope="col"
            className="py-2 pr-4 font-semibold text-slate-600 dark:text-slate-300"
          >
            Earnings
          </th>
          <th
            scope="col"
            className="py-2 px-4 font-semibold text-right text-slate-600 dark:text-slate-300"
          >
            Hours
          </th>
          <th
            scope="col"
            className="py-2 pl-4 font-semibold text-right text-slate-600 dark:text-slate-300"
          >
            Amount
          </th>
        </tr>
      </thead>

      <tbody>
        {lines.length === 0 ? (
          <tr>
            <td
              colSpan={3}
              className="py-3 text-center text-slate-500 dark:text-slate-400"
            >
              No earnings for this period.
            </td>
          </tr>
        ) : (
          lines.map((line: EarningsLine) => (
            <tr
              key={line.code}
              className="border-b border-slate-100 dark:border-white/5"
            >
              <td className="py-2 pr-4 text-slate-800 dark:text-slate-100">
                {line.description}
              </td>
              <td className="py-2 px-4 text-right tabular-nums text-slate-600 dark:text-slate-300">
                {formatHours(line.hours)}
              </td>
              <td className="py-2 pl-4 text-right tabular-nums text-slate-900 dark:text-white">
                {formatCost(line.amount)}
              </td>
            </tr>
          ))
        )}
      </tbody>

      <tfoot>
        <tr className="border-t-2 border-slate-300 dark:border-white/20">
          <th
            scope="row"
            className="py-2 pr-4 text-left font-bold text-slate-900 dark:text-white"
          >
            Gross pay
          </th>
          <td className="py-2 px-4" aria-hidden="true" />
          <td
            className="py-2 pl-4 text-right font-bold tabular-nums text-slate-900 dark:text-white"
            data-testid="gross-total"
          >
            {formatCost(grossPay)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
};

export default EarningsLinesTable;
