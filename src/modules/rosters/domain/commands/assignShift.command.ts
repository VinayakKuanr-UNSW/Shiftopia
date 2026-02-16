/**
 * Assign Shift Command
 * Domain layer - assigns/unassigns employee to shift
 */

import { supabase } from '@/platform/realtime/client';

export interface AssignShiftInput {
    shiftId: string;
    employeeId: string | null;
}

export interface AssignShiftOutput {
    success: boolean;
    error?: string;
}

/**
 * Execute assign shift command
 */
export async function executeAssignShift(
    input: AssignShiftInput
): Promise<AssignShiftOutput> {
    const { shiftId, employeeId } = input;

    if (!shiftId) {
        return { success: false, error: 'Shift ID is required' };
    }

    // V3 MIGRATION: Check state to decide RPC
    try {
        // 1. Fetch shift state
        const { data: shift, error: fetchError } = await supabase
            .from('shifts')
            .select('lifecycle_status, is_published')
            .eq('id', shiftId)
            .single();

        if (fetchError) throw fetchError;

        let rpcName = 'assign_employee_to_shift'; // Default for Draft
        let params: any = {
            p_roster_shift_id: shiftId, // Legacy param name for draft
            p_employee_id: employeeId,
            p_user_id: (await supabase.auth.getUser()).data.user?.id
        };

        // 2. If Published, use Emergency Assign (Manager Override)
        if (shift.is_published || shift.lifecycle_status === 'Published') {
            rpcName = 'sm_emergency_assign';
            params = {
                p_shift_id: shiftId,
                p_employee_id: employeeId,
                p_user_id: (await supabase.auth.getUser()).data.user?.id,
                p_reason: 'Manual assignment override'
            };
        }

        // 3. Execute
        const { data, error } = await supabase.rpc(rpcName as any, params);

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || 'Unknown error' };
    }
}

/**
 * Execute unassign shift command
 */
export async function executeUnassignShift(
    shiftId: string
): Promise<AssignShiftOutput> {
    return executeAssignShift({ shiftId, employeeId: null });
}
