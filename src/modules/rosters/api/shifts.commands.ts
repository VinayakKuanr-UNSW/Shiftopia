import { supabase } from '@/platform/realtime/client';
import { Shift, isValidUuid, safeUuid, calculateMinutesBetweenTimes } from '../domain/shift.entity';
import { CreateShiftData, UpdateShiftData } from './shifts.dto';
import { complianceService } from '../services/compliance.service';
import { shiftsQueries } from './shifts.queries';

export const shiftsCommands = {
    /* ============================================================
       CREATE SHIFT
       ============================================================ */

    async createShift(shiftData: CreateShiftData): Promise<Shift> {
        try {
            const {
                data: { user },
            } = await supabase.auth.getUser();

            // Validate compliance if employee assigned
            if (
                shiftData.assigned_employee_id &&
                isValidUuid(shiftData.assigned_employee_id)
            ) {
                const netMinutes =
                    calculateMinutesBetweenTimes(
                        shiftData.start_time,
                        shiftData.end_time
                    ) - (shiftData.unpaid_break_minutes || 0);

                const validation = await complianceService.validateShiftCompliance(
                    shiftData.assigned_employee_id,
                    shiftData.shift_date,
                    shiftData.start_time,
                    shiftData.end_time,
                    netMinutes
                );

                if (!validation.isValid) {
                    throw new Error(validation.violations.join('. '));
                }
            }

            const payload: Record<string, any> = {
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
                break_minutes:
                    (shiftData.paid_break_minutes || 0) +
                    (shiftData.unpaid_break_minutes || 0),
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
                created_by_user_id: user?.id || null,
            };

            console.log('Creating shift via RPC with payload:', payload);

            const { data, error } = await supabase.rpc('sm_create_shift', {
                p_shift_data: payload,
                p_user_id: user?.id || '00000000-0000-0000-0000-000000000000', // Fallback if no user, though auth should prevent this
            });

            if (error) {
                console.error('Shift creation error:', error);
                throw error;
            }

            console.log('Shift created successfully:', data);
            return data as unknown as Shift;
        } catch (error) {
            console.error('Error in createShift:', error);
            throw error;
        }
    },

    /* ============================================================
       UPDATE SHIFT
       ============================================================ */

    async updateShift(shiftId: string, updates: UpdateShiftData): Promise<Shift> {
        try {
            const {
                data: { user },
            } = await supabase.auth.getUser();

            const payload: Record<string, any> = {};
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

            // RPC handles break_minutes calculation if paid/unpaid are passed

            console.log('Updating shift via RPC:', shiftId, payload);

            const { data, error } = await supabase.rpc('sm_update_shift', {
                p_shift_id: shiftId,
                p_shift_data: payload,
                p_user_id: user?.id || '00000000-0000-0000-0000-000000000000',
            });

            if (error) throw error;
            return data as unknown as Shift;
        } catch (error) {
            console.error('Error in updateShift:', error);
            throw error;
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
    async bulkAssignShifts(employeeId: string, shiftIds: string[]): Promise<{
        success: boolean;
        total_requested: number;
        success_count: number;
        failure_count: number;
        message?: string;
    }> {
        if (!employeeId || !isValidUuid(employeeId)) {
            throw new Error('Invalid employee ID');
        }
        if (shiftIds.length === 0) {
            return { success: true, total_requested: 0, success_count: 0, failure_count: 0, message: 'No shifts selected' };
        }

        console.log('[shiftsApi] bulkAssignShifts (RPC):', { employeeId, count: shiftIds.length });

        try {
            const { data: { user } } = await supabase.auth.getUser();

            // Use the new set-based RPC
            // Cast to any to bypass type check for updated RPC signature/return
            const { data, error } = await supabase.rpc('sm_bulk_assign' as any, {
                p_shift_ids: shiftIds,
                p_employee_id: employeeId,
                p_user_id: user?.id
            });

            if (error) {
                console.error('[shiftsApi] Bulk assign RPC failed:', error);
                throw error;
            }

            const result = data as any;
            console.log('[shiftsApi] Bulk assign success:', result.success_count, 'shifts assigned');
            return result;
        } catch (error) {
            console.error('Error bulk assigning shifts:', error);
            throw error;
        }
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
        if (shiftIds.length === 0) {
            return [];
        }

        console.log('[shiftsApi] bulkUnassignShifts:', { shiftIds });

        try {
            const {
                data: { user },
            } = await supabase.auth.getUser();

            const { data, error } = await supabase
                .from('shifts')
                .update({
                    assigned_employee_id: null,
                    assigned_at: null,

                    last_modified_by: user?.id || null,
                    updated_at: new Date().toISOString(),
                })
                .in('id', shiftIds)
                .is('deleted_at', null)
                .select('*');

            if (error) {
                console.error('[shiftsApi] bulkUnassignShifts error:', error);
                throw error;
            }

            console.log('[shiftsApi] bulkUnassignShifts success:', data?.length, 'shifts updated');
            return (data || []) as unknown as Shift[];
        } catch (error) {
            console.error('Error in bulkUnassignShifts:', error);
            throw error;
        }
    },




    async publishShift(shiftId: string): Promise<{ success: boolean; new_status: string }> {
        try {
            // Updated to use State Machine v2 RPC
            const { data: { user } } = await supabase.auth.getUser();
            const { data, error } = await supabase.rpc('sm_publish_shift', {
                p_shift_id: shiftId,
                p_user_id: user?.id
            });

            if (error) throw error;
            return data as { success: boolean; new_status: string };
        } catch (error) {
            console.error('Error publishing shift:', error);
            throw error;
        }
    },

    async bulkPublishShifts(shiftIds: string[]): Promise<{
        success: boolean;
        total_requested: number;
        success_count: number;
        failure_count: number;
        message?: string;
    }> {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const { data, error } = await supabase.rpc('sm_bulk_publish_shifts', {
                p_shift_ids: shiftIds,
                p_actor_id: user?.id
            });

            if (error) throw error;
            return data as any;
        } catch (error) {
            console.error('Error bulk publishing shifts:', error);
            throw error;
        }
    },

    /* ============================================================
       ATTENDANCE
       ============================================================ */

    async checkIn(shiftId: string, location?: { lat: number; lon: number }): Promise<void> {
        try {
            const { error } = await supabase.rpc('check_in_shift', {
                p_shift_id: shiftId,
                p_lat: location?.lat,
                p_lon: location?.lon
            });
            if (error) throw error;
        } catch (error) {
            console.error('Error checking in:', error);
            throw error;
        }
    },



    async withdrawShiftFromBidding(shiftId: string): Promise<{ success: boolean; new_status: string }> {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const { data, error } = await supabase.rpc('sm_close_bidding', {
                p_shift_id: shiftId,
                p_user_id: user?.id,
                p_reason: 'User declined offer'
            });

            if (error) throw error;
            return data as { success: boolean; new_status: string };
        } catch (error) {
            console.error('Error declining offer:', error);
            throw error;
        }
    },

    /* ============================================================
       CANCEL SHIFT
       ============================================================ */

    /**
     * Cancel a shift (employee initiated)
     * Triggers the cancel_shift RPC which handles bidding logic
     */
    async cancelShift(shiftId: string, reason: string): Promise<any> {
        console.log('[shiftsApi] calling sm_manager_cancel RPC', { shiftId, reason });
        const { data: { user } } = await supabase.auth.getUser();
        const { data, error } = await supabase.rpc('sm_manager_cancel', {
            p_shift_id: shiftId,
            p_reason: reason,
            p_user_id: user?.id
        });

        if (error) {
            console.error('[shiftsApi] RPC Error:', error);
            throw error;
        }
        console.log('[shiftsApi] RPC Success:', data);
        return data;
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
        reason?: string
    ): Promise<void> {
        try {
            if (!isValidUuid(shiftId)) {
                return;
            }

            const {
                data: { user },
            } = await supabase.auth.getUser();

            await supabase.from('shift_audit_events').insert({
                shift_id: shiftId,
                event_type: action,
                event_category: 'MANUAL_LOG',
                field_changed: fieldName,
                old_value: oldValue,
                new_value: newValue,
                metadata: reason ? { reason } : null,
                performed_by_id: user?.id || null,
                performed_by_name: user?.email || 'System',
                performed_by_role: 'system', // Default since we don't have role handy
            });
        } catch (error) {
            console.error('Error adding audit log entry:', error);
        }
    },

    /* ============================================================
       DELETE SHIFT
       ============================================================ */

    async deleteShift(shiftId: string): Promise<boolean> {
        if (!shiftId || !isValidUuid(shiftId)) {
            console.error('[shifts.api] Invalid shift ID for deletion:', shiftId);
            return false;
        }

        // Use valid RPC function for deletion (bypasses RLS)
        // 'delete_shift_with_audit' returns boolean
        const { data, error } = await supabase
            .rpc('delete_shift_with_audit', {
                p_shift_id: shiftId,
                p_deleted_by: (await supabase.auth.getUser()).data.user?.id,
                p_reason: 'Manual deletion'
            });

        if (error) {
            console.error('[shifts.api] Failed to delete shift via RPC:', error);
            throw new Error(error?.message || 'Failed to delete shift');
        }

        // RPC returns true/false
        if (data === false) {
            console.error('[shifts.api] RPC returned false (shift not found or already deleted)');
            return false;
        }

        console.log('[shifts.api] Shift deleted successfully via RPC:', shiftId);
        return true;
    },

    /* ============================================================
       BULK DELETE SHIFTS
       ============================================================ */

    async bulkDeleteShifts(shiftIds: string[]): Promise<number> {
        if (!shiftIds || shiftIds.length === 0) return 0;

        console.log(`[shifts.api] Bulk deleting ${shiftIds.length} shifts via set-based RPC...`);

        try {
            const { data: { user } } = await supabase.auth.getUser();

            // Use the new set-based RPC
            // Cast to any because generated types are not updated
            const { data, error } = await supabase.rpc('sm_bulk_delete_shifts' as any, {
                p_shift_ids: shiftIds,
                p_deleted_by: user?.id,
                p_reason: 'Bulk manual deletion'
            });

            if (error) {
                console.error('[shifts.api] Bulk delete RPC failed:', error);
                // Return 0 so UI knows nothing happened, or throw if we want to block
                // For now, let's throw to allow UI to show specific error if needed
                throw error;
            }

            // data = { success: true, total_requested: N, success_count: M }
            const result = data as { success: boolean; success_count: number; error?: string };

            if (!result.success) {
                console.error('[shifts.api] Bulk delete RPC returned failure:', result.error);
                throw new Error(result.error);
            }

            console.log(`[shifts.api] Bulk delete success: ${result.success_count} / ${shiftIds.length}`);
            return result.success_count;
        } catch (error) {
            console.error('[shifts.api] Error in bulkDeleteShifts:', error);
            // Return 0 or rethrow. The UI expects a number (success count).
            // If we throw, the UI shows "Unexpected error". 
            // If we return 0, the UI shows "No shifts deleted".
            // Let's rethrow to signal a system error vs just "no rows found".
            throw error;
        }
    },

    /* ============================================================
       DELETE SHIFTS BY TEMPLATE
       ============================================================ */

    async deleteShiftsByTemplateId(templateId: string): Promise<number> {
        if (!templateId || !isValidUuid(templateId)) {
            console.error('[shifts.api] Invalid template ID for deletion:', templateId);
            return 0;
        }

        // First count how many shifts we're deleting
        const { count } = await (supabase as any)
            .from('shifts')
            .select('*', { count: 'exact', head: true })
            .eq('template_id', templateId);

        // Delete all shifts with this template_id
        const { error } = await supabase
            .from('shifts')
            .delete()
            .eq('template_id', templateId);

        if (error) {
            console.error('[shifts.api] Failed to delete shifts by template:', error);
            throw new Error(error.message);
        }

        console.log(`[shifts.api] Deleted ${count || 0} shifts for template:`, templateId);
        return count || 0;
    },

    /* ============================================================
       EMPLOYEE ACTIONS (V3)
       ============================================================ */

    async requestTrade(shiftId: string): Promise<{ success: boolean; trade_id: string }> {
        const { data, error } = await supabase.rpc('sm_request_trade', {
            p_shift_id: shiftId,
            p_target_employee_id: null // Open trade
        });
        if (error) throw error;
        return data as { success: boolean; trade_id: string };
    },

    async acceptOffer(shiftId: string): Promise<{ success: boolean; message: string }> {
        const { data: { user } } = await supabase.auth.getUser();

        // Try RPC first
        const { data, error } = await supabase.rpc('sm_accept_offer', {
            p_shift_id: shiftId,
            p_user_id: user?.id
        });

        if (error) {
            // Fallback to straight update if RPC fails not found (backwards compat)
            // But ideally we want to throw if RPC exists but fails logic
            throw error;
        }
        return data as { success: boolean; message: string };
    },

    async rejectOffer(shiftId: string, reason: string): Promise<{ success: boolean; message: string }> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { data, error } = await supabase.rpc('sm_reject_offer', {
            p_shift_id: shiftId,
            p_employee_id: user.id,
            p_reason: reason
        });
        if (error) throw error;
        return data as { success: boolean; message: string };
    },

    /**
     * Employee drops an assigned shift (pushes to bidding based on time-to-start rules)
     * - >24h before start: on_bidding_normal (S5)
     * - 4-24h before start: on_bidding_urgent (S6)
     * - <4h before start: Blocked
     */
    async employeeDropShift(shiftId: string, reason?: string): Promise<{
        success: boolean;
        new_bidding_status?: string;
        hours_to_start?: number;
        message?: string;
        error?: string;
    }> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { data, error } = await (supabase.rpc as any)('sm_employee_drop_shift', {
            p_shift_id: shiftId,
            p_employee_id: user.id,
            p_reason: reason || 'Employee dropped shift'
        });

        if (error) {
            console.error('[shiftsCommands] sm_employee_drop_shift error:', error);
            throw error;
        }

        // Check for business logic error from RPC (e.g., 4-hour lock)
        if (data && data.success === false) {
            console.error('[shiftsCommands] Drop rejected by RPC:', data.error);
            throw new Error(data.error);
        }

        console.log('[shiftsCommands] employeeDropShift result:', data);
        return data as any;
    },
};
