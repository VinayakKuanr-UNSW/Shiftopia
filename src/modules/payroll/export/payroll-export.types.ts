/**
 * Certified-provider EXPORT SEAM — row + payload shapes for handing GROSS pay
 * off to a certified payroll provider.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ GROSS ↔ PROVIDER BOUNDARY                                                   │
 * │ These shapes carry GROSS earnings ONLY. PAYG withholding, superannuation   │
 * │ guarantee, STP (Single Touch Payroll) reporting and NET pay are the        │
 * │ certified provider's responsibility. Nothing in this module invents,       │
 * │ derives or implies a tax / super / net figure. The `grossOnly` marker      │
 * │ below MUST be carried through every serialisation so a downstream system   │
 * │ can never mistake this hand-off for net pay.                               │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ROW DESIGN — chosen shape: ONE FLATTENED ROW PER (employee, period,
 * earnings-code). i.e. the earnings lines are the grain, NOT wide per-code
 * columns.
 *
 * Why this over "one row per (employee, period) with earnings columns":
 *   - Normalised & stable: the column set never changes when a new EarningsCode
 *     is added — no schema churn, no sparse/empty columns, provider-agnostic.
 *   - Line-by-line reconcilable: each row is exactly one `EarningsLine`, so a
 *     provider can sum `amount` per (employeeId, periodStart, periodEnd) and
 *     assert it equals the repeated `periodGross` on those rows.
 *   - CSV-friendly: fixed, deterministic column order regardless of which codes
 *     a given employee earned in a given period.
 * The `periodGross` (period total) is repeated on every row of the period so a
 * single row is self-describing and the total is verifiable without a join.
 */

import type { EarningsCode } from '../model/gross-pay.types';

/** Constant boundary marker — literally `true`, never absent, never net. */
export const GROSS_ONLY = true as const;

/** Human-readable banner carried into CSV/JSON so the boundary is unmissable. */
export const GROSS_ONLY_NOTE =
  'GROSS ONLY — excludes PAYG tax & super; net pay is the certified provider job';

/**
 * One flattened export row = one earnings line for one employee in one period.
 * Amounts are NUMBERS here (the domain currency); serialisers format to 2-dp
 * strings. Hours is `null` for per-shift/lump lines (no time basis).
 */
export interface PayrollExportRow {
  /** Boundary marker — always `true`. Present on every row. */
  readonly grossOnly: true;
  employeeId: string;
  periodId?: string;
  /** YYYY-MM-DD, inclusive. */
  periodStart: string;
  /** YYYY-MM-DD, inclusive. */
  periodEnd: string;
  /** Earnings-line category (payslip-group granularity). */
  earningsCode: EarningsCode;
  earningsDescription: string;
  /** Paid hours for time-based lines; `null` for per-shift/lump lines. */
  hours: number | null;
  /** GROSS amount for this line, in dollars (rounded to whole cents). */
  amount: number;
  /** The employee's GROSS total for the whole period (repeated per row). */
  periodGross: number;
}

/**
 * The full tabular export: header banner + deterministic column order + rows.
 * `toGrossPayCsv` consumes this indirectly; exposed for adapters that want the
 * structured (non-CSV) form of the same tabular grain.
 */
export interface PayrollExport {
  readonly grossOnly: true;
  readonly note: string;
  /** Deterministic, ordered column keys for the flattened rows. */
  columns: readonly (keyof PayrollExportRow)[];
  rows: PayrollExportRow[];
}

/** Optional caller-supplied metadata stamped onto the provider JSON payload. */
export interface ProviderPayloadMeta {
  /** ISO-8601; defaults to `new Date().toISOString()` when omitted. */
  generatedAt?: string;
  /** Free-form source/system tag (e.g. `'superman-ultimate@gross-pay'`). */
  source?: string;
  /** Optional pay-run / batch identifier for the provider to echo back. */
  payRunId?: string;
}

/** One earnings line inside a provider-JSON employee block. */
export interface ProviderEarningsLine {
  code: EarningsCode;
  description: string;
  hours: number | null;
  amount: number;
}

/** One employee's gross earnings for one period, in the provider payload. */
export interface ProviderEmployeePeriod {
  employeeId: string;
  periodId?: string;
  periodStart: string;
  periodEnd: string;
  lines: ProviderEarningsLine[];
  grossPay: number;
  paidHours: number;
  shiftCount: number;
}

/**
 * Structured JSON payload suitable for POSTing to a payroll-provider adapter.
 * `grossOnly` is a required, literal-`true` field so the boundary survives
 * JSON serialisation and any downstream schema validation.
 */
export interface ProviderGrossPayPayload {
  readonly grossOnly: true;
  readonly note: string;
  generatedAt: string;
  source?: string;
  payRunId?: string;
  /** Overall inclusive bounds spanning every employee period (null if empty). */
  periodStart: string | null;
  periodEnd: string | null;
  /** Sum of every employee's period gross (the payload-level control total). */
  totalGross: number;
  employeeCount: number;
  employees: ProviderEmployeePeriod[];
}
