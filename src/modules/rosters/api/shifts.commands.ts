import { supabase } from '@/platform/realtime/client';
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
    BulkDeleteResponse,
    BulkDeleteResponseSchema,
    DeleteShiftResponseSchema,
    CancelShiftResponseSchema,
    OfferActionResponseSchema,
    RequestTradeResponseSchema,
    EmployeeDropResponseSchema,
    CloseBiddingResponseSchema,
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
            p_group_type: params.groupType ?? null,
            p_sub_group_name: params.subGroupName ?? null,
            p_shift_group_id: safeUuid(params.shiftGroupId) ?? null,
            p_roster_subgroup_id: safeUuid(params.rosterSubgroupId) ?? null,
            p_shift_date: params.shiftDate ?? null,
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
            role_id: safeUuid(shiftData.role_id),
            remuneration_level_id: safeUuid(shiftData.remuneration_level_id),
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
        };

        const newShiftId = await callRpc('sm_create_shift', {
            p_shift_data: payload,
            p_user_id: user.id,
        }, CreateShiftResponseSchema);

        const newShift = await shiftsQueries.getShiftById(newShiftId);
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

        {
            const payload: Record<string, unknown> = {};
            // We pass updates directly, but mapped to correct keys/types if needed
            // The RPC handles COALESCE logic, so we only need to pass defined fields.

            if (updates.roster_id !== undefined)
                payload.roster_id = safeUuid(updates.roster_id);
            if (updates.department_id !== undefined)
                payload.department_id = safeUuid(updates.department_id);
            if (updates.sub_department_id !== undefined)
                payload.sub_department_id = safeUuid(updates.sub_department_id);
            if (updates.group_type !== undefined)
                payload.group_type = updates.group_type;
            if (updates.sub_group_name !== undefined)
                payload.sub_group_name = updates.sub_group_name;
            if (updates.display_order !== undefined)
                payload.display_order = updates.display_order;
            if (updates.shift_group_id !== undefined)
                payload.shift_group_id = safeUuid(updates.shift_group_id);
            if (updates.shift_subgroup_id !== undefined)
                payload.roster_subgroup_id = safeUuid(updates.shift_subgroup_id);
            if (updates.role_id !== undefined)
                payload.role_id = safeUuid(updates.role_id);
            if (updates.remuneration_level_id !== undefined)
                payload.remuneration_level_id = safeUuid(updates.remuneration_level_id);
            if (updates.shift_date !== undefined) {
                payload.shift_date = updates.shift_date;
                // roster_date handles separately in RPC if shift_date provided
            }
            if (updates.start_time !== undefined)
                payload.start_time = updates.start_time;
            if (updates.end_time !== undefined) payload.end_time = updates.end_time;
            if (updates.paid_break_minutes !== undefined)
                payload.paid_break_minutes = updates.paid_break_minutes;
            if (updates.unpaid_break_minutes !== undefined)
                payload.unpaid_break_minutes = updates.unpaid_break_minutes;
            if (updates.timezone !== undefined) payload.timezone = updates.timezone;
            if (updates.start_at !== undefined) payload.start_at = updates.start_at;
            if (updates.end_at !== undefined) payload.end_at = updates.end_at;
            if (updates.assigned_employee_id !== undefined) {
                payload.assigned_employee_id = safeUuid(updates.assigned_employee_id);
                if (updates.assigned_employee_id) {
                    payload.assignment_source = updates.assignment_source ?? 'manual';
                } else {
                    payload.assignment_source = null;
                }
            }
            if (updates.required_skills !== undefined)
                payload.required_skills = updates.required_skills;
            if (updates.required_licenses !== undefined)
                payload.required_licenses = updates.required_licenses;
            if (updates.event_ids !== undefined)
                payload.event_ids = updates.event_ids;
            if (updates.tags !== undefined) payload.tags = updates.tags;
            if (updates.notes !== undefined) payload.notes = updates.notes;
            if (updates.cancellation_reason !== undefined)
                payload.cancellation_reason = updates.cancellation_reason;

            // 4. Execute DB write — direct UPDATE on shifts table.
            //    The legacy RPC `sm_update_shift` fails because it tries to call
            //     a non-existent `notify_user` function. Direct update bypasses it.
            let query = supabase
                .from('shifts')
                .update({
                    ...payload,
                    updated_at:       new Date().toISOString(),
                    last_modified_by: user.id,
                })
                .eq('id', shiftId);

            if (updates.expectedVersion !== undefined) {
                query = query.eq('version', updates.expectedVersion);
            }

            const { data: updatedRows, error: updateError } = await query.select('id');

            if (updateError) {
                throw new Error(updateError.message);
            }

            if (!updatedRows || updatedRows.length === 0) {
                throw new Error('No rows were updated. The shift may have been modified by another user.');
            }

            const updatedShift = await shiftsQueries.getShiftById(shiftId);
            if (!updatedShift) {
                throw new Error('Shift updated but could not be retrieved');
            }

            return updatedShift;
        }
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
       BULK UNASSIGN SHIFTS
       ============================================================ */

    /**
     * Remove assignment from multiple shifts
     * @param shiftIds Array of shift UUIDs to unassign
     * @returns Array of updated shifts
     */
    async bulkUnassignShifts(shiftIds: string[]): Promise<Shift[]> {
        if (shiftIds.length === 0) return [];

        const user = await requireUser();

        const { data, error } = await supabase
            .from('shifts')
            .update({
                assigned_employee_id: null,
                assigned_at: null,
                last_modified_by: user.id,
                updated_at: new Date().toISOString(),
            })
            .in('id', shiftIds)
            .is('deleted_at', null)
            .select('*');

        if (error) throw error;

        return (data || []) as unknown as Shift[];
    },




    async publishShift(shiftId: string) {
        // Compliance pre-check before publishing
        const shift = await shiftsQueries.getShiftById(shiftId);
        if (shift?.assigned_employee_id && isValidUuid(shift.assigned_employee_id)) {
            const netMinutes =
                calculateMinutesBetweenTimes(shift.start_time, shift.end_time)
                - (shift.unpaid_break_minutes || 0);
            const validation = await complianceService.validateShiftCompliance(
                shift.assigned_employee_id,
                shift.shift_date,
                shift.start_time,
                shift.end_time,
                netMinutes,
                shiftId,
            );
            if (!validation.isValid) {
                throw new ComplianceError(validation.violations, 'sm_publish_shift');
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
        const complianceChecks = await Promise.allSettled(
            shiftIds.map(async (id) => {
                const shift = await shiftsQueries.getShiftById(id);
                // Unassigned shifts: no compliance needed, always pass
                if (!shift?.assigned_employee_id || !isValidUuid(shift.assigned_employee_id)) {
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
                    const rules = validation.violations.map(v => v.rule ?? 'violation').join(', ');
                    return { id, pass: false as const, reason: rules };
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

        // Call RPC only with compliant IDs
        const dbResult = await callAuthenticatedRpc(
            'sm_bulk_publish_shifts',
            (userId) => ({ p_shift_ids: passIds, p_actor_id: userId }),
            BulkPublishResponseSchema,
        );

        const dbFailed: Array<{ id: string; reason: string }> = (dbResult.errors ?? []).map(e => ({
            id: e.shift_id,
            reason: e.reason,
        }));
        const dbFailedSet = new Set(dbFailed.map(f => f.id));
        const publishedIds = passIds.filter(id => !dbFailedSet.has(id));

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
                failed.push({ id: r.id, reason: r.error });
            }
        }

        return { unpublishedIds, failed };
    },

    async unpublishShift(shiftId: string, reason?: string) {
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
            'delete_shift_with_audit',
            (userId) => ({ p_shift_id: shiftId, p_deleted_by: userId, p_reason: 'Manual deletion' }),
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
     * Per-item bulk delete using processInChunks.
     * Returns structured { deletedIds, failed } — caller knows EXACTLY which shifted deleted.
     * Replaces the coarse bulk RPC (which only returned a count) for bulk mode UI.
     */
    async bulkDeleteShiftsPerItem(shiftIds: string[]): Promise<BulkDeletePartialResult> {
        if (!shiftIds || shiftIds.length === 0) return { deletedIds: [], failed: [] };

        const results = await processInChunks(shiftIds, async (id) => {
            await this.deleteShift(id);
            return id;
        });

        const deletedIds: string[] = [];
        const failed: Array<{ id: string; reason: string }> = [];

        for (const r of results) {
            if (r.ok) deletedIds.push(r.id);
            else failed.push({ id: r.id, reason: r.error });
        }

        return { deletedIds, failed };
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
                    const rules = validation.violations.map(v => v.rule ?? 'violation').join(', ');
                    return { id, category: 'compliance_failed' as const, reason: rules };
                }

                return { id, category: 'eligible' as const, reason: '' };
            },
        );

        for (const r of checks) {
            if (!r.ok) {
                complianceFailed.push({ id: r.id, reason: r.error });
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
        //   TTS ≤ 4h → sm_expire_offer_now → draft+unassigned (S1) — bidding window closed,
        //              manager must use emergency assignment
        const { data: shift } = await (supabase as any)
            .from('shifts')
            .select('shift_date, start_time, start_at')
            .eq('id', shiftId)
            .single();

        if (shift) {
            const tts = shift.start_at
                ? new Date(shift.start_at).getTime() - Date.now()
                : new Date(`${shift.shift_date}T${shift.start_time}`).getTime() - Date.now();

            if (tts <= 4 * 60 * 60 * 1000) {
                // Window closed — expire the offer, notify manager for emergency assignment
                return this.expireOfferNow(shiftId);
            }
        }

        return callAuthenticatedRpc(
            'sm_reject_offer',
            (userId) => ({ p_shift_id: shiftId, p_employee_id: userId, p_reason: reason }),
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
