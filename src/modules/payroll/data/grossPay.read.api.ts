/**
 * Gross-pay LIVE read adapter — turns APPROVED ACTUAL timesheet data into the
 * `GrossPayShiftInput[]` the pure gross-pay engine prices, and (convenience)
 * into one `PeriodGrossPay` per employee for a pay period.
 *
 * MONEY-CRITICAL parity: the billable-hours logic delegates to the SAME
 * resolver the timesheet reader uses (`timesheets/domain/billable-time.ts`) —
 * manager edit ELSE snapped actual (only once the shift is finished) — so
 * gross pay is priced from the exact billable minutes the manager reviewed,
 * not a hand-copied re-implementation that can drift from it. All I/O lives
 * in the fetchers; `mapShiftRowToGrossPayInput` is pure.
 *
 * DATA GAPS (documented, not fabricated — see the field comments below):
 *   • leave flags on the SHIFT mapper stay false — leave has no shift-level
 *     column. Leave pay is instead SYNTHESISED from approved leave_requests in
 *     `leaveGrossPay.ts` and merged in by `getPeriodGrossPay` (leave is an
 *     absence, not a shift), so leave IS now priced end-to-end.
 *   • allowances: not represented on approved timesheet data → left undefined
 *     (the engine still auto-derives the cl 28.1 meal allowance from overtime).
 *
 * PAY TERMS: a shift linked to the assignee's own contract (user_contract_id)
 * is paid on that contract's terms on the shift date — level, basis, salary —
 * via `resolveShiftPayTerms`, the TS copy of the SQL resolver the roster budget
 * uses. A shift level above the contract level is higher duties (cl 29). An
 * unlinked shift is paid on its own level and employment target.
 */

import { supabase } from '@/platform/supabase/client';
import {
  isShiftFinished,
  resolveBillableSide,
  calculateNetMinutes,
  applyMinEngagementFloor,
  type BillableSide,
} from '@/modules/timesheets/domain/billable-time';
import { getShiftDayType } from '@/modules/core/lib/holidays';
import {
  computeEmployeePeriodGrossPay,
  isoWeekKey,
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
import { isSecurityRoleName } from '@/modules/compliance/security-role';
import {
  classificationForLevel,
  contractPayTermsOn,
  resolveShiftPayTerms,
  type ContractPayTermsRow,
  type ShiftPayContract,
} from '../domain/shiftPayTerms';

type EngineEmploymentType = NonNullable<CostCalculatorOptions['employmentType']>;

/** A mapped input plus its provenance (returned by the *WithProvenance fetch). */
export interface GrossPayInputWithProvenance {
  input: GrossPayShiftInput;
  provenance: GrossPayInputProvenance;
}

/**
 * A window priced in place of the billable one (see mapShiftRowToGrossPayInput).
 * Times are 'HH:MM' venue wall-clock; overnight is read from their sign.
 */
export interface PricingWindow {
  startTime: string;
  endTime: string;
  /** Net minutes before the minimum-engagement floor (the floor is applied as usual). */
  rawNetMinutes: number;
  hoursSource: GrossPayHoursSource;
  /** Price it even if the shift is flagged no-show — the roster still scheduled it. */
  ignoreNoShow?: boolean;
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

/** `dateStr` (YYYY-MM-DD) shifted by `delta` days, computed on LOCAL date parts. */
function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** PostgREST embeds can be a single object OR a one-element array — normalize. */
function firstEmbed<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v.length > 0 ? v[0] : null;
  return v ?? null;
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

/** Same employment basis, Flexible Part-Time counting as Part-Time. */
function sameBasis(a: EngineEmploymentType | undefined, b: EngineEmploymentType | undefined): boolean {
  const collapse = (t?: EngineEmploymentType) => (t === 'Flexible Part-Time' ? 'Part-Time' : t);
  return a !== undefined && collapse(a) === collapse(b);
}

/**
 * The award engine's employment type for a row. The shift's target (FT / PT /
 * Casual) decides it: a person with several contracts has ONE profile value
 * and differently-paid shifts (memory: casual-loading-priced-off-profile). The
 * person's own value — the linked contract, else the profile — only refines
 * Part-Time to Flexible Part-Time, or stands in when the shift has no target.
 */
export function resolveRowEmploymentType(row: GrossPayShiftRow): EngineEmploymentType | undefined {
  const target = mapEmploymentType(row.target_employment_type);
  const personal = mapEmploymentType(row._payContract?.employmentStatus ?? row._employmentType);
  if (!target) return personal;
  return sameBasis(target, personal) ? personal : target;
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
 * rate = null + the classificationLevel (the engine resolves the effective-dated
 * EBA rate). There is no per-shift rate override: someone on a level is paid that level.
 * isSecurityRole = an annualised-Security contract, or the role name says so.
 * isNoShow  ⇐ attendance_status === 'no_show' OR timesheet.status === 'no_show'.
 * isCancelled ⇐ lifecycle_status === 'Cancelled' OR assignment_status ∈
 *               {declined, unassigned}.
 *
 * `window` prices a window OTHER than the billable one — the pay ledger's
 * Scheduled (roster) and Actual (raw clock) columns — on exactly the same
 * contract, classification and minimum-engagement context.
 */
export function mapShiftRowToGrossPayInput(
  row: GrossPayShiftRow,
  window?: PricingWindow,
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

  // ── pay terms ─────────────────────────────────────────────────────────────
  // Linked to the assignee's own contract ⇒ that contract's terms on the shift
  // date (resolveShiftPayTerms — the TS copy of internal.resolve_pay_terms).
  // Resolved above the min-engagement floor block below, which needs the
  // employment type and the security flag.
  const shiftLevel = remLevel?.level_number != null
    ? Number(remLevel.level_number)
    : (row.remuneration_level != null ? Number(row.remuneration_level) : null);
  const terms = row._payContract
    ? resolveShiftPayTerms({
        shiftDate: row.shift_date,
        shiftLevel,
        shiftEmploymentType: row.target_employment_type ?? null,
        contract: row._payContract,
      })
    : null;
  const isSalaried = terms?.payBasis === 'salary';
  // Sch 2 §2: annualised Security is Full-Time by definition (DB CHECK
  // user_contracts_security_annualised_terms), whatever the role is named.
  const isAnnualisedSecurity = terms?.payBasis === 'eba_security_annualised';
  const isSecurityRole = isAnnualisedSecurity || isSecurityRoleName(role?.name);
  const employmentType: EngineEmploymentType | undefined = isAnnualisedSecurity
    ? 'Full-Time'
    : resolveRowEmploymentType(row);

  // ── not-worked flags ─────────────────────────────────────────────────────
  const tsStatus = (ts?.status ?? '').toLowerCase();
  const attStatus = (row.attendance_status ?? '').toLowerCase();
  const isNoShow = !window?.ignoreNoShow
    && (attStatus === ATTENDANCE_NO_SHOW || tsStatus === ATTENDANCE_NO_SHOW);

  const assignStatus = (row.assignment_status ?? '').toLowerCase();
  const isCancelled =
    row.lifecycle_status === LIFECYCLE_CANCELLED ||
    assignStatus === 'declined' ||
    assignStatus === 'unassigned';

  let rawNetMinutes: number | null;
  let startTime: string | undefined;
  let endTime: string | undefined;
  let hoursSource: GrossPayHoursSource;

  if (window) {
    rawNetMinutes = window.rawNetMinutes;
    startTime = window.startTime;
    endTime = window.endTime;
    hoursSource = window.hoursSource;
  } else {
    // ── billable times — delegates to the SAME resolver the timesheet reader
    // uses, so pricing can't drift from what the manager actually reviewed ──
    const finished = isShiftFinished(
      row.shift_date,
      row.start_time ?? '',
      row.end_time ?? '',
      row.actual_end,
    );

    const managerEdited = !!ts?.start_time || !!ts?.end_time;

    const resolvedStart = resolveBillableSide(ts?.start_time, row.actual_start, finished);
    const resolvedEnd = resolveBillableSide(ts?.end_time, row.actual_end, finished);

    // A resolver 'missing' (finished, no edit, no actual — e.g. forgot to clock
    // out) still gets a SCHEDULED estimate here for preview/estimate mode, but
    // — unlike the old code — it is never mislabeled as 'actual' pay (see
    // hoursSource below), and a shift in this state can no longer reach
    // 'approved' status at all (guarded in timesheets.supabase.api.ts), so a
    // real pay-run (approvedOnly=true) will simply never see it.
    const startForCalc: BillableSide = resolvedStart.hhmm
      ? resolvedStart
      : { hhmm: row.start_time ?? null, source: resolvedStart.source };
    const endForCalc: BillableSide = resolvedEnd.hhmm
      ? resolvedEnd
      : { hhmm: row.end_time ?? null, source: resolvedEnd.source };

    const unpaidBreak =
      ts?.unpaid_break_minutes != null
        ? ts.unpaid_break_minutes
        : (row.unpaid_break_minutes ?? 0);

    // Overnight rollover is a pure sign check on these RESOLVED times inside
    // calculateNetMinutes — it deliberately ignores row.is_overnight (the
    // ORIGINAL schedule's flag). OR-ing that stale flag in used to double-count
    // 24h whenever a manager corrected an overnight-scheduled shift to real
    // times that didn't cross midnight (e.g. an early finish before midnight).
    rawNetMinutes = calculateNetMinutes(startForCalc, endForCalc, unpaidBreak);
    startTime = startForCalc.hhmm ?? undefined;
    endTime = endForCalc.hhmm ?? undefined;

    // 'actual' requires BOTH sides to have genuinely snapped from a real clock
    // time. The old check only tested `row.actual_start != null`, so a shift
    // with a clock-IN but no clock-OUT (start snaps, end silently falls back to
    // the schedule above) was mislabeled 'actual' even though half its billable
    // window was fabricated from the roster, not attendance.
    hoursSource = managerEdited
      ? 'adjusted'
      : (finished && resolvedStart.source === 'snapped' && resolvedEnd.source === 'snapped')
        ? 'actual'
        : 'scheduled_fallback';
  }

  // EBA minimum-engagement floor (F-locked 2026-07-28): the SAME resolver both
  // the timesheet reader and this payroll adapter share also applies the
  // statutory floor, so pricing and the timesheet's displayed net minutes can
  // never disagree. Automatic, no exemption path — see billable-time.ts.
  // Gated purely on rawNetMinutes !== null (a resolved billable window), NOT
  // on isNoShow/isCancelled: a manager can legitimately enter a manual
  // billable override on a shift still flagged no-show/cancelled, and that
  // resolved window must still get the floor. The isNoShow/isCancelled flags
  // below still do their existing job — computeShiftGrossPay's own
  // NOT_WORKED short-circuit zeroes pay when there's genuinely no resolved
  // window, independent of this floor. A salaried shift is outside the EA, so
  // it gets no floor — its hours are the hours worked (time in lieu).
  const { isSunday, isPublicHoliday } = getShiftDayType(row.shift_date);
  const netMinutes = rawNetMinutes === null
    ? 0
    : isSalaried
      ? rawNetMinutes
      : applyMinEngagementFloor(rawNetMinutes, {
        isTraining: row.is_training === true,
        isSunday,
        isPublicHoliday,
        employmentType,
        isSecurityRole,
      }).netMinutes;

  // ── rate & classification ─────────────────────────────────────────────────
  // MONEY-CRITICAL. The old sourcing was `hourly_rate_min ?? remuneration_rate`,
  // which fed the PERMANENT band minimum to everyone: the award engine treats a
  // supplied rate as the LOADED rate for casuals and divides by 1.25, so every
  // casual was de-loaded off an already-unloaded rate (~20% underpay) — and the
  // effective-dated eba_rate schedule (cl 25 CPI machinery) never applied.
  //
  // Now: pass the CLASSIFICATION string (rate = null) so the engine resolves
  // the effective-dated Schedule 2 rate, choosing the casual vs permanent
  // column from employment type. There is no per-shift rate override (user
  // decision 2026-10-08: someone on a level is paid that level; the SQL budget
  // ignores shifts.remuneration_rate too).
  //
  // Linked: the contract's level is the classification; a higher shift level
  // is cl 29 higher duties, which the engine prices on the whole shift with a
  // 4-hour minimum. (This used to take the ROLE's level as higher duties.)
  // Unlinked: the shift's level, else the employee's active contract level.
  let classificationLevel: string | undefined;
  let higherDutiesLevel: string | undefined;
  if (terms) {
    classificationLevel = classificationForLevel(terms.substantiveLevel);
    higherDutiesLevel = terms.higherDuties ? classificationForLevel(terms.paidLevel) : undefined;
  } else {
    const contractLevel = row._contractRemunerationLevel != null ? Number(row._contractRemunerationLevel) : null;
    classificationLevel = classificationForLevel(shiftLevel ?? contractLevel);
  }

  const rate: number | null = classificationLevel ? null : (row.remuneration_rate != null ? Number(row.remuneration_rate) : null);

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

    payBasis: terms?.payBasis,
    annualSalary: row._payContract?.annualSalary ?? undefined,
    contractedWeeklyHours: row._payContract?.contractedWeeklyHours ?? undefined,
    rate,
    employmentType,
    classificationLevel,
    isSecurityRole,
    isTrainingShift: row.is_training === true,

    employeeName,
    roleName,
    groupName,
    subGroupName,


    // Audit H-6: first-aid duty (cl 28.2) now has a real per-shift data
    // source (shifts.is_first_aid_duty). Split-shift (cl 39/28.4) is
    // auto-derived from the employee's own same-day shift pattern by the
    // period aggregator (which has cross-shift visibility this per-row
    // mapper doesn't) — see aggregatePeriodGrossPay.ts. Protein-spill
    // (cl 28.3) is deliberately still not represented: it's an ad-hoc
    // per-incident event, not a plannable per-shift flag, and needs its own
    // incident-capture UX rather than reusing this shape.
    allowances: row.is_first_aid_duty ? { firstAid: true } : undefined,

    // priorOrdinaryHoursThisWeek is sequenced by computeEmployeePeriodGrossPay.
    higherDutiesLevel,

    // ── Schedule 4/5/6 engagement fields (H1 audit fix) ─────────────────
    is_apprentice: row._isApprentice,
    apprentice_type: row._apprenticeType,
    apprentice_year: row._apprenticeYear,
    has_completed_year_12: row._hasCompletedYear12,
    is_trainee: row._isTrainee,
    trainee_category: row._traineeCategory,
    trainee_level: row._traineeLevel,
    trainee_exit_year: row._traineeExitYear,
    trainee_years_out: row._traineeYearsOut,
    trainee_aqf_level: row._traineeAqfLevel,
    trainee_year: row._traineeYear,
    is_sws: row._isSws,
    sws_capacity_percentage: row._swsCapacityPercentage,
    timesheetStatus: ts?.status ?? null,
    lifecycleStatus: row.lifecycle_status ?? null,
    rawShift: {
      lifecycle_status: row.lifecycle_status,
      attendance_status: row.attendance_status,
      actual_start: row.actual_start,
      actual_end: row.actual_end,
      adjusted_start: ts?.start_time ?? null,
      adjusted_end: ts?.end_time ?? null,
      adjusted_start_source: ts?.start_time ? 'manual' : null,
      adjusted_end_source: ts?.end_time ? 'manual' : null,
      adjusted_start_is_manual: !!ts?.start_time,
      adjusted_end_is_manual: !!ts?.end_time,
      adjusted_is_manual: !!(ts?.start_time || ts?.end_time),
      start_at: row.start_at,
      end_at: row.end_at,
      shift_date: row.shift_date,
      start_time: row.start_time,
      end_time: row.end_time,
      assigned_employee_id: row.assigned_employee_id,
      assignment_status: row.assignment_status,
      assignment_outcome: (row as any).assignment_outcome,
      trading_status: (row as any).trading_status,
      is_cancelled: !!(row as any).is_cancelled,
    },
  };
}

/** Build the provenance record that pairs with a mapped input. */
function provenanceFor(row: GrossPayShiftRow): GrossPayInputProvenance {
  return {
    timesheetStatus: row._timesheet?.status ?? null,
    managerEdited: !!(row._timesheet?.start_time || row._timesheet?.end_time),
    employmentTypeMissing: resolveRowEmploymentType(row) === undefined,
  };
}

/** user_contracts columns the pay path reads (pay terms + Schedules 4–6). */
const CONTRACT_PAY_COLUMNS =
  'id, user_id, employment_status, remuneration_level, pay_basis, annual_salary, contracted_weekly_hours, ' +
  'is_apprentice, apprentice_type, apprentice_year, has_completed_year_12, ' +
  'is_trainee, trainee_category, trainee_level, trainee_exit_year, trainee_years_out, trainee_aqf_level, trainee_year, ' +
  'is_sws, sws_capacity_percentage';

/**
 * A linked contract's pay terms on `date`: the history row in force then
 * (hr.contract_pay_terms_on), else the contract's current columns — the same
 * fallback internal.shift_pay_terms uses.
 */
export function payContractOn(
  contract: any,
  history: readonly ContractPayTermsRow[],
  date: string,
): ShiftPayContract {
  const h = contractPayTermsOn(history, date);
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    payBasis: h?.pay_basis ?? contract.pay_basis ?? 'eba_level',
    level: num(h ? h.remuneration_level : contract.remuneration_level),
    annualSalary: num(h ? h.annual_salary : contract.annual_salary),
    employmentStatus: contract.employment_status ?? null,
    contractedWeeklyHours: num(contract.contracted_weekly_hours),
    usesWageScheme: !!(contract.is_apprentice || contract.is_trainee || contract.is_sws),
  };
}

// ───────────────────────── I/O fetchers ───────────────────────────────────

/** PostgREST answers at most this many rows per request (the API's default cap). */
const PAGE_SIZE = 1000;
/** Ids per `.in()` filter — keeps the request URL well under proxy limits. */
const IN_CHUNK = 200;

type QueryResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/**
 * Every row of a query, page by page. A single PostgREST response is capped,
 * and a capped response looks exactly like a complete one — so a period with
 * more shifts than the cap used to be priced on a silent subset.
 */
async function fetchAllPages<T>(
  page: (from: number, to: number) => QueryResult<T>,
): Promise<{ rows: T[]; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, error: null };
  }
}

/** A `.in(column, ids)` lookup split into chunks, results concatenated. */
async function selectInChunks<T>(
  ids: readonly string[],
  run: (chunk: string[]) => QueryResult<T>,
): Promise<{ data: T[]; error: unknown }> {
  const data: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data: part, error } = await run(ids.slice(i, i + IN_CHUNK));
    if (error) return { data, error };
    data.push(...(part ?? []));
  }
  return { data, error: null };
}

export interface FetchShiftRowsOptions {
  /**
   * Every shift in the period — all lifecycle states, assigned or not — for
   * the pay ledger. Default: the payable set (live lifecycle, assigned).
   */
  allShifts?: boolean;
}

/**
 * Fetch the raw shift rows (payable lifecycle, not deleted) in the period +
 * scope, then attach each row's timesheet overlay and the assigned employee's
 * employment_type. Returns hydrated {@link GrossPayShiftRow}s (still un-mapped).
 */
export async function fetchHydratedShiftRows(
  bounds: GrossPayPeriodBounds,
  opts: FetchShiftRowsOptions = {},
): Promise<GrossPayShiftRow[]> {
  const buildQuery = () => {
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
        remuneration_level,
        remuneration_rate,
        target_employment_type,
        user_contract_id,
        assigned_employee_id,
        assignment_outcome,
        trading_status,
        is_cancelled,
        role_id,
        is_first_aid_duty,
        is_training,
        organization_id,
        department_id,
        sub_department_id,
        roles(id, name),
        remuneration_levels(level_number, level_name),
        assigned_profiles:profiles!assigned_employee_id(first_name, last_name),
        roster_subgroup:roster_subgroups(name, roster_group:roster_groups(name))
      `)
      .gte('shift_date', bounds.periodStart)
      .lte('shift_date', bounds.periodEnd)
      .is('deleted_at', null)
      // A stable total order, so consecutive pages neither skip nor repeat rows.
      .order('shift_date')
      .order('id');

    if (!opts.allShifts) {
      query = query
        .in('lifecycle_status', LIFECYCLE_PAYABLE)
        .not('assigned_employee_id', 'is', null);
    }

    if (bounds.organizationId) query = query.eq('organization_id', bounds.organizationId);
    if (bounds.departmentId) query = query.eq('department_id', bounds.departmentId);
    if (bounds.subDepartmentId) query = query.eq('sub_department_id', bounds.subDepartmentId);

    if (bounds.orgIds?.length) query = query.in('organization_id', bounds.orgIds);
    if (bounds.deptIds?.length) query = query.in('department_id', bounds.deptIds);
    if (bounds.subDeptIds?.length) query = query.in('sub_department_id', bounds.subDeptIds);
    return query;
  };

  const { rows: shifts, error } = await fetchAllPages((from, to) => buildQuery().range(from, to));
  if (error) {
    // Half a period priced as if it were the whole is worse than no figure.
    console.error('[grossPay.read] shifts query error:', error);
    throw error;
  }
  const rows = shifts as unknown as GrossPayShiftRow[];
  if (rows.length === 0) return [];

  // Attach timesheet overlays (by shift_id).
  const shiftIds = rows.map((r) => r.id);
  const { data: timesheets, error: tsErr } = await selectInChunks(shiftIds, (ids) => supabase
    .from('timesheets')
    .select('id, shift_id, start_time, end_time, unpaid_break_minutes, status')
    .in('shift_id', ids));
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
  const linkedContractIds = Array.from(
    new Set(rows.map((r) => r.user_contract_id).filter((id): id is string => !!id)),
  );
  const empTypeById = new Map<string, string | null>();
  // H1 audit fix: store the full contract row per employee so apprentice/trainee/SWS
  // fields travel to the mapper alongside the remuneration level. Used only for
  // a shift with no usable contract link.
  const contractByEmployee = new Map<string, any>();
  // The contract each shift is linked to (any status — a shift worked under a
  // since-ended contract is still paid on it), and its pay-terms history.
  const contractById = new Map<string, any>();
  const payHistoryByContract = new Map<string, ContractPayTermsRow[]>();

  if (employeeIds.length > 0) {
    const [pRes, cRes, linkedRes, historyRes] = await Promise.all([
      selectInChunks<any>(employeeIds, (ids) =>
        supabase.from('profiles').select('id, employment_type').in('id', ids)),
      // H1 audit fix: fetch apprentice/trainee/SWS columns that AddContractDialog writes.
      selectInChunks<any>(employeeIds, (ids) =>
        supabase.from('user_contracts').select(CONTRACT_PAY_COLUMNS).in('user_id', ids).eq('status', 'Active')),
      selectInChunks<any>(linkedContractIds, (ids) =>
        supabase.from('user_contracts').select(CONTRACT_PAY_COLUMNS).in('id', ids)),
      // RLS: payroll managers (delta access) read every row; others their own.
      // Unreadable history falls back to the contract's current terms, as the
      // SQL resolver does when a contract has no history row.
      selectInChunks<any>(linkedContractIds, (ids) =>
        (supabase as any).schema('hr').from('contract_pay_terms')
          .select('contract_id, effective_from, pay_basis, remuneration_level, annual_salary')
          .in('contract_id', ids)),
    ]);

    if (pRes.error) console.error('[grossPay.read] profiles query error:', pRes.error);
    for (const p of pRes.data ?? []) {
      empTypeById.set((p as any).id, (p as any).employment_type ?? null);
    }

    if (cRes.error) console.error('[grossPay.read] user_contracts query error:', cRes.error);
    for (const c of cRes.data ?? []) {
      contractByEmployee.set((c as any).user_id, c);
    }

    if (linkedRes.error) console.error('[grossPay.read] linked contracts query error:', linkedRes.error);
    for (const c of linkedRes.data ?? []) contractById.set((c as any).id, c);

    if (historyRes.error) console.error('[grossPay.read] contract_pay_terms query error:', historyRes.error);
    for (const h of (historyRes.data ?? []) as ContractPayTermsRow[]) {
      const list = payHistoryByContract.get(h.contract_id);
      if (list) list.push(h);
      else payHistoryByContract.set(h.contract_id, [h]);
    }
  }

  for (const r of rows) {
    r._timesheet = (tsByShift.get(r.id) as any) ?? null;
    r._employmentType = r.assigned_employee_id
      ? (empTypeById.get(r.assigned_employee_id) ?? null)
      : null;
    // Only the assignee's OWN contract is used — a stale link to someone
    // else's is ignored, exactly as internal.shift_pay_terms does.
    const linked = r.user_contract_id ? contractById.get(r.user_contract_id) : undefined;
    const own = linked && linked.user_id === r.assigned_employee_id ? linked : undefined;
    r._payContract = own
      ? payContractOn(own, payHistoryByContract.get(own.id) ?? [], r.shift_date)
      : null;
    const contract = own ?? (r.assigned_employee_id ? contractByEmployee.get(r.assigned_employee_id) : null);
    r._hasActiveContract = !!contract;
    r._contractRemunerationLevel = contract?.remuneration_level ?? null;
    // H1 audit fix: apprentice/trainee/SWS fields from the active contract.
    if (contract) {
      r._isApprentice = !!contract.is_apprentice;
      r._apprenticeType = contract.apprentice_type ?? undefined;
      r._apprenticeYear = contract.apprentice_year ?? undefined;
      r._hasCompletedYear12 = !!contract.has_completed_year_12;
      r._isTrainee = !!contract.is_trainee;
      r._traineeCategory = contract.trainee_category ?? undefined;
      r._traineeLevel = contract.trainee_level ?? undefined;
      r._traineeExitYear = contract.trainee_exit_year ?? undefined;
      r._traineeYearsOut = contract.trainee_years_out ?? undefined;
      r._traineeAqfLevel = contract.trainee_aqf_level ?? undefined;
      r._traineeYear = contract.trainee_year ?? undefined;
      r._isSws = !!contract.is_sws;
      r._swsCapacityPercentage = contract.sws_capacity_percentage ?? undefined;
    }
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

  // Audit H-7: when the window's start falls mid-ISO-week (any custom report
  // range, not just Monday-anchored pay periods), fetch the lead-in days —
  // from that week's Monday up to periodStart-1 — purely so
  // computeEmployeePeriodGrossPay can seed weekly-ordinary-hours correctly.
  // Without this, hours worked earlier that same week but outside the window
  // are invisible, so cl 42 weekly overtime (>38h/week) under-detects for the
  // window's first partial week.
  const leadInStart = isoWeekKey(bounds.periodStart);
  const leadInInputs =
    leadInStart < bounds.periodStart
      ? await getGrossPayInputsForPeriod(
          { ...bounds, periodStart: leadInStart, periodEnd: addDays(bounds.periodStart, -1) },
          opts,
        )
      : [];

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
  for (const input of [...keptShifts, ...mergedLeave, ...leadInInputs]) {
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
    results.push(computeEmployeePeriodGrossPay(employeeId, empInputs, periodBounds, { leadInStart }));
  }
  return results;
}
