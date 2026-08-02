/**
 * Reserve List — live candidate search + manager-only emergency assignment.
 *
 * Composed entirely from existing, already-correct subsystems rather than a
 * new eligibility/compliance engine — see
 * docs/investigations/2026-07-21_reserve-list-audit-and-implementation-plan.md §4, §12 for the
 * full rationale:
 *   - EligibilityService.getEligibleEmployees()  → structural (org/dept/role/
 *     skill/license via active contract) eligibility.
 *   - profiles.is_active / status / termination_date / preferences.reserve_list.opt_in
 *     → the one genuinely missing filter (nothing else in the codebase applies
 *     employment-status or opt-in filtering to scheduling candidates).
 *   - check_shift_overlap RPC                     → cheap overlap pre-filter.
 *   - evaluateShiftAvailabilityFromSlots()         → declared-availability read.
 *   - validateCompliance() / evaluate-compliance   → the real, live V8 compliance
 *     engine (fatigue, EBA, visa, leave, overlap, qualifications) — the same
 *     call real shift assignment already makes.
 *   - sm_apply_shift_op ('assign' then 'publish')  → the existing version-CAS +
 *     row-locked + FSM-guarded + audited mutation gateway, hardened in
 *     migration 20260721013000 to re-check overlap at commit time and to fold
 *     the emergency-confirm publish into the same protected path.
 *
 * Nothing here invents a second eligibility engine, a second compliance
 * engine, or a second locking mechanism.
 */

import { supabase } from '@/platform/supabase/client';
import { callRpc } from '@/platform/supabase/rpc/client';
import { isValidUuid, calculateMinutesBetweenTimes } from '@/modules/rosters/domain/shift.entity';
import { shiftsQueries } from '@/modules/rosters/api/shifts.queries';
import { ApplyShiftOpResponseSchema, OverlapCheckSchema } from '@/modules/rosters/api/contracts';
import { EligibilityService } from '@/modules/rosters/services/eligibility.service';
import { validateCompliance } from '@/modules/rosters/services/compliance.service';
import {
  evaluateShiftAvailabilityFromSlots,
  type DeclaredSlot,
} from '@/modules/rosters/domain/availability-check';
import type { ReserveListAssignResult, ReserveListCandidate } from '../model/reserveList.types';

interface ReserveListProfileRow {
  id: string;
  email: string | null;
  status: string | null;
  is_active: boolean | null;
  termination_date: string | null;
  preferences: { reserve_list?: { opt_in?: boolean } } | null;
}

function isEmploymentEligible(p: ReserveListProfileRow, shiftDate: string): boolean {
  if (p.is_active === false) return false;
  if (p.status && p.status !== 'Active') return false;
  if (p.termination_date && p.termination_date <= shiftDate) return false;
  return true;
}

/**
 * Run a fresh Reserve List candidate search for a shift. Never cache the
 * result — call this again on every "Refresh" press (per the spec: the
 * pool must reflect the latest compliance, availability, assignments,
 * fatigue, version, qualifications, and leave every time).
 */
export async function getReserveListCandidates(shiftId: string): Promise<ReserveListCandidate[]> {
  if (!isValidUuid(shiftId)) return [];

  const shift = await shiftsQueries.getShiftById(shiftId);
  if (!shift) return [];

  // 1. Structural eligibility (active contract matching org/dept/sub-dept/role,
  //    plus required skills/licenses on the shift).
  const eligible = await EligibilityService.getEligibleEmployees({
    organizationId: shift.organization_id ?? undefined,
    departmentId: shift.department_id,
    subDepartmentId: shift.sub_department_id ?? undefined,
    roleId: shift.role_id ?? undefined,
    skills: shift.required_skills?.length ? shift.required_skills : undefined,
    licenses: shift.required_licenses?.length ? shift.required_licenses : undefined,
  });
  if (eligible.length === 0) return [];

  const candidateIds = eligible.map((e) => e.id);
  const eligibleById = new Map(eligible.map((e) => [e.id, e]));

  // 2. Employment status + Reserve List opt-in — the one filter nothing else
  //    in the codebase already applies (see module doc comment above).
  const { data: profileRows, error: profileErr } = await supabase
    .from('profiles')
    .select('id, email, status, is_active, termination_date, preferences')
    .in('id', candidateIds);

  if (profileErr) {
    console.error('[reserveList] Error fetching profiles:', profileErr);
    return [];
  }

  const shortlist = ((profileRows ?? []) as ReserveListProfileRow[]).filter(
    (p) => isEmploymentEligible(p, shift.shift_date) && p.preferences?.reserve_list?.opt_in === true,
  );
  if (shortlist.length === 0) return [];

  const profileById = new Map(shortlist.map((p) => [p.id, p]));
  const shortlistIds = shortlist.map((p) => p.id);

  // 3. Declared availability for this date (unset = unavailable — advisory,
  //    surfaced in the panel, not a hard exclusion by itself).
  const { data: slotRows } = await supabase
    .from('availability_slots')
    .select('profile_id, slot_date, start_time, end_time')
    .in('profile_id', shortlistIds)
    .eq('slot_date', shift.shift_date);

  const slotsByProfile = new Map<string, DeclaredSlot[]>();
  (slotRows ?? []).forEach((s: { profile_id: string; slot_date: string; start_time: string; end_time: string }) => {
    const list = slotsByProfile.get(s.profile_id) ?? [];
    list.push({ slot_date: s.slot_date, start_time: s.start_time, end_time: s.end_time });
    slotsByProfile.set(s.profile_id, list);
  });

  // 4. Cheap overlap pre-filter (DB-side, same function the write path
  //    re-checks at commit time) before running the heavier compliance engine.
  const overlapChecks = await Promise.all(
    shortlistIds.map(async (id) => {
      try {
        const overlaps = await callRpc(
          'check_shift_overlap',
          {
            p_employee_id: id,
            p_shift_date: shift.shift_date,
            p_start_time: shift.start_time,
            p_end_time: shift.end_time,
            p_exclude_shift_id: shiftId,
          },
          OverlapCheckSchema,
        );
        return { id, overlaps };
      } catch (e) {
        console.error('[reserveList] Overlap check failed for', id, e);
        return { id, overlaps: true }; // fail closed — exclude on error
      }
    }),
  );
  const overlapFreeIds = overlapChecks.filter((r) => !r.overlaps).map((r) => r.id);
  if (overlapFreeIds.length === 0) return [];

  // 5. Full compliance run per remaining candidate. The spec requires the
  //    search to ONLY return employees who pass compliance/fatigue/EBA/visa —
  //    not just structurally-eligible ones — so this runs at search time, not
  //    only on-demand per row.
  const netMinutes =
    calculateMinutesBetweenTimes(shift.start_time, shift.end_time) - (shift.unpaid_break_minutes || 0);

  const complianceResults = await Promise.all(
    overlapFreeIds.map(async (id) => {
      const compliance = await validateCompliance({
        employeeId: id,
        shiftDate: shift.shift_date,
        startTime: shift.start_time,
        endTime: shift.end_time,
        netLengthMinutes: netMinutes,
        shiftId,
      });
      return { id, compliance };
    }),
  );

  const candidates: ReserveListCandidate[] = [];
  for (const { id, compliance } of complianceResults) {
    // 'violated' and 'unavailable' are excluded — only 'passed'/'warned' count
    // as eligible, matching complianceService.validateShiftCompliance's rule.
    if (compliance.status !== 'passed' && compliance.status !== 'warned') continue;

    const profile = profileById.get(id);
    const eligibleInfo = eligibleById.get(id);
    const availability = evaluateShiftAvailabilityFromSlots(
      slotsByProfile.get(id) ?? null,
      shift.shift_date,
      shift.start_time,
      shift.end_time,
    );

    candidates.push({
      employeeId: id,
      name: `${eligibleInfo?.first_name ?? ''} ${eligibleInfo?.last_name ?? ''}`.trim(),
      email: profile?.email ?? '',
      roleId: shift.role_id,
      contractType: eligibleInfo?.contract_type ?? null,
      currentWeeklyHours: compliance.weeklyHours,
      maxWeeklyHours: compliance.maxWeeklyHours,
      complianceStatus: compliance.status,
      violations: compliance.violations,
      warnings: compliance.warnings,
      availability,
    });
  }

  candidates.sort((a, b) => a.name.localeCompare(b.name));
  return candidates;
}

function mapApplyEnvelopeToAssignResult(
  envelope: import('zod').infer<typeof ApplyShiftOpResponseSchema>,
): ReserveListAssignResult {
  switch (envelope.code) {
    case 'APPLIED':
    case 'IDEMPOTENT_REPLAY':
      return { success: true, version: envelope.version };
    case 'VERSION_CONFLICT':
      return {
        success: false,
        reason: 'STALE',
        message: 'This shift changed while you were searching (someone else may have edited or assigned it). Refresh and try again.',
      };
    case 'WRITE_REJECTED':
      if (envelope.note === 'CANDIDATE_OVERLAP') {
        return {
          success: false,
          reason: 'CANDIDATE_NO_LONGER_ELIGIBLE',
          message: 'This employee has since been assigned to a conflicting shift. Refresh the candidate list and pick someone else.',
        };
      }
      return { success: false, reason: 'REJECTED', message: envelope.note ?? 'Assignment was rejected.' };
    case 'ILLEGAL_TRANSITION':
      return {
        success: false,
        reason: 'ILLEGAL_TRANSITION',
        message: `Not allowed in the shift's current state (${envelope.current_state ?? 'unknown'}).`,
      };
    case 'FORBIDDEN':
      return { success: false, reason: 'FORBIDDEN', message: 'You do not have permission to assign this shift.' };
    case 'GONE':
      return { success: false, reason: 'GONE', message: 'Shift not found or has been deleted.' };
    default:
      return { success: false, reason: 'ERROR', message: envelope.error ?? 'Failed to assign shift.' };
  }
}

/**
 * Assign a Reserve List candidate to a shift and (for the emergent,
 * TTS<4h case this feature exists for) publish it in the same action —
 * the spec's "manager selects employee → Run Compliance → Assign → Publish"
 * workflow. Both steps go through sm_apply_shift_op, so both get the row
 * lock + version CAS + FSM guard + audit trail, and the 'assign' step gets
 * the server-side overlap re-check added in migration 20260721013000.
 */
export async function assignFromReserveList(
  shiftId: string,
  employeeId: string,
  expectedVersion: number,
): Promise<ReserveListAssignResult> {
  const assignEnvelope = await callRpc(
    'sm_apply_shift_op',
    {
      p_shift_id: shiftId,
      p_expected_version: expectedVersion,
      p_op: 'assign',
      p_payload: {
        employee_id: employeeId,
        assignment_source: 'reserve_list',
        reason: 'Reserve List emergency assignment',
      },
      p_idempotency_key: null,
    },
    ApplyShiftOpResponseSchema,
  );

  const assignResult = mapApplyEnvelopeToAssignResult(assignEnvelope);
  if (!assignResult.success || assignEnvelope.version === undefined) {
    return assignResult;
  }

  const publishEnvelope = await callRpc(
    'sm_apply_shift_op',
    {
      p_shift_id: shiftId,
      p_expected_version: assignEnvelope.version,
      p_op: 'publish',
      p_payload: { reason: 'Reserve List emergency publish' },
      p_idempotency_key: null,
    },
    ApplyShiftOpResponseSchema,
  );

  if (publishEnvelope.code === 'APPLIED' || publishEnvelope.code === 'IDEMPOTENT_REPLAY') {
    return { success: true, version: publishEnvelope.version };
  }

  // Assignment succeeded but the follow-on publish didn't — not a broken
  // state (the shift is simply Draft+Assigned), but the manager needs to
  // know to publish it manually to actually confirm the worker.
  return {
    success: true,
    version: assignEnvelope.version,
    warning: `Employee assigned, but publishing failed (${publishEnvelope.note ?? publishEnvelope.code}). Publish the shift from the card to confirm it.`,
  };
}
