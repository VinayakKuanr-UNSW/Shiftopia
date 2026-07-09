/**
 * Shared projector utilities
 *
 * Functions used by multiple projectors — kept here to avoid circular imports.
 * Pure functions, no React, no side effects.
 *
 * Phase 3: Builds an AwardContext before the cost loop so holiday and
 * day-of-week lookups are O(1) map reads for every shift on the same date.
 */

import type { Shift } from '../../shift.entity';
import type { ProjectionStats } from '../types';
import { netMinutesFromShift } from '../utils/duration';
import { estimateDetailedShiftCost } from '../utils/cost/index';
import { buildAwardContext } from '../utils/cost/award-context';
import type { AwardContext } from '../utils/cost/award-context';

/**
 * Compute the top-level ProjectionStats bag from a flat Shift array.
 * Called by every projector so the returned `stats` field is consistent
 * across all four modes regardless of which projector is active.
 */
/** ISO-8601 week key `YYYY-Www` (Monday-anchored) — mirrors the pipeline helper. */
function isoWeekKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('T')[0].split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * cl 42 weekly OT: build `shiftId → priorOrdinaryHoursThisWeek` for assigned
 * non-casual, non-cancelled shifts. Group per employee + ISO week, order by
 * date/start, and accumulate each shift's ordinary hours. Mirrors the DTO-path
 * accumulation in runProjectionPipeline.ts so both stats surfaces agree.
 */
function buildPriorOrdinaryMap(shifts: Shift[]): Map<string, number> {
  const prior = new Map<string, number>();
  const byEmpWeek = new Map<string, Map<string, Shift[]>>();

  for (const s of shifts) {
    const empType = (s.target_employment_type ?? '').toLowerCase();
    const isNonCasual = !!empType && !empType.includes('casual');
    if (s.is_cancelled || !s.assigned_employee_id || !isNonCasual) continue;
    const emp = s.assigned_employee_id;
    const wk = isoWeekKey(s.shift_date);
    let weeks = byEmpWeek.get(emp);
    if (!weeks) { weeks = new Map(); byEmpWeek.set(emp, weeks); }
    let list = weeks.get(wk);
    if (!list) { list = []; weeks.set(wk, list); }
    list.push(s);
  }

  for (const weeks of byEmpWeek.values()) {
    for (const list of weeks.values()) {
      list.sort((a, b) =>
        a.shift_date === b.shift_date
          ? (a.start_time || '').localeCompare(b.start_time || '')
          : a.shift_date.localeCompare(b.shift_date),
      );
      let running = 0;
      for (const s of list) {
        prior.set(s.id, running);
        const net = netMinutesFromShift(s) / 60;
        const sched = (s.scheduled_length_minutes ?? 0) / 60;
        const dailyOt = sched > 0
          ? Math.max(0, net - sched, net - 12)
          : Math.max(0, net - 12);
        running += Math.max(0, net - dailyOt);
      }
    }
  }

  return prior;
}

export function buildStats(shifts: Shift[]): ProjectionStats {
  const nonCancelled = shifts.filter(s => !s.is_cancelled);

  // ── Phase 3: Pre-compute date context for the entire batch ─────────
  const assignedShifts = nonCancelled.filter(s => !!s.assigned_employee_id);
  const ctx = buildAwardContext(assignedShifts.map(s => s.shift_date).filter(Boolean));

  // ── cl 42 weekly OT: per-employee / per-ISO-week prior-ordinary accumulation.
  const priorOrdinaryMap = buildPriorOrdinaryMap(nonCancelled);

  let totalNetMinutes = 0;
  let estimatedCost   = 0;
  const costBreakdown = {
    base: 0,
    penalty: 0,
    overtime: 0,
    allowance: 0,
    leave: 0,
  };

  for (const shift of nonCancelled) {
    const mins = netMinutesFromShift(shift);
    totalNetMinutes += mins;

    // Cost is employee-dependent — only compute for assigned shifts
    if (shift.assigned_employee_id) {
      const roleName = shift.roles?.name;
      const empType = shift.target_employment_type;

      const detail = estimateDetailedShiftCost({
        netMinutes: mins,
        start_time: shift.start_time,
        end_time: shift.end_time,
        rate: (shift as any).actual_hourly_rate || shift.remuneration_rate,
        scheduled_length_minutes: shift.scheduled_length_minutes ?? 0,
        is_overnight: !!shift.is_overnight,
        is_cancelled: !!shift.is_cancelled,
        shift_date: shift.shift_date,
        allowances: shift.allowances,
        isAnnualLeave: (shift as any).isAnnualLeave,
        isPersonalLeave: (shift as any).isPersonalLeave,
        isCarerLeave: (shift as any).isCarerLeave,
        previousWage: (shift as any).previousWage,
        employmentType: empType === 'FT' ? 'Full-Time' : empType === 'PT' ? 'Part-Time' : (empType as any || 'Casual'),
        isSecurityRole: roleName?.toLowerCase().includes('security'),
        classificationLevel: roleName?.match(/(?:L|Level\s*)(\d)/i)
          ? `LEVEL_${roleName.match(/(?:L|Level\s*)(\d)/i)![1]}`
          : undefined,
        // cl 42 weekly OT — undefined ⇒ no-op (only set for non-casual shifts).
        priorOrdinaryHoursThisWeek: priorOrdinaryMap.get(shift.id),
      } as any, ctx);

      estimatedCost += detail.totalCost;
      costBreakdown.base += detail.ordinaryCost;
      costBreakdown.penalty += detail.penaltyCost;
      costBreakdown.overtime += detail.overtimeCost;
      costBreakdown.allowance += detail.allowanceCost ?? 0;
    }
  }

  return {
    totalShifts:    nonCancelled.length,
    assignedShifts: assignedShifts.length,
    openShifts:     nonCancelled.length - assignedShifts.length,
    publishedShifts: nonCancelled.filter(s => ['Published', 'InProgress', 'Completed'].includes(s.lifecycle_status)).length,
    totalNetMinutes,
    estimatedCost:  Math.round(estimatedCost * 100) / 100,
    costBreakdown,
  };
}
