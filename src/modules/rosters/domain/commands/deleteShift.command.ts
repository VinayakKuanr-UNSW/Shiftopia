/**
 * Delete Shift Command
 * Domain layer - orchestrates shift deletion
 */

import { shiftsRepo } from '@/modules/rosters/infra/shifts.repo';

export interface DeleteShiftInput {
    shiftId: string;
}

export interface DeleteShiftOutput {
    success: boolean;
    error?: string;
}

/**
 * Execute delete shift command
 */
export async function executeDeleteShift(
    input: DeleteShiftInput
): Promise<DeleteShiftOutput> {
    const { shiftId } = input;

    if (!shiftId) {
        return { success: false, error: 'Shift ID is required' };
    }

    const result = await shiftsRepo.deleteShift(shiftId);

    return result;
}

/**
 * Execute bulk delete shifts command
 */
export async function executeBulkDeleteShifts(
    shiftIds: string[]
): Promise<DeleteShiftOutput> {
    if (!shiftIds.length) {
        return { success: false, error: 'No shifts selected' };
    }

    const result = await shiftsRepo.bulkDeleteShifts(shiftIds);

    return result;
}
