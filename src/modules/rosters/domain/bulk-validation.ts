/**
 * Bulk Action Validation Layer
 * 
 * Centralized validation for all bulk shift operations.
 * All bulk actions are atomic - if any shift fails validation, the entire action is blocked.
 */

import type { Shift } from '../api/shifts.api';
import { differenceInMinutes } from 'date-fns';

// ============================================================
// TYPES
// ============================================================

export interface BulkValidationResult {
    canProceed: boolean;
    blockedV8ShiftIds: string[];
    blockedCount: number;
    errorMessage: string | null;
}

// ============================================================
// VALIDATION FUNCTIONS
// ============================================================

/**
 * Validate Assign All action
 * 
 * Rules:
 * - Cannot assign shifts that are in Bidding state
 * - Cannot assign shifts that are Cancelled
 * - Cannot assign shifts that are already assigned to ANY employee
 */
export function validateAssignAll(
    shifts: Shift[],
    targetEmployeeId?: string
): BulkValidationResult {
    const blockedV8ShiftIds: string[] = [];
    const alreadyAssignedV8ShiftIds: string[] = [];

    for (const shift of shifts) {
        // Block if in bidding
        if (shift.bidding_status !== 'not_on_bidding') {
            blockedV8ShiftIds.push(shift.id);
            continue;
        }

        // Block if cancelled
        if (shift.is_cancelled) {
            blockedV8ShiftIds.push(shift.id);
            continue;
        }

        // NEW: Block if already assigned (to anyone)
        if (shift.assigned_employee_id) {
            alreadyAssignedV8ShiftIds.push(shift.id);
            continue;
        }
    }

    // Combine both types of blocked shifts
    const allBlockedIds = [...blockedV8ShiftIds, ...alreadyAssignedV8ShiftIds];

    if (allBlockedIds.length > 0) {
        const biddingCount = shifts.filter(s => s.bidding_status !== 'not_on_bidding' && blockedV8ShiftIds.includes(s.id)).length;
        const cancelledCount = shifts.filter(s => s.is_cancelled && blockedV8ShiftIds.includes(s.id)).length;
        const assignedCount = alreadyAssignedV8ShiftIds.length;

        let message = '';

        if (assignedCount > 0) {
            message = `${assignedCount} shift(s) are already assigned. Please deselect them before using Assign All.`;
        } else {
            message = `${allBlockedIds.length} selected shift(s) cannot be assigned.`;
            if (biddingCount > 0) {
                message += ` ${biddingCount} are in bidding.`;
            }
            if (cancelledCount > 0) {
                message += ` ${cancelledCount} are cancelled.`;
            }
            message += ' Remove them from bidding or selection before assigning.';
        }

        return {
            canProceed: false,
            blockedV8ShiftIds: allBlockedIds,
            blockedCount: allBlockedIds.length,
            errorMessage: message,
        };
    }

    return {
        canProceed: true,
        blockedV8ShiftIds: [],
        blockedCount: 0,
        errorMessage: null,
    };
}

/**
 * Validate Unassign All action
 * 
 * Rules:
 * - Cannot unassign shifts that are in Bidding state
 * - Cannot unassign shifts that are Cancelled
 * - Shifts already unassigned are ignored (not blocked)
 */
export function validateUnassignAll(shifts: Shift[]): BulkValidationResult {
    const blockedV8ShiftIds: string[] = [];

    for (const shift of shifts) {
        // Block if in bidding
        if (shift.bidding_status !== 'not_on_bidding') {
            blockedV8ShiftIds.push(shift.id);
            continue;
        }

        // Block if cancelled
        if (shift.is_cancelled) {
            blockedV8ShiftIds.push(shift.id);
            continue;
        }

        // Already unassigned is ignored at execution time
    }

    if (blockedV8ShiftIds.length > 0) {
        return {
            canProceed: false,
            blockedV8ShiftIds,
            blockedCount: blockedV8ShiftIds.length,
            errorMessage: `${blockedV8ShiftIds.length} selected shift(s) are in bidding or cancelled and cannot be unassigned.`,
        };
    }

    return {
        canProceed: true,
        blockedV8ShiftIds: [],
        blockedCount: 0,
        errorMessage: null,
    };
}

/**
 * Validate Push to Bidding action
 * 
 * Rules:
 * - Cannot push shifts that are already in Bidding
 * - Cannot push shifts that are Assigned
 * - Cannot push shifts that are Cancelled
 */


// ============================================================
// HELPER: Get allowed actions for a selection
// ============================================================

export interface AllowedActions {
    canAssign: boolean;
    canUnassign: boolean;
    canPublish: boolean;
    canUnpublish: boolean;
    canDelete: boolean;
}

/**
 * Determine which bulk actions are available for the current selection.
 * Used to dynamically show/hide or enable/disable toolbar buttons.
 */
export function getAllowedActions(shifts: Shift[]): AllowedActions {
    if (shifts.length === 0) {
        return {
            canAssign: false,
            canUnassign: false,
            canPublish: false,
            canUnpublish: false,
            canDelete: false,
        };
    }

    const hasAssigned = shifts.some(s => !!s.assigned_employee_id);
    const hasBidding = shifts.some(s => s.bidding_status !== 'not_on_bidding');
    const hasCancelled = shifts.some(s => !!s.is_cancelled);
    const hasDraft = shifts.some(s => s.lifecycle_status === 'Draft' || s.is_draft);
    const hasPublished = shifts.some(s => s.lifecycle_status === 'Published');

    return {
        // Can assign if NO shifts are in bidding or cancelled
        canAssign: !hasBidding && !hasCancelled,

        // Can unassign if there are assigned shifts and NO shifts are in bidding
        canUnassign: hasAssigned && !hasBidding && !hasCancelled,

        // Can publish if there are draft shifts (partial — compliance checked per-shift)
        canPublish: hasDraft && !hasCancelled,

        // Can unpublish if any published shifts exist
        canUnpublish: hasPublished,

        // Delete is always available (with confirmation)
        canDelete: true,
    };
}
