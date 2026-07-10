/**
 * Gross-pay LIVE read adapter — turns APPROVED ACTUAL timesheet data into the
 * `GrossPayShiftInput[]` the pure gross-pay engine prices, and (convenience)
 * into one `PeriodGrossPay` per employee for a pay period.
 *
 * MONEY-CRITICAL parity: the billable-hours + rate logic here is a faithful copy
 * of the existing timesheet reader (`timesheets/api/timesheets.supabase.api.ts`)
 * two-tier rule — manager edit ELSE snapped actual (only once the shift is
 * finished) — so gross pay is priced from the SAME billable minutes the manager
 * reviewed. All I/O lives in the fetchers; `mapShiftRowToGrossPayInput` is pure.
 *
 * DATA GAPS (documented, not fabricated — see the field comments below):
 *   • leave flags on the SHIFT mapper stay false — leave has no shift-level
 *     column. Leave pay is instead SYNTHESISED from approved leave_requests in
 *     `leaveGrossPay.ts` and merged in by `getPeriodGrossPay` (leave is an
 *     absence, not a shift), so leave IS now priced end-to-end.
 *   • allowances: not represented on approved timesheet data → left undefined
 *     (the engine still auto-derives the cl 28.1 meal allowance from overtime).
 *   • higherDutiesLevel: not carried on the shift row here → left undefined.
 *   • classificationLevel: derived from remuneration_levels.level_number
 *     ('LEVEL_N' / 'TRAINEE') so the engine resolves the effective-dated
 *     Schedule 2 rate, casual/permanent-aware — see the rate block below.
 */

import { supabase } from '@/platform/supabase/client';
import { isShiftFinished } from '@/modules/timesheets/ui/components/TimesheetTable.utils';
import { snapToQuarterHour } from '@/modules/timesheets/api/timesheets.supabase.api';
import {
  computeEmployeePeriodGrossPay,
  type PeriodBounds,
  type PeriodGrossPay,
} from '../index';
import type { GrossPayShiftInput } from '../domain/computeShiftGrossPay';
import type { GrossPayHoursSource } from '../model/gross-pay.types';
import type { CostCalculatorOptions } from '../../rosters/domain/projections/utils/cost/types';
import type {
  GrossPayShiftRow,
  GrossPayRoleEmbed,
  GrossPayRemLevelEmbed,
  GrossPayInputProvenance,
} from './types';
import { getLeaveGrossPayInputs } from './leaveGrossPay';

/** A mapped input plus its provenance (returned by the *WithProvenance fetch). */
export interface GrossPayInputWithProvenance {
  input: GrossPayShiftInput;
  provenance: GrossPayInputProvenance;
}

/** Scope + options for the period fetchers. */
export interface GrossPayPeriodBounds extends PeriodBounds {
  organizationId?: string | null;
  departmentId?: string | null;
  subDepartmentId?: string | null;
  orgIds?: string[];
  deptIds?: string[];
  subDeptIds?: string[];
}

export interface GrossPayFetchOptions {
  /**
   * When true (default) only shifts whose timesheet is FINAL — status ∈
   * {approved, locked} — are priced. This is the pay-run mode. When false, every
   * eligible shift is mapped (with its best-available billable hours) for
   * previews / estimates.
   */
  approvedOnly?: boolean;
  /**
   * When true (default) approved leave (annual / personal / carer) overlapping
   * the period is synthesised into leave-day inputs and included in the
   * per-employee rollup. Set false to price shifts only.
   */
  includeLeave?: boolean;
}

// ── enum constants (verified against the supabase baseline) ────────────────
const LIFECYCLE_PAYABLE = ['Draft', 'Published', 'InProgress', 'Completed'] as const;
const LIFECYCLE_CANCELLED = 'Cancelled';
const ATTENDANCE_NO_SHOW = 'no_show';
/** timesheet_status values that mean "final for pay". DB enum has no 'locked'; */
/** the TS model (timesheet.types) does — accept both, case-insensitively. */
const APPROVED_STATUSES = new Set(['approved', 'locked']);

// ───────────────────────── pure helpers ───────────────────────────────────

/** PostgREST embeds can be a single object OR a one-element array — normalize. */
function firstEmbed<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v.length > 0 ? v[0] : null;
  return v ?? null;
}

/** Parse 'HH:MM[:SS]' to minutes-since-midnight, or null if unparseable. */
function timeToMinutes(value: string | null | undefined): number | null {
  if (!value || value === 'NIL' || value === '-' || value === '—') return null;
  const parts = value.split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** Minutes-since-midnight back to canonical 'HH:MM'. */
function minutesToHHMM(mins: number): string {
  const norm = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Map the DB `profiles.employment_type` value to the award engine's union type.
 * Mirrors `useHardValidation.mapEmploymentTypeToContract` casing tolerance but
 * targets the CostCalculatorOptions union. Unknown / missing → null so the
 * caller can flag the gap; the award engine then defaults conservatively.
 */
export function mapEmploymentType(
  t: string | null | undefined,
): CostCalculatorOptions['employmentType'] | undefined {
  switch ((t ?? '').toLowerCase().replace(/[\s-]/g, '_')) {
    case 'full_time':
    case 'fulltime':
    case 'ft':
      return 'Full-Time';
    case 'part_time':
    case 'parttime':
    case 'pt':
      return 'Part-Time';
    case 'flexible_part_time':
    case 'flexi_part_time':
      return 'Flexible Part-Time';
    case 'casual':
      return 'Casual';
    default:
      return undefined;
  }
}

/**
 * PURE mapper: one `shifts` row (+ attached `_timesheet` / `_employmentType`) →
 * one `GrossPayShiftInput`, or null when the shift has no assigned employee.
 *
 * Billable hours (two-tier, COPIED from the timesheet reader):
 *   • adjustedStart = timesheet.start_time (manager edit)
 *                     ELSE snapped shift.actual_start (only if the shift finished)
 *   • adjustedEnd   likewise off timesheet.end_time / shift.actual_end
 *   • netMinutes    = (adjustedEnd − adjustedStart, +24h if overnight)
 *                     − unpaidBreak (timesheet.unpaid_break_minutes ?? shift.unpaid_break_minutes)
 *   • startTime / endTime returned as 'HH:MM'.
 *
 * rate = shift.remuneration_rate (explicit override) ELSE null + the derived
 * classificationLevel (engine resolves the effective-dated EBA rate) ELSE
 * remuneration_levels.hourly_rate_min as a last resort.
 * isSecurityRole = roles.name (lowercased) includes 'security'.
 * isNoShow  ⇐ attendance_status === 'no_show' OR timesheet.status === 'no_show'.
 * isCancelled ⇐ lifecycle_status === 'Cancelled' OR assignment_status ∈
 *               {declined, unassigned}.
 */
export function mapShiftRowToGrossPayInput(
  row: GrossPayShiftRow,
): GrossPayShiftInput | null {
  const employeeId = row.assigned_employee_id;
  if (!employeeId) return null; // unassigned shift — nobody to pay.

  const ts = row._timesheet ?? null;
  const role = firstEmbed<GrossPayRoleEmbed>(row.roles);
  const remLevel = firstEmbed<GrossPayRemLevelEmbed>(row.remuneration_levels);
  
  const empProfile = firstEmbed<any>((row as any).assigned_profiles);
  const employeeName = empProfile
    ? `${empProfile.first_name} ${empProfile.last_name}`.trim()
    : undefined;

  const rosterSubgroup = firstEmbed<any>((row as any).roster_subgroup);
  const subGroupName = rosterSubgroup?.name || undefined;
  const groupName = rosterSubgroup?.roster_group?.name || undefined;
  const roleName = role?.name || undefined;

  // ── not-worked flags ─────────────────────────────────────────────────────
  const tsStatus = (ts?.status ?? '').toLowerCase();
  const attStatus = (row.attendance_status ?? '').toLowerCase();
  const isNoShow = attStatus === ATTENDANCE_NO_SHOW || tsStatus === ATTENDANCE_NO_SHOW;

  const assignStatus = (row.assignment_status ?? '').toLowerCase();
  const isCancelled =
    row.lifecycle_status === LIFECYCLE_CANCELLED ||
    assignStatus === 'declined' ||
    assignStatus === 'unassigned';

  // ── two-tier billable times (parity with the timesheet reader) ────────────
  const finished = isShiftFinished(
    row.shift_date,
    row.start_time ?? '',
    row.end_time ?? '',
    row.actual_end,
  );

  const managerEditedStart = !!ts?.start_time;
  const managerEditedEnd = !!ts?.end_time;
  const managerEdited = managerEditedStart || managerEditedEnd;

  const adjustedStartRaw =
    ts?.start_time ?? (finished ? snapToQuarterHour(row.actual_start ?? null) : null) ?? row.start_time;
  const adjustedEndRaw =
    ts?.end_time ?? (finished ? snapToQuarterHour(row.actual_end ?? null) : null) ?? row.end_time;

  const startMins = timeToMinutes(adjustedStartRaw);
  const endMins = timeToMinutes(adjustedEndRaw);

  const unpaidBreak =
    ts?.unpaid_break_minutes != null
      ? ts.unpaid_break_minutes
      : (row.unpaid_break_minutes ?? 0);

  let netMinutes = 0;
  let startTime: string | undefined;
  let endTime: string | undefined;

  if (startMins != null && endMins != null) {
    let diff = endMins - startMins;
    if (diff < 0 || row.is_overnight) diff += 24 * 60; // overnight roll-forward
    netMinutes = Math.max(0, diff - (unpaidBreak || 0));
    startTime = minutesToHHMM(startMins);
    endTime = minutesToHHMM(endMins);
  }

  // ── rate & classification ─────────────────────────────────────────────────
  // MONEY-CRITICAL. The old sourcing was `hourly_rate_min ?? remuneration_rate`,
  // which fed the PERMANENT band minimum to everyone: the award engine treats a
  // supplied rate as the LOADED rate for casuals and divides by 1.25, so every
  // casual was de-loaded off an already-unloaded rate (~20% underpay) — and the
  // effective-dated eba_rate schedule (cl 25 CPI machinery) never applied.
  //
  // Now: an explicit per-shift rate (remuneration_rate — an override, NULL in
  // prod today) wins; otherwise pass the CLASSIFICATION string (rate = null) so
  // the engine resolves the effective-dated Schedule 2 rate, choosing the
  // casual vs permanent column from employment type. hourly_rate_min is only a
  // last resort when the row has a rem-level embed without a level_number.
  const levelNum = remLevel?.level_number != null
    ? Number(remLevel.level_number)
    : (row._contractRemunerationLevel != null ? Number(row._contractRemunerationLevel) : null);
  const classificationLevel: string | undefined =
    levelNum != null && Number.isFinite(levelNum)
      ? (levelNum === 0 ? 'TRAINEE' : `LEVEL_${levelNum}`)
      : undefined;

  const roleLevelNum = role?.remuneration_level != null ? Number(role.remuneration_level) : null;
  const higherDutiesLevel: string | undefined =
    roleLevelNum != null && Number.isFinite(roleLevelNum)
      ? (roleLevelNum === 0 ? 'TRAINEE' : `LEVEL_${roleLevelNum}`)
      : undefined;

  const rate: number | null =
    row.remuneration_rate
      ?? (classificationLevel ? null : (remLevel?.hourly_rate_min ?? null));

  const isSecurityRole = (role?.name ?? '').toLowerCase().includes('security');

  // ── hours provenance ──────────────────────────────────────────────────────
  const hoursSource: GrossPayHoursSource = managerEdited
    ? 'adjusted'
    : (finished && row.actual_start != null)
      ? 'actual'
      : 'scheduled_fallback';

  return {
    shiftId: row.id,
    employeeId,
    shiftDate: row.shift_date,

    netMinutes,
    startTime,
    endTime,
    isOvernight: !!row.is_overnight,
    scheduledLengthMinutes: row.scheduled_length_minutes ?? undefined,
    hoursSource,

    isCancelled,
    isNoShow,
    // DATA GAP — leave has no shift-level column (separate `leave_requests`
    // table, not joinable per-shift). Left false; flag in the fetcher summary.
    isAnnualLeave: false,
    isPersonalLeave: false,
    isCarerLeave: false,

    rate,
    employmentType: mapEmploymentType(row._employmentType),
    classificationLevel,
    isSecurityRole,

    employeeName,
    roleName,
    groupName,
    subGroupName,


    // DATA GAP — meal/first-aid/split-shift allowances aren't represented on
    // approved timesheet data; do NOT fabricate them.
    allowances: undefined,

    // priorOrdinaryHoursThisWeek is sequenced by computeEmployeePeriodGrossPay.
    higherDutiesLevel,
  };
}

/** Build the provenance record that pairs with a mapped input. */
function provenanceFor(row: GrossPayShiftRow): GrossPayInputProvenance {
  return {
    timesheetStatus: row._timesheet?.status ?? null,
    managerEdited: !!(row._timesheet?.start_time || row._timesheet?.end_time),
    employmentTypeMissing: mapEmploymentType(row._employmentType) === undefined,
  };
}

// ───────────────────────── I/O fetchers ───────────────────────────────────

/**
 * Fetch the raw shift rows (payable lifecycle, not deleted) in the period +
 * scope, then attach each row's timesheet overlay and the assigned employee's
 * employment_type. Returns hydrated {@link GrossPayShiftRow}s (still un-mapped).
 */
async function fetchHydratedShiftRows(
  bounds: GrossPayPeriodBounds,
): Promise<GrossPayShiftRow[]> {
  let query = supabase
    .from('shifts')
    .select(`
      id,
      shift_date,
      start_time,
      end_time,
      start_at,
      end_at,
      is_overnight,
      lifecycle_status,
      assignment_status,
      attendance_status,
      actual_start,
      actual_end,
      paid_break_minutes,
      unpaid_break_minutes,
      net_length_minutes,
      scheduled_length_minutes,
      remuneration_rate,
      remuneration_level,
      assigned_employee_id,
      role_id,
      roles(id, name, remuneration_level),
      remuneration_levels(level_number, level_name, hourly_rate_min),
      assigned_profiles:profiles!assigned_employee_id(first_name, last_name),
      roster_subgroup:roster_subgroups(name, roster_group:roster_groups(name))
    `)
    .gte('shift_date', bounds.periodStart)
    .lte('shift_date', bounds.periodEnd)
    .in('lifecycle_status', LIFECYCLE_PAYABLE)
    .is('deleted_at', null)
    .not('assigned_employee_id', 'is', null)
    .order('shift_date');

  if (bounds.organizationId) query = query.eq('organization_id', bounds.organizationId);
  if (bounds.departmentId) query = query.eq('department_id', bounds.departmentId);
  if (bounds.subDepartmentId) query = query.eq('sub_department_id', bounds.subDepartmentId);

  if (bounds.orgIds?.length) query = query.in('organization_id', bounds.orgIds);
  if (bounds.deptIds?.length) query = query.in('department_id', bounds.deptIds);
  if (bounds.subDeptIds?.length) query = query.in('sub_department_id', bounds.subDeptIds);

  const { data: shifts, error } = await query;
  if (error) {
    console.error('[grossPay.read] shifts query error:', error);
    return [];
  }
  const rows = (shifts ?? []) as unknown as GrossPayShiftRow[];
  if (rows.length === 0) return [];

  // Attach timesheet overlays (by shift_id).
  const shiftIds = rows.map((r) => r.id);
  const { data: timesheets, error: tsErr } = await supabase
    .from('timesheets')
    .select('id, shift_id, start_time, end_time, unpaid_break_minutes, status')
    .in('shift_id', shiftIds);
  if (tsErr) console.error('[grossPay.read] timesheets query error:', tsErr);
  const tsByShift = new Map(
    (timesheets ?? [])
      .filter((t: any) => !!t.shift_id)
      .map((t: any) => [t.shift_id as string, t]),
  );

  // Attach employment_type (by assigned_employee_id, from profiles).
  const employeeIds = Array.from(
    new Set(rows.map((r) => r.assigned_employee_id).filter((id): id is string => !!id)),
  );
  const empTypeById = new Map<string, string | null>();
  const contractLevelById = new Map<string, number | null>();

  if (employeeIds.length > 0) {
    const [pRes, cRes] = await Promise.all([
      supabase.from('profiles').select('id, employment_type').in('id', employeeIds),
      supabase.from('user_contracts').select('user_id, remuneration_level').in('user_id', employeeIds).eq('status', 'Active')
    ]);

    if (pRes.error) console.error('[grossPay.read] profiles query error:', pRes.error);
    for (const p of pRes.data ?? []) {
      empTypeById.set((p as any).id, (p as any).employment_type ?? null);
    }

    if (cRes.error) console.error('[grossPay.read] user_contracts query error:', cRes.error);
    for (const c of cRes.data ?? []) {
      contractLevelById.set((c as any).user_id, (c as any).remuneration_level ?? null);
    }
  }

  for (const r of rows) {
    r._timesheet = (tsByShift.get(r.id) as any) ?? null;
    r._employmentType = r.assigned_employee_id
      ? (empTypeById.get(r.assigned_employee_id) ?? null)
      : null;
    r._contractRemunerationLevel = r.assigned_employee_id
      ? (contractLevelById.get(r.assigned_employee_id) ?? null)
      : null;
  }
  return rows;
}

/**
 * The pay-run gate: is this hydrated row eligible under `approvedOnly`?
 * approvedOnly=true ⇒ keep only rows with a FINAL timesheet (approved / locked)
 * OR a no-show timesheet (paid $0 but still a settled pay outcome to report).
 */
function passesApprovalGate(row: GrossPayShiftRow, approvedOnly: boolean): boolean {
  if (!approvedOnly) return true;
  const status = (row._timesheet?.status ?? '').toLowerCase();
  if (!status) return false;
  return APPROVED_STATUSES.has(status) || status === ATTENDANCE_NO_SHOW;
}

/**
 * Fetch + map every payable shift in the period/scope into `GrossPayShiftInput`.
 * With `approvedOnly` (default true) only FINAL (approved/locked/no-show)
 * timesheets are included — that is the pay-run set.
 */
export async function getGrossPayInputsForPeriod(
  bounds: GrossPayPeriodBounds,
  opts: GrossPayFetchOptions = {},
): Promise<GrossPayShiftInput[]> {
  const withProv = await getGrossPayInputsWithProvenance(bounds, opts);
  return withProv.map((w) => w.input);
}

/**
 * Same as {@link getGrossPayInputsForPeriod} but returns each input paired with
 * its provenance (timesheet status, manager-edited flag, employment-type gap).
 */
export async function getGrossPayInputsWithProvenance(
  bounds: GrossPayPeriodBounds,
  opts: GrossPayFetchOptions = {},
): Promise<GrossPayInputWithProvenance[]> {
  const approvedOnly = opts.approvedOnly ?? true;
  const rows = await fetchHydratedShiftRows(bounds);
  const out: GrossPayInputWithProvenance[] = [];
  for (const row of rows) {
    if (!passesApprovalGate(row, approvedOnly)) continue;
    const input = mapShiftRowToGrossPayInput(row);
    if (!input) continue; // unassigned — skip.
    out.push({ input, provenance: provenanceFor(row) });
  }
  return out;
}

/**
 * Compose the above with `computeEmployeePeriodGrossPay` per distinct employee —
 * one {@link PeriodGrossPay} each (the payroll hand-off record). Weekly overtime
 * is sequenced inside the domain aggregator from the real shift order.
 */
export async function getPeriodGrossPay(
  bounds: GrossPayPeriodBounds,
  opts: GrossPayFetchOptions = {},
): Promise<PeriodGrossPay[]> {
  const shiftInputs = await getGrossPayInputsForPeriod(bounds, opts);

  // Approved leave is an ABSENCE, not a shift, so it is synthesised separately
  // and merged in. A leave day is dropped when the same employee already has a
  // shift on that date (a worked shift takes precedence over leave).
  const leaveInputs =
    opts.includeLeave === false
      ? []
      : await getLeaveGrossPayInputs({ 
          periodStart: bounds.periodStart, 
          periodEnd: bounds.periodEnd,
          orgIds: bounds.orgIds,
          deptIds: bounds.deptIds,
          subDeptIds: bounds.subDeptIds,
        });
  // Collision rule per employee+date: a shift priced from REAL attendance
  // (manager-edited or actual times) beats leave; a rostered-but-unworked
  // shift (`scheduled_fallback` hours) YIELDS to approved leave — the member
  // was absent on leave, so pricing the rostered line as worked would both
  // drop the leave pay and fabricate attendance.
  const leaveKeys = new Set(leaveInputs.map((i) => `${i.employeeId}:${i.shiftDate}`));
  const keptShifts = shiftInputs.filter(
    (i) => !(leaveKeys.has(`${i.employeeId}:${i.shiftDate}`) && i.hoursSource === 'scheduled_fallback'),
  );
  const workedKeys = new Set(keptShifts.map((i) => `${i.employeeId}:${i.shiftDate}`));
  const mergedLeave = leaveInputs.filter((i) => !workedKeys.has(`${i.employeeId}:${i.shiftDate}`));

  const byEmployee = new Map<string, GrossPayShiftInput[]>();
  for (const input of [...keptShifts, ...mergedLeave]) {
    const arr = byEmployee.get(input.employeeId);
    if (arr) arr.push(input);
    else byEmployee.set(input.employeeId, [input]);
  }
  const periodBounds: PeriodBounds = {
    periodId: bounds.periodId,
    periodStart: bounds.periodStart,
    periodEnd: bounds.periodEnd,
  };
  const results: PeriodGrossPay[] = [];
  for (const [employeeId, empInputs] of byEmployee) {
    results.push(computeEmployeePeriodGrossPay(employeeId, empInputs, periodBounds));
  }
  return results;
}
