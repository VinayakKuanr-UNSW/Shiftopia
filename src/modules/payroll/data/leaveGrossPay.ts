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

/** Leave flags the award engine understands (all optional; at most one true). */
export interface LeaveFlags {
  isAnnualLeave?: boolean;
  isPersonalLeave?: boolean;
  isCarerLeave?: boolean;
}

/**
 * Map a free-text `leave_requests.leave_type` to the award engine's leave flags,
 * or null for leave the gross engine must NOT price as paid ordinary leave
 * (unpaid, long-service, parental, unknown — handled elsewhere / not at all).
 */
export function leaveTypeToFlags(leaveType: string | null | undefined): LeaveFlags | null {
  const t = (leaveType ?? '').toLowerCase();
  if (/annual|recreation|holiday/.test(t)) return { isAnnualLeave: true };
  if (/carer|carer's|compassionate|bereavement/.test(t)) return { isCarerLeave: true };
  if (/personal|sick|illness/.test(t)) return { isPersonalLeave: true };
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

/** Resolved per-employee context for pricing a leave day. */
export interface LeaveEmployeeContext {
  employeeId: string;
  employmentType?: CostCalculatorOptions['employmentType'];
  rate: number | null;
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
export function buildLeaveInputs(
  req: LeaveRequestRow,
  ctx: LeaveEmployeeContext,
  days: string[],
): GrossPayShiftInput[] {
  const flags = leaveTypeToFlags(req.leave_type);
  if (!flags) return [];
  if (/casual/i.test(ctx.employmentType ?? '')) return []; // no paid leave accrual
  if (days.length === 0) return [];

  return days.map((shiftDate) => ({
    shiftId: `leave:${req.id}:${shiftDate}`,
    employeeId: ctx.employeeId,
    shiftDate,
    netMinutes: ctx.dailyOrdinaryMinutes,
    scheduledLengthMinutes: ctx.dailyOrdinaryMinutes,
    isOvernight: false,
    hoursSource: 'actual' as const,
    rate: ctx.rate,
    employmentType: ctx.employmentType,
    ...flags,
  }));
}

// ── I/O: fetch approved leave + resolve contexts ────────────────────────────

const APPROVED_LEAVE_STATUSES = new Set(['approved', 'accepted', 'taken']);

/**
 * Fetch approved leave requests overlapping the period and synthesise the
 * eligible-day `GrossPayShiftInput`s. Rate + contracted hours come from each
 * employee's active `user_contracts` row; employment type from `profiles`.
 */
export async function getLeaveGrossPayInputs(bounds: {
  periodStart: string;
  periodEnd: string;
}): Promise<GrossPayShiftInput[]> {
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

  const isHoliday = (ymd: string) => !!ausHolidays.isHoliday(ymd);
  const out: GrossPayShiftInput[] = [];
  for (const req of approved) {
    const ctx = ctxById.get(req.employee_id);
    if (!ctx) continue; // no resolvable contract/rate — skip rather than guess.
    const days = eligibleLeaveDays(req.start_date, req.end_date, bounds.periodStart, bounds.periodEnd, isHoliday);
    out.push(...buildLeaveInputs(req, ctx, days));
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
  bounds: { periodStart: string; periodEnd: string },
): Promise<Map<string, LeaveEmployeeContext>> {
  const out = new Map<string, LeaveEmployeeContext>();
  if (employeeIds.length === 0) return out;

  const { data: contracts, error: cErr } = await (supabase as any)
    .from('user_contracts')
    .select('user_id, remuneration_level, contracted_weekly_hours, custom_hourly_rate, status, start_date, end_date')
    .in('user_id', employeeIds);
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

  // Rate lookup for the referenced classification levels.
  const levels = Array.from(
    new Set(Array.from(bestByUser.values()).map((c) => c.remuneration_level).filter((n) => n != null)),
  );
  const rateByLevel = new Map<number, number>();
  if (levels.length > 0) {
    const { data: rems } = await (supabase as any)
      .from('remuneration_levels')
      .select('level_number, hourly_rate_min')
      .in('level_number', levels);
    for (const r of rems ?? []) {
      if (r.hourly_rate_min != null) rateByLevel.set(Number(r.level_number), Number(r.hourly_rate_min));
    }
  }

  // Employment type from profiles (parity with the shift path).
  const empTypeById = new Map<string, string | null>();
  const { data: profiles } = await (supabase as any)
    .from('profiles')
    .select('id, employment_type')
    .in('id', employeeIds);
  for (const p of profiles ?? []) empTypeById.set(p.id, p.employment_type ?? null);

  for (const uid of employeeIds) {
    const c = bestByUser.get(uid);
    if (!c) continue; // no contract → cannot resolve a leave-day rate; skip.
    const rate: number | null =
      c.custom_hourly_rate != null
        ? Number(c.custom_hourly_rate)
        : (c.remuneration_level != null ? (rateByLevel.get(Number(c.remuneration_level)) ?? null) : null);
    const weekly = c.contracted_weekly_hours != null ? Number(c.contracted_weekly_hours) : DEFAULT_WEEKLY_HOURS;
    const dailyOrdinaryMinutes = Math.round((weekly / WORKING_DAYS_PER_WEEK) * 60);
    out.set(uid, {
      employeeId: uid,
      employmentType: mapEmploymentType(empTypeById.get(uid)),
      rate,
      dailyOrdinaryMinutes,
    });
  }
  return out;
}
