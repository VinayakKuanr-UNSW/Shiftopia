/**
 * How a manager takes a shift off the roster (docs/design/shift-trading/03-bidding-fsm.md B-D13, B-D14).
 *
 * Drafts are deleted. A published shift — or one in progress — is cancelled
 * instead, which keeps its history; the database refuses the cancel once someone
 * has clocked in. A cancelled or completed shift is final.
 */
export type ShiftRemoval = 'delete' | 'cancel' | null;

interface ShiftRemovalInput {
    lifecycle_status?: string | null;
    is_cancelled?: boolean | null;
}

export function getShiftRemoval(shift: ShiftRemovalInput): ShiftRemoval {
    if (shift.is_cancelled || shift.lifecycle_status === 'Cancelled' || shift.lifecycle_status === 'Completed') {
        return null;
    }
    return shift.lifecycle_status === 'Draft' || !shift.lifecycle_status ? 'delete' : 'cancel';
}
