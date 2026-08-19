/**
 * Assign / Persist Shift Command
 *
 * Domain layer — the single, fail-closed entry point for ALL shift mutations
 * that require compliance validation:
 *   - Assigning / unassigning an employee
 *   - Moving a shift to a different date (DnD cross-column)
 *   - Changing a shift's start/end times (Day Mode resize / drag)
 *
 * Compliance model (V2 — full rule coverage):
 *   ALL 12 compliance rules are evaluated via the V2 engine before the RPC write.
 *
 *   For ASSIGNED shifts:
 *     R01–R11 + R_AVAIL — full employee-centric evaluation.
 *
 *   For UNASSIGNED shifts:
 *     the Layer-1 SHAPE rules — length, breaks, minimum engagement — which are
 *     decidable without an employee. This used to be described as "skeleton
 *     mode: R01, R02, R08" and to run the V8 engine against a fabricated casual
 *     with no contracts and no history. Two of those three rules no longer
 *     exist there (R02/`V8_MIN_SHIFT_LENGTH` was removed when the shape layer
 *     took ownership; overlap cannot fire against an empty shift list), so the
 *     check had quietly become a no-op that still read like a gate.
 *
 *   SHAPE runs on ANY change to date or times, assigned or not. Both are inputs
 *   to a shape verdict: cl 56.2 and the Sunday tier of cl 12.4(c)/12.5(c) are
 *   decided by which day the shift lands on, so re-dating a lawful shift can
 *   make it unlawful without touching a single other field.
 *
 *   Fail-closed: if the compliance engine cannot run (DB/network error),
 *   the mutation is BLOCKED — never silently allowed.
 */

import { supabase }                      from '@/platform/supabase/client';
import { runV8Orchestrator }            from '@/modules/compliance/v8/index';
import { buildAssignInput }              from '@/modules/planning/unified/compliance/input-builder';
import {
    fetchV8EmployeeContext,
    fetchEmployeeShiftsV2,
}                                        from '@/modules/compliance/employee-context';
import { getAvailabilitySlots }          from '@/modules/availability/api/availability.api';
import { getAssignedShiftsForAvailability }
                                         from '@/modules/availability/api/availability-view.api';
import type { V8AvailabilityData } from '@/modules/compliance/v8/orchestrator/types';
import type { V8OrchestratorShift, V8OrchestratorResult } from '@/modules/compliance/v8/orchestrator/types';
import { evaluateShapeForRow }           from '@/modules/rosters/api/shift-shape-gate';

export type AssignmentContext = 'MANUAL' | 'AUTO' | 'BID' | 'TRADE';

export interface AssignShiftInput {
    shiftId:   string;
    employeeId: string | null;
    /** Assignment context — controls availability enforcement. Default: 'MANUAL' */
    context?:  AssignmentContext;
    /** Output date to move the shift to. If provided, shift_date is updated. */
    targetDate?: string;
    /** New start time (HH:mm). If provided, start_time is updated. */
    targetStartTime?: string;
    /** New end time (HH:mm). If provided, end_time is updated. */
    targetEndTime?: string;
    /** If true, availability warnings (Bucket B) will NOT block the assignment */
    ignoreWarnings?: boolean;
}

export interface AssignShiftOutput {
    success:    boolean;
    error?:     string;
    /** Non-blocking warnings surfaced to caller */
    advisories?: string[];
}

// =============================================================================
// FULL COMPLIANCE PRE-CHECK  (V2 engine — all rules)
// =============================================================================

/**
 * Run all V2 compliance rules before the DB write.
 *
 * FAIL-CLOSED contract: this function never catches exceptions.
 * Any fetch failure propagates upward to the outer try-catch in
 * executeAssignShift, which returns a blocking error to the caller.
 * This ensures compliance checks are never silently skipped.
 */
async function runFullCompliancePreCheck(
    employeeId: string,
    shift: {
        id:                   string;
        shift_date:           string;
        start_time:           string;
        end_time:             string;
        role_id:              string | null;
        unpaid_break_minutes: number | null;
        required_skills:      string[] | null;
        required_licenses:    string[] | null;
        is_training?:         boolean;
    },
    context:        AssignmentContext,
    ignoreWarnings: boolean,
): Promise<{ error: string | null; advisories: string[] }> {
    // Fetch all required data in parallel.
    // Any thrown exception propagates — no catch here (fail-closed).
    const [employeeCtx, existingShifts, availSlots, assignedShifts] = await Promise.all([
        fetchV8EmployeeContext(employeeId),
        fetchEmployeeShiftsV2(employeeId, shift.shift_date, 35, shift.id),
        getAvailabilitySlots(employeeId, shift.shift_date, shift.shift_date),
        getAssignedShiftsForAvailability(employeeId, shift.shift_date, shift.shift_date),
    ]);

    // Build candidate V8OrchestratorShift for the V2 engine
    const candidateShift: V8OrchestratorShift = {
        id:                      shift.id,
        date:                    shift.shift_date,
        start_time:              shift.start_time,
        end_time:                shift.end_time,
        role_id:                 shift.role_id ?? '',
        required_qualifications: [
            ...(shift.required_skills  ?? []),
            ...(shift.required_licenses ?? []),
        ],
        is_ordinary_hours:    true,
        is_training:          shift.is_training ?? false,
        break_minutes:        shift.unpaid_break_minutes ?? 0,
        unpaid_break_minutes: shift.unpaid_break_minutes ?? 0,
    };

    // Build availability data for R_AVAILABILITY_MATCH
    const availabilityData: V8AvailabilityData = {
        declared_slots: availSlots.map(s => ({
            slot_date:  s.slot_date,
            start_time: s.start_time,
            end_time:   s.end_time,
        })),
        // Exclude the shift being assigned so it is not treated as a locked conflict
        assigned_shifts: assignedShifts
            .filter(s => s.id !== shift.id)
            .map(s => ({
                id:                s.id,
                date:              s.shift_date,
                start_time:        s.start_time,
                end_time:          s.end_time,
                is_ordinary_hours: true,
            })),
    };

    // Run V2 engine — all 12 rules evaluated at PUBLISH stage
    const result = runV8Orchestrator(
        buildAssignInput({
            employeeId,
            employeeContext: employeeCtx,
            existingShifts,
            candidateShift,
            stage: 'PUBLISH',
            operationType: context === 'BID' ? 'BID' : context === 'TRADE' ? 'SWAP' : 'ASSIGN',
            availabilityData,
        }),
    ) as V8OrchestratorResult;

    // BLOCKING hits — reject regardless of context
    const blockingHits = result.hits.filter(h => h.status === 'BLOCKING');
    if (blockingHits.length > 0) {
        return { error: blockingHits[0].summary, advisories: [] };
    }

    // Availability-specific enforcement is handled by the V8 engine via AVAIL_*
    // rules. BLOCKING availability hits are already caught above; WARNING hits
    // are collected below as advisories. No separate avMatch block is needed.
    const advisories: string[] = [];

    // Collect non-blocking warnings as advisories for the caller
    for (const hit of result.hits) {
        if (hit.status === 'WARNING') {
            advisories.push(hit.summary);
        }
    }

    return { error: null, advisories };
}

// =============================================================================
// MAIN COMMAND
// =============================================================================

/**
 * Execute assign/persist shift command.
 *
 * Runs full V2 compliance (all 12 rules) before the DB write for assigned shifts.
 * Runs skeleton compliance (R01, R02, R08) for unassigned shifts when times change.
 * FAIL-CLOSED: any exception during compliance checks blocks the mutation.
 */
export async function executeAssignShift(
    input: AssignShiftInput,
): Promise<AssignShiftOutput> {
    const { shiftId, employeeId, context = 'MANUAL', targetDate, targetStartTime, targetEndTime } = input;

    if (!shiftId) {
        return { success: false, error: 'Shift ID is required' };
    }

    try {
        // 1. Fetch shift details including role + qualifications for V2 engine
        const { data: shift, error: fetchError } = await supabase
            .from('shifts')
            .select(`
                id,
                lifecycle_status,
                is_published,
                is_cancelled,
                assignment_status,
                bidding_status,
                shift_date,
                start_time,
                end_time,
                role_id,
                unpaid_break_minutes,
                paid_break_minutes,
                target_employment_type,
                target_requires_flexible,
                required_skills,
                required_licenses,
                assigned_employee_id,
                is_training
            `)
            .eq('id', shiftId)
            .single();

        if (fetchError || !shift) {
            return { success: false, error: fetchError?.message ?? 'Shift not found' };
        }

        // 1b. FSM pre-guard — fail fast before touching the DB or running compliance.
        //     Mirrors the DB trigger rules but catches obvious mistakes client-side.
        if (employeeId) {
            const s = shift as any;
            // Cannot assign to a cancelled shift
            if (s.is_cancelled) {
                return { success: false, error: 'Cannot assign a cancelled shift' };
            }
            // Cannot assign to a terminal (completed) shift
            if (s.lifecycle_status === 'Completed') {
                return { success: false, error: 'Cannot assign a completed shift' };
            }
            // Assigned shift must not be on bidding at the same time
            if (s.assignment_status === 'assigned' && s.bidding_status !== 'not_on_bidding') {
                return { success: false, error: 'Cannot re-assign a shift that is still open for bidding' };
            }
        }

        // Build the "effective" shift with any target overrides applied
        const effectiveShift = {
            ...shift,
            shift_date: targetDate ?? (shift as any).shift_date,
            start_time: targetStartTime ?? (shift as any).start_time,
            end_time:   targetEndTime ?? (shift as any).end_time,
        };

        // 2. Compliance pre-check
        let advisories: string[] = [];

        // ── Layer 1: shape of the shift AFTER this change ─────────────────────
        //
        // Runs for assigned and unassigned alike, and BEFORE the employee-scoped
        // rules, because a shift whose shape is unlawful is unlawful for
        // everyone — there is no point asking whether a particular person may
        // work a two-hour public-holiday engagement that nobody may work.
        //
        // Only when the change touches a shape input. Re-dating is one: cl 56.2
        // and the Sunday tier of cl 12.4(c)/12.5(c) are decided by the day, so
        // a move from Monday to Christmas Day changes the verdict without
        // changing a single other field. This path previously wrote both the
        // date (via `sm_move_shift`) and the times (via a raw table update) with
        // no shape check at either.
        if (targetDate || targetStartTime || targetEndTime) {
            const es = effectiveShift as any;
            const shapeResult = await evaluateShapeForRow({
                shift_date:               es.shift_date,
                start_time:               es.start_time,
                end_time:                 es.end_time,
                unpaid_break_minutes:     es.unpaid_break_minutes,
                paid_break_minutes:       es.paid_break_minutes,
                is_training:              es.is_training,
                target_employment_type:   es.target_employment_type,
                target_requires_flexible: es.target_requires_flexible,
                role_id:                  es.role_id,
            });
            if (shapeResult.blocking) {
                return {
                    success: false,
                    error: shapeResult.hits.filter(h => h.blocking).map(h => h.summary).join('; '),
                };
            }
            advisories = shapeResult.hits.filter(h => h.status === 'WARNING').map(h => h.summary);
        }

        // Determine who the effective employee is for compliance
        const effectiveEmployeeId = employeeId ?? (shift as any).assigned_employee_id;

        if (effectiveEmployeeId) {
            // ASSIGNED shift — run full V2 compliance (all 12 rules)
            const check = await runFullCompliancePreCheck(
                effectiveEmployeeId,
                effectiveShift as Parameters<typeof runFullCompliancePreCheck>[1],
                context,
                input.ignoreWarnings ?? false,
            );
            if (check.error) {
                return { success: false, error: check.error };
            }
            // Appended, not assigned: the shape pass above may already have
            // raised warnings, and the employee-scoped pass must not erase them.
            advisories = [...advisories, ...check.advisories];
        }

        // 3. Execute DB write via FSM RPCs.
        const userId = (await supabase.auth.getUser()).data.user?.id;

        if (employeeId === null && !targetDate && !targetStartTime && !targetEndTime) {
            // Pure unassign — delegate entirely to sm_unassign_shift RPC (handles bidding_status reset,
            // and FOR UPDATE lock to prevent TOCTOU races).
            const { data: rpcResult, error: rpcError } = await (supabase as any)
                .rpc('sm_unassign_shift', { p_shift_id: shiftId, p_user_id: userId ?? null });
            if (rpcError) return { success: false, error: rpcError.message };
            if (rpcResult && rpcResult.success === false) return { success: false, error: rpcResult.error };
            return { success: true, advisories };
        }

        // Build the update payload for metadata changes (times only — see below)
        const metadataPayload: any = {};

        // A date change is NOT a plain column write. `rosters` is a per-day
        // container and `roster_groups`/`roster_subgroups` hang off it, so moving a
        // shift to another day has to re-point roster_id and re-resolve the
        // group/subgroup on the destination day — and create that day's roster if
        // nobody has scheduled on it yet. sm_move_shift does all of that
        // atomically; a raw `.update({ shift_date })` here silently left roster_id
        // on the ORIGINAL day, which is the drift this replaces.
        const isDateMove = !!targetDate && targetDate !== (shift as any).shift_date;
        if (isDateMove) {
            const { data: moveResult, error: moveError } = await (supabase as any)
                .rpc('sm_move_shift', {
                    p_shift_id:   shiftId,
                    p_shift_date: targetDate,
                    p_user_id:    userId ?? null,
                });
            if (moveError) return { success: false, error: moveError.message };
            if (moveResult && moveResult.success === false) {
                return { success: false, error: moveResult.error };
            }
        }
        if (targetStartTime && targetStartTime !== (shift as any).start_time) {
            metadataPayload.start_time = targetStartTime;
        }
        if (targetEndTime && targetEndTime !== (shift as any).end_time) {
            metadataPayload.end_time = targetEndTime;
        }

        // If no employee change but we have metadata changes → pure timing/date update
        if (employeeId === undefined || employeeId === (shift as any).assigned_employee_id) {
            if (Object.keys(metadataPayload).length > 0) {
                metadataPayload.updated_at = new Date().toISOString();
                metadataPayload.last_modified_by = userId;

                const { error: updateError } = await supabase
                    .from('shifts')
                    .update(metadataPayload)
                    .eq('id', shiftId);

                if (updateError) {
                    return { success: false, error: updateError.message };
                }
            }
            return { success: true, advisories };
        }

        // Assign — path splits by lifecycle_status:
        //   Published (S5) → sm_emergency_assign RPC (S5→S4, sets assignment_outcome='confirmed',
        //                     fulfillment_status='scheduled', bidding_status='not_on_bidding')
        //   Draft (S1)     → direct UPDATE (S1→S2, no outcome field needed)
        const lifecycleStatus = (shift as any).lifecycle_status;

        if (lifecycleStatus === 'Published') {
            // Apply metadata updates first (date/time changes)
            if (Object.keys(metadataPayload).length > 0) {
                metadataPayload.updated_at = new Date().toISOString();
                metadataPayload.last_modified_by = userId;
                const { error: dateUpdateError } = await supabase
                    .from('shifts')
                    .update(metadataPayload)
                    .eq('id', shiftId);
                if (dateUpdateError) return { success: false, error: dateUpdateError.message };
            }

            const { data: rpcResult, error: rpcError } = await (supabase as any)
                .rpc('sm_emergency_assign', {
                    p_shift_id:    shiftId,
                    p_employee_id: employeeId,
                    p_reason:      context === 'AUTO' ? 'Auto-scheduled direct assignment' : 'Manual direct assignment',
                    p_user_id:     userId ?? null,
                });
            if (rpcError) return { success: false, error: rpcError.message };
            if (rpcResult && rpcResult.success === false) return { success: false, error: rpcResult.error };
            return { success: true, advisories };
        }

        // Draft shift — direct UPDATE (S1→S2)
        const updatePayload: any = {
            ...metadataPayload,
            updated_at:           new Date().toISOString(),
            last_modified_by:     userId,
        };

        if (employeeId) {
            updatePayload.assigned_employee_id = employeeId;
            updatePayload.assigned_at = new Date().toISOString();
            updatePayload.assignment_status = 'assigned';
            updatePayload.assignment_source = 'manual';
        }

        const { error: updateError } = await supabase
            .from('shifts')
            .update(updatePayload)
            .eq('id', shiftId);

        if (updateError) {
            return { success: false, error: updateError.message };
        }

        return { success: true, advisories };
    } catch (err: unknown) {
        // FAIL-CLOSED: any unhandled error (including compliance pre-check failures)
        // blocks the assignment. We never silently allow an unchecked write.
        const message = err instanceof Error
            ? err.message
            : 'Compliance checks unavailable — assignment blocked';
        return { success: false, error: message };
    }
}

/**
 * Execute unassign shift command.
 * No compliance checks required for unassignment.
 */
export async function executeUnassignShift(
    shiftId: string,
): Promise<AssignShiftOutput> {
    return executeAssignShift({ shiftId, employeeId: null });
}
