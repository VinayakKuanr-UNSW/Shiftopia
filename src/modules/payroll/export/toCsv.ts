/**
 * GROSS-pay CSV serialiser — RFC-4180-safe, dependency-free (hand-rolled, no
 * CSV lib).
 *
 * GROSS ↔ PROVIDER BOUNDARY: this file emits GROSS earnings only. It never
 * computes tax, super or net. The boundary is enforced two ways:
 *   1. A leading, quoted "GROSS ONLY …" banner row (valid single-field CSV
 *      record — parseable, and it does NOT collide with the header because it
 *      is a distinct first line the reader can skip or assert on).
 *   2. A `grossOnly` column on every data row whose value is literally `true`.
 *
 * Determinism: columns and rows are emitted in a fixed order (see COLUMNS and
 * the flattening in payload/row builders); amounts are fixed 2-dp strings.
 */

import type { PeriodGrossPay } from '../model/gross-pay.types';
import {
  GROSS_ONLY_NOTE,
  type PayrollExportRow,
} from './payroll-export.types';
import { toExportRows, EXPORT_COLUMNS } from './rows';

/** Fixed, deterministic column order for the flattened CSV. */
const COLUMNS = EXPORT_COLUMNS;

/** Human-readable header labels, 1:1 with COLUMNS. */
const HEADER_LABELS: Record<(typeof COLUMNS)[number], string> = {
  grossOnly: 'gross_only',
  employeeId: 'employee_id',
  periodId: 'period_id',
  periodStart: 'period_start',
  periodEnd: 'period_end',
  earningsCode: 'earnings_code',
  earningsDescription: 'earnings_description',
  hours: 'hours',
  amount: 'amount',
  periodGross: 'period_gross',
};

/**
 * RFC-4180 field escaping: a field is quoted iff it contains a comma, a double
 * quote, CR or LF; embedded double quotes are escaped by doubling them.
 */
export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Format a currency number as a fixed 2-dp string (e.g. 240 → "240.00"). */
function money(n: number): string {
  // Normalise -0 to 0 so we never emit "-0.00".
  const v = Object.is(n, -0) ? 0 : n;
  return v.toFixed(2);
}

/** Serialise one flattened row into a CSV record (no trailing newline). */
function rowToCsv(row: PayrollExportRow): string {
  const cells = COLUMNS.map((col): string => {
    switch (col) {
      case 'grossOnly':
        return 'true';
      case 'periodId':
        return csvEscape(row.periodId ?? '');
      case 'hours':
        return row.hours === null ? '' : String(row.hours);
      case 'amount':
        return money(row.amount);
      case 'periodGross':
        return money(row.periodGross);
      case 'employeeId':
      case 'periodStart':
      case 'periodEnd':
      case 'earningsCode':
      case 'earningsDescription':
        return csvEscape(String(row[col]));
      default: {
        // Exhaustiveness guard — a new column must be handled explicitly.
        const _never: never = col;
        return _never;
      }
    }
  });
  return cells.join(',');
}

/**
 * Serialise `PeriodGrossPay[]` into RFC-4180 CSV.
 *
 * Layout:
 *   line 1 : quoted GROSS-ONLY banner (single field, skippable/assertable)
 *   line 2 : header row (deterministic column labels)
 *   line 3+: one row per (employee, period, earnings-code)
 *
 * Empty input still yields the banner + header (a valid, header-only export).
 * Records are CRLF-terminated per RFC-4180; the final record has no trailing
 * newline.
 */
export function toGrossPayCsv(periods: PeriodGrossPay[]): string {
  const banner = csvEscape(GROSS_ONLY_NOTE);
  const header = COLUMNS.map((c) => csvEscape(HEADER_LABELS[c])).join(',');
  const rows = toExportRows(periods).map(rowToCsv);
  return [banner, header, ...rows].join('\r\n');
}
