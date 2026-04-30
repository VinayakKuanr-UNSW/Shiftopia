import {
  DemandTensor,
  SynthesizedShift,
  minutesToTime,
  applySupervisorRatios,
  applyMinimumStaff,
} from '../domain/shiftSynthesizer.policy';
import {
  synthesizeShifts,
  getCoverageWindow,
} from './shiftSynthesiser.service';
import { shiftsCommands } from '../api/shifts.commands';
import { synthesisRunsQueries } from '../api/synthesisRuns.queries';
import { processInChunks } from '../domain/bulk-action-engine';
import {
  fetchSupervisoryRatios,
  fetchMinimumStaffRules,
} from '../api/workRules.queries';
import type { CreateShiftData } from '../api/shifts.dto';
import type { TemplateGroupType } from '../domain/shift.entity';
import { supabase } from '@/platform/realtime/client';
import { createModuleLogger } from '@/modules/core/lib/logger';

// ── Compliance Engine v2 ──────────────────────────────────────────────────────
// Rewired from capstone's compliance.service to the parent's unified engine.
// All synthesized shifts are inserted as Draft for manager review (option b).
// Hard-blocked shifts are NOT silently dropped — they land as Draft with a
// compliance_status flag so a manager can inspect and approve or discard.
//
// TODO: The `shifts` table may not yet have a `compliance_status` column.
//       When it is added (planned for a later phase), stamp it here on insert.
//       For now we log the compliance result and proceed with Draft insertion.
import { evaluateCompliance } from '@/modules/compliance/v2/index';
import type { ComplianceInputV2, ShiftV2 } from '@/modules/compliance/v2/index';

const logger = createModuleLogger('shiftSynthesiser.orchestrator');

export interface SynthesizeAndInsertParams {
  demandTensors: DemandTensor[];
  rosterId: string;
  departmentId: string;
  shiftDate: string; // YYYY-MM-DD
  organizationId?: string;
  timezone?: string;
  /** When provided, stamped onto every created shift so the run can be rolled back. */
  synthesisRunId?: string;
  /** Pass the array of unassigned shift IDs computed from dry run for immediate deletion. */
  suggestedDeletions?: string[];
  /** Gate supervisor-ratio expansion (Step 6). Default true. */
  enforceSupervisorRatios?: boolean;
  /** Gate minimum-staff enforcement (Step 7). Default true. */
  enforceMinimumStaff?: boolean;
  /** Gate min 3h / max 12h shift duration (Steps 8-9). Default true. */
  enforceMinMax?: boolean;
  /** Merge sub-1h spikes into adjacent shifts. Default false. */
  mergeMicroPeaks?: boolean;
}

export interface SynthesizeAndInsertResult {
  createdCount: number;
  deletedCount: number;
  failed: Array<{ index: number; reason: string }>;
  synthesizedShifts: SynthesizedShift[];
}

/** Map the shift's building type to the roster_group name a DB trigger accepts. */
function buildingTypeToGroupName(
  buildingType: string,
): 'Convention Centre' | 'Exhibition Centre' | 'Theatre' {
  if (buildingType === 'exhibition_centre') return 'Exhibition Centre';
  if (buildingType === 'theatre') return 'Theatre';
  return 'Convention Centre'; // Default
}

/**
 * Every shift row needs a `roster_subgroup_id` (NOT NULL). Resolve one for the
 * roster by reusing what's there, falling back to creating a minimal default.
 */
async function ensureDefaultRosterSubgroup(
  rosterId: string,
  buildingType: string,
): Promise<string> {
  const { data: groups, error: qErr } = await supabase
    .from('roster_groups')
    .select('id, name, roster_subgroups(id)')
    .eq('roster_id', rosterId);
  if (qErr) throw new Error(`Failed to read roster subgroups: ${qErr.message}`);

  const existingGroups = (groups ?? []) as Array<{
    id: string;
    name: string;
    roster_subgroups?: { id: string }[];
  }>;

  // 1. Any subgroup already attached anywhere on the roster — use it.
  for (const g of existingGroups) {
    if ((g.roster_subgroups ?? []).length > 0) return g.roster_subgroups![0].id;
  }

  // 2/3. Reuse an existing same-named group, or create the correctly-named one.
  const groupName = buildingTypeToGroupName(buildingType);
  let groupId = existingGroups.find((g) => g.name === groupName)?.id;

  if (!groupId) {
    const { data: newGroup, error: gErr } = await supabase
      .from('roster_groups')
      .insert({ roster_id: rosterId, name: groupName, sort_order: 0 })
      .select('id')
      .single();
    if (gErr || !newGroup)
      throw new Error(
        `Failed to create default roster_group: ${gErr?.message}`,
      );
    groupId = newGroup.id;
  }

  const { data: newSub, error: sErr } = await supabase
    .from('roster_subgroups')
    .insert({ roster_group_id: groupId, name: 'General', sort_order: 0 })
    .select('id')
    .single();
  if (sErr || !newSub)
    throw new Error(
      `Failed to create default roster_subgroup: ${sErr?.message}`,
    );

  return newSub.id;
}

/**
 * Run Compliance Engine v2 against a synthesized shift (skeleton mode — no employee).
 *
 * Uses `employee_id: 'skeleton'` so only structural rules fire (R01 overlap,
 * R02 min length, R08 meal break). Employee-centric rules are skipped.
 *
 * Returns the compliance status string. 'BLOCKING' shifts are still inserted
 * as Draft so managers can review — they are never silently dropped.
 */
function runSkeletonCompliance(
  shift: SynthesizedShift,
  shiftDate: string,
): { status: string; blocked: boolean } {
  const candidateShift: ShiftV2 = {
    shift_id: `synth-${shift.roleId}-${shift.startMinutes}-${shift.endMinutes}`,
    shift_date: shiftDate,
    start_time: minutesToTime(shift.startMinutes),
    end_time: minutesToTime(shift.endMinutes),
    role_id: shift.roleId,
    required_qualifications: [],
    is_ordinary_hours: true,
    break_minutes: 0,
  };

  const input: ComplianceInputV2 = {
    employee_id: 'skeleton',
    employee_context: {
      employee_id: 'skeleton',
      contract_type: 'CASUAL',
      contracted_weekly_hours: 0,
      assigned_role_ids: [],
      contracts: [],
      qualifications: [],
    },
    existing_shifts: [],
    candidate_changes: {
      add_shifts: [candidateShift],
      remove_shifts: [],
    },
    mode: 'SIMULATED',
    operation_type: 'ASSIGN',
    stage: 'DRAFT',
  };

  const result = evaluateCompliance(input);
  const blocked = result.status === 'BLOCKING';
  return { status: result.status, blocked };
}

/**
 * Expand a single SynthesizedShift (which may have headcount > 1)
 * into individual CreateShiftData payloads ready for DB insertion.
 */
function expandToCreatePayloads(
  shifts: SynthesizedShift[],
  params: SynthesizeAndInsertParams,
  rosterSubgroupId: string,
): CreateShiftData[] {
  const payloads: CreateShiftData[] = [];

  for (const shift of shifts) {
    const base: CreateShiftData = {
      roster_id: params.rosterId,
      department_id: params.departmentId,
      shift_date: params.shiftDate,
      start_time: minutesToTime(shift.startMinutes),
      end_time: minutesToTime(shift.endMinutes),
      sub_department_id: shift.subDepartmentId,
      role_id: shift.roleId,
      group_type: shift.buildingType as TemplateGroupType,
      organization_id: params.organizationId ?? null,
      timezone: params.timezone ?? 'Australia/Sydney',
      creation_source: 'synthesizer',
      synthesis_run_id: params.synthesisRunId ?? null,
      shift_subgroup_id: rosterSubgroupId,
    };

    for (let i = 0; i < shift.headcount; i++) {
      payloads.push({ ...base });
    }
  }

  return payloads;
}

/**
 * Full pipeline: synthesize shifts from demand tensors, apply business rules
 * (supervisor ratios + minimum staff), run compliance check per shift,
 * then insert all as draft shifts for manager review.
 *
 * Compliance rewiring (Phase 2c):
 *   - Capstone's compliance.service calls are replaced by evaluateCompliance()
 *     from the parent's Compliance Engine v2.
 *   - Skeleton mode (employee_id = 'skeleton') evaluates structural rules only.
 *   - Option (b): all synthesized shifts land as Draft regardless of compliance
 *     status — hard-blocked shifts are flagged in logs for manager review.
 *   - TODO: stamp compliance_status column on shift row once schema supports it.
 */
export async function synthesizeAndInsertShifts(
  params: SynthesizeAndInsertParams,
): Promise<SynthesizeAndInsertResult> {
  let deletedCount = 0;
  if (params.suggestedDeletions && params.suggestedDeletions.length > 0) {
    try {
      deletedCount = await shiftsCommands.bulkDeleteShifts(
        params.suggestedDeletions,
      );
    } catch (err) {
      logger.error(
        'Failed to remove draft shift redundancies before new allocation',
        {
          err,
          operation: '',
        },
      );
    }
  }

  const enforceSupervisorRatios = params.enforceSupervisorRatios !== false;
  const enforceMinimumStaff = params.enforceMinimumStaff !== false;
  const synthesizeOptions = {
    enforceMinMax: params.enforceMinMax !== false,
    mergeMicroPeaks: params.mergeMicroPeaks === true,
  };

  // 1. Synthesize shifts from each demand tensor with the caller's options.
  const allShifts: SynthesizedShift[] = [];
  let globalCoverageWindow: { start: number; end: number } | null = null;

  for (const tensor of params.demandTensors) {
    const shifts = synthesizeShifts(tensor, synthesizeOptions);
    allShifts.push(...shifts);

    const cw = getCoverageWindow(tensor.slots);
    if (cw) {
      if (!globalCoverageWindow) {
        globalCoverageWindow = { ...cw };
      } else {
        globalCoverageWindow.start = Math.min(
          globalCoverageWindow.start,
          cw.start,
        );
        globalCoverageWindow.end = Math.max(globalCoverageWindow.end, cw.end);
      }
    }
  }

  if (allShifts.length === 0 && !globalCoverageWindow) {
    return { createdCount: 0, deletedCount, failed: [], synthesizedShifts: [] };
  }

  // 2. Fetch business rules from work_rules table only if we might use them.
  const subDeptIds = [
    ...new Set([
      ...allShifts.map((s) => s.subDepartmentId),
      ...params.demandTensors.map((t) => t.subDepartmentId),
    ]),
  ];
  const [ratios, minimums] = await Promise.all([
    enforceSupervisorRatios
      ? fetchSupervisoryRatios(subDeptIds)
      : Promise.resolve([]),
    enforceMinimumStaff
      ? fetchMinimumStaffRules(subDeptIds)
      : Promise.resolve([]),
  ]);

  // 3. Apply supervisor ratios then minimum staff rules, each gated by flag.
  let finalShifts = enforceSupervisorRatios
    ? applySupervisorRatios(allShifts, ratios)
    : allShifts;
  if (globalCoverageWindow && enforceMinimumStaff) {
    finalShifts = applyMinimumStaff(
      finalShifts,
      minimums,
      globalCoverageWindow,
    );
  }

  // 4. Run Compliance Engine v2 per synthesized shift (skeleton — no employee).
  //    All shifts proceed to Draft regardless of compliance status (option b).
  //    Blocked shifts are logged so managers can review them in the Draft queue.
  let complianceBlockedCount = 0;
  for (const shift of finalShifts) {
    const { status, blocked } = runSkeletonCompliance(shift, params.shiftDate);
    if (blocked) {
      complianceBlockedCount++;
      logger.warn('synthesized shift has structural compliance violation — inserting as Draft for manager review', {
        operation: 'synthesizeAndInsertShifts',
        roleId: shift.roleId,
        subDepartmentId: shift.subDepartmentId,
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        headcount: shift.headcount,
        complianceStatus: status,
        // TODO: stamp compliance_status on the shift row once the column exists.
      });
    }
  }

  if (complianceBlockedCount > 0) {
    logger.info('compliance check complete — blocked shifts still inserted as Draft', {
      operation: 'synthesizeAndInsertShifts',
      totalShifts: finalShifts.length,
      complianceBlockedCount,
    });
  }

  // 5. Every shift needs a roster_subgroup_id — use or create a default on this roster.
  const buildingType = finalShifts[0]?.buildingType ?? 'convention_centre';
  const defaultSubgroupId = await ensureDefaultRosterSubgroup(
    params.rosterId,
    buildingType,
  );

  // 6. Expand headcount into individual CreateShiftData payloads
  const payloads = expandToCreatePayloads(
    finalShifts,
    params,
    defaultSubgroupId,
  );

  if (payloads.length === 0) {
    return {
      createdCount: 0,
      deletedCount,
      failed: [],
      synthesizedShifts: finalShifts,
    };
  }

  // 7. Bulk insert using processInChunks (20 at a time)
  const results = await processInChunks(
    payloads.map((_, i) => String(i)),
    async (index) => {
      return shiftsCommands.createShift(payloads[Number(index)]);
    },
  );

  const failed: Array<{ index: number; reason: string }> = [];
  let createdCount = 0;
  const createdShiftIds: string[] = [];

  for (const r of results) {
    if (r.ok) {
      createdCount++;
      const shift = (r as { value: { id?: string } }).value;
      if (shift?.id) createdShiftIds.push(shift.id);
    } else {
      failed.push({
        index: Number(r.id),
        reason: (r as { id: string; ok: false; error: string }).error,
      });
    }
  }

  // 8. Stamp synthesis_run_id onto the new rows directly.
  //    The sm_create_shift RPC has a hardcoded field allow-list that predates
  //    this column, so it silently drops synthesis_run_id from the payload.
  if (params.synthesisRunId && createdShiftIds.length > 0) {
    const { error: stampErr } = await supabase
      .from('shifts')
      .update({ synthesis_run_id: params.synthesisRunId })
      .in('id', createdShiftIds);
    if (stampErr) {
      logger.error('failed to stamp synthesis_run_id', {
        runId: params.synthesisRunId,
        shiftIdCount: createdShiftIds.length,
        supabaseError: stampErr.message,
        operation: '',
      });
    }
  }

  return { createdCount, deletedCount, failed, synthesizedShifts: finalShifts };
}

/**
 * Rollback a synthesis run. Deletes shifts that match the run id AND are still unassigned.
 * Assigned shifts are kept — someone has already committed.
 */
export async function rollbackSynthesisRun(runId: string): Promise<{
  deletedCount: number;
  skippedAssigned: number;
  failedDeletes: Array<{ id: string; reason: string }>;
  orphaned: boolean;
}> {
  return synthesisRunsQueries.rollbackRun(runId);
}
