/**
 * DB-row shapes for the gross-pay read adapter.
 *
 * These are the SUBSET of `shifts` / `timesheets` / `billables` / `profiles`
 * columns the adapter selects — hand-typed so the pure mapper is unit-testable
 * WITHOUT the generated Supabase types (which pull in the whole schema and
 * aren't stable across sibling-agent edits). They mirror the real column
 * names/casing exactly (see attendance_arrival_track, attendance_departure_track,
 * and timesheet_status enums).
 */

import type { ShiftPayContract } from '../domain/shiftPayTerms';

/** Ground-truth attendance actuals row from `public.timesheets` (1:1 by shift_id). */
export interface GrossPayAttendanceRow {
  id: string;
  shift_id: string;
  clock_in: string | null;
  clock_out: string | null;
  arrival_track?: 'early_in' | 'on_time' | 'late_in' | 'missing' | string | null;
  departure_track?: 'early_out' | 'on_time' | 'late_out' | 'missing' | string | null;
  is_no_show?: boolean | null;
}

/** Manager-verified billable & payroll row from `public.billables` (1:1 by shift_id). */
export interface GrossPayBillableRow {
  id: string;
  shift_id: string | null;
  /** Manager-adjusted billable start — 'HH:MM[:SS]' or null (no manual edit). */
  billable_start?: string | null;
  /** Manager-adjusted billable end — 'HH:MM[:SS]' or null. */
  billable_end?: string | null;
  /** Legacy alias for billable_start in pure unit-test fixtures. */
  start_time?: string | null;
  /** Legacy alias for billable_end in pure unit-test fixtures. */
  end_time?: string | null;
  unpaid_break_minutes: number | null;
  paid_break_minutes?: number | null;
  /** Manager-verified meal-break start — 'HH:MM[:SS]' or null. */
  break_start?: string | null;
  break_end?: string | null;
  /** Legacy alias for break_start in pure unit-test fixtures. */
  actual_break_start?: string | null;
  /** timesheet_status enum: 'draft'|'submitted'|'approved'|'rejected'|'no_show'. */
  status: string | null;
  payroll_exported?: boolean | null;
}

/** Compatibility alias for billable overlay rows attached to a shift. */
export type GrossPayTimesheetRow = GrossPayBillableRow;

/** Nested remuneration_levels embed (PostgREST returns object OR array). */
export interface GrossPayRemLevelEmbed {
  level_number?: number | null;
  level_name?: string | null;
}

/** Nested roles embed. */
export interface GrossPayRoleEmbed {
  id?: string | null;
  name?: string | null;
  remuneration_level?: number | null;
}

/**
 * The `shifts` row (+ embeds + attached timesheet + resolved employment type)
 * that {@link mapShiftRowToGrossPayInput} consumes. `_timesheet` and
 * `_employmentType` are attached by the fetcher AFTER the query, so the mapper
 * itself does no I/O.
 */
export interface GrossPayShiftRow {
  id: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  start_at?: string | null;
  end_at?: string | null;
  is_overnight?: boolean | null;
  /** shift_lifecycle enum: 'Draft'|'Published'|'InProgress'|'Completed'|'Cancelled'. */
  lifecycle_status?: string | null;
  /** shift_assignment_status: 'unassigned'|'assigned'|'pending'|'declined'. */
  assignment_status?: string | null;
  assignment_outcome?: string | null;
  /** Hydrated attendance status (derived from `public.timesheets` + `public.billables`). */
  attendance_status?: string | null;
  /** Hydrated raw clock-in from `public.timesheets.clock_in`. */
  actual_start?: string | null;
  /** Hydrated raw clock-out from `public.timesheets.clock_out`. */
  actual_end?: string | null;
  paid_break_minutes?: number | null;
  unpaid_break_minutes?: number | null;
  /** The rostered meal-break start — 'HH:MM[:SS]' or null. */
  break_start?: string | null;
  net_length_minutes?: number | null;
  scheduled_length_minutes?: number | null;
  remuneration_level?: number | null;
  /** 'FT' | 'PT' | 'Casual' — the shift's own employment basis. */
  target_employment_type?: string | null;
  /** The assignee's contract this shift is worked under (set by trg_shift_z_link_contract). */
  user_contract_id?: string | null;
  assigned_employee_id: string | null;
  role_id?: string | null;
  /** cl 28.2 — true when the employer appointed this employee to First Aid duty on this shift. */
  is_first_aid_duty?: boolean | null;
  /** Flag for training shifts — drives the EBA minimum-engagement 2h tier. */
  is_training?: boolean | null;
  is_cancelled?: boolean | null;
  organization_id?: string | null;
  department_id?: string | null;
  sub_department_id?: string | null;

  // PostgREST embeds — may arrive as a single object or a one-element array.
  roles?: GrossPayRoleEmbed | GrossPayRoleEmbed[] | null;
  remuneration_levels?: GrossPayRemLevelEmbed | GrossPayRemLevelEmbed[] | null;

  // ── Attached by the fetcher (not selected columns) ──────────────────────
  /** Actual unpaid break minutes summed from completed `timesheet_breaks`. */
  _actualUnpaidBreakMinutes?: number | null;
  /** True when manager explicitly entered/overrode unpaid break on billables. */
  _unpaidBreakIsManual?: boolean;
  /** The employee's employment_type from `profiles` (raw DB value, e.g. 'casual'). */
  _employmentType?: string | null;
  /** The employee's substantive contract remuneration level. */
  _contractRemunerationLevel?: number | null;
  /**
   * The LINKED contract's pay terms on the shift date (hr.contract_pay_terms),
   * when `user_contract_id` is the assignee's own contract. Present ⇒ the shift
   * is paid on the contract's terms (see shiftPayTerms.ts); absent ⇒ on the
   * shift's own level and target.
   */
  _payContract?: ShiftPayContract | null;
  /**
   * The assignee has a contract the shift can be paid on — the linked one, or
   * an active one. False ⇒ nothing to price on (the ledger's NO CONTRACT);
   * undefined ⇒ not looked up.
   */
  _hasActiveContract?: boolean;
  // ── Apprentice / Trainee / SWS contract fields (H1 audit fix) ──────────
  /** Schedule 4 apprentice. */
  _isApprentice?: boolean;
  _apprenticeType?: 'standard' | 'adult' | 'school_based';
  _apprenticeYear?: number;
  _hasCompletedYear12?: boolean;
  /** Schedule 5 trainee. */
  _isTrainee?: boolean;
  _traineeCategory?: 'junior' | 'adult' | 'school_based';
  _traineeLevel?: 'A' | 'B';
  _traineeExitYear?: number;
  _traineeYearsOut?: number;
  _traineeAqfLevel?: number;
  _traineeYear?: number;
  /** Schedule 6 SWS. */
  _isSws?: boolean;
  _swsCapacityPercentage?: number;
  /** Ground-truth attendance actuals from `public.timesheets` for this shift, if any. */
  _attendance?: GrossPayAttendanceRow | null;
  /** Manager-verified billables overlay from `public.billables` for this shift, if any. */
  _billable?: GrossPayBillableRow | null;
  /** Compatibility alias for `_billable` (used by existing pure unit tests). */
  _timesheet?: GrossPayTimesheetRow | null;
}

/** Optional provenance a caller may want alongside each mapped input. */
export interface GrossPayInputProvenance {
  /** Raw timesheet_status ('approved' | 'no_show' | null …). */
  timesheetStatus: string | null;
  /** True when billable times came from a manager edit (timesheet.start/end_time). */
  managerEdited: boolean;
  /** True when the employee's employment type could not be resolved. */
  employmentTypeMissing: boolean;
}
