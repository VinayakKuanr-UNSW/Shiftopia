import { supabase } from '@/platform/realtime/client';
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
    BulkPublishResponse,
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

export const shiftsCommands = {
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
                payload.shift_subgroup_id = safeUuid(updates.shift_subgroup_id);
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
            if (updates.assigned_employee_id !== undefined) {
                payload.assigned_employee_id = safeUuid(updates.assigned_employee_id);

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

            const success = await callRpc('sm_update_shift', {
                p_shift_id: shiftId,
                p_shift_data: payload,
                p_user_id: user.id,
            }, UpdateShiftResponseSchema);

            if (!success) {
                throw new Error('Shift update failed in database');
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

    async bulkPublishShifts(shiftIds: string[]): Promise<BulkPublishResponse> {
        return callAuthenticatedRpc(
            'sm_bulk_publish_shifts',
            (userId) => ({ p_shift_ids: shiftIds, p_actor_id: userId }),
            BulkPublishResponseSchema,
        );
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
       AUDIT LOG METHODS
       ============================================================ */

    async addAuditLogEntry(
        shiftId: string,
        action: string,
        fieldName?: string,
        oldValue?: string,
        newValue?: string,
        reason?: string,
    ): Promise<void> {
        // Fire-and-forget: never let audit logging block the caller
        if (!isValidUuid(shiftId)) return;

        try {
            const user = await requireUser();

            await supabase.from('shift_audit_events').insert({
                shift_id: shiftId,
                event_type: action,
                event_category: 'MANUAL_LOG',
                field_changed: fieldName ?? null,
                old_value: oldValue ?? null,
                new_value: newValue ?? null,
                metadata: reason ? { reason } : null,
                performed_by_id: user.id,
                performed_by_name: user.email ?? 'System',
                performed_by_role: 'system',
            });
        } catch (error) {
            console.error('[shifts.commands] addAuditLogEntry silenced:', error);
        }
    },

    /* ============================================================
       DELETE SHIFT
       ============================================================ */

    async deleteShift(shiftId: string): Promise<boolean> {
        if (!shiftId || !isValidUuid(shiftId)) return false;

        return callAuthenticatedRpc(
            'delete_shift_with_audit',
            (userId) => ({ p_shift_id: shiftId, p_deleted_by: userId, p_reason: 'Manual deletion' }),
            DeleteShiftResponseSchema,
        );
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
        return callAuthenticatedRpc(
            'sm_reject_offer',
            (userId) => ({ p_shift_id: shiftId, p_employee_id: userId, p_reason: reason }),
            OfferActionResponseSchema,
        );
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
