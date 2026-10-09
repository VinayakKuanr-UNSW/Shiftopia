/**
 * The shift pay ledger — Gross Pay's per-shift record, and the ONLY place a
 * shift's pay is shown (decision 2026-10-09: money lives in Gross Pay alone).
 *
 * Every shift in the period appears, whatever its state. Each assigned,
 * priceable shift carries three figures, all on the assignee's linked contract:
 *
 *   Scheduled — the rostered window.
 *   Actual    — the raw clock-in → clock-out, to the minute.
 *   Billable  — the payroll-resolved window (manager edit, else the actual
 *               snapped to 15 min), i.e. what gets paid.
 *
 * All three include the EBA minimum-payment floor (cl 12.3–12.5, 56.2) — it is
 * a minimum PAYMENT, so every pay figure carries it — and all three are priced
 * through the period aggregator, so weekly overtime (cl 42), the rest-gap
 * double-time floor (cl 40.1) and the split-shift allowance (cl 28.4) land on
 * the shift they belong to.
 */

import type { PayBasis } from '@/modules/users/domain/contractPayTerms';
import type { ShiftFSMInput } from '@/modules/rosters/domain/shift-fsm';
import type { EarningsLine } from './gross-pay.types';

export type LedgerColumn = 'scheduled' | 'actual' | 'billable';

/** What one of a shift's three pay figures is. */
export type LedgerCell =
  | { kind: 'priced'; amount: number; hours: number; lines: EarningsLine[] }
  /** Salaried contract: no per-shift pay — the salary is paid per period. */
  | { kind: 'salaried'; hours: number }
  /** The shift has not started. */
  | { kind: 'not_worked_yet' }
  /** Clocked in, not out yet, and the shift is not over. */
  | { kind: 'in_progress' }
  /** The shift is over but a clock-in or clock-out is missing. */
  | { kind: 'no_clock' }
  | { kind: 'no_show' };

/**
 * Why a row has, or has no, pay figures. Only 'priced' rows carry cells —
 * pay depends on the assignee's contract, so a shift without one cannot be
 * priced at all.
 */
export type LedgerRowState = 'priced' | 'unassigned' | 'no_contract' | 'cancelled';

export interface ShiftPayLedgerRow {
  shiftId: string;
  shiftDate: string;            // YYYY-MM-DD
  /** Rostered window, 'HH:MM'. */
  startTime: string | null;
  endTime: string | null;
  employeeId: string | null;
  employeeName?: string;
  roleName?: string;
  groupName?: string;
  subGroupName?: string;
  organizationId?: string | null;
  departmentId?: string | null;
  subDepartmentId?: string | null;
  lifecycleStatus: string | null;
  timesheetStatus: string | null;
  /** The fields the shift FSM reads, for the state badge. */
  fsm: ShiftFSMInput;
  employmentType?: string;
  payBasis?: PayBasis;
  isSecurityRole?: boolean;
  /** Salaried contract terms — the salary is a period cost (see labourCost.ts). */
  annualSalary?: number;
  contractedWeeklyHours?: number;

  state: LedgerRowState;
  /** Present exactly when state === 'priced'. */
  scheduled?: LedgerCell;
  actual?: LedgerCell;
  billable?: LedgerCell;
  /** Billable Pay is final — the timesheet is approved or locked. */
  billableFinal: boolean;
}

export interface LedgerColumnSummary {
  /** Sum of the priced figures. */
  total: number;
  /** Shifts with a priced figure in this column. */
  priced: number;
  /** Shifts on a salaried contract (no per-shift figure). */
  salaried: number;
  /** Assigned shifts with no figure yet (not worked, in progress, missing clock). */
  pending: number;
}

export interface LedgerSummary {
  shiftCount: number;
  unassigned: number;
  noContract: number;
  cancelled: number;
  scheduled: LedgerColumnSummary;
  actual: LedgerColumnSummary;
  billable: LedgerColumnSummary;
  /** Billable Pay on approved / locked timesheets — what this period pays out per shift. */
  payable: number;
  /** Priced Billable Pay whose timesheet is not approved yet. */
  unverified: number;
}
