/**
 * AssignmentCommitter — Atomically assigns passing shifts via Supabase RPC.
 *
 * Calls the existing `sm_bulk_assign` RPC which assigns all shifts in a
 * single DB transaction (BEGIN/COMMIT with rollback on error).
 *
 * The committer receives only the shift IDs that passed all validation —
 * the controller decides which IDs to pass based on the selected mode.
 */

import { shiftsCommands } from '@/modules/rosters/api/shifts.commands';
import type { BulkAssignResponse } from '@/modules/rosters/api/contracts';

export interface CommitResult {
    success: boolean;
    committed: string[];
    failed: string[];
    message?: string;
}

export class AssignmentCommitter {
    /**
     * Atomically assign all `shiftIds` to `employeeId`.
     *
     * @param shiftIds   - IDs of shifts that passed validation
     * @param employeeId - Target employee
     */
    async commit(shiftIds: string[], employeeId: string): Promise<CommitResult> {
        if (shiftIds.length === 0) {
            return { success: true, committed: [], failed: [], message: 'No shifts to commit' };
        }

        console.debug('[BulkAssignmentCommitter] Committing', shiftIds.length, 'shifts to', employeeId);

        try {
            const response: BulkAssignResponse = await shiftsCommands.bulkAssignShifts(
                employeeId,
                shiftIds,
            );

            console.debug('[BulkAssignmentCommitter] RPC result:', response);

            if (response.success) {
                return {
                    success: true,
                    committed: shiftIds,
                    failed: [],
                    message: response.message,
                };
            } else {
                return {
                    success: false,
                    committed: [],
                    failed: shiftIds,
                    message: response.message ?? 'Bulk assign RPC returned failure',
                };
            }
        } catch (err: any) {
            console.error('[BulkAssignmentCommitter] RPC error:', err);
            return {
                success: false,
                committed: [],
                failed: shiftIds,
                message: err?.message ?? 'Unknown error during bulk assign',
            };
        }
    }
}

export const assignmentCommitter = new AssignmentCommitter();
