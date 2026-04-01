/**
 * Assign Shift Command
 *
 * Domain layer — assigns / unassigns an employee to a shift.
 *
 * Compliance model (V2 — full rule coverage):
 *   ALL 12 compliance rules are evaluated via the V2 engine before the RPC write.
 *   This replaces the previous availability-only pre-check.
 *
 *   Rules enforced (stage: 'PUBLISH'):
 *     R01 — No overlapping shifts                  (BLOCKING, all contexts)
 *     R02 — Minimum shift length                   (BLOCKING, all contexts)
 *     R03 — Maximum daily hours (12h)              (BLOCKING, all contexts)
 *     R04 — Max working days in 28-day window      (BLOCKING, all contexts)
 *     R05 — Student visa 48h/fortnight             (BLOCKING when contract = STUDENT_VISA)
 *     R06 — Ordinary hours averaging               (BLOCKING when applicable)
 *     R07 — Minimum rest gap between shifts        (BLOCKING, all contexts)
 *     R09 — Maximum consecutive working days       (BLOCKING, all contexts)
 *     R10 — Role/contract match                    (BLOCKING, all contexts)
 *     R11 — Required qualifications held           (BLOCKING, all contexts)
 *     R12 — Qualifications not expired             (BLOCKING, all contexts)
 *     R_AVAIL — Availability match                 (BLOCKING for MANUAL/AUTO; advisory for BID/TRADE)
 *
 *   Fail-closed: if the compliance engine cannot run (DB/network error),
 *   the assignment is BLOCKED — never silently allowed.
 */

import { supabase }                      from '@/platform/realtime/client';
import { evaluateCompliance }            from '@/modules/compliance/v2/index';
import {
    fetchEmployeeContextV2,
    fetchEmployeeShiftsV2,
}                                        from '@/modules/compliance/employee-context';
import { getAvailabilitySlots }          from '@/modules/availability/api/availability.api';
import { getAssignedShiftsForAvailability }
                                         from '@/modules/availability/api/availability-view.api';
import type {
    AvailabilityDataV2,
    ShiftV2,
    ComplianceResultV2,
} from '@/modules/compliance/v2/types';

export type AssignmentContext = 'MANUAL' | 'AUTO' | 'BID' | 'TRADE';

export interface AssignShiftInput {
    shiftId:   string;
    employeeId: string | null;
    /** Assignment context — controls availability enforcement. Default: 'MANUAL' */
    context?:  AssignmentContext;
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
    },
    context:        AssignmentContext,
    ignoreWarnings: boolean,
): Promise<{ error: string | null; advisories: string[] }> {
    // Fetch all required data in parallel.
    // Any thrown exception propagates — no catch here (fail-closed).
    const [employeeCtx, existingShifts, availSlots, assignedShifts] = await Promise.all([
        fetchEmployeeContextV2(employeeId),
        fetchEmployeeShiftsV2(employeeId, shift.shift_date, 35, shift.id),
        getAvailabilitySlots(employeeId, shift.shift_date, shift.shift_date),
        getAssignedShiftsForAvailability(employeeId, shift.shift_date, shift.shift_date),
    ]);

    // Build candidate ShiftV2 for the V2 engine
    const candidateShift: ShiftV2 = {
        shift_id:                shift.id,
        shift_date:              shift.shift_date,
        start_time:              shift.start_time,
        end_time:                shift.end_time,
        role_id:                 shift.role_id ?? '',
        required_qualifications: [
            ...(shift.required_skills  ?? []),
            ...(shift.required_licenses ?? []),
        ],
        is_ordinary_hours:    true,
        break_minutes:        shift.unpaid_break_minutes ?? 0,
        unpaid_break_minutes: shift.unpaid_break_minutes ?? 0,
    };

    // Build availability data for R_AVAILABILITY_MATCH
    const availabilityData: AvailabilityDataV2 = {
        declared_slots: availSlots.map(s => ({
            slot_date:  s.slot_date,
            start_time: s.start_time,
            end_time:   s.end_time,
        })),
        // Exclude the shift being assigned so it is not treated as a locked conflict
        assigned_shifts: assignedShifts
            .filter(s => s.id !== shift.id)
            .map(s => ({
                shift_id:   s.id,
                shift_date: s.shift_date,
                start_time: s.start_time,
                end_time:   s.end_time,
            })),
    };

    // Run V2 engine — all 12 rules evaluated at PUBLISH stage
    const result = evaluateCompliance(
        {
            employee_id:       employeeId,
            employee_context:  employeeCtx,
            existing_shifts:   existingShifts,
            candidate_changes: {
                add_shifts:    [candidateShift],
                remove_shifts: [],
            },
            mode:              'SIMULATED',
            operation_type:    context === 'BID' ? 'BID' : context === 'TRADE' ? 'SWAP' : 'ASSIGN',
            stage:             'PUBLISH',
            availability_data: availabilityData,
        },
    ) as ComplianceResultV2;

    // BLOCKING hits — reject regardless of context
    const blockingHits = result.rule_hits.filter(h => h.severity === 'BLOCKING');
    if (blockingHits.length > 0) {
        return { error: blockingHits[0].message, advisories: [] };
    }

    // Availability-specific enforcement — context-aware
    const enforce = context === 'MANUAL' || context === 'AUTO';
    const avMatch = result.availability_match;
    const advisories: string[] = [];

    if (avMatch && avMatch.status !== 'PASS') {
        const label =
            avMatch.status === 'FAIL'
                ? 'Employee already has an assigned shift during this time.'
                : 'Employee has not declared availability for this shift time.';

        // LOCKED (FAIL) blocks all contexts; WARN (Bucket B) blocks only MANUAL/AUTO
        // If ignoreWarnings is true, we allow availability warnings (Bucket B) to pass.
        if (avMatch.status === 'FAIL' || (enforce && !ignoreWarnings)) {
            return { error: label, advisories: [] };
        }
        advisories.push(label);
    }

    // Collect non-blocking warnings as advisories for the caller
    for (const hit of result.rule_hits) {
        if (hit.severity === 'WARNING') {
            advisories.push(hit.message);
        }
    }

    return { error: null, advisories };
}

// =============================================================================
// MAIN COMMAND
// =============================================================================

/**
 * Execute assign shift command.
 *
 * Runs full V2 compliance (all 12 rules) before the DB write.
 * FAIL-CLOSED: any exception during compliance checks blocks the assignment.
 */
export async function executeAssignShift(
    input: AssignShiftInput,
): Promise<AssignShiftOutput> {
    const { shiftId, employeeId, context = 'MANUAL' } = input;

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
                required_skills,
                required_licenses
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

        // 2. Full V2 compliance pre-check (all rules) when assigning
        //    For unassignment (employeeId = null) no compliance check is needed.
        let advisories: string[] = [];
        if (employeeId) {
            // FAIL-CLOSED: runFullCompliancePreCheck never catches exceptions.
            // If it throws, the outer catch returns a blocking error.
            const check = await runFullCompliancePreCheck(
                employeeId,
                shift as Parameters<typeof runFullCompliancePreCheck>[1],
                context,
                input.ignoreWarnings ?? false,
            );
            if (check.error) {
                return { success: false, error: check.error };
            }
            advisories = check.advisories;
        }

        // 3. Execute DB write — direct UPDATE on shifts table.
        //    The legacy RPC `assign_employee_to_shift` references a defunct
        //    `roster_shifts` table, so we use a direct update instead.
        const userId = (await supabase.auth.getUser()).data.user?.id;

        // Build update payload — always set assignment_status explicitly so the
        // FSM validator (validate_shift_state_invariants trigger) sees a consistent row.
        // On unassign: clear assignment_outcome too (cross-field rule: unassigned → null).
        const updatePayload: Record<string, unknown> = {
            assigned_employee_id: employeeId,
            assigned_at:          employeeId ? new Date().toISOString() : null,
            assignment_status:    employeeId ? 'assigned' : 'unassigned',
            assignment_source:    employeeId ? 'manual' : null,
            last_modified_by:     userId,
            updated_at:           new Date().toISOString(),
        };
        if (!employeeId) {
            updatePayload.assignment_outcome = null;
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
