/**
 * Projection Pipeline Orchestrator
 *
 * THE single entry point for all projection logic. Worker-agnostic, testable,
 * backend-portable. The worker calls this — it never calls projectors directly.
 *
 * Responsibilities:
 *   1. Filter shifts (via WorkerFilterDTO)
 *   2. Select the correct projector based on mode
 *   3. Route through the cache layer for cost lookups
 *   4. Compute top-level stats
 *   5. Return a fully-typed ProjectionResult
 *
 * This file must NEVER import React, Zustand, Supabase, or DOM APIs.
 */

import type {
  ProjectionRequest,
  ProjectionResult,
  ProjectionStatsResult,
  WorkerShiftDTO,
  WorkerFilterDTO,
} from '../worker/protocol';
import {
  makeCacheKey,
  getCachedCost,
  setCachedCost,
} from '../cache/projection.cache';
import type { ShiftCostBreakdown } from '../utils/cost/types';
import type { CostCalculatorOptions } from '../utils/cost/types';
import { detectSplitShiftEligibleIds } from '../utils/cost/split-shift-eligibility';
import { detectRestGapBreaches } from '../utils/cost/rest-gap-breach';
import { estimateDetailedShiftCost, extractLevel } from '../utils/cost/index';
import type { AwardContext } from '../utils/cost/award-context';
import { buildAwardContext } from '../utils/cost/award-context';
import { projectPeople } from '../projectors/people.projector';
import { projectGroup } from '../projectors/group.projector';
import { projectEvents } from '../projectors/events.projector';
import { projectRoles } from '../projectors/roles.projector';

// ── Filter Logic (mirrors utils/filters.ts but operates on DTOs) ─────────────

function applyFilters(shifts: WorkerShiftDTO[], filters: WorkerFilterDTO): WorkerShiftDTO[] {
  const {
    roleId, skillIds, lifecycleStatus, assignmentStatus,
    assignmentOutcome, biddingStatus, tradingStatus, stateId, searchQuery,
  } = filters;

  const noop =
    !roleId &&
    skillIds.length === 0 &&
    lifecycleStatus === 'all' &&
    assignmentStatus === 'all' &&
    assignmentOutcome === 'all' &&
    biddingStatus === 'all' &&
    tradingStatus === 'all' &&
    (!stateId || stateId === 'all') &&
    !searchQuery.trim();

  if (noop) return shifts;

  return shifts.filter(s => {
    if (roleId && s.roleId !== roleId) return false;
    if (skillIds.length > 0 && !skillIds.every(id => s.requiredSkills.includes(id))) return false;
    if (lifecycleStatus !== 'all' && s.lifecycleStatus.toLowerCase() !== lifecycleStatus) return false;
    if (assignmentStatus !== 'all') {
      const isAssigned = !!s.assignedEmployeeId;
      if (assignmentStatus === 'assigned' && !isAssigned) return false;
      if (assignmentStatus === 'unassigned' && isAssigned) return false;
      if (assignmentStatus === 'on_bidding' && s.biddingStatus === 'not_on_bidding') return false;
    }
    if (assignmentOutcome !== 'all') {
      if (assignmentOutcome === 'none' ? s.assignmentOutcome : s.assignmentOutcome !== assignmentOutcome) return false;
    }
    if (biddingStatus !== 'all' && s.biddingStatus !== biddingStatus) return false;
    if (tradingStatus !== 'all') {
      const isTrade = !!s.tradeRequestedAt;
      if (tradingStatus === 'requested' && !isTrade) return false;
      if (tradingStatus === 'none' && isTrade) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const role = (s.roleName ?? '').toLowerCase();
      const emp = `${s.employeeFirstName ?? ''} ${s.employeeLastName ?? ''}`.toLowerCase();
      const sub = (s.subGroupName ?? '').toLowerCase();
      const notes = (s.notes ?? '').toLowerCase();
      if (!role.includes(q) && !emp.includes(q) && !sub.includes(q) && !notes.includes(q)) return false;
    }
    return true;
  });
}

// ── Cost calculation with cache ──────────────────────────────────────────────


export function computeCostForShift(
  shift: WorkerShiftDTO,
  netMinutes: number,
  ctx?: AwardContext,
): ShiftCostBreakdown {
  const key = makeCacheKey(shift.id, shift.updatedAtMs);
  const cached = getCachedCost(key);
  if (cached) return cached;

  const empType = shift.targetEmploymentType;
  const result = estimateDetailedShiftCost({
    netMinutes,
    start_time: shift.startTime,
    end_time: shift.endTime,
    rate: shift.actualHourlyRate || shift.remunerationRate,
    scheduled_length_minutes: shift.scheduledLengthMinutes,
    is_overnight: shift.isOvernight,
    is_cancelled: shift.isCancelled,
    shift_date: shift.shiftDate,
    allowances: shift.allowances ?? undefined,
    isAnnualLeave: shift.isAnnualLeave,
    isPersonalLeave: shift.isPersonalLeave,
    isCarerLeave: shift.isCarerLeave,
    previousWage: shift.previousWage,
    employmentType: (empType === 'FT' || /full/i.test(empType as string)) ? 'Full-Time' : (empType === 'PT' || /part/i.test(empType as string)) ? 'Part-Time' : (empType as any || 'Casual'),
    isSecurityRole: shift.roleName?.toLowerCase().includes('security'),
    classificationLevel: extractLevel(shift.roleName),
  } as CostCalculatorOptions, ctx);

  setCachedCost(key, result);
  return result;
}

/**
 * Cost with cross-shift context the engine can't derive per-shift in
 * isolation — the running `priorOrdinaryHoursThisWeek` (cl 42) and/or an
 * auto-derived split-shift allowance (cl 28.4/39, compliance audit finding —
 * 2026-08-02). Deliberately UNCACHED: the per-shift cache key
 * (shiftId:updatedAtMs) does not encode either piece of context, so caching
 * an adjusted result would corrupt the shared entry read by the display
 * path. These are a small minority of shifts (weekly-OT: only members already
 * past ~38h in a week; split-shift: only same-day PT/Flex-PT pairs), so
 * recomputing them per projection is cheap.
 */
export function computeCostForShiftAdjusted(
  shift: WorkerShiftDTO,
  netMinutes: number,
  overrides: { priorOrdinaryHoursThisWeek?: number; isSplitShiftEligible?: boolean },
  ctx?: AwardContext,
): ShiftCostBreakdown {
  const empType = shift.targetEmploymentType;
  const allowances = overrides.isSplitShiftEligible
    ? { ...shift.allowances, splitShift: true }
    : (shift.allowances ?? undefined);
  return estimateDetailedShiftCost({
    netMinutes,
    start_time: shift.startTime,
    end_time: shift.endTime,
    rate: shift.actualHourlyRate || shift.remunerationRate,
    scheduled_length_minutes: shift.scheduledLengthMinutes,
    is_overnight: shift.isOvernight,
    is_cancelled: shift.isCancelled,
    shift_date: shift.shiftDate,
    allowances,
    isAnnualLeave: shift.isAnnualLeave,
    isPersonalLeave: shift.isPersonalLeave,
    isCarerLeave: shift.isCarerLeave,
    previousWage: shift.previousWage,
    employmentType: (empType === 'FT' || /full/i.test(empType as string)) ? 'Full-Time' : (empType === 'PT' || /part/i.test(empType as string)) ? 'Part-Time' : (empType as any || 'Casual'),
    isSecurityRole: shift.roleName?.toLowerCase().includes('security'),
    classificationLevel: extractLevel(shift.roleName),
    priorOrdinaryHoursThisWeek: overrides.priorOrdinaryHoursThisWeek,
  } as CostCalculatorOptions, ctx);
}

// ── Net minutes from DTO ─────────────────────────────────────────────────────

function netMinutesFromDTO(shift: WorkerShiftDTO): number {
  if (shift.netLengthMinutes != null && shift.netLengthMinutes > 0) return shift.netLengthMinutes;
  const [sh, sm] = shift.startTime.split(':').map(Number);
  const [eh, em] = shift.endTime.split(':').map(Number);
  let start = sh * 60 + sm;
  let end = eh * 60 + em;
  if (end <= start) end += 24 * 60;
  return Math.max(0, (end - start) - shift.unpaidBreakMinutes);
}

// ── Weekly overtime accumulation (cl 42) ─────────────────────────────────────
// The cost engine can move ordinary hours past 38h/week into overtime, but only
// if it is TOLD how many ordinary hours the member already banked earlier in the
// SAME ISO week. That is cross-shift context the engine can't see per-shift, so
// the pipeline computes it here: group each employee's assigned, non-cancelled,
// non-casual shifts by ISO week (Mon-anchored), order by date then start time,
// and hand each shift the RUNNING prior-ordinary total. Casuals are excluded
// (casual weekly OT is ambiguous under the EA — see standard.ts).

/** ISO-8601 week key `YYYY-Www` (Monday-anchored) for grouping. Pure, no deps. */
function isoWeekKey(dateStr: string): string {
  // Parse YYYY-MM-DD as a UTC date to avoid TZ drift, then apply the ISO rule.
  const [y, m, d] = dateStr.split('T')[0].split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  // ISO weekday: Mon=1..Sun=7. Shift to the Thursday of this week (ISO anchor).
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** True when the DTO's employment type is a permanent (non-casual) engagement. */
function isNonCasualDTO(shift: WorkerShiftDTO): boolean {
  const t = (shift.targetEmploymentType ?? '').toLowerCase();
  // Casual is the only excluded class; FT / PT / flexi all accrue weekly OT.
  return !!t && !t.includes('casual');
}

/**
 * Build `shiftId → priorOrdinaryHoursThisWeek` for every assigned non-casual
 * shift. Only the ORDINARY portion of each shift accumulates (daily/weekly OT
 * hours don't re-enter the ordinary tally). We derive the per-shift ordinary
 * hours from a cheap capless daily model that mirrors the engine's daily split;
 * the engine then applies the weekly reallocation exactly using this prior total.
 */
function buildPriorOrdinaryMap(shifts: WorkerShiftDTO[]): Map<string, number> {
  const prior = new Map<string, number>();

  // employeeId → isoWeek → list of {shift, sortKey}
  const byEmpWeek = new Map<string, Map<string, WorkerShiftDTO[]>>();
  for (const s of shifts) {
    if (s.isCancelled || !s.assignedEmployeeId || !isNonCasualDTO(s)) continue;
    const emp = s.assignedEmployeeId;
    const wk = isoWeekKey(s.shiftDate);
    let weeks = byEmpWeek.get(emp);
    if (!weeks) { weeks = new Map(); byEmpWeek.set(emp, weeks); }
    let list = weeks.get(wk);
    if (!list) { list = []; weeks.set(wk, list); }
    list.push(s);
  }

  for (const weeks of byEmpWeek.values()) {
    for (const list of weeks.values()) {
      // Order by date, then start time — the sequence in which hours accrue.
      list.sort((a, b) =>
        a.shiftDate === b.shiftDate
          ? a.startTime.localeCompare(b.startTime)
          : a.shiftDate.localeCompare(b.shiftDate),
      );
      let running = 0;
      for (const s of list) {
        prior.set(s.id, running);
        // Ordinary hours banked by THIS shift (daily model, no weekly cap here —
        // the engine handles the weekly split; we only need the ordinary tally).
        const net = netMinutesFromDTO(s) / 60;
        const sched = (s.scheduledLengthMinutes || 0) / 60;
        const dailyOt = sched > 0
          ? Math.max(0, net - sched, net - 12)
          : Math.max(0, net - 12);
        const dailyOrdinary = Math.max(0, net - dailyOt);
        running += dailyOrdinary;
      }
    }
  }

  return prior;
}

// ── Stats builder ────────────────────────────────────────────────────────────

function buildStats(shifts: WorkerShiftDTO[]): ProjectionStatsResult {
  const nonCancelled = shifts.filter(s => !s.isCancelled);
  let totalNetMinutes = 0, estimatedCost = 0;
  const cb = { base: 0, penalty: 0, overtime: 0, allowance: 0, leave: 0 };

  // ── Phase 3: Pre-compute date context for O(1) lookups ──────────────
  const assignedDates = nonCancelled
    .filter(s => !!s.assignedEmployeeId)
    .map(s => s.shiftDate)
    .filter(Boolean);
  const ctx = buildAwardContext(assignedDates);

  // ── cl 42 weekly OT: per-employee / per-ISO-week prior-ordinary accumulation.
  const priorOrdinaryMap = buildPriorOrdinaryMap(nonCancelled);

  // ── cl 28.4/39 split-shift allowance: auto-derived from same-day PT/Flex-PT
  // pairs with a ≤3h gap (compliance audit finding — 2026-08-02). Grouped
  // across ALL assigned shifts in this batch (by employee + date), not just
  // one employee, since `nonCancelled` spans the whole roster view.
  const splitShiftEligibleIds = detectSplitShiftEligibleIds(
    nonCancelled
      .filter(s => !!s.assignedEmployeeId)
      .map(s => ({
        id: s.id,
        employeeId: s.assignedEmployeeId as string,
        shiftDate: s.shiftDate,
        startTime: s.startTime,
        endTime: s.endTime,
        employmentType: s.targetEmploymentType,
        isLeave: !!(s.isAnnualLeave || s.isPersonalLeave || s.isCarerLeave),
      })),
  );

  // ── cl 40.1 rest-gap double-time: forced early recall (compliance audit
  // finding — 2026-08-02). Applies to EVERY employment type, so — unlike
  // split-shift — the candidate filter is not narrowed to PT/Flex-PT.
  const restGapBreaches = detectRestGapBreaches(
    nonCancelled
      .filter(s => !!s.assignedEmployeeId)
      .map(s => ({
        id: s.id,
        employeeId: s.assignedEmployeeId as string,
        shiftDate: s.shiftDate,
        startTime: s.startTime,
        endTime: s.endTime,
        isWorkedWithTimes: !(s.isAnnualLeave || s.isPersonalLeave || s.isCarerLeave)
          && !!s.startTime && !!s.endTime && netMinutesFromDTO(s) > 0,
      })),
  );

  for (const s of nonCancelled) {
    const mins = netMinutesFromDTO(s);
    totalNetMinutes += mins;

    // Cost is employee-dependent — only compute for assigned shifts
    if (s.assignedEmployeeId) {
      const prior = priorOrdinaryMap.get(s.id);
      const isSplitShiftEligible = splitShiftEligibleIds.has(s.id);
      // When a shift carries cross-shift context (a weekly-OT prior total
      // and/or an auto-derived split-shift allowance) we price it WITHOUT the
      // per-shift cache: the cache is keyed on shiftId:updatedAtMs only, so a
      // context-dependent cost would poison the shared entry used by the
      // display path. Shifts with neither keep the cached fast path.
      const detail = (prior !== undefined || isSplitShiftEligible)
        ? computeCostForShiftAdjusted(s, mins, { priorOrdinaryHoursThisWeek: prior, isSplitShiftEligible }, ctx)
        : computeCostForShift(s, mins, ctx);

      // cl 40.1 double-time floor — applied as a pure ADDITIVE top-up to the
      // running totals (never mutates `detail`, which may be the shared
      // cached object) so this never risks poisoning the per-shift cache.
      let restGapPenalty = 0;
      if (restGapBreaches.has(s.id)) {
        const hours = detail.ordinaryHours + detail.overtimeHours;
        const ordinaryRate = detail.breakdown.ordinaryRate;
        const effectiveRate = hours > 0 ? detail.totalCost / hours : 0;
        const doubleTimeRate = 2 * ordinaryRate;
        if (ordinaryRate > 0 && effectiveRate < doubleTimeRate) {
          restGapPenalty = Math.round((doubleTimeRate - effectiveRate) * hours * 100) / 100;
        }
      }

      estimatedCost += detail.totalCost + restGapPenalty;
      cb.base += detail.ordinaryCost;
      cb.penalty += detail.penaltyCost + restGapPenalty;
      cb.overtime += detail.overtimeCost;
      cb.allowance += detail.allowanceCost ?? 0;
    }
  }

  return {
    totalShifts: nonCancelled.length,
    assignedShifts: nonCancelled.filter(s => !!s.assignedEmployeeId).length,
    openShifts: nonCancelled.filter(s => !s.assignedEmployeeId).length,
    publishedShifts: nonCancelled.filter(s => ['Published', 'InProgress', 'Completed'].includes(s.lifecycleStatus)).length,
    totalNetMinutes,
    estimatedCost: Math.round(estimatedCost * 100) / 100,
    costBreakdown: cb,
  };
}

// ── Main Pipeline ────────────────────────────────────────────────────────────

/**
 * Run the full projection pipeline. This is the ONLY function the worker calls.
 *
 * @param request  - The projection request with DTOs, mode, and filters
 * @param activeRequestId - Ref to the current active request ID for cancellation
 * @returns ProjectionResult or null if cancelled
 */
export function runProjectionPipeline(
  request: ProjectionRequest,
  activeRequestId?: { current: number },
): ProjectionResult | null {
  const t0 = performance.now();

  // ── Cancellation check helper ──
  const isCancelled = () =>
    activeRequestId != null && activeRequestId.current !== request.requestId;

  // ── 1. Filter ──
  const filtered = applyFilters(request.shifts, request.filters);
  if (isCancelled()) return null;

  // ── 2. Stats (always computed) ──
  const stats = buildStats(filtered);
  if (isCancelled()) return null;

  // ── 3. Mode-specific projection ──
  // Placeholder: returns the stats and filtered count.
  // Phase 2 will wire in the actual projector logic for each mode,
  // converting WorkerShiftDTOs into ProjectedShiftResults.
  const result: ProjectionResult = {
    requestId: request.requestId,
    durationMs: 0,
    mode: request.mode,
    stats,
    group: null,
    people: null,
    events: null,
    roles: null,
  };

  if (request.mode === 'people') {
    result.people = projectPeople(filtered, { employees: request.employees, nowIso: request.nowIso, rangeDays: request.rangeDays });
  } else if (request.mode === 'group') {
    result.group = projectGroup(filtered, { rosterStructures: request.rosterStructures });
  } else if (request.mode === 'events') {
    result.events = projectEvents(filtered, { events: request.events });
  } else if (request.mode === 'roles') {
    result.roles = projectRoles(filtered, { roles: request.roles, levels: request.levels });
  }

  result.durationMs = Math.round(performance.now() - t0);
  return result;
}
