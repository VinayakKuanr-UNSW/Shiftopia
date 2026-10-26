/**
 * Compliance Service
 *
 * Asks the database's EBA engine, `eba_check_assignment` — the same rules every
 * shift write answers to at commit (trg_shift_eba_compliance). It reads the
 * person's whole schedule itself, RLS-blind, and answers only callers who may
 * already see that person's shifts (can_view_employee_schedule).
 *
 * If the engine cannot be reached, a local check that sees only the shift
 * itself runs instead, and the result says so (`engineReached: false`) — it is
 * never reported as the engine's verdict.
 *
 * Legacy adapter at the bottom maintains backward compatibility with
 * existing callers using complianceService.validateShiftCompliance().
 */

import { supabase } from '@/platform/supabase/client';
import { isValidUuid } from '@/modules/rosters/domain/shift.entity';
import { runHardValidation } from '@/modules/compliance';

// ── Types ──────────────────────────────────────────────────────────────────

export type ComplianceStatus =
  | 'passed'       // All checks passed — safe to save
  | 'violated'     // Hard violation — save MUST be blocked
  | 'warned'       // Soft warning — save can proceed with acknowledgment
  | 'unavailable'; // Engine unreachable — surface to UI, NEVER treat as passed

export interface QualificationViolation {
  type: 'ROLE_MISMATCH' | 'LICENSE_MISSING' | 'LICENSE_EXPIRED' | 'SKILL_MISSING' | 'SKILL_EXPIRED';
  message: string;
  role_id?: string;
  license_id?: string;
  license_name?: string;
  skill_id?: string;
  skill_name?: string;
  expiration_date?: string;
}

export interface ComplianceResult {
  /** Overall result status */
  status: ComplianceStatus;
  /** Hard violations — present when status = 'violated' */
  violations: string[];
  /** Soft warnings — may be present alongside any status */
  warnings: string[];
  /** Projected weekly hours after this shift is added */
  weeklyHours: number;
  /** Configured maximum weekly hours */
  maxWeeklyHours: number;
  /** Which checks actually ran successfully */
  checksPerformed: string[];
  /** Which checks could not reach the database */
  checksSkipped: string[];
  /** Structured qualification violations (role/license/skill) */
  qualificationViolations: QualificationViolation[];
}

export interface EbaCheckRow {
  is_compliant: boolean;
  rule_id: string | null;
  rule_name: string | null;
  tier: string | null;
  summary: string | null;
  details: string | null;
  payload: Record<string, any> | null;
}

export function mapEbaRowsToComplianceResult(data: EbaCheckRow | EbaCheckRow[]): ComplianceResult {
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  const violations: string[] = [];
  const warnings: string[] = [];
  const qualificationViolations: QualificationViolation[] = [];
  let weeklyHours = 0;

  for (const row of rows) {
    if (!row || (!row.rule_id && row.is_compliant)) {
      continue;
    }
    const message = row.details || row.summary || row.rule_name || 'EBA compliance rule violation';
    if (row.tier === 'BLOCKING' || row.is_compliant === false) {
      violations.push(message);
      if (
        row.rule_id === 'V8_QUALIFICATIONS' ||
        row.rule_id === 'V8_QUALIFICATION_EXPIRED' ||
        row.payload?.skill_id ||
        row.payload?.license_id
      ) {
        const isExpired = row.rule_id === 'V8_QUALIFICATION_EXPIRED' || Boolean(row.payload?.expiration_date);
        const isSkill = Boolean(row.payload?.skill_id);
        qualificationViolations.push({
          type: isSkill
            ? (isExpired ? 'SKILL_EXPIRED' : 'SKILL_MISSING')
            : (isExpired ? 'LICENSE_EXPIRED' : 'LICENSE_MISSING'),
          message,
          role_id: row.payload?.role_id,
          license_id: row.payload?.license_id,
          license_name: row.payload?.license_name,
          skill_id: row.payload?.skill_id,
          skill_name: row.payload?.skill_name,
          expiration_date: row.payload?.expiration_date,
        });
      }
    } else if (row.tier === 'WARNING') {
      warnings.push(message);
    }

    if (row.payload?.total_hours != null) {
      weeklyHours = Number(row.payload.total_hours);
    }
  }

  let status: ComplianceStatus = 'passed';
  if (violations.length > 0) {
    status = 'violated';
  } else if (warnings.length > 0) {
    status = 'warned';
  } else {
    status = 'passed';
  }

  return {
    status,
    violations,
    warnings,
    weeklyHours,
    maxWeeklyHours: MAX_WEEKLY_HOURS,
    checksPerformed: ['eba_check_assignment'],
    checksSkipped: [],
    qualificationViolations,
  };
}

function parseMinutes(timeStr?: string | null): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

function calculateUnpaidBreakMinutes(
  startTime?: string | null,
  endTime?: string | null,
  netLengthMinutes?: number | null,
  explicitUnpaid?: number | null
): number {
  if (typeof explicitUnpaid === 'number' && !isNaN(explicitUnpaid)) {
    return explicitUnpaid;
  }
  if (!startTime || !endTime || netLengthMinutes == null) {
    return 0;
  }
  let gross = parseMinutes(endTime) - parseMinutes(startTime);
  if (gross < 0) gross += 24 * 60;
  return Math.max(0, gross - Number(netLengthMinutes));
}

export interface ComplianceInput {
  employeeId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  netLengthMinutes: number;
  excludeV8ShiftId?: string;
  /** The shift ID (UUID) — required for qualification compliance check */
  shiftId?: string;
  /** Optional override for required role */
  overrideV8RoleId?: string;
  /** Optional override for required skills */
  overrideSkillIds?: string[];
  /** Optional override for required licenses */
  overrideLicenseIds?: string[];
  /** Optional explicit unpaid break minutes */
  unpaidBreakMinutes?: number;
}

// ── Main compliance entry point ────────────────────────────────────────────

const MAX_WEEKLY_HOURS = 48;

/** `checksSkipped` marker: the database engine never answered; any verdict is local. */
const REMOTE_ENGINE_SKIPPED = 'remote_evaluate_compliance';

const UNAVAILABLE_RESULT: ComplianceResult = {
  status: 'unavailable',
  violations: [],
  warnings: ['Cannot validate compliance without a valid employee assignment'],
  weeklyHours: 0,
  maxWeeklyHours: MAX_WEEKLY_HOURS,
  checksPerformed: [],
  checksSkipped: ['overlap', 'weekly_hours', 'rest_period', 'qualification'],
  qualificationViolations: [],
};

/**
 * Run EBA compliance checks via the eba_check_assignment RPC, falling back to a local check.
 */
export async function validateCompliance(input: ComplianceInput): Promise<ComplianceResult> {
  if (!isValidUuid(input.employeeId)) {
    return UNAVAILABLE_RESULT;
  }

  const unpaidBreakMins = calculateUnpaidBreakMinutes(
    input.startTime,
    input.endTime,
    input.netLengthMinutes,
    input.unpaidBreakMinutes
  );
  const targetShiftId = isValidUuid(input.shiftId)
    ? input.shiftId
    : (isValidUuid(input.excludeV8ShiftId) ? input.excludeV8ShiftId : null);

  // 1. Direct database RPC via SECURITY DEFINER eba_check_assignment
  if (typeof (supabase as any)?.rpc === 'function') {
    try {
      const { data, error } = await (supabase as any).rpc('eba_check_assignment', {
        p_shift_id: targetShiftId,
        p_employee_id: input.employeeId,
        p_shift_date: input.shiftDate,
        p_start_time: input.startTime,
        p_end_time: input.endTime,
        p_unpaid_break_mins: unpaidBreakMins,
        p_role_id: isValidUuid(input.overrideV8RoleId) ? input.overrideV8RoleId : null,
      });

      if (!error && data) {
        return mapEbaRowsToComplianceResult(data);
      }
      if (error) {
        console.warn('[validateCompliance] supabase.rpc(eba_check_assignment) error, performing local fallback check:', error);
      }
    } catch (rpcErr) {
      console.warn('[validateCompliance] supabase.rpc(eba_check_assignment) threw, performing local fallback check:', rpcErr);
    }
  }

  // Graceful local client-side hard-validation fallback
  try {
    const hv = runHardValidation({
      shift_date:      input.shiftDate,
      start_time:      input.startTime,
      end_time:        input.endTime,
      employee_id:     input.employeeId,
      existing_shifts: [],
      current_time:    new Date(),
      is_template:     false,
    });

    return {
      status: hv.passed ? 'passed' : 'violated',
      violations: hv.errors.map(e => e.message),
      warnings: [],
      weeklyHours: 0,
      maxWeeklyHours: MAX_WEEKLY_HOURS,
      checksPerformed: ['local_hard_validation'],
      checksSkipped: [REMOTE_ENGINE_SKIPPED],
      qualificationViolations: [],
    };
  } catch {
    return {
      status: 'unavailable',
      violations: [],
      warnings: ['Compliance engine unreachable — checks could not be performed'],
      weeklyHours: 0,
      maxWeeklyHours: MAX_WEEKLY_HOURS,
      checksPerformed: [],
      checksSkipped: [REMOTE_ENGINE_SKIPPED, 'overlap', 'weekly_hours', 'rest_period', 'qualification'],
      qualificationViolations: [],
    };
  }
}

// ── Legacy adapter ─────────────────────────────────────────────────────────
// Backward compatible with existing callers. New code should call
// validateCompliance() directly to access the full ComplianceResult.

export const complianceService = {
  async validateShiftCompliance(
    employeeId: string,
    shiftDate: string,
    startTime: string,
    endTime: string,
    netLengthMinutes: number,
    excludeV8ShiftId?: string,
  ) {
    const result = await validateCompliance({
      employeeId, shiftDate, startTime, endTime, netLengthMinutes, excludeV8ShiftId,
    });
    // F5: 'unavailable' must NOT be treated as valid. Only 'passed' and 'warned'
    // mean the check ran and found no blocking violation. Any other status
    // (including 'unavailable') is treated as invalid to prevent silent saves
    // when the compliance engine is unreachable.
    //
    // `status` is returned alongside so callers can tell the two failures apart.
    // They are not the same thing: 'violated' means the shift breaks a rule and
    // the manager needs to change it; 'unavailable' means we never found out,
    // and no amount of editing the shift will help. Collapsing both into
    // isValid=false produced "Compliance check failed:" with nothing after the
    // colon, because an unreachable engine reports no violations to list.
    //
    // `engineReached` is false when the edge function could not be reached and
    // the verdict came from the local fallback, which sees only past dates and
    // start=end and so "passes" almost anything. isValid keeps its meaning for
    // the callers that already rely on it; a write that must not proceed on an
    // unchecked shift (bulk publish) requires engineReached as well.
    return {
      isValid: result.status === 'passed' || result.status === 'warned',
      status: result.status,
      engineReached: !(result.checksSkipped ?? []).includes(REMOTE_ENGINE_SKIPPED),
      violations: result.violations,
      warnings: result.warnings,
      weeklyHours: result.weeklyHours,
      maxWeeklyHours: result.maxWeeklyHours,
    };
  },
};
