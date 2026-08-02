/**
 * DB-row shapes for the gross-pay read adapter.
 *
 * These are the SUBSET of `shifts` / `timesheets` / `profiles` columns the
 * adapter selects — hand-typed so the pure mapper is unit-testable WITHOUT the
 * generated Supabase types (which pull in the whole schema and aren't stable
 * across sibling-agent edits). They mirror the real column names/casing exactly
 * (see supabase baseline: shift_attendance_status, timesheet_status enums).
 */

/** Timesheet row joined onto a shift (by shift_id). Only pay-relevant columns. */
export interface GrossPayTimesheetRow {
  id: string;
  shift_id: string | null;
  /** Manager-adjusted billable start — 'HH:MM[:SS]' or null (no manual edit). */
  start_time: string | null;
  /** Manager-adjusted billable end — 'HH:MM[:SS]' or null. */
  end_time: string | null;
  unpaid_break_minutes: number | null;
  /** timesheet_status enum: 'draft'|'submitted'|'approved'|'rejected'|'no_show'. */
  status: string | null;
}

/** Nested remuneration_levels embed (PostgREST returns object OR array). */
export interface GrossPayRemLevelEmbed {
  level_number?: number | null;
  level_name?: string | null;
  hourly_rate_min?: number | null;
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
  /** shift_attendance_status: 'unknown'|'checked_in'|'no_show'|'late'|'excused'|'auto_clock_out'. */
  attendance_status?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  paid_break_minutes?: number | null;
  unpaid_break_minutes?: number | null;
  net_length_minutes?: number | null;
  scheduled_length_minutes?: number | null;
  remuneration_rate?: number | null;
  remuneration_level?: number | null;
  assigned_employee_id: string | null;
  role_id?: string | null;
  /** cl 28.2 — true when the employer appointed this employee to First Aid duty on this shift. */
  is_first_aid_duty?: boolean | null;
  /** Flag for training shifts — drives the EBA minimum-engagement 2h tier. */
  is_training?: boolean | null;

  // PostgREST embeds — may arrive as a single object or a one-element array.
  roles?: GrossPayRoleEmbed | GrossPayRoleEmbed[] | null;
  remuneration_levels?: GrossPayRemLevelEmbed | GrossPayRemLevelEmbed[] | null;

  // ── Attached by the fetcher (not selected columns) ──────────────────────
  /** The employee's employment_type from `profiles` (raw DB value, e.g. 'casual'). */
  _employmentType?: string | null;
  /** The employee's substantive contract remuneration level. */
  _contractRemunerationLevel?: number | null;
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
  /** The APPROVED timesheet overlay for this shift, if any. */
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
