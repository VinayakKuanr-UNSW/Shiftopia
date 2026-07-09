/**
 * Payroll GROSS-pay EXPORT SEAM (public surface).
 *
 * Serialises `PeriodGrossPay[]` into certified-provider hand-off formats. GROSS
 * earnings ONLY — PAYG tax, super, STP and net pay belong to the certified
 * provider (see model/gross-pay.types.ts and the `grossOnly` markers here).
 */

export {
  GROSS_ONLY,
  GROSS_ONLY_NOTE,
  type PayrollExport,
  type PayrollExportRow,
  type ProviderPayloadMeta,
  type ProviderEarningsLine,
  type ProviderEmployeePeriod,
  type ProviderGrossPayPayload,
} from './payroll-export.types';

export { toExportRows, EXPORT_COLUMNS } from './rows';
export { toGrossPayCsv, csvEscape } from './toCsv';
export { toGrossPayProviderPayload } from './toProviderJson';
