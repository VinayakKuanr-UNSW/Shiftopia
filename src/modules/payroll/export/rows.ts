/**
 * Shared flattening — turns `PeriodGrossPay[]` into the deterministic
 * per-(employee, period, earnings-code) row grain used by the CSV serialiser
 * and (structurally) the tabular `PayrollExport`.
 *
 * GROSS ↔ PROVIDER BOUNDARY: every emitted row carries `grossOnly: true` and
 * only ever reflects domain GROSS lines — no tax/super/net is introduced here.
 */

import type { PeriodGrossPay } from '../model/gross-pay.types';
import { GROSS_ONLY, type PayrollExportRow } from './payroll-export.types';

/**
 * Deterministic column order for the flattened rows. `grossOnly` leads so the
 * boundary marker is the first thing any reader sees on a data row.
 */
export const EXPORT_COLUMNS = [
  'grossOnly',
  'employeeId',
  'periodId',
  'periodStart',
  'periodEnd',
  'earningsCode',
  'earningsDescription',
  'hours',
  'amount',
  'periodGross',
] as const satisfies readonly (keyof PayrollExportRow)[];

/**
 * Flatten periods into export rows. Grain = one row per earnings line. Rows are
 * emitted in input order of periods, then in each period's canonical
 * `lines` order (already aggregated-by-code by the domain layer).
 *
 * A period with zero earnings lines produces zero rows (there is nothing to
 * hand off for it); its gross is definitionally 0.
 */
export function toExportRows(periods: PeriodGrossPay[]): PayrollExportRow[] {
  const rows: PayrollExportRow[] = [];
  for (const p of periods) {
    for (const l of p.lines) {
      rows.push({
        grossOnly: GROSS_ONLY,
        employeeId: p.employeeId,
        periodId: p.periodId,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        earningsCode: l.code,
        earningsDescription: l.description,
        hours: l.hours ?? null,
        amount: l.amount,
        periodGross: p.grossPay,
      });
    }
  }
  return rows;
}
