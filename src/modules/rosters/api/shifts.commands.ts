import { supabase } from '@/platform/supabase/client';
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { processInChunks } from '../domain/bulk-action-engine';
import { Shift, isValidUuid, safeUuid, calculateMinutesBetweenTimes } from '../domain/shift.entity';
import { CreateShiftData, UpdateShiftData } from './shifts.dto';
import { complianceService } from '../services/compliance.service';
import { callRpc, callAuthenticatedRpc, callAuthenticatedVoidRpc, requireUser } from '@/platform/supabase/rpc/client';
import { shiftsQueries } from './shifts.queries';
import { ComplianceError } from '@/platform/supabase/rpc/errors';
import {
    CreateShiftResponseSchema,
    UpdateShiftResponseSchema,
    PublishShiftResponseSchema,
    BulkPublishResponseSchema,
    BulkAssignResponse,
    BulkAssignResponseSchema,
    BulkAssignAtomicResponse,
    BulkAssignAtomicResponseSchema,
    BulkDeleteResponse,
    BulkDeleteResponseSchema,
    DeleteShiftResponseSchema,
    CancelShiftResponseSchema,
    OfferActionResponseSchema,
    RequestTradeResponseSchema,
    EmployeeDropResponseSchema,
    CloseBiddingResponseSchema,
    ApplyShiftOpResponseSchema,
} from './contracts';

// ============================================================
// BULK ACTION PARTIAL RESULT TYPES
// ============================================================

/** Publish — compliance checked per-shift, partial success supported. */
export type BulkPublishPartialResult = {
    /** IDs that were fully published in the DB */
    publishedIds: string[];
    /** IDs that failed the client-side compliance pre-check */
    complianceFailed: Array<{ id: string; reason: string }>;
    /** IDs that passed compliance but failed in the DB RPC */
    dbFailed: Array<{ id: string; reason: string }>;
};

/** Unpublish — per-shift via processInChunks, partial success supported. */
export type BulkUnpublishPartialResult = {
    unpublishedIds: string[];
    failed: Array<{ id: string; reason: string }>;
};

/** Delete — per-item via processInChunks, partial success supported. */
export type BulkDeletePartialResult = {
    deletedIds: string[];
    failed: Array<{ id: string; reason: string }>;
};

/**
 * Publish validation result — returned by validateBulkPublishCompliance.
 * Mirrors the shape expected by BulkActionsToolbar's onValidatePublish prop.
 */
export type BulkPublishValidationResult = {
    eligible: string[];
    complianceFailed: Array<{ id: string; reason: string }>;
    skipped: Array<{ id: string; reason: string }>;
};

export const shiftsCommands = {
    /* ============================================================
       MOVE SHIFT (DnD position change)
       Uses dedicated sm_move_shift RPC to bypass the broken
       notify_user trigger on the shifts table.
       ============================================================ */

    async moveShift(shiftId: string, params: {
        groupType?: string | null;
        subGroupName?: string | null;
        shiftGroupId?: string | null;
        rosterSubgroupId?: string | null;
        shiftDate?: string | null;
    }): Promise<{ success: boolean; error?: string }> {
        const user = await requireUser();

        const { data, error } = await supabase.rpc('sm_move_shift', {
            p_shift_id: shiftId,
            p_group_type: params.groupType ?? undefined,
            p_sub_group_name: params.subGroupName ?? undefined,
            p_shift_group_id: safeUuid(params.shiftGroupId) ?? undefined,
            p_roster_subgroup_id: safeUuid(params.rosterSubgroupId) ?? undefined,
            p_shift_date: params.shiftDate ?? undefined,
            p_user_id: user.id,
        });

        if (error) {
            throw new Error(error.message);
        }

        const result = data as { success: boolean; error?: string };
        if (!result.success) {
            throw new Error(result.error ?? 'Failed to move shift');
        }

        return result;
    },

    /* ============================================================
       CREATE SHIFT
       ============================================================ */

    async createShift(shiftData: CreateShiftData): Promise<Shift> {
        const user = await requireUser();

        // Compliance check before hitting the DB — blocks the request early
        if (shiftData.assigned_employee_id && isValidUuid(shiftData.assigned_employee_id)) {
            const netMinutes =
                calculateMinutesBetweenTimes(shiftData.start_time, shiftData.end_time)
                - (shiftData.unpaid_break_minutes || 0);

            const validation = await complianceService.validateShiftCompliance(
                shiftData.assigned_employee_id,
                shiftData.shift_date,
                shiftData.start_time,
                shiftData.end_time,
                netMinutes
            );

            if (!validation.isValid) {
                throw new ComplianceError(validation.violations, 'sm_create_shift');
            }
        }

        const payload = {
            roster_id: shiftData.roster_id,
            department_id: safeUuid(shiftData.department_id)!,
            shift_date: shiftData.shift_date,
            roster_date: shiftData.shift_date,
            start_time: shiftData.start_time,
            end_time: shiftData.end_time,
            organization_id: safeUuid(shiftData.organization_id),
            sub_department_id: safeUuid(shiftData.sub_department_id),
            group_type: shiftData.group_type || null,
            sub_group_name: shiftData.sub_group_name || null,
            display_order: shiftData.display_order || 0,
            shift_group_id: safeUuid(shiftData.shift_group_id),
            shift_subgroup_id: safeUuid(shiftData.shift_subgroup_id),
            roster_subgroup_id: safeUuid(shiftData.shift_subgroup_id),
            role_id: safeUuid(shiftData.role_id),
            remuneration_level: shiftData.remuneration_level !== undefined && shiftData.remuneration_level !== null ? Number(shiftData.remuneration_level) : null,
            paid_break_minutes: shiftData.paid_break_minutes || 0,
            unpaid_break_minutes: shiftData.unpaid_break_minutes || 0,
            break_minutes: (shiftData.paid_break_minutes || 0) + (shiftData.unpaid_break_minutes || 0),
            timezone: shiftData.timezone || 'Australia/Sydney',
            start_at: shiftData.start_at || null,
            end_at: shiftData.end_at || null,
            assigned_employee_id: safeUuid(shiftData.assigned_employee_id),
            required_skills: shiftData.required_skills || [],
            required_licenses: shiftData.required_licenses || [],
            event_ids: shiftData.event_ids || [],
            tags: shiftData.tags || [],
            notes: shiftData.notes || null,
            template_id: safeUuid(shiftData.template_id),
            template_group: shiftData.template_group || null,
            template_sub_group: shiftData.template_sub_group || null,
            is_from_template: shiftData.is_from_template || false,
            template_instance_id: safeUuid(shiftData.template_instance_id),
            lifecycle_status: 'Draft',
            is_draft: true,
            created_by_user_id: user.id,
            creation_source: shiftData.creation_source ?? (shiftData.is_from_template ? 'template' : 'manual'),
            assignment_source: shiftData.assigned_employee_id ? (shiftData.assignment_source ?? 'direct') : null,
            is_training: shiftData.is_training ?? false,
            // Planning target. `null` = "Any employment type". Persisted by
            // sm_create_shift as of 20260805060000 — before that migration this
            // key was silently swallowed by the RPC's explicit column list.
            target_employment_type: shiftData.target_employment_type ?? null,
            // Coerce the pair into a coherent state rather than letting
            // shifts_target_flexible_requires_pt_check reject the write: the flag
            // is only meaningful for a PT target.
            target_requires_flexible:
                shiftData.target_employment_type === 'PT'
                    ? (shiftData.target_requires_flexible ?? false)
                    : false,
        };

        const newV8ShiftId = await callRpc('sm_create_shift', {
            p_shift_data: payload,
            p_user_id: user.id,
        }, CreateShiftResponseSchema);

        const newShift = await shiftsQueries.getShiftById(newV8ShiftId);
        if (!newShift) {
            throw new Error('Shift created but could not be retrieved');
        }

        return newShift;
    },

    /* ============================================================
       UPDATE SHIFT
       ============================================================ */

    async updateShift(shiftId: string, updates: UpdateShiftData): Promise<Shift> {
        const user = await requireUser();

        // Prevent modification if the shift is in the past
        const currentShift = await shiftsQueries.getShiftById(shiftId);
        if (currentShift) {
            const now = new Date();
            const shiftStartAt = parseZonedDateTime(currentShift.shift_date, currentShift.start_time, SYDNEY_TZ);
            if (now >= shiftStartAt) {
                throw new Error('Cannot edit a shift that is in the past.');
            }
        }

        // ── Split the incoming patch into two buckets ──────────────────────────
        //
        //  (1) editPayload — schedule + grouping fields (and, on a DRAFT shift,
        //      the assignment) that the audited gateway 'edit' op WHITELISTS.
        //      These flow through sm_apply_shift_op so the action lands in the
        //      shift_events ledger as a SINGLE record (state + field diff +
        //      folded assignment).
        //
        //  (2) excludedPayload — fields the gateway 'edit' op DELIBERATELY does
        //      NOT own (structural/RLS-scoping moves, canonical timestamps, jsonb
        //      eligibility arrays, cancellation reason). These keep their existing
        //      direct-update behaviour so nothing regresses.
        //
        // Gateway 'edit' whitelist (payload keys, per 20260630001100):
        //   start_time, end_time, shift_date, paid_break_minutes,
        //   unpaid_break_minutes, notes, role_id, sub_department_id,
        //   remuneration_level_id, group_type, sub_group_name, display_order,
        //   shift_group_id, shift_subgroup_id, timezone, is_training,
        //   assigned_employee_id, assignment_source
        const editPayload: Record<string, unknown> = {};

        if (updates.start_time !== undefined) editPayload.start_time = updates.start_time;
        if (updates.end_time !== undefined) editPayload.end_time = updates.end_time;
        if (updates.shift_date !== undefined) editPayload.shift_date = updates.shift_date;
        if (updates.paid_break_minutes !== undefined)
            editPayload.paid_break_minutes = updates.paid_break_minutes;
        if (updates.unpaid_break_minutes !== undefined)
            editPayload.unpaid_break_minutes = updates.unpaid_break_minutes;
        // notes: pass through even when null so it can be explicitly cleared
        // (the gateway uses the `?` operator to allow clearing).
        if (updates.notes !== undefined) editPayload.notes = updates.notes;
        if (updates.role_id !== undefined)
            editPayload.role_id = safeUuid(updates.role_id);
        if (updates.sub_department_id !== undefined)
            editPayload.sub_department_id = safeUuid(updates.sub_department_id);
        if (updates.remuneration_level !== undefined)
            editPayload.remuneration_level = updates.remuneration_level !== null ? Number(updates.remuneration_level) : null;
        if (updates.group_type !== undefined) editPayload.group_type = updates.group_type;
        // sub_group_name: pass through even when null so it can be explicitly cleared.
        if (updates.sub_group_name !== undefined)
            editPayload.sub_group_name = updates.sub_group_name;
        if (updates.display_order !== undefined)
            editPayload.display_order = updates.display_order;
        if (updates.shift_group_id !== undefined)
            editPayload.shift_group_id = safeUuid(updates.shift_group_id);
        // Payload key is `shift_subgroup_id`; the gateway maps it to the DB column
        // roster_subgroup_id internally. (Preserves the old "only set when a valid
        // UUID is present" behaviour — a null/invalid value is simply omitted, so
        // COALESCE keeps the existing subgroup.)
        if (updates.shift_subgroup_id !== undefined) {
            const safeSubgroupId = safeUuid(updates.shift_subgroup_id);
            if (safeSubgroupId) {
                editPayload.shift_subgroup_id = safeSubgroupId;
            }
        }
        if (updates.timezone !== undefined) editPayload.timezone = updates.timezone;
        if (updates.is_training !== undefined) editPayload.is_training = updates.is_training;

        // Assignment is FOLDED into the single audited `edit` op so an
        // edit-and-reassign on a DRAFT shift produces ONE shift_events record
        // (the gateway gates the fold on assign/unassign FSM legality and its
        // via_gateway guard suppresses the duplicate trigger ASSIGNED row).
        // Pass an explicit `null` (not undefined) when clearing so the key
        // survives JSON serialization and the gateway sees the unassign intent.
        // Published-shift assignment changes are gated out server-side and keep
        // their dedicated assign/emergency path.
        if (updates.assigned_employee_id !== undefined) {
            const empId = safeUuid(updates.assigned_employee_id);
            editPayload.assigned_employee_id = empId ?? null;
            editPayload.assignment_source = empId
                ? (updates.assignment_source ?? 'manual')
                : null;
        }

        // ── Non-whitelist fields: preserve the existing direct-update path ─────
        // These are NOT silently dropped. roster_id/department_id/organization_id
        // are structural moves; start_at/end_at are canonical timestamps; the jsonb
        // arrays + cancellation_reason are owned by other pipelines. (Assignment
        // now flows through the audited `edit` op above, not here.)
        const excludedPayload: Record<string, unknown> = {};

        if (updates.roster_id !== undefined)
            excludedPayload.roster_id = safeUuid(updates.roster_id);
        if (updates.department_id !== undefined)
            excludedPayload.department_id = safeUuid(updates.department_id);
        if (updates.organization_id !== undefined)
            excludedPayload.organization_id = safeUuid(updates.organization_id);
        if (updates.start_at !== undefined) excludedPayload.start_at = updates.start_at;
        if (updates.end_at !== undefined) excludedPayload.end_at = updates.end_at;
        if (updates.required_skills !== undefined)
            editPayload.required_skills = updates.required_skills;
        if (updates.required_licenses !== undefined)
            editPayload.required_licenses = updates.required_licenses;
        if (updates.event_ids !== undefined)
            editPayload.event_ids = updates.event_ids;
        if (updates.tags !== undefined) excludedPayload.tags = updates.tags;
        if (updates.cancellation_reason !== undefined)
            excludedPayload.cancellation_reason = updates.cancellation_reason;

        // Employment target: a PLANNING attribute, in the same family as `tags`.
        // It is deliberately NOT routed through the gateway `edit` op — that op's
        // server-side whitelist does not carry these keys, so sending them there
        // would be silently dropped (`NO_EDITABLE_FIELDS` / ignored key). It also
        // drives no FSM transition and no compliance gate, so the direct-update
        // path the other planning fields already use is the correct home.
        //
        // Both keys move together so the pair can never violate
        // shifts_target_flexible_requires_pt_check: clearing the type to "Any"
        // must also clear the flexible flag.
        // The flag is only writable alongside the type it qualifies. Writing it
        // alone is rejected rather than guessed at: we would have to read the
        // shift's current target to know whether `true` is even legal, and a
        // wrong guess either trips the CHECK or silently clears the planner's
        // intent. Every caller in the app submits the pair together.
        if (updates.target_employment_type !== undefined) {
            const nextTarget = updates.target_employment_type ?? null;
            excludedPayload.target_employment_type = nextTarget;
            excludedPayload.target_requires_flexible =
                nextTarget === 'PT' ? (updates.target_requires_flexible ?? false) : false;
        }

        const hasEdit = Object.keys(editPayload).length > 0;
        const hasExcluded = Object.keys(excludedPayload).length > 0;

        // ── (1) Schedule/grouping edits → audited gateway op ──────────────────
        if (hasEdit) {
            // The gateway performs CAS against the EXACT current version, so an
            // expected version is mandatory. If the caller did not supply one,
            // read the current version (non-critical updates that omit it keep
            // working — we just fetch the head version to satisfy the contract).
            let expectedVersion = updates.expectedVersion;
            if (expectedVersion === undefined) {
                const current = await shiftsQueries.getShiftById(shiftId);
                if (!current) {
                    throw new Error('Shift not found or has been deleted.');
                }
                expectedVersion = current.version;
            }

            const envelope = await callRpc(
                'sm_apply_shift_op',
                {
                    p_shift_id: shiftId,
                    p_expected_version: expectedVersion,
                    p_op: 'edit',
                    p_payload: { ...editPayload, reason: 'Shift edited' },
                    p_idempotency_key: null,
                },
                ApplyShiftOpResponseSchema,
            );

            switch (envelope.code) {
                case 'APPLIED':
                case 'IDEMPOTENT_REPLAY':
                    break;
                case 'VERSION_CONFLICT':
                    throw new Error(
                        'This shift was modified by someone else (concurrent modification). ' +
                        'Reload and try again.',
                    );
                case 'ILLEGAL_TRANSITION':
                    throw new Error(
                        `This edit is not allowed in the shift's current state (${envelope.current_state ?? 'unknown'}).`,
                    );
                case 'FORBIDDEN':
                    throw new Error('You do not have permission to edit this shift.');
                case 'GONE':
                    throw new Error('Shift not found or has been deleted.');
                case 'WRITE_REJECTED':
                    throw new Error(`Shift edit was rejected: ${envelope.note ?? 'unknown reason'}.`);
                default:
                    throw new Error(envelope.error ?? 'Failed to edit shift.');
            }
        }

        // ── (2) Non-whitelist fields → existing direct-update path ────────────
        // Behaviour-preserving: same direct UPDATE the legacy code used (the
        // legacy RPC sm_update_shift is broken via a missing notify_user fn).
        // Only runs when there are excluded fields to write.
        if (hasExcluded) {
            let query = supabase
                .from('shifts')
                .update({
                    ...excludedPayload,
                    updated_at:       new Date().toISOString(),
                    last_modified_by: user.id,
                })
                .eq('id', shiftId);

            // Honour optimistic concurrency when the caller passed a version. If
            // the gateway 'edit' op already ran above, it bumped the version, so
            // only gate on the original expected version when there was NO edit.
            if (updates.expectedVersion !== undefined && !hasEdit) {
                query = query.eq('version', updates.expectedVersion);
            }

            const { data: updatedRows, error: updateError } = await query.select('id');

            if (updateError) {
                throw new Error(updateError.message);
            }

            if (!updatedRows || updatedRows.length === 0) {
                throw new Error('No rows were updated. The shift may have been modified by another user.');
            }
        }

        const updatedShift = await shiftsQueries.getShiftById(shiftId);
        if (!updatedShift) {
            throw new Error('Shift updated but could not be retrieved');
        }

        return updatedShift;
    },

    /* ============================================================
       BULK ASSIGN SHIFTS
       ============================================================ */

    /**
     * Assign multiple shifts to a single employee
     * @param employeeId The employee UUID to assign
     * @param shiftIds Array of shift UUIDs to assign
     * @returns Array of updated shifts
     */
    async bulkAssignShifts(employeeId: string, shiftIds: string[]): Promise<BulkAssignResponse> {
        if (!employeeId || !isValidUuid(employeeId)) {
            throw new Error('Invalid employee ID');
        }
        if (shiftIds.length === 0) {
            return { success: true, total_requested: 0, success_count: 0, failure_count: 0, message: 'No shifts selected' };
        }

        return callAuthenticatedRpc(
            'sm_bulk_assign',
            (userId) => ({ p_shift_ids: shiftIds, p_employee_id: employeeId, p_user_id: userId }),
            BulkAssignResponseSchema,
        );
    },

    /* ============================================================
       ATOMIC BULK ASSIGN SHIFTS (multi-employee, idempotent)
       ============================================================ */

    /**
     * Assign multiple (employee → shifts[]) pairs in a single atomic DB
     * transaction via the sm_bulk_assign_atomic RPC.
     *
     * @param assignments     Array of { employeeId, shiftIds } pairs.
     * @param idempotencyKey  Optional UUID — if supplied and the key already
     *                        exists in bulk_assign_idempotency, the stored
     *                        result is returned without re-applying anything.
     */
    async bulkAssignShiftsAtomic(
        assignments: { employeeId: string; shiftIds: string[] }[],
        idempotencyKey?: string,
    ): Promise<BulkAssignAtomicResponse> {
        if (assignments.length === 0) {
            return {
                success: true,
                total_requested: 0,
                success_count: 0,
                conflict_count: 0,
                conflicts: [],
                per_employee: [],
            };
        }

        // Build the JSONB array the RPC expects:
        // [{ "employee_id": uuid, "shift_ids": [uuid, ...] }, ...]
        const p_assignments = assignments.map(a => ({
            employee_id: a.employeeId,
            shift_ids: a.shiftIds,
        }));

        return callAuthenticatedRpc(
            'sm_bulk_assign_atomic',
            (userId) => ({
                p_assignments,
                p_user_id:         userId,
                p_idempotency_key: idempotencyKey ?? null,
            }),
            BulkAssignAtomicResponseSchema,
        );
    },

    /* ============================================================
       BULK UNASSIGN SHIFTS
       ============================================================ */

    /**
     * Remove assignment from multiple shifts
     * @param shiftIds Array of shift UUIDs to unassign
     * @returns Array of updated shifts
     */
    async bulkUnassignShifts(shiftIds: string[]): Promise<Shift[]> {
        if (shiftIds.length === 0) return [];

        // Route each unassign through the audited mutation gateway (the `unassign`
        // op added in 20260623000100_shift_unassign_op). The gateway records a
        // durable UNASSIGNED shift_events row per shift (naming the removed worker),
        // so the previous console.info "audit log" is gone. Partial-success
        // semantics are preserved: a per-shift failure (already-unassigned, version
        // conflict, illegal state, etc.) is skipped, not fatal.
        //
        // The gateway requires the EXACT current version for its CAS, so fetch
        // version per shift first (this also lets us return the updated rows).
        const { data: preState } = await supabase
            .from('shifts')
            .select('id, version, assigned_employee_id')
            .in('id', shiftIds)
            .is('deleted_at', null);

        const succeededIds: string[] = [];

        await Promise.all(
            (preState ?? []).map(async (s: { id: string; version: number; assigned_employee_id: string | null }) => {
                // Nothing to remove — the gateway would soft-reject (ALREADY_UNASSIGNED).
                if (s.assigned_employee_id === null) return;

                try {
                    const envelope = await callRpc(
                        'sm_apply_shift_op',
                        {
                            p_shift_id: s.id,
                            p_expected_version: s.version,
                            p_op: 'unassign',
                            p_payload: { reason: 'Bulk unassign' },
                            p_idempotency_key: null,
                        },
                        ApplyShiftOpResponseSchema,
                    );

                    if (envelope.code === 'APPLIED' || envelope.code === 'IDEMPOTENT_REPLAY') {
                        succeededIds.push(s.id);
                    }
                    // Any other code (VERSION_CONFLICT / ILLEGAL_TRANSITION /
                    // WRITE_REJECTED / FORBIDDEN / GONE) is a per-shift skip.
                } catch {
                    // Network/validation error on one shift must not fail the batch.
                }
            }),
        );

        if (succeededIds.length === 0) return [];

        // Return the freshly-unassigned rows (preserves the Shift[] return type).
        const { data, error } = await supabase
            .from('shifts')
            .select('*')
            .in('id', succeededIds)
            .is('deleted_at', null);

        if (error) throw error;

        return (data || []) as unknown as Shift[];
    },




    async publishShift(shiftId: string) {
        // Publish is a lifecycle transition only — compliance is checked at assignment time.
        const shift = await shiftsQueries.getShiftById(shiftId);

        if (shift) {
            const now = new Date();
            const shiftStartAt = parseZonedDateTime(shift.shift_date, shift.start_time, SYDNEY_TZ);
            if (now >= shiftStartAt) {
                throw new Error('Cannot publish a shift that is in the past.');
            }
        }

        const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
        const ttsMs = shift?.start_at
            ? new Date(shift.start_at).getTime() - Date.now()
            : shift
                ? parseZonedDateTime(shift.shift_date, shift.start_time, SYDNEY_TZ).getTime() - Date.now()
                : Number.POSITIVE_INFINITY;
        const isAssigned = !!shift?.assigned_employee_id && isValidUuid(shift.assigned_employee_id);

        // Emergent window (TTS ≤ 4h) + UNASSIGNED: opening bidding (S5) is a no-op —
        // the shift-state-processor expires bidding inside the 4h lock, bouncing the
        // shift straight back to Draft (S1). Block it and steer the manager to
        // Emergency Assignment: assigning a worker publishes directly to Confirmed (S4).
        if (!isAssigned && ttsMs <= FOUR_HOURS_MS) {
            throw new Error(
                'This shift starts within 4 hours, so it can’t be opened for bidding — bids are locked in the emergency window and it would immediately revert to Draft. Assign an employee to emergency-publish it instead.',
            );
        }

        // TTS-aware routing for assigned shifts: inside the 4h window, bypass the offer
        // flow (S3) and publish straight to Confirmed (S4). sm_publish_shift never sets
        // assignment_outcome, so an assigned draft would otherwise land in S3 and the
        // shift-state-processor cron would immediately expire S3 → S2, a stuck loop.
        //
        // Routed through sm_apply_shift_op('publish') — the gateway itself detects the
        // TTS<4h + assigned case and does the emergency-confirm write server-side (see
        // migration 20260721013000). This used to be a direct, unprotected
        // `supabase.from('shifts').update()` here with no row lock and no version CAS;
        // that gap is what docs/investigations/2026-07-21_reserve-list-audit-and-implementation-plan.md §6
        // flagged as the exact race Reserve List needed closed before it could be safe.
        if (isAssigned && ttsMs > 0 && ttsMs < FOUR_HOURS_MS) {
            const envelope = await callRpc(
                'sm_apply_shift_op',
                {
                    p_shift_id: shiftId,
                    p_expected_version: shift!.version,
                    p_op: 'publish',
                    p_payload: { reason: 'Emergency publish' },
                    p_idempotency_key: null,
                },
                ApplyShiftOpResponseSchema,
            );

            switch (envelope.code) {
                case 'APPLIED':
                case 'IDEMPOTENT_REPLAY':
                    return { success: true };
                case 'VERSION_CONFLICT':
                    throw new Error(
                        'This shift was modified by someone else (concurrent modification). ' +
                        'Reload and try again.',
                    );
                case 'ILLEGAL_TRANSITION':
                    throw new Error(
                        `Publishing is not allowed in the shift's current state (${envelope.current_state ?? 'unknown'}).`,
                    );
                case 'FORBIDDEN':
                    throw new Error('You do not have permission to publish this shift.');
                case 'GONE':
                    throw new Error('Shift not found or has been deleted.');
                case 'WRITE_REJECTED':
                    throw new Error(`Emergency publish was rejected: ${envelope.note ?? 'unknown reason'}.`);
                default:
                    throw new Error(envelope.error ?? 'Failed to publish shift.');
            }
        }

        const result = await callAuthenticatedRpc(
            'sm_publish_shift',
            (userId) => ({ p_shift_id: shiftId, p_user_id: userId }),
            PublishShiftResponseSchema,
        );

        if (!result.success) {
            throw new Error(result.error ?? 'Failed to publish shift');
        }

        return result;
    },

    async bulkPublishShifts(shiftIds: string[]): Promise<BulkPublishPartialResult> {
        // Per-shift compliance pre-check — does NOT block the whole batch on a single failure.
        // Also identifies assigned shifts with TTS < 4h (emergency set) so they bypass the
        // offer flow and land directly on S4 (Confirmed) rather than S3 (Offered).
        const FOUR_H_MS = 4 * 60 * 60 * 1000;
        const emergencySet = new Set<string>();

        const complianceChecks = await Promise.allSettled(
            shiftIds.map(async (id) => {
                const shift = await shiftsQueries.getShiftById(id);
                // Unassigned shifts: no compliance needed. BUT inside the 4h emergency
                // window, opening bidding (S5) auto-expires back to Draft (S1) — so skip
                // the no-op and surface the emergency-assignment hint instead of passing.
                if (!shift?.assigned_employee_id || !isValidUuid(shift.assigned_employee_id)) {
                    const ttsUnassigned = shift?.start_at
                        ? new Date(shift.start_at).getTime() - Date.now()
                        : shift
                            ? parseZonedDateTime(shift.shift_date, shift.start_time, SYDNEY_TZ).getTime() - Date.now()
                            : Number.POSITIVE_INFINITY;
                    if (ttsUnassigned <= FOUR_H_MS) {
                        return {
                            id,
                            pass: false as const,
                            reason: 'Starts within 4h — assign an employee to emergency-publish (bidding would expire)',
                        };
                    }
                    return { id, pass: true as const, reason: '' };
                }
                const netMinutes =
                    calculateMinutesBetweenTimes(shift.start_time, shift.end_time)
                    - (shift.unpaid_break_minutes || 0);
                const validation = await complianceService.validateShiftCompliance(
                    shift.assigned_employee_id,
                    shift.shift_date,
                    shift.start_time,
                    shift.end_time,
                    netMinutes,
                    id,
                );
                if (!validation.isValid) {
                    const rules = validation.violations.join(', ');
                    return { id, pass: false as const, reason: rules };
                }
                // Flag assigned shifts within the 4h lock window for emergency publish
                const ttsMs = shift.start_at
                    ? new Date(shift.start_at).getTime() - Date.now()
                    : parseZonedDateTime(shift.shift_date, shift.start_time, SYDNEY_TZ).getTime() - Date.now();
                if (ttsMs > 0 && ttsMs < FOUR_H_MS) {
                    emergencySet.add(id);
                }
                return { id, pass: true as const, reason: '' };
            })
        );

        const complianceFailed: Array<{ id: string; reason: string }> = [];
        const passIds: string[] = [];

        complianceChecks.forEach((check, i) => {
            const id = shiftIds[i];
            if (check.status === 'rejected') {
                complianceFailed.push({ id, reason: 'Compliance check error' });
            } else if (!check.value.pass) {
                complianceFailed.push({ id, reason: check.value.reason });
            } else {
                passIds.push(id);
            }
        });

        // Nothing passes compliance — skip the DB round-trip entirely
        if (passIds.length === 0) {
            return { publishedIds: [], complianceFailed, dbFailed: [] };
        }

        // Split: normal publish via RPC; emergency publish via direct update (S2 → S4, no offer).
        const normalIds    = passIds.filter(id => !emergencySet.has(id));
        const emergencyIds = passIds.filter(id =>  emergencySet.has(id));

        const publishedIds: string[] = [];
        const dbFailed: Array<{ id: string; reason: string }> = [];

        // Normal path — bulk publish via RPC
        if (normalIds.length > 0) {
            try {
                const result = await callAuthenticatedRpc(
                    'sm_bulk_publish_shifts',
                    (userId) => ({ p_shift_ids: normalIds, p_actor_id: userId }),
                    BulkPublishResponseSchema,
                );

                if (result.success === false) {
                    // RPC signalled a hard failure — the whole batch was rejected.
                    normalIds.forEach(id => dbFailed.push({ id, reason: result.message || 'Bulk publish failed' }));
                } else {
                    // Forward-compatibility: if a future RPC version returns a per-shift
                    // errors array, use it as the primary source of truth.
                    const hasLegacyErrors = Array.isArray(result.errors) && result.errors.length > 0;
                    if (hasLegacyErrors) {
                        const errorMap = new Map(
                            (result.errors as Array<{ shift_id: string; reason: string }>)
                                .map((e) => [e.shift_id, e.reason])
                        );
                        for (const id of normalIds) {
                            if (errorMap.has(id)) {
                                dbFailed.push({ id, reason: errorMap.get(id)! });
                            } else {
                                publishedIds.push(id);
                            }
                        }
                    } else if (
                        // Fast path: the RPC confirms every requested shift was updated.
                        // failure_count === 0 (or success_count exactly matches) means we can
                        // trust the full normalIds list without a round-trip.
                        typeof result.failure_count === 'number' && result.failure_count === 0
                    ) {
                        normalIds.forEach(id => publishedIds.push(id));
                    } else if (
                        // Discrepancy detected: the RPC silently skipped some shifts
                        // (e.g. wrong FSM state, shift starts in the past, S1+emergency).
                        // failure_count > 0, OR success_count returned and doesn't match
                        // the count we sent. Fetch ground-truth from the DB to classify each
                        // shift individually — never fabricate success.
                        (typeof result.failure_count === 'number' && result.failure_count > 0)
                        || (typeof result.success_count === 'number' && result.success_count !== normalIds.length)
                    ) {
                        const { data: rows, error: selectError } = await supabase
                            .from('shifts')
                            .select('id, lifecycle_status')
                            .in('id', normalIds);

                        if (selectError) {
                            // Verification query itself failed. We cannot safely claim any
                            // shift was published. Mark all as failed with the DB error so
                            // the caller can surface it to the user (who can reload to see
                            // the real state).
                            normalIds.forEach(id =>
                                dbFailed.push({ id, reason: `Could not verify publish status: ${selectError.message}` })
                            );
                        } else {
                            // Post-publish lifecycle states: Published, InProgress, Completed.
                            // Any other state means the RPC skipped this shift.
                            const postPublishStatuses = new Set(['Published', 'InProgress', 'Completed']);
                            const publishedSet = new Set(
                                (rows ?? [])
                                    .filter((r: { id: string; lifecycle_status: string }) =>
                                        postPublishStatuses.has(r.lifecycle_status))
                                    .map((r: { id: string; lifecycle_status: string }) => r.id)
                            );
                            for (const id of normalIds) {
                                if (publishedSet.has(id)) {
                                    publishedIds.push(id);
                                } else {
                                    dbFailed.push({
                                        id,
                                        reason: 'Skipped by server (not in a publishable state or starts in the past)',
                                    });
                                }
                            }
                        }
                    } else {
                        // Neither failure_count nor success_count was present in the response
                        // (e.g. older RPC that predates these fields). Optimistically trust the
                        // RPC's success flag — this is the same behaviour the code had before
                        // the reconciliation logic was introduced.
                        normalIds.forEach(id => publishedIds.push(id));
                    }
                }
            } catch (e: any) {
                normalIds.forEach(id => dbFailed.push({ id, reason: e.message }));
            }
        }

        // Emergency path — publish + confirm atomically (S2 → S4) via the audited
        // gateway. sm_apply_shift_op('publish') detects the TTS<4h + assigned case
        // and does the emergency-confirm write server-side (migration 20260721013000),
        // with a real row lock + version CAS. This used to be a direct, unprotected
        // `supabase.from('shifts').update()` here — the exact gap
        // docs/investigations/2026-07-21_reserve-list-audit-and-implementation-plan.md §6 flagged as
        // needing to close before Reserve List's own writes could rely on the same
        // pattern. One RPC call per shift (mirrors bulkUnassignShifts below), since
        // the gateway is single-shift by design.
        if (emergencyIds.length > 0) {
            const { data: preState } = await supabase
                .from('shifts')
                .select('id, version')
                .in('id', emergencyIds);
            const versionById = new Map(
                (preState ?? []).map((s: { id: string; version: number }) => [s.id, s.version]),
            );

            await Promise.all(
                emergencyIds.map(async (id) => {
                    const version = versionById.get(id);
                    if (version === undefined) {
                        dbFailed.push({ id, reason: 'Shift not found' });
                        return;
                    }
                    try {
                        const envelope = await callRpc(
                            'sm_apply_shift_op',
                            {
                                p_shift_id: id,
                                p_expected_version: version,
                                p_op: 'publish',
                                p_payload: { reason: 'Emergency publish' },
                                p_idempotency_key: null,
                            },
                            ApplyShiftOpResponseSchema,
                        );
                        if (envelope.code === 'APPLIED' || envelope.code === 'IDEMPOTENT_REPLAY') {
                            publishedIds.push(id);
                        } else {
                            dbFailed.push({ id, reason: envelope.note ?? envelope.error ?? envelope.code });
                        }
                    } catch (e: any) {
                        dbFailed.push({ id, reason: e?.message ?? 'Emergency publish failed' });
                    }
                }),
            );
        }

        return { publishedIds, complianceFailed, dbFailed };
    },

    async bulkUnpublishShifts(shiftIds: string[]): Promise<BulkUnpublishPartialResult> {
        if (!shiftIds || shiftIds.length === 0) return { unpublishedIds: [], failed: [] };

        // processInChunks: 20 at a time, fully parallel within each chunk
        const results = await processInChunks(
            shiftIds,
            (id) => this.unpublishShift(id, 'Bulk unpublish'),
        );

        const unpublishedIds: string[] = [];
        const failed: Array<{ id: string; reason: string }> = [];

        for (const r of results) {
            if (r.ok) {
                unpublishedIds.push(r.id);
            } else {
                failed.push({ id: r.id, reason: (r as any).error });
            }
        }

        return { unpublishedIds, failed };
    },

    async unpublishShift(shiftId: string, reason?: string) {
        const shift = await shiftsQueries.getShiftById(shiftId);
        if (shift) {
            const now = new Date();
            const shiftStartAt = parseZonedDateTime(shift.shift_date, shift.start_time, SYDNEY_TZ);
            if (now >= shiftStartAt) {
                throw new Error('Cannot unpublish a shift that is in the past.');
            }
        }

        const result = await callAuthenticatedRpc(
            'sm_unpublish_shift',
            (userId) => ({ p_shift_id: shiftId, p_user_id: userId, p_reason: reason ?? 'Unpublished' }),
            PublishShiftResponseSchema,
        );

        if (!result.success) {
            throw new Error(result.error ?? 'Failed to unpublish shift');
        }

        return result;
    },

    /* ============================================================
       ATTENDANCE
       ============================================================ */

    async checkIn(shiftId: string, location?: { lat: number; lon: number }): Promise<void> {
        await callAuthenticatedVoidRpc('check_in_shift', (userId) => ({
            p_shift_id: shiftId,
            p_user_id: userId,
            p_lat: location?.lat ?? null,
            p_lon: location?.lon ?? null,
        }));
    },



    async withdrawShiftFromBidding(shiftId: string) {
        const result = await callAuthenticatedRpc(
            'sm_close_bidding',
            (userId) => ({ p_shift_id: shiftId, p_user_id: userId, p_reason: 'User declined offer' }),
            CloseBiddingResponseSchema,
        );

        if (!result.success) {
            throw new Error(result.error ?? 'Failed to withdraw shift from bidding');
        }

        return result;
    },

    /* ============================================================
       CANCEL SHIFT
       ============================================================ */

    /**
     * Cancel a shift (employee initiated)
     * Triggers the cancel_shift RPC which handles bidding logic
     */
    async cancelShift(shiftId: string, reason: string) {
        return callAuthenticatedRpc(
            'sm_manager_cancel',
            (userId) => ({ p_shift_id: shiftId, p_reason: reason, p_user_id: userId }),
            CancelShiftResponseSchema,
        );
    },

    /* ============================================================
       DELETE SHIFT
       ============================================================ */

    async deleteShift(shiftId: string): Promise<boolean> {
        if (!shiftId || !isValidUuid(shiftId)) return false;

        const result = await callAuthenticatedRpc(
            'sm_delete_shift',
            (userId) => ({ p_shift_id: shiftId, p_user_id: userId, p_reason: 'Manual deletion' }),
            DeleteShiftResponseSchema,
        );

        if (!result.success) {
            throw new Error(result.error ?? 'Failed to delete shift on the server.');
        }

        return true;
    },

    /* ============================================================
       BULK DELETE SHIFTS
       ============================================================ */

    async bulkDeleteShifts(shiftIds: string[]): Promise<number> {
        if (!shiftIds || shiftIds.length === 0) return 0;

        const result = await callAuthenticatedRpc(
            'sm_bulk_delete_shifts',
            (userId) => ({ p_shift_ids: shiftIds, p_deleted_by: userId, p_reason: 'Bulk manual deletion' }),
            BulkDeleteResponseSchema,
        );

        return result.success_count;
    },

    /**
     * Per-item bulk delete mapped to sm_bulk_delete_shifts RPC to avoid 429 Too Many Requests.
     * Replaces the coarse map/chunk logic.
     */
    async bulkDeleteShiftsPerItem(shiftIds: string[]): Promise<BulkDeletePartialResult> {
        if (!shiftIds || shiftIds.length === 0) return { deletedIds: [], failed: [] };

        try {
            const result = await callAuthenticatedRpc(
                'sm_bulk_delete_shifts',
                (userId) => ({ p_shift_ids: shiftIds, p_deleted_by: userId, p_reason: 'Bulk manual deletion' }),
                BulkDeleteResponseSchema,
            );

            if (result.success !== false) {
                // If RPC succeeds but we don't have per-item errors in schema, assume all passed
                return { deletedIds: shiftIds, failed: [] };
            } else {
                return { deletedIds: [], failed: shiftIds.map(id => ({ id, reason: result.error || 'Bulk delete failed' })) };
            }
        } catch (e: any) {
            return { deletedIds: [], failed: shiftIds.map(id => ({ id, reason: e.message })) };
        }
    },

    /**
     * Async compliance pre-check for a set of shifts BEFORE the user confirms publish.
     * Runs per-shift compliance in parallel chunks (20 at a time).
     * Returns eligible IDs, compliance-failed IDs, and already-published (skipped) IDs.
     *
     * Used by the VALIDATING phase in BulkActionsToolbar to surface compliance results
     * to the user BEFORE they click "Confirm Publish".
     */
    async validateBulkPublishCompliance(shifts: Shift[]): Promise<BulkPublishValidationResult> {
        const eligible: string[] = [];
        const complianceFailed: Array<{ id: string; reason: string }> = [];
        const skipped: Array<{ id: string; reason: string }> = [];

        const checks = await processInChunks(
            shifts.map(s => s.id),
            async (id) => {
                const shift = shifts.find(s => s.id === id)!;

                // Already published → skip
                if (shift.lifecycle_status === 'Published') {
                    return { id, category: 'skipped' as const, reason: 'Already published' };
                }

                // Unassigned draft → eligible (compliance only applies to assigned shifts)
                if (!shift.assigned_employee_id || !isValidUuid(shift.assigned_employee_id)) {
                    return { id, category: 'eligible' as const, reason: '' };
                }

                // Assigned draft → run compliance check
                const netMinutes =
                    calculateMinutesBetweenTimes(shift.start_time, shift.end_time)
                    - (shift.unpaid_break_minutes || 0);

                const validation = await complianceService.validateShiftCompliance(
                    shift.assigned_employee_id,
                    shift.shift_date,
                    shift.start_time,
                    shift.end_time,
                    netMinutes,
                    id,
                );

                if (!validation.isValid) {
                    const rules = validation.violations.join(', ');
                    return { id, category: 'compliance_failed' as const, reason: rules };
                }

                return { id, category: 'eligible' as const, reason: '' };
            },
        );

        for (const r of checks) {
            if (!r.ok) {
                complianceFailed.push({ id: r.id, reason: (r as any).error });
            } else {
                switch (r.value.category) {
                    case 'eligible':          eligible.push(r.id); break;
                    case 'compliance_failed': complianceFailed.push({ id: r.id, reason: r.value.reason }); break;
                    case 'skipped':           skipped.push({ id: r.id, reason: r.value.reason }); break;
                }
            }
        }

        return { eligible, complianceFailed, skipped };
    },

    /* ============================================================
       DELETE SHIFTS BY TEMPLATE
       ============================================================ */

    async deleteShiftsByTemplateId(templateId: string): Promise<number> {
        if (!templateId || !isValidUuid(templateId)) return 0;

        const { count } = await supabase
            .from('shifts')
            .select('*', { count: 'exact', head: true })
            .eq('template_id', templateId);

        const { error } = await supabase
            .from('shifts')
            .delete()
            .eq('template_id', templateId);

        if (error) throw new Error(error.message);

        return count ?? 0;
    },

    /* ============================================================
       EMPLOYEE ACTIONS (V3)
       ============================================================ */

    async requestTrade(shiftId: string) {
        return callAuthenticatedRpc(
            'sm_request_trade',
            (userId) => ({ p_shift_id: shiftId, p_user_id: userId, p_target_employee_id: null }),
            RequestTradeResponseSchema,
        );
    },

    async acceptOffer(shiftId: string) {
        return callAuthenticatedRpc(
            'sm_accept_offer',
            (userId) => ({ p_shift_id: shiftId, p_user_id: userId }),
            OfferActionResponseSchema,
        );
    },

    async rejectOffer(shiftId: string, reason: string) {
        // TTS-aware routing:
        //   TTS > 4h → sm_reject_offer → bidding (S5) — peers can still bid
        //   TTS ≤ 4h → sm_expire_offer_now → draft+assigned (S2) — bidding window closed,
        //              manager must use emergency assignment
        const { data: shift } = await (supabase as any)
            .from('shifts')
            .select('shift_date, start_time, start_at')
            .eq('id', shiftId)
            .single();

        if (shift) {
            const tts = shift.start_at
                ? new Date(shift.start_at).getTime() - Date.now()
                : parseZonedDateTime(shift.shift_date, shift.start_time, SYDNEY_TZ).getTime() - Date.now();

            if (tts <= 4 * 60 * 60 * 1000) {
                // Window closed — expire the offer, notify manager for emergency assignment
                return this.expireOfferNow(shiftId);
            }
        }

        return callAuthenticatedRpc(
            'sm_reject_offer',
            (userId) => ({ p_shift_id: shiftId, p_user_id: userId, p_reason: reason }),
            OfferActionResponseSchema,
        );
    },

    /**
     * Immediately expire a shift offer. Called client-side the moment the
     * countdown hits zero or isShiftLocked fires, so the DB transitions
     * S3 → S2 (Draft+Assigned) instantly without waiting for the cron.
     */
    async expireOfferNow(shiftId: string) {
        const { data, error } = await supabase.rpc('sm_expire_offer_now', {
            p_shift_id: shiftId,
        });
        if (error) throw error;
        return data as { success: boolean; error?: string; from_state?: string; to_state?: string };
    },

    /**
     * Employee drops an assigned shift (pushes to bidding based on time-to-start rules)
     * - >24h before start: on_bidding_normal (S5)
     * - 4-24h before start: on_bidding_urgent (S6)
     * - <4h before start: Blocked (RPC returns success=false with error message)
     */
    async employeeDropShift(shiftId: string, reason?: string) {
        const result = await callAuthenticatedRpc(
            'sm_employee_drop_shift',
            (userId) => ({ p_shift_id: shiftId, p_employee_id: userId, p_reason: reason ?? 'Employee dropped shift' }),
            EmployeeDropResponseSchema,
        );

        if (!result.success) {
            throw new Error(result.error ?? 'Failed to drop shift');
        }

        return result;
    },
};
