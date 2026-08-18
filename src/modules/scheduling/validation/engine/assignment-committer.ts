/**
 * AssignmentCommitter — Atomically assigns passing shifts via Supabase RPC.
 *
 * Commit path:
 *
 *   commitAtomic(assignments, idempotencyKey?)
 *     Multi-employee atomic path. Calls sm_bulk_assign_atomic for N pairs in a
 *     single DB transaction. Used by AutoSchedulerController.commit() to ensure
 *     all employees are written atomically or rolled back together.
 *
 * The committer receives only the shift IDs that passed all validation.
 */

import { shiftsCommands } from '@/modules/rosters/api/shifts.commands';
import type { BulkAssignAtomicResponse } from '@/modules/rosters/api/contracts';

export interface AtomicCommitResult {
    success: boolean;
    totalCommitted: number;
    /** Shift IDs that were not applied because another employee now holds them. */
    concurrencyConflicts: string[];
    /** Employee IDs whose entire commit set produced zero committed shifts. */
    failedEmployees: string[];
    perEmployee: Array<{ employeeId: string; committed: number; conflicts: string[] }>;
    message?: string;
}

export class AssignmentCommitter {

    /**
     * Multi-employee atomic assign (AutoScheduler path).
     *
     * Sends all (employee → shifts[]) pairs to sm_bulk_assign_atomic in a single
     * RPC call which runs inside one implicit plpgsql transaction. Either ALL
     * qualifying rows are written (shifts that pass the lost-update guard) or on
     * a hard DB error NONE are. Shifts held by a different employee are returned
     * as concurrency conflicts, not errors.
     *
     * @param assignments     Pairs to commit.
     * @param idempotencyKey  If supplied and already stored, the cached result is
     *                        returned without re-executing any UPDATEs.
     */
    async commitAtomic(
        assignments: { employeeId: string; shiftIds: string[] }[],
        idempotencyKey?: string,
    ): Promise<AtomicCommitResult> {
        if (assignments.length === 0) {
            return {
                success: true,
                totalCommitted: 0,
                concurrencyConflicts: [],
                failedEmployees: [],
                perEmployee: [],
                message: 'No assignments to commit',
            };
        }

        console.debug(
            '[AssignmentCommitter] Atomic commit: %d employees, key=%s',
            assignments.length,
            idempotencyKey ?? 'none',
        );

        let response: BulkAssignAtomicResponse;
        try {
            response = await shiftsCommands.bulkAssignShiftsAtomic(assignments, idempotencyKey);
        } catch (err: any) {
            console.error('[AssignmentCommitter] Atomic RPC error:', err);
            return {
                success: false,
                totalCommitted: 0,
                concurrencyConflicts: [],
                failedEmployees: assignments.map(a => a.employeeId),
                perEmployee: [],
                message: err?.message ?? 'Unknown error during atomic bulk assign',
            };
        }

        if (!response.success) {
            return {
                success: false,
                totalCommitted: 0,
                concurrencyConflicts: response.conflicts ?? [],
                failedEmployees: assignments.map(a => a.employeeId),
                perEmployee: [],
                message: response.error ?? 'Atomic bulk assign RPC returned failure',
            };
        }

        const perEmployee = (response.per_employee ?? []).map(pe => ({
            employeeId: pe.employee_id,
            committed: pe.committed,
            conflicts: pe.conflicts,
        }));

        // An employee "failed" if they had shifts in the request but zero were committed.
        const failedEmployees = perEmployee
            .filter(pe => pe.committed === 0)
            .map(pe => pe.employeeId);

        const concurrencyConflicts = response.conflicts ?? [];

        console.debug('[AssignmentCommitter] Atomic commit result:', {
            success_count: response.success_count,
            conflict_count: response.conflict_count,
            failedEmployees,
        });

        // NOTE: fairness-ledger write-back is done by the caller
        // (AutoSchedulerController.commit), which owns the org ID + shift dates.
        return {
            success: true,
            totalCommitted: response.success_count ?? 0,
            concurrencyConflicts,
            failedEmployees,
            perEmployee,
            message: `Committed ${response.success_count ?? 0} shifts`,
        };
    }
}

export const assignmentCommitter = new AssignmentCommitter();
