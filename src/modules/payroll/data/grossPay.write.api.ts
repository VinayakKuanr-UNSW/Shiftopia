/**
 * Payroll — GROSS-pay persistence (write side).
 *
 * Persists the pure-domain gross-pay result (`PeriodGrossPay` from
 * `src/modules/payroll`) into Postgres and gives the two dormant baseline
 * tables their first writer:
 *   - public.gross_pay_records   (NEW — migration 20260709100000_gross_pay_records.sql)
 *   - public.shift_payroll_records (per-shift actuals / export status)
 *   - public.pay_periods           (period bounds + open|locked|paid status)
 *
 * SCOPE BOUNDARY — GROSS pay ONLY. Tax (PAYG), superannuation, STP reporting and
 * net-pay disbursement are OUT of scope and belong to a certified payroll
 * provider. This layer only persists the itemised GROSS earnings hand-off.
 *
 * RLS: `gross_pay_records`, `shift_payroll_records` and `pay_periods` writes are
 * (or, for gross_pay_records, will be) service_role-gated in the migration. These
 * functions are therefore intended to run from a privileged context (an edge
 * function / server task using a service_role key) — NOT from the browser under
 * the anon key. When run under an insufficient key, Supabase returns an RLS
 * error which these functions surface as a thrown Error (matching the write-API
 * convention elsewhere in the repo, e.g. fairnessLedger.upsertBatch).
 *
 * NOTE: `gross_pay_records` is a brand-new table that is NOT yet present in the
 * generated `src/platform/supabase/types.ts` (that file is generated and must
 * not be hand-edited / regenerated here). Calls therefore go through the
 * `(supabase as any)` escape hatch — the same pattern used by
 * `rosters/api/fairnessLedger.queries.ts` for its untyped table. Row/insert
 * shapes are defined inline in this file.
 */

import { supabase } from '@/platform/supabase/client';
import type { PeriodGrossPay, ShiftGrossPay, EarningsLine } from '../model/gross-pay.types';

// ---------------------------------------------------------------------------
// Inline DB-row shapes (not in generated types — this write file owns them).
// ---------------------------------------------------------------------------

/** Lifecycle of a persisted gross-pay record (independent of pay_periods.status). */
export type GrossPayRecordStatus = 'draft' | 'final' | 'void';

/** How a gross-pay record was produced. */
export type GrossPayRecordSource = 'engine' | 'manual' | 'import';

/** A row of public.gross_pay_records as returned by Supabase. */
export interface GrossPayRecordRow {
  id: string;
  pay_period_id: string;
  employee_id: string;
  period_start_date: string;
  period_end_date: string;
  gross_pay: number;
  paid_hours: number;
  shift_count: number;
  lines: EarningsLine[];
  status: GrossPayRecordStatus;
  source: GrossPayRecordSource;
  source_shift_payroll_record_ids: string[];
  computed_at: string;
  computed_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Metadata that accompanies a persist call (provenance, not domain data). */
export interface PersistGrossPayMeta {
  /**
   * The pay_periods.id this record belongs to. Required because
   * gross_pay_records.pay_period_id is NOT NULL + FK. If you only have period
   * bounds, call `ensurePayPeriod` first to obtain one.
   */
  payPeriodId: string;
  /** Lifecycle to store. Defaults to 'draft'. */
  status?: GrossPayRecordStatus;
  /** Provenance of the numbers. Defaults to 'engine'. */
  source?: GrossPayRecordSource;
  /** profiles.id of whoever/whatever triggered the compute (nullable). */
  computedBy?: string | null;
  /**
   * Optional: the shift_payroll_records.id (or shift_id) rows that fed this
   * aggregate, for provenance. Kept simple — a flat uuid[] stored on the record.
   */
  sourceShiftPayrollRecordIds?: string[];
}

// ---------------------------------------------------------------------------
// 1) Persist a PeriodGrossPay (upsert into gross_pay_records).
// ---------------------------------------------------------------------------

/**
 * Upsert the computed gross pay for one employee for one pay period.
 *
 * Conflict target: (pay_period_id, employee_id) — the UNIQUE constraint from
 * migration 20260709100000. Re-running the engine for the same period simply
 * overwrites the prior aggregate (gross_pay / paid_hours / shift_count / lines).
 *
 * INPUT CONTRACT:
 *   - `record` is the pure-domain `PeriodGrossPay` produced by
 *     `computeEmployeePeriodGrossPay` / `aggregatePeriodGrossPay`. Only its
 *     aggregate fields are persisted here (employeeId, periodStart/End, lines,
 *     grossPay, paidHours, shiftCount). Per-shift `record.shifts[]` are NOT
 *     stored on this row — persist those separately via
 *     `upsertShiftPayrollActuals` if you also want per-shift actuals.
 *   - `meta.payPeriodId` MUST be a real pay_periods.id (see `ensurePayPeriod`).
 *
 * @returns the persisted row.
 * @throws  on any Supabase/RLS error.
 */
export async function persistPeriodGrossPay(
  record: PeriodGrossPay,
  meta: PersistGrossPayMeta,
): Promise<GrossPayRecordRow> {
  if (!meta?.payPeriodId) {
    throw new Error('persistPeriodGrossPay: meta.payPeriodId is required (call ensurePayPeriod first).');
  }
  if (!record?.employeeId) {
    throw new Error('persistPeriodGrossPay: record.employeeId is required.');
  }

  const insertRow = {
    pay_period_id: meta.payPeriodId,
    employee_id: record.employeeId,
    period_start_date: record.periodStart,
    period_end_date: record.periodEnd,
    gross_pay: round2(record.grossPay),
    paid_hours: round2(record.paidHours),
    shift_count: record.shiftCount,
    lines: record.lines ?? [],
    status: meta.status ?? 'draft',
    source: meta.source ?? 'engine',
    source_shift_payroll_record_ids: meta.sourceShiftPayrollRecordIds ?? [],
    computed_at: new Date().toISOString(),
    computed_by: meta.computedBy ?? null,
  };

  const { data, error } = await (supabase as any)
    .from('gross_pay_records')
    .upsert(insertRow, {
      onConflict: 'pay_period_id,employee_id',
      ignoreDuplicates: false,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[grossPay.write] persistPeriodGrossPay failed:', error.message);
    throw new Error(`persistPeriodGrossPay failed: ${error.message}`);
  }

  return data as GrossPayRecordRow;
}

/**
 * Batch variant of {@link persistPeriodGrossPay}. Persists many employees'
 * period gross pay in one round-trip. All records MUST share the same
 * `meta.payPeriodId` (they belong to the same pay period).
 *
 * @returns the persisted rows.
 * @throws  on any Supabase/RLS error.
 */
export async function persistPeriodGrossPayBatch(
  records: PeriodGrossPay[],
  meta: PersistGrossPayMeta,
): Promise<GrossPayRecordRow[]> {
  if (!meta?.payPeriodId) {
    throw new Error('persistPeriodGrossPayBatch: meta.payPeriodId is required (call ensurePayPeriod first).');
  }
  if (records.length === 0) return [];

  const nowIso = new Date().toISOString();
  const insertRows = records.map((record) => ({
    pay_period_id: meta.payPeriodId,
    employee_id: record.employeeId,
    period_start_date: record.periodStart,
    period_end_date: record.periodEnd,
    gross_pay: round2(record.grossPay),
    paid_hours: round2(record.paidHours),
    shift_count: record.shiftCount,
    lines: record.lines ?? [],
    status: meta.status ?? 'draft',
    source: meta.source ?? 'engine',
    source_shift_payroll_record_ids: meta.sourceShiftPayrollRecordIds ?? [],
    computed_at: nowIso,
    computed_by: meta.computedBy ?? null,
  }));

  const { data, error } = await (supabase as any)
    .from('gross_pay_records')
    .upsert(insertRows, {
      onConflict: 'pay_period_id,employee_id',
      ignoreDuplicates: false,
    })
    .select('*');

  if (error) {
    console.error('[grossPay.write] persistPeriodGrossPayBatch failed:', error.message);
    throw new Error(`persistPeriodGrossPayBatch failed: ${error.message}`);
  }

  return (data ?? []) as GrossPayRecordRow[];
}

// ---------------------------------------------------------------------------
// 2) Upsert per-shift actuals into shift_payroll_records.
// ---------------------------------------------------------------------------

/**
 * The raw actual timestamps for a single shift's payroll record.
 *
 * WHY THIS EXISTS / INPUT CONTRACT:
 *   `ShiftGrossPay` (the domain type) intentionally carries only the PRICED
 *   result — shiftId, shiftDate, hours and dollar lines. It does NOT carry the
 *   raw `actual_start` / `actual_end` clock timestamps that fed the pricing.
 *   shift_payroll_records, however, stores exactly those raw timestamps + a
 *   derived net-minutes figure. So the caller (the layer that ran the engine
 *   from approved timesheet/adjusted times) MUST supply those raw actuals
 *   alongside each ShiftGrossPay. This type is that supplement, keyed by
 *   `shiftId` so it can be matched to the corresponding ShiftGrossPay.
 *
 *   `actualStart` / `actualEnd` are ISO-8601 timestamptz strings (the same
 *   `adjusted_start`/`adjusted_end` or `clock_in`/`clock_out` values that were
 *   priced upstream). `actualNetMinutes`, if omitted, is derived from
 *   (actualEnd - actualStart); if either bound is missing it is left null.
 */
export interface ShiftPayrollActualInput {
  /** shifts.id — the conflict key for shift_payroll_records (UNIQUE shift_id). */
  shiftId: string;
  /** ISO timestamptz of the actual/adjusted start that was priced. */
  actualStart: string | null;
  /** ISO timestamptz of the actual/adjusted end that was priced. */
  actualEnd: string | null;
  /** Net paid minutes (post-break). Derived from the bounds if omitted. */
  actualNetMinutes?: number | null;
  /** Optional link back to the source timesheet row. */
  timesheetId?: string | null;
}

/**
 * A ShiftGrossPay paired with its raw actual timestamps, so the priced result
 * and the underlying actuals can be written together.
 */
export interface ShiftGrossPayWithActuals {
  grossPay: ShiftGrossPay;
  actuals: ShiftPayrollActualInput;
}

/**
 * Upsert per-shift actuals into public.shift_payroll_records.
 *
 * INPUT CONTRACT (two accepted shapes):
 *   (a) `ShiftPayrollActualInput[]` — raw actuals only (the timestamps the
 *       engine priced from). Use this when you just need to record actuals.
 *   (b) `ShiftGrossPayWithActuals[]` — each ShiftGrossPay bundled with its raw
 *       actuals. `paidHours` from the ShiftGrossPay is used to fill
 *       `actualNetMinutes` when the caller did not supply one and the raw
 *       timestamp bounds are unavailable (paidHours * 60).
 *
 * The raw `actual_start` / `actual_end` timestamps ALWAYS come from the caller
 * (shape (a) directly, or `.actuals` in shape (b)) — never from ShiftGrossPay,
 * which does not carry them (see ShiftPayrollActualInput docs).
 *
 * Conflict target: shift_id (baseline UNIQUE constraint). Matches the existing
 * DB trigger's upsert semantics. `payroll_exported` is deliberately NOT written
 * here (owned by the export path); the upsert only touches the actuals columns.
 *
 * @returns number of rows written.
 * @throws  on any Supabase/RLS error.
 */
export async function upsertShiftPayrollActuals(
  input: ShiftPayrollActualInput[] | ShiftGrossPayWithActuals[],
): Promise<number> {
  if (input.length === 0) return 0;

  const rows = input.map((item) => {
    const withActuals = item as ShiftGrossPayWithActuals;
    const actuals: ShiftPayrollActualInput =
      'actuals' in item && withActuals.actuals
        ? withActuals.actuals
        : (item as ShiftPayrollActualInput);
    const grossPay: ShiftGrossPay | undefined =
      'grossPay' in item ? withActuals.grossPay : undefined;

    if (!actuals.shiftId) {
      throw new Error('upsertShiftPayrollActuals: every entry must include a shiftId.');
    }

    return {
      shift_id: actuals.shiftId,
      actual_start: actuals.actualStart ?? null,
      actual_end: actuals.actualEnd ?? null,
      actual_net_minutes: deriveNetMinutes(actuals, grossPay),
      timesheet_id: actuals.timesheetId ?? null,
    };
  });

  const { data, error } = await (supabase as any)
    .from('shift_payroll_records')
    .upsert(rows, {
      onConflict: 'shift_id',
      ignoreDuplicates: false,
    })
    .select('id');

  if (error) {
    console.error('[grossPay.write] upsertShiftPayrollActuals failed:', error.message);
    throw new Error(`upsertShiftPayrollActuals failed: ${error.message}`);
  }

  return (data ?? []).length;
}

// ---------------------------------------------------------------------------
// 3) ensurePayPeriod — find-or-create a pay_periods row (dormant-table writer).
// ---------------------------------------------------------------------------

/** Period bounds for find-or-create. Dates are YYYY-MM-DD (inclusive). */
export interface PayPeriodBounds {
  periodStartDate: string;
  periodEndDate: string;
  /**
   * pay_periods.cutoff_date is NOT NULL in the baseline. Defaults to
   * `periodEndDate` when the caller does not supply one.
   */
  cutoffDate?: string;
  /** Defaults to 'open'. */
  status?: 'open' | 'locked' | 'paid';
}

/**
 * Find-or-create a public.pay_periods row for the given bounds and return its id.
 *
 * There is no unique constraint on (period_start_date, period_end_date) in the
 * baseline, so this does an explicit SELECT-then-INSERT rather than an upsert
 * (to avoid silently creating duplicate periods). Concurrency note: a rare race
 * could create two rows for identical bounds; the caller should serialise
 * period creation if that matters.
 *
 * INPUT CONTRACT: `bounds.periodStartDate` / `periodEndDate` are required
 * YYYY-MM-DD strings; `cutoffDate` defaults to `periodEndDate`; `status`
 * defaults to 'open'.
 *
 * @returns the existing-or-new pay_periods.id.
 * @throws  on any Supabase/RLS error.
 */
export async function ensurePayPeriod(bounds: PayPeriodBounds): Promise<string> {
  if (!bounds?.periodStartDate || !bounds?.periodEndDate) {
    throw new Error('ensurePayPeriod: periodStartDate and periodEndDate are required.');
  }

  // 1) Try to find an existing period with the exact same bounds.
  const { data: existing, error: findError } = await (supabase as any)
    .from('pay_periods')
    .select('id')
    .eq('period_start_date', bounds.periodStartDate)
    .eq('period_end_date', bounds.periodEndDate)
    .limit(1)
    .maybeSingle();

  if (findError) {
    console.error('[grossPay.write] ensurePayPeriod lookup failed:', findError.message);
    throw new Error(`ensurePayPeriod lookup failed: ${findError.message}`);
  }
  if (existing?.id) {
    return existing.id as string;
  }

  // 2) Not found — create it.
  const { data: created, error: insertError } = await (supabase as any)
    .from('pay_periods')
    .insert({
      period_start_date: bounds.periodStartDate,
      period_end_date: bounds.periodEndDate,
      cutoff_date: bounds.cutoffDate ?? bounds.periodEndDate,
      status: bounds.status ?? 'open',
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[grossPay.write] ensurePayPeriod insert failed:', insertError.message);
    throw new Error(`ensurePayPeriod insert failed: ${insertError.message}`);
  }

  return created.id as string;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Round to whole cents (numeric(12,2) / numeric(8,2) DB columns). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Derive shift_payroll_records.actual_net_minutes.
 * Priority: explicit input -> (actualEnd - actualStart) -> ShiftGrossPay.paidHours*60 -> null.
 */
function deriveNetMinutes(
  actuals: ShiftPayrollActualInput,
  grossPay?: ShiftGrossPay,
): number | null {
  if (typeof actuals.actualNetMinutes === 'number') {
    return Math.round(actuals.actualNetMinutes);
  }
  if (actuals.actualStart && actuals.actualEnd) {
    const startMs = Date.parse(actuals.actualStart);
    const endMs = Date.parse(actuals.actualEnd);
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs >= startMs) {
      return Math.round((endMs - startMs) / 60000);
    }
  }
  if (grossPay && typeof grossPay.paidHours === 'number') {
    return Math.round(grossPay.paidHours * 60);
  }
  return null;
}
