/**
 * Leave-day gross pay — closes the "leave not detected" gap in the shift-based
 * read adapter.
 *
 * WHY THIS EXISTS: leave is an ABSENCE, not a shift. An employee on annual leave
 * for a week usually has NO shifts those days, so there is nothing to flag on the
 * `shifts` table — leave pay must be SYNTHESISED from approved `leave_requests`
 * (employee_id + free-text leave_type + [start_date, end_date] range). Each
 * eligible working day in the range becomes a `GrossPayShiftInput` carrying the
 * right leave flag, which the award engine then prices (annual = the greater of
 * 17.5% loading or the day's penalties; personal/carer = ordinary base; casual =
 * $0, since casuals accrue no paid leave).
 *
 * Rate + hours are resolved off the employee's active `user_contracts` row
 * (custom_hourly_rate ?? the classification's hourly_rate_min; contracted daily
 * hours = contracted_weekly_hours / 5). Weekends and public holidays are excluded
 * from synthesis (a public holiday during leave is a separate entitlement, not a
 * leave day — including it would misprice via the annual-leave greater-of rule).
 */

import { supabase } from '@/platform/supabase/client';
import { ausHolidays } from '@/modules/core/lib/holidays';
import type { GrossPayShiftInput } from '../domain/computeShiftGrossPay';
import type { CostCalculatorOptions } from '../../rosters/domain/projections/utils/cost/types';
import { mapEmploymentType } from './grossPay.read.api';

const DEFAULT_WEEKLY_HOURS = 38;
const WORKING_DAYS_PER_WEEK = 5;

// ── EBA paid-day caps (measured from the LEAVE START, not per pay period) ───
export const PARENTAL_LEAVE_CAP_WEEKS = 10;  // cl 51.2 — 10 weeks paid
export const PARENTAL_LEAVE_CAP_DAYS = PARENTAL_LEAVE_CAP_WEEKS * WORKING_DAYS_PER_WEEK; // 50
export const JURY_DUTY_CAP_DAYS = 10;        // cl 53.2 — make-up pay, first 10 days
export const SUPPORTING_CARER_CAP_DAYS = 5;  // cl 52.2 — ONE week paid per occasion
export const COMPASSIONATE_CAP_DAYS = 2;     // cl 48 / NES ss104–105 — 2 days per occasion

/** Leave flags the award engine understands (all optional; at most one true). */
export interface LeaveFlags {
  isAnnualLeave?: boolean;
  isPersonalLeave?: boolean;
  isCarerLeave?: boolean;
  isParentalLeave?: boolean;
  isLongServiceLeave?: boolean;
  isJuryDuty?: boolean;
  isSupportingCarer?: boolean;
  /** cl 46 / NES Div 11 — FDV leave; the ONLY paid-leave flag for casuals. */
  isFdvLeave?: boolean;
  /**
   * cl 48 — compassionate/bereavement, 2 paid days PER OCCASION. INTERNAL to
   * this module: it exists so `paidDayCapFor` can cap the occasion; on the
   * emitted `GrossPayShiftInput` it is translated to `isCarerLeave` so the
   * engine's pricing path (flat ordinary, like carer's leave) is unchanged.
   */
  isCompassionate?: boolean;
}

/**
 * Map a free-text `leave_requests.leave_type` to the award engine's leave flags,
 * or null for leave the gross engine must NOT price as paid ordinary leave
 * (unpaid, long-service, parental — 10 weeks paid on commencement (cl 51), jury
 * make-up pay (cl 53) — both need data this per-day synthesis doesn't have).
 *
 * Family & domestic violence leave (cl 46) IS paid — up to 10 days — INCLUDING
 * for CASUALS: cl 46.6 pays "the hours the Team Member is rostered on the day
 * that the leave is taken", so casual FDV days are priced from ROSTERED shift
 * minutes only (see `buildLeaveInputs`). It carries its own `isFdvLeave` flag
 * through the engine but MUST surface on the payslip as an ordinary
 * personal-leave line: the Fair Work Regulations prohibit identifying FDV
 * leave on a payslip (`computeShiftGrossPay` enforces this).
 */
export function leaveTypeToFlags(leaveType: string | null | undefined): LeaveFlags | null {
  const t = (leaveType ?? '').toLowerCase();
  if (/annual|recreation|holiday/.test(t)) return { isAnnualLeave: true };
  // cl 52 supporting carer (secondary carer / partner / paternity). Checked
  // before the parental and carer families so "supporting carer" and
  // "paternity" don't fall into those broader matches. The bare word "support"
  // is deliberately NOT matched — it is far too loose for a pay decision.
  if (/supporting.?carer|partner.?leave|paternity/.test(t)) return { isSupportingCarer: true };
  // cl 48 compassionate/bereavement — checked BEFORE carer so the 2-day
  // per-occasion cap applies (it is still PRICED as carer's leave downstream).
  if (/compassionate|bereavement/.test(t)) return { isCompassionate: true };
  if (/carer|carer's/.test(t)) return { isCarerLeave: true };
  if (/personal|sick|illness/.test(t)) return { isPersonalLeave: true };
  if (/family|domestic|violence|fdv/.test(t)) return { isFdvLeave: true };
  if (/parental|maternity|adoption/.test(t)) return { isParentalLeave: true };
  if (/long.?service|lsl/.test(t)) return { isLongServiceLeave: true };
  if (/jury|court/.test(t)) return { isJuryDuty: true };
  return null;
}

/**
 * The paid-day cap for a leave type, or null when uncapped. Caps are per
 * REQUEST (per occasion) and count eligible days from the LEAVE START.
 */
export function paidDayCapFor(flags: LeaveFlags): number | null {
  if (flags.isParentalLeave) return PARENTAL_LEAVE_CAP_DAYS;
  if (flags.isJuryDuty) return JURY_DUTY_CAP_DAYS;
  if (flags.isSupportingCarer) return SUPPORTING_CARER_CAP_DAYS;
  if (flags.isCompassionate) return COMPASSIONATE_CAP_DAYS;
  return null;
}

// ── pure date helpers (local-parts, tz-safe) ────────────────────────────────

function toYmd(value: string): string {
  return value.includes('T') ? value.split('T')[0] : value.slice(0, 10);
}

function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * The eligible leave-pay days (Mon–Fri, excluding public holidays) in the
 * intersection of a leave request's [start, end] range and the pay period.
 * `isHoliday` is injected so this stays pure and unit-testable.
 */
export function eligibleLeaveDays(
  leaveStart: string,
  leaveEnd: string,
  periodStart: string,
  periodEnd: string,
  isHoliday?: (ymd: string) => boolean,
): string[] {
  const from = toYmd(leaveStart) > periodStart ? toYmd(leaveStart) : periodStart;
  const to = toYmd(leaveEnd) < periodEnd ? toYmd(leaveEnd) : periodEnd;
  if (from > to) return [];

  const out: string[] = [];
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    const dow = cur.getDay();
    const ymd = fmtLocal(cur);
    const weekend = dow === 0 || dow === 6;
    if (!weekend && !(isHoliday?.(ymd))) out.push(ymd);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * Roster-aware leave days — intersects a leave range with the employee's
 * rostered shift dates in the period. Falls back to Mon–Fri (via
 * `eligibleLeaveDays`) when no roster data exists.
 *
 * @param rosteredDates YYYY-MM-DD dates the employee is rostered to work
 */
export function rosteredLeaveDays(
  leaveStart: string,
  leaveEnd: string,
  periodStart: string,
  periodEnd: string,
  rosteredDates: string[],
  isHoliday?: (ymd: string) => boolean,
): string[] {
  if (rosteredDates.length === 0) {
    return eligibleLeaveDays(leaveStart, leaveEnd, periodStart, periodEnd, isHoliday);
  }
  const from = toYmd(leaveStart) > periodStart ? toYmd(leaveStart) : periodStart;
  const to = toYmd(leaveEnd) < periodEnd ? toYmd(leaveEnd) : periodEnd;
  if (from > to) return [];

  return Array.from(new Set(rosteredDates))
    .filter((d) => d >= from && d <= to)
    .filter((d) => !(isHoliday?.(d)))
    .sort();
}

/**
 * The payable-day set for a CAPPED leave type, anchored to the LEAVE START:
 * the first `cap` eligible (Mon–Fri, non-PH) days of the FULL leave range.
 * Days beyond the cap are unpaid (e.g. months 3–12 of a parental range,
 * cl 50 unpaid parental). Capped types deliberately use the deterministic
 * Mon–Fri calendar rather than roster data, so the same request caps
 * identically no matter which pay period prices it.
 */
export function paidDaysFromLeaveStart(
  leaveStart: string,
  leaveEnd: string,
  cap: number,
  isHoliday?: (ymd: string) => boolean,
): Set<string> {
  const full = eligibleLeaveDays(leaveStart, leaveEnd, toYmd(leaveStart), toYmd(leaveEnd), isHoliday);
  return new Set(full.slice(0, cap));
}

/**
 * The PUBLIC-HOLIDAY days (Mon–Fri) in the intersection of a leave range and the
 * pay period. cl 44.8 makes annual leave exclusive of public holidays, and
 * cl 56.4 pays the not-worked PH at the ordinary rate — so these days are paid
 * as `public_holiday`, not as leave. Uses the same Mon–Fri "ordinarily
 * rostered" assumption as `eligibleLeaveDays`.
 */
export function publicHolidayDaysInRange(
  leaveStart: string,
  leaveEnd: string,
  periodStart: string,
  periodEnd: string,
  isHoliday: (ymd: string) => boolean,
): string[] {
  const from = toYmd(leaveStart) > periodStart ? toYmd(leaveStart) : periodStart;
  const to = toYmd(leaveEnd) < periodEnd ? toYmd(leaveEnd) : periodEnd;
  if (from > to) return [];

  const out: string[] = [];
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    const dow = cur.getDay();
    const ymd = fmtLocal(cur);
    const weekend = dow === 0 || dow === 6;
    if (!weekend && isHoliday(ymd)) out.push(ymd);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Resolved per-employee context for pricing a leave day. */
export interface LeaveEmployeeContext {
  employeeId: string;
  employmentType?: CostCalculatorOptions['employmentType'];
  rate: number | null;
  /** e.g. 'LEVEL_3' — lets the engine resolve the effective-dated EBA rate. */
  classificationLevel?: string;
  dailyOrdinaryMinutes: number;
}

/** A minimal shape of an approved leave request (from the DB). */
export interface LeaveRequestRow {
  id: string;
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
}

/**
 * PURE: expand ONE approved leave request into per-eligible-day
 * `GrossPayShiftInput`s (empty when the leave type is not priced here, when the
 * employee is casual — casuals accrue no paid leave — or when no eligible days).
 */
/**
 * PURE: expand ONE approved leave request into per-eligible-day
 * `GrossPayShiftInput`s (empty when the leave type is not priced here, when the
 * employee is casual — casuals accrue no paid leave — or when no eligible days).
 *
 * Day caps (NES/EBA) truncate inputs when the leave type has a statutory limit.
 * `dailyMinutesOverrides` allows roster-aware synthesis to use per-date shift
 * hours instead of the contracted daily average.
 */
export function buildLeaveInputs(
  req: LeaveRequestRow,
  ctx: LeaveEmployeeContext,
  days: string[],
  dailyMinutesOverrides?: Map<string, number>,
): GrossPayShiftInput[] {
  const flags = leaveTypeToFlags(req.leave_type);
  if (!flags) return [];
  const isCasual = /casual/i.test(ctx.employmentType ?? '');
  // Casuals accrue NO paid leave (cl 12.5(b) — loading in lieu) with ONE
  // exception: FDV leave (cl 46.6 / NES Div 11) is paid for casuals too.
  if (isCasual && !flags.isFdvLeave) return [];
  if (days.length === 0) return [];

  // ── Defensive per-call day cap ───────────────────────────────────────────
  // The REAL cap is anchored to the leave start and applied by the fetcher via
  // `paidDaysFromLeaveStart` (a per-period slice here would re-open the cap
  // every pay period — a 12-month parental range must pay only its first 50
  // working days, not 5 days of every week forever). This slice only guards
  // direct callers that pass an uncapped day list.
  const cap = paidDayCapFor(flags);
  const cappedDays = cap != null ? days.slice(0, cap) : days;

  // Compassionate is capped above but PRICED as carer's leave (flat ordinary);
  // the engine never sees `isCompassionate`.
  const { isCompassionate, ...engineFlags } = flags;
  const emitFlags: LeaveFlags = isCompassionate
    ? { ...engineFlags, isCarerLeave: true }
    : engineFlags;

  const out: GrossPayShiftInput[] = [];
  for (const shiftDate of cappedDays) {
    const overrideMins = dailyMinutesOverrides?.get(shiftDate);
    // cl 46.6 pays a casual FDV day for the hours ROSTERED on that day — a
    // casual has no contracted daily hours, so a day with no rostered minutes
    // is skipped (correctly $0), never priced off the contracted-hours model.
    if (isCasual && flags.isFdvLeave && (overrideMins == null || overrideMins <= 0)) continue;
    const minutes = isCasual && flags.isFdvLeave
      ? (overrideMins as number)
      : (overrideMins ?? ctx.dailyOrdinaryMinutes);
    out.push({
      shiftId: `leave:${req.id}:${shiftDate}`,
      employeeId: ctx.employeeId,
      shiftDate,
      netMinutes: minutes,
      scheduledLengthMinutes: minutes,
      isOvernight: false,
      hoursSource: 'actual' as const,
      rate: ctx.rate,
      classificationLevel: ctx.classificationLevel,
      employmentType: ctx.employmentType,
      ...emitFlags,
    });
  }
  return out;
}

/**
 * PURE: expand the public-holiday days inside ONE approved leave request into
 * cl 56.4 `public_holiday` pay inputs (permanents only — casuals have no PH
 * absence entitlement, and cl 56.4 excludes them; the engine also zeroes them).
 */
export function buildPublicHolidayInputs(
  req: LeaveRequestRow,
  ctx: LeaveEmployeeContext,
  phDays: string[],
  dailyMinutesOverrides?: Map<string, number>,
): GrossPayShiftInput[] {
  if (/casual/i.test(ctx.employmentType ?? '')) return [];
  if (phDays.length === 0) return [];

  return phDays.map((shiftDate) => ({
    shiftId: `ph:${req.id}:${shiftDate}`,
    employeeId: ctx.employeeId,
    shiftDate,
    netMinutes: dailyMinutesOverrides?.get(shiftDate) ?? ctx.dailyOrdinaryMinutes,
    scheduledLengthMinutes: dailyMinutesOverrides?.get(shiftDate) ?? ctx.dailyOrdinaryMinutes,
    isOvernight: false,
    hoursSource: 'actual' as const,
    rate: ctx.rate,
    classificationLevel: ctx.classificationLevel,
    employmentType: ctx.employmentType,
    isPublicHolidayNotWorked: true,
  }));
}

// ── I/O: fetch approved leave + resolve contexts ────────────────────────────

const APPROVED_LEAVE_STATUSES = new Set(['approved', 'accepted', 'taken']);

/**
 * Fetch approved leave requests overlapping the period and synthesise the
 * eligible-day `GrossPayShiftInput`s. Rate + contracted hours come from each
 * employee's active `user_contracts` row; employment type from `profiles`.
 */
export interface LeaveFetchBounds {
  periodStart: string;
  periodEnd: string;
  orgIds?: string[];
  deptIds?: string[];
  subDeptIds?: string[];
}

export async function getLeaveGrossPayInputs(bounds: LeaveFetchBounds): Promise<GrossPayShiftInput[]> {
  const { data: leaves, error } = await (supabase as any)
    .from('leave_requests')
    .select('id, employee_id, leave_type, start_date, end_date, status')
    .lte('start_date', `${bounds.periodEnd}T23:59:59`)
    .gte('end_date', bounds.periodStart);
  if (error) {
    console.error('[leaveGrossPay] leave_requests query error:', error);
    return [];
  }

  const approved: LeaveRequestRow[] = (leaves ?? [])
    .filter((l: any) => APPROVED_LEAVE_STATUSES.has(String(l.status ?? '').toLowerCase()))
    .filter((l: any) => leaveTypeToFlags(l.leave_type) !== null);
  if (approved.length === 0) return [];

  const employeeIds = Array.from(new Set(approved.map((l) => l.employee_id).filter(Boolean)));
  const ctxById = await resolveLeaveContexts(employeeIds, bounds);
  const rosterByEmp = await fetchRosteredMinutes(employeeIds, bounds);

  const isHoliday = (ymd: string) => !!ausHolidays.isHoliday(ymd);
  const out: GrossPayShiftInput[] = [];
  const phSeen = new Set<string>(); // employee:date — overlapping requests must not double-pay a PH
  for (const req of approved) {
    const ctx = ctxById.get(req.employee_id);
    if (!ctx) continue; // no resolvable contract/rate — skip rather than guess.
    const flags = leaveTypeToFlags(req.leave_type)!; // non-null: filtered above
    const cap = paidDayCapFor(flags);
    const roster = rosterByEmp.get(req.employee_id);

    let days: string[];
    let overrides: Map<string, number> | undefined;
    if (cap != null) {
      // Capped types (parental / jury / supporting carer): the payable window is
      // the first `cap` eligible days FROM THE LEAVE START; this period pays
      // only its intersection with that window. Per-period slicing would re-open
      // the cap every period and pay a 12-month parental range in full.
      const allowed = paidDaysFromLeaveStart(req.start_date, req.end_date, cap, isHoliday);
      days = eligibleLeaveDays(req.start_date, req.end_date, bounds.periodStart, bounds.periodEnd, isHoliday)
        .filter((d) => allowed.has(d));
    } else {
      // Uncapped types: roster-aware — when the employee has rostered shifts in
      // the window, leave follows those days/hours (7-day-roster correctness,
      // cl 44.7 "ordinary hours of work"); otherwise Mon–Fri contracted/5.
      //
      // Casual FDV keeps its PH days IN the leave set: cl 46.6 / NES s106B pay
      // the rostered hours as-if-worked (the engine prices the PH penalty),
      // and casuals have no separate cl 56.4 PH-absence entitlement that the
      // exclusion exists to protect.
      const rosterDates = roster ? Array.from(roster.keys()) : [];
      const isCasualFdv = !!flags.isFdvLeave && /casual/i.test(ctx.employmentType ?? '');
      days = rosteredLeaveDays(
        req.start_date, req.end_date, bounds.periodStart, bounds.periodEnd,
        rosterDates, isCasualFdv ? undefined : isHoliday,
      );
      overrides = roster;
    }
    out.push(...buildLeaveInputs(req, ctx, days, overrides));

    // cl 44.8 / 56.4 — a public holiday inside the leave range is NOT a leave
    // day (excluded above) but must still be PAID at the ordinary rate. With
    // roster data, "would ordinarily be rostered" is answered by the roster
    // itself (incl. weekend PHs like Easter Saturday); otherwise Mon–Fri.
    const from = toYmd(req.start_date) > bounds.periodStart ? toYmd(req.start_date) : bounds.periodStart;
    const to = toYmd(req.end_date) < bounds.periodEnd ? toYmd(req.end_date) : bounds.periodEnd;
    const phCandidates = roster && roster.size > 0
      ? Array.from(roster.keys()).filter((d) => d >= from && d <= to && isHoliday(d)).sort()
      : publicHolidayDaysInRange(req.start_date, req.end_date, bounds.periodStart, bounds.periodEnd, isHoliday);
    const phDays = phCandidates.filter((d) => {
      const key = `${req.employee_id}:${d}`;
      if (phSeen.has(key)) return false;
      phSeen.add(key);
      return true;
    });
    out.push(...buildPublicHolidayInputs(req, ctx, phDays, roster));
  }
  return out;
}

/**
 * The employee's rostered minutes per date inside the period window — every
 * non-cancelled, non-deleted shift (any lifecycle: a member on leave usually
 * keeps or pre-dates a draft/published roster line). Returns
 * employeeId → (YYYY-MM-DD → summed scheduled minutes). Empty map on error so
 * callers fall back to the Mon–Fri model instead of silently paying nothing.
 */
async function fetchRosteredMinutes(
  employeeIds: string[],
  bounds: { periodStart: string; periodEnd: string },
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (employeeIds.length === 0) return out;

  const { data, error } = await (supabase as any)
    .from('shifts')
    .select('assigned_employee_id, shift_date, scheduled_length_minutes, net_length_minutes, lifecycle_status')
    .in('assigned_employee_id', employeeIds)
    .gte('shift_date', bounds.periodStart)
    .lte('shift_date', bounds.periodEnd)
    .neq('lifecycle_status', 'Cancelled')
    .is('deleted_at', null);
  if (error) {
    console.error('[leaveGrossPay] rostered shifts query error:', error);
    return out;
  }

  for (const s of data ?? []) {
    const emp = s.assigned_employee_id as string | null;
    const date = s.shift_date as string | null;
    if (!emp || !date) continue;
    const mins = Number(s.scheduled_length_minutes ?? s.net_length_minutes ?? 0);
    if (!Number.isFinite(mins) || mins <= 0) continue;
    let byDate = out.get(emp);
    if (!byDate) { byDate = new Map(); out.set(emp, byDate); }
    byDate.set(date, (byDate.get(date) ?? 0) + mins);
  }
  return out;
}

/**
 * Resolve rate + daily hours + employment type for the given employees from
 * their active `user_contracts` row (+ `remuneration_levels` for the rate, +
 * `profiles.employment_type`). Employees with no resolvable contract are omitted.
 */
async function resolveLeaveContexts(
  employeeIds: string[],
  bounds: LeaveFetchBounds,
): Promise<Map<string, LeaveEmployeeContext>> {
  const out = new Map<string, LeaveEmployeeContext>();
  if (employeeIds.length === 0) return out;

  // Org/dept scoping lives on user_contracts — `profiles` has NO
  // organization_id / department_id / sub_department_id columns in prod, so
  // filtering the profiles query on them errors and (unchecked) silently
  // zeroes ALL leave pay for the run.
  let cQuery = (supabase as any)
    .from('user_contracts')
    .select('user_id, remuneration_level, contracted_weekly_hours, custom_hourly_rate, status, start_date, end_date')
    .in('user_id', employeeIds);
  if (bounds.orgIds?.length) cQuery = cQuery.in('organization_id', bounds.orgIds);
  if (bounds.deptIds?.length) cQuery = cQuery.in('department_id', bounds.deptIds);
  if (bounds.subDeptIds?.length) cQuery = cQuery.in('sub_department_id', bounds.subDeptIds);
  const { data: contracts, error: cErr } = await cQuery;
  if (cErr) console.error('[leaveGrossPay] user_contracts query error:', cErr);

  // Pick, per employee, the contract in effect during the period (latest start
  // that has not ended before the period), preferring active status.
  const bestByUser = new Map<string, any>();
  for (const c of contracts ?? []) {
    const uid = c.user_id as string;
    const endsBefore = c.end_date && toYmd(c.end_date) < bounds.periodStart;
    if (endsBefore) continue;
    const prev = bestByUser.get(uid);
    if (!prev || String(c.start_date ?? '') > String(prev.start_date ?? '')) bestByUser.set(uid, c);
  }

  // Employment type from profiles (parity with the shift path).
  const empTypeById = new Map<string, string | null>();
  const { data: profiles, error: pErr } = await (supabase as any)
    .from('profiles')
    .select('id, employment_type')
    .in('id', employeeIds);
  if (pErr) console.error('[leaveGrossPay] profiles query error:', pErr);
  for (const p of profiles ?? []) empTypeById.set(p.id, p.employment_type ?? null);

  const scoped = !!(bounds.orgIds?.length || bounds.deptIds?.length || bounds.subDeptIds?.length);

  for (const uid of employeeIds) {
    // Org/dept scoping is enforced by the contracts query above: no in-scope
    // contract ⇒ no context ⇒ the request is skipped.
    const c = bestByUser.get(uid);
    if (!c) {
      // CASUAL fallback (unscoped runs only — a synthesized context must not
      // bypass org/dept scoping): a casual needs no contract to be owed FDV
      // leave (cl 46.6, the only paid casual leave). rate=null + no
      // classification ⇒ the engine's conservative default (L1 casual);
      // dailyOrdinaryMinutes=0 because casual FDV days are priced from
      // rostered minutes only.
      const empType = mapEmploymentType(empTypeById.get(uid));
      if (!scoped && empType === 'Casual') {
        out.set(uid, {
          employeeId: uid,
          employmentType: empType,
          rate: null,
          classificationLevel: undefined,
          dailyOrdinaryMinutes: 0,
        });
      }
      continue; // permanents: no contract → cannot resolve a leave-day rate; skip.
    }
    // Rate precedence: an explicit contract override wins; otherwise pass the
    // CLASSIFICATION (rate = null) so the award engine resolves the
    // effective-dated EBA rate (permanent column — leave is non-casual only) —
    // rather than freezing today's remuneration_levels.hourly_rate_min into pay.
    const levelNum = c.remuneration_level != null ? Number(c.remuneration_level) : null;
    const classificationLevel =
      levelNum != null ? (levelNum === 0 ? 'TRAINEE' : `LEVEL_${levelNum}`) : undefined;
    const rate: number | null =
      c.custom_hourly_rate != null ? Number(c.custom_hourly_rate) : null;
    const weekly = c.contracted_weekly_hours != null ? Number(c.contracted_weekly_hours) : DEFAULT_WEEKLY_HOURS;
    const dailyOrdinaryMinutes = Math.round((weekly / WORKING_DAYS_PER_WEEK) * 60);
    out.set(uid, {
      employeeId: uid,
      employmentType: mapEmploymentType(empTypeById.get(uid)),
      rate,
      classificationLevel,
      dailyOrdinaryMinutes,
    });
  }
  return out;
}
