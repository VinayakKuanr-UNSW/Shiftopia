import { Shift } from '../api/shifts.api';
import { getShiftFSMState, FSM_STATE_META, type ShiftStateID as FSMStateID } from './shift-fsm';

/**
 * Extended ShiftStateID — new canonical IDs from shift-fsm.ts, plus legacy IDs
 * kept for backward compatibility so existing type-checks in callers compile.
 *
 * S6, S7, S8, S12, S14 are NEVER returned by determineShiftState anymore.
 * Code that branches on them is dead — remove when convenient.
 */
export type ShiftStateID =
    | FSMStateID          // S1 S2 S3 S4 S5 S9 S10 S11 S13 S15
    | 'S6' | 'S7' | 'S8' | 'S12' | 'S14'   // legacy — never returned
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

export function getShiftStateDebugString(shift: Partial<Shift>) {
    const stateId = determineShiftState(shift);

    const format = (s?: string | null) =>
        s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '-';

    const meta = stateId !== 'Unknown' && stateId in FSM_STATE_META
        ? FSM_STATE_META[stateId as FSMStateID]
        : null;

    return {
        id:        stateId,
        label:     meta?.label ?? stateId,
        lifecycle: format(shift.lifecycle_status),
        assignment: format(shift.assignment_status),
        outcome:   format(shift.assignment_outcome),
        trading:   shift.trading_status && shift.trading_status !== 'NoTrade'
                       ? format(shift.trading_status)
                       : 'No',
    };
}
