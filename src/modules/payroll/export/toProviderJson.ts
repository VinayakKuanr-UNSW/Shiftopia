/**
 * GROSS-pay provider JSON serialiser — pure, no network.
 *
 * Produces a structured payload suitable for POSTing to a certified payroll
 * provider adapter. This function does NOT perform any I/O.
 *
 * SEAM: a real provider adapter (e.g. STP-enabled) consumes this payload —
 * it is the point where the certified provider takes over PAYG withholding,
 * superannuation guarantee, STP reporting and net-pay disbursement. None of
 * those figures are computed here.
 *
 * GROSS ↔ PROVIDER BOUNDARY: the payload's `grossOnly` field is a required,
 * literal-`true` value and the `note` banner spells out the exclusion, so the
 * boundary survives JSON serialisation and downstream schema validation.
 */

import type { PeriodGrossPay } from '../model/gross-pay.types';
import {
  GROSS_ONLY,
  GROSS_ONLY_NOTE,
  type ProviderGrossPayPayload,
  type ProviderEmployeePeriod,
  type ProviderPayloadMeta,
} from './payroll-export.types';

/** Round a currency number to whole cents (defensive; domain is already cents). */
function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Min of two YYYY-MM-DD strings (lexicographic == chronological for ISO). */
function minDate(a: string | null, b: string): string {
  return a === null || b < a ? b : a;
}

/** Max of two YYYY-MM-DD strings. */
function maxDate(a: string | null, b: string): string {
  return a === null || b > a ? b : a;
}

/**
 * Serialise `PeriodGrossPay[]` into a provider-ready JSON payload.
 *
 * @param periods gross-pay hand-off records (one per employee per period)
 * @param meta    optional stamp (generatedAt, source, payRunId)
 *
 * Determinism note: `generatedAt` defaults to `new Date().toISOString()`, which
 * is the ONE non-deterministic input — pass `meta.generatedAt` to make the
 * payload fully reproducible (tests do this).
 *
 * Empty input yields a well-formed payload: empty `employees`, `totalGross` 0,
 * null period bounds — never a throw.
 */
export function toGrossPayProviderPayload(
  periods: PeriodGrossPay[],
  meta?: ProviderPayloadMeta,
): ProviderGrossPayPayload {
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let totalGross = 0;

  const employees: ProviderEmployeePeriod[] = periods.map((p): ProviderEmployeePeriod => {
    periodStart = minDate(periodStart, p.periodStart);
    periodEnd = maxDate(periodEnd, p.periodEnd);
    totalGross += p.grossPay;

    return {
      employeeId: p.employeeId,
      ...(p.periodId !== undefined ? { periodId: p.periodId } : {}),
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      lines: p.lines.map((l) => ({
        code: l.code,
        description: l.description,
        hours: l.hours ?? null,
        amount: l.amount,
      })),
      grossPay: p.grossPay,
      paidHours: p.paidHours,
      shiftCount: p.shiftCount,
    };
  });

  return {
    grossOnly: GROSS_ONLY,
    note: GROSS_ONLY_NOTE,
    generatedAt: meta?.generatedAt ?? new Date().toISOString(),
    ...(meta?.source !== undefined ? { source: meta.source } : {}),
    ...(meta?.payRunId !== undefined ? { payRunId: meta.payRunId } : {}),
    periodStart,
    periodEnd,
    totalGross: roundCents(totalGross),
    employeeCount: employees.length,
    employees,
  };
}
