
import { Shift } from '../api/shifts.api';

export type ShiftStateID =
    | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8'
    | 'S9' | 'S10' | 'S11' | 'S12' | 'S13' | 'S14' | 'S15'
    | 'Unknown';

export function determineShiftState(shift: Partial<Shift>): ShiftStateID {
    // S15: Cancelled
    if (shift.lifecycle_status === 'Cancelled' || shift.is_cancelled) return 'S15';

    // Draft States
    if (shift.lifecycle_status === 'Draft') {
        if (shift.assignment_status === 'unassigned') return 'S1';
        if (shift.assignment_status === 'assigned') return 'S2';
    }

    // Published / InProgress / Completed
    const isPublished = shift.lifecycle_status === 'Published';
    const isInProgress = shift.lifecycle_status === 'InProgress';
    const isCompleted = shift.lifecycle_status === 'Completed';

    // Unassigned Flow
    if (shift.assignment_status === 'unassigned') {
        if (shift.bidding_status === 'on_bidding_urgent') return 'S6';
        if (shift.bidding_status === 'bidding_closed_no_winner') return 'S8';
        // Default to S5 for published unassigned (Normal Bidding or just Open)
        if (isPublished) return 'S5';
    }

    // Assigned Flow
    if (shift.assignment_status === 'assigned') {
        // Emergency Assigned
        if (shift.assignment_outcome === 'emergency_assigned') {
            if (isPublished) return 'S7';
            if (isInProgress) return 'S12';
            if (isCompleted) return 'S14';
        }

        // Confirmed
        if (shift.assignment_outcome === 'confirmed') {
            if (isPublished) {
                // Trading
                if (shift.trade_requested_at) return 'S9';
                // S10 would require checking swap status "TradeAccepted" which isn't directly on shift usually, 
                // but if we assume shift.trade_requested_at covers S9, S10 is harder to detect without extra data.
                // For now, return S4 if just confirmed.
                return 'S4';
            }
            if (isInProgress) return 'S11';
            if (isCompleted) return 'S13';
        }

        // Offered
        if (shift.assignment_outcome === 'offered') {
            if (isPublished) return 'S3';
        }
    }

    return 'Unknown';
}

export function getShiftStateDebugString(shift: Partial<Shift>) {
    const stateId = determineShiftState(shift);

    // Helper to format strings (e.g., "on_bidding_urgent" -> "On Bidding Urgent")
    const format = (s?: string | null) => s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '-';

    let outcome = format(shift.assignment_outcome);
    // S2 Invariant: Draft + Assigned = Pending Outcome (derived if null)
    if (stateId === 'S2' && outcome === '-') {
        outcome = 'Pending';
    }

    return {
        id: stateId,
        lifecycle: format(shift.lifecycle_status),
        assignment: format(shift.assignment_status),
        outcome,
        bidding: shift.bidding_status === 'not_on_bidding' ? 'No' : format(shift.bidding_status),
        trading: shift.trade_requested_at ? 'Trade Requested' : 'No'
    };
}
