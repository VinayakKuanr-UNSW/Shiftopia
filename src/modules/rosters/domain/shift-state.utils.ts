import { Shift } from '../api/shifts.api';
import { getShiftFSMState, type ShiftStateID as FSMStateID } from './shift-fsm';

/**
 * The canonical IDs from shift-fsm.ts, plus 'Unknown' for a row too partial to read.
 */
export type ShiftStateID =
    | FSMStateID          // S1 S2 S3 S4 S5 S9 S10 S11 S13 S15
    | 'Unknown';

/**
 * Derive the FSM state of a (possibly partial) shift.
 *
 * Delegates to the canonical getShiftFSMState() from shift-fsm.ts.
 * Returns 'Unknown' for incomplete or invalid data instead of throwing,
 * so callers that receive partial rows from queries don't crash.
 */
export function determineShiftState(shift: Partial<Shift>): ShiftStateID {
    try {
        return getShiftFSMState({
            lifecycle_status:   shift.lifecycle_status  ?? '',
            assignment_status:  shift.assignment_status ?? 'unassigned',
            assignment_outcome: shift.assignment_outcome ?? null,
            trading_status:     shift.trading_status    ?? null,
            is_cancelled:       shift.is_cancelled      ?? false,
        });
    } catch {
        return 'Unknown';
    }
}
