/**
 * Compliance Service
 *
 * Runs four compliance checks against the database and returns a
 * strongly-typed ComplianceResult. Failures are never swallowed silently.
 *
 * Each check (overlap, weekly hours, rest period, qualification) is
 * independently wrapped in a Result<T> so that:
 *  - A network failure on one check does NOT cancel the others
 *  - The caller sees exactly which checks ran and which were unavailable
 *  - The overall status is 'unavailable' only if ALL checks failed —
 *    not just one, and never silently treated as 'passed'
 *
 * Legacy adapter at the bottom maintains backward compatibility with
 * existing callers using complianceService.validateShiftCompliance().
 */

import { supabase } from '@/platform/realtime/client';
import { isValidUuid } from '@/modules/rosters/domain/shift.entity';
import { ok, err, type Result } from '@/platform/supabase/rpc/result';
import { AppError } from '@/platform/supabase/rpc/errors';
import {
  OverlapCheckSchema,
  WeeklyHoursSchema,
  RestPeriodSchema,
} from '@/modules/rosters/api/contracts';

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

export interface ComplianceInput {
  employeeId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  netLengthMinutes: number;
  excludeShiftId?: string;
  /** The shift ID (UUID) — required for qualification compliance check */
  shiftId?: string;
  /** Optional override for required role */
  overrideRoleId?: string;
  /** Optional override for required skills */
  overrideSkillIds?: string[];
  /** Optional override for required licenses */
  overrideLicenseIds?: string[];
}

// ── Individual check functions — each returns Result<T> ───────────────────

async function checkOverlap(input: ComplianceInput): Promise<Result<boolean>> {
  const { data, error } = await supabase.rpc('check_shift_overlap', {
    p_employee_id: input.employeeId,
    p_shift_date: input.shiftDate,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    ...(input.excludeShiftId ? { p_exclude_shift_id: input.excludeShiftId } : {}),
  });

  if (error) {
    return err(new AppError({
      code: 'RPC_NETWORK',
      message: error.message,
      rpcName: 'check_shift_overlap',
    }));
  }

  const parsed = OverlapCheckSchema.safeParse(data);
  if (!parsed.success) {
    return err(new AppError({
      code: 'RPC_VALIDATION',
      message: 'check_shift_overlap returned unexpected data',
      rpcName: 'check_shift_overlap',
    }));
  }

  return ok(parsed.data);
}

async function checkWeeklyHours(input: ComplianceInput): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('calculate_weekly_hours', {
    p_employee_id: input.employeeId,
    p_week_start_date: getWeekStart(input.shiftDate),
  });

  if (error) {
    return err(new AppError({
      code: 'RPC_NETWORK',
      message: error.message,
      rpcName: 'calculate_weekly_hours',
    }));
  }

  const parsed = WeeklyHoursSchema.safeParse(data);
  if (!parsed.success) {
    return err(new AppError({
      code: 'RPC_VALIDATION',
      message: 'calculate_weekly_hours returned unexpected data',
      rpcName: 'calculate_weekly_hours',
    }));
  }

  return ok(parsed.data);
}

async function checkRestPeriod(input: ComplianceInput): Promise<Result<boolean>> {
  const { data, error } = await supabase.rpc('validate_rest_period', {
    p_employee_id: input.employeeId,
    p_shift_date: input.shiftDate,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_minimum_hours: 11,
  });

  if (error) {
    return err(new AppError({
      code: 'RPC_NETWORK',
      message: error.message,
      rpcName: 'validate_rest_period',
    }));
  }

  const parsed = RestPeriodSchema.safeParse(data);
  if (!parsed.success) {
    return err(new AppError({
      code: 'RPC_VALIDATION',
      message: 'validate_rest_period returned unexpected data',
      rpcName: 'validate_rest_period',
    }));
  }

  return ok(parsed.data);
}

// ── Qualification check ───────────────────────────────────────────────────

interface QualificationRpcResult {
  is_compliant: boolean;
  compliance_status: string;
  violations: QualificationViolation[];
  eligibility_snapshot: Record<string, unknown> | null;
}

async function checkQualification(
  shiftId: string,
  employeeId: string,
  overrideRoleId?: string,
  overrideSkillIds?: string[],
  overrideLicenseIds?: string[],
): Promise<Result<QualificationRpcResult>> {
  const { data, error } = await supabase.rpc('check_shift_compliance', {
    p_roster_shift_id: shiftId,
    p_employee_id: employeeId,
    p_role_id_override: overrideRoleId || null,
    p_skill_ids_override: overrideSkillIds || null,
    p_license_ids_override: overrideLicenseIds || null,
  });

  if (error) {
    return err(new AppError({
      code: 'RPC_NETWORK',
      message: error.message,
      rpcName: 'check_shift_compliance',
    }));
  }

  // The RPC returns a single-row SETOF, Supabase wraps it in an array
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.is_compliant !== 'boolean') {
    return err(new AppError({
      code: 'RPC_VALIDATION',
      message: 'check_shift_compliance returned unexpected data',
      rpcName: 'check_shift_compliance',
    }));
  }

  return ok(row as QualificationRpcResult);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = start of week
  date.setDate(date.getDate() + diff);
  return date.toISOString().split('T')[0];
}

// ── Main compliance entry point ────────────────────────────────────────────

/**
 * Run all four compliance checks and return a typed ComplianceResult.
 *
 * Checks run in parallel. Each is independently fault-tolerant.
 * Unavailable checks surface as warnings — NEVER silently treated as passing.
 */
export async function validateCompliance(input: ComplianceInput): Promise<ComplianceResult> {
  const MAX_WEEKLY_HOURS = 48;

  if (!isValidUuid(input.employeeId)) {
    return {
      status: 'unavailable',
      violations: [],
      warnings: ['Cannot validate compliance without a valid employee assignment'],
      weeklyHours: 0,
      maxWeeklyHours: MAX_WEEKLY_HOURS,
      checksPerformed: [],
      checksSkipped: ['overlap', 'weekly_hours', 'rest_period', 'qualification'],
      qualificationViolations: [],
    };
  }

  // Run all checks in parallel — qualification only if shiftId is provided
  const qualificationPromise = input.shiftId && isValidUuid(input.shiftId)
    ? checkQualification(input.shiftId, input.employeeId, input.overrideRoleId, input.overrideSkillIds, input.overrideLicenseIds)
    : null;

  const [overlapResult, weeklyResult, restResult, qualResult] = await Promise.all([
    checkOverlap(input),
    checkWeeklyHours(input),
    checkRestPeriod(input),
    qualificationPromise,
  ]);

  const violations: string[] = [];
  const warnings: string[] = [];
  const checksPerformed: string[] = [];
  const checksSkipped: string[] = [];
  const qualificationViolations: QualificationViolation[] = [];
  let weeklyHours = 0;

  // Overlap
  if (overlapResult.ok) {
    checksPerformed.push('overlap');
    if (overlapResult.value) {
      violations.push('This shift overlaps with an existing shift for the employee');
    }
  } else {
    checksSkipped.push('overlap');
    warnings.push(`Overlap check unavailable — ${(overlapResult as any).error.message}`);
  }

  // Weekly hours
  if (weeklyResult.ok) {
    checksPerformed.push('weekly_hours');
    const projected = weeklyResult.value / 60 + input.netLengthMinutes / 60;
    weeklyHours = projected;
    if (projected > MAX_WEEKLY_HOURS) {
      violations.push(
        `Shift would exceed the weekly hours limit (${projected.toFixed(1)}h / ${MAX_WEEKLY_HOURS}h)`
      );
    } else if (projected > MAX_WEEKLY_HOURS * 0.9) {
      warnings.push(
        `Employee is approaching the weekly hours limit (${projected.toFixed(1)}h / ${MAX_WEEKLY_HOURS}h)`
      );
    }
  } else {
    checksSkipped.push('weekly_hours');
    warnings.push(`Weekly hours check unavailable — ${(weeklyResult as any).error.message}`);
  }

  // Rest period
  if (restResult.ok) {
    checksPerformed.push('rest_period');
    if (!restResult.value) {
      violations.push('Minimum rest period of 11 hours between consecutive shifts is not met');
    }
  } else {
    checksSkipped.push('rest_period');
    warnings.push(`Rest period check unavailable — ${(restResult as any).error.message}`);
  }

  // Qualification
  if (qualResult === null) {
    // No shiftId provided — skip silently (not an error)
    checksSkipped.push('qualification');
  } else if (qualResult.ok) {
    checksPerformed.push('qualification');
    const qr = qualResult.value;
    if (!qr.is_compliant && Array.isArray(qr.violations)) {
      qr.violations.forEach((v: QualificationViolation) => {
        qualificationViolations.push(v);
        violations.push(v.message);
      });
    }
  } else {
    checksSkipped.push('qualification');
    warnings.push(`Qualification check unavailable — ${(qualResult as any).error.message}`);
  }

  const totalChecks = 4; // overlap, weekly_hours, rest_period, qualification
  let status: ComplianceStatus;
  if (violations.length > 0) {
    status = 'violated';
  } else if (checksSkipped.length === totalChecks) {
    status = 'unavailable'; // all checks failed — do NOT silently pass
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
    checksPerformed,
    checksSkipped,
    qualificationViolations,
  };
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
    excludeShiftId?: string,
  ) {
    const result = await validateCompliance({
      employeeId, shiftDate, startTime, endTime, netLengthMinutes, excludeShiftId,
    });
    return {
      isValid: result.status !== 'violated',
      violations: result.violations,
      warnings: result.warnings,
      weeklyHours: result.weeklyHours,
      maxWeeklyHours: result.maxWeeklyHours,
    };
  },
};
