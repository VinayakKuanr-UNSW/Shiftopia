/**
 * Shift FSM — State Derivation Utility
 *
 * Single source of truth for deriving the logical FSM state of a shift from
 * its 5 DB columns. This mirrors the PL/pgSQL `get_shift_fsm_state()` function
 * exactly — any change here must be reflected there, and vice versa.
 *
 * Inputs:  lifecycle_status, assignment_status, assignment_outcome,
 *          trading_status, is_cancelled
 * Output:  ShiftStateID  ('S1' … 'S15')
 *
 * Priority order (hard-coded, must not change):
 *   Cancelled > Completed > InProgress > Published > Draft
 */

// ─── State ID ────────────────────────────────────────────────────────────────

export type ShiftStateID =
    | 'S1'      // Draft – Unassigned
    | 'S2'      // Draft – Assigned
    | 'S3'      // Published – Offered   (assigned + outcome = null)
    | 'S4'      // Published – Confirmed
    | 'S5'      // Published – Bidding   (unassigned)
    | 'S9'      // Published – Trade Requested (Pending Peer)   — display: S6
    | 'S10'     // Published – Trade Requested (Pending Manager) — display: S7
    | 'S11'     // In Progress
    | 'S13'     // Completed
    | 'S15'     // Cancelled
    | 'UNKNOWN'; // Stale/unrecognized DB combination — renders as neutral fallback

// ─── Input shape ─────────────────────────────────────────────────────────────

export interface ShiftFSMInput {
    lifecycle_status: string;
    assignment_status: string;
    assignment_outcome: string | null | undefined;
    trading_status: string | null | undefined;
    is_cancelled: boolean;
}

// ─── State metadata ───────────────────────────────────────────────────────────

export interface ShiftFSMStateInfo {
    /**
     * Canonical state ID. This is a stable TS↔PL/pgSQL contract — DB transition
     * guards (`sm_*`, `publish_shift`) branch on these exact strings returned by
     * `get_shift_fsm_state()`. NEVER renumber it. For the user-facing badge use
     * {@link ShiftFSMStateInfo.displayId} instead.
     */
    id: ShiftStateID;
    /**
     * Gapless, user-facing ID shown on cards (S1…S10). The deprecated tombstone
     * states (old S6/S7/S8/S12/S14) left holes in the canonical numbering, so the
     * UI collapses the survivors back to a clean sequence. Display-only — keep all
     * logic, tests, and DB on `id`.
     */
    displayId: string;
    label: string;
    description: string;
    /** Tailwind colour token — use with bg-/text-/border- prefixes */
    color: 'slate' | 'blue' | 'violet' | 'emerald' | 'amber' | 'orange' | 'red' | 'gray';
}

export const FSM_STATE_META: Record<ShiftStateID, ShiftFSMStateInfo> = {
    S1:  { id: 'S1',  displayId: 'S1',  label: 'Draft',             description: 'Created, not yet assigned or published',    color: 'slate'   },
    S2:  { id: 'S2',  displayId: 'S2',  label: 'Draft (Assigned)',   description: 'Assigned in draft — not yet published',     color: 'slate'   },
    S3:  { id: 'S3',  displayId: 'S3',  label: 'Offered',            description: 'Published and offered to an employee',      color: 'blue'    },
    S4:  { id: 'S4',  displayId: 'S4',  label: 'Confirmed',          description: 'Assignment accepted and confirmed',         color: 'emerald' },
    S5:  { id: 'S5',  displayId: 'S5',  label: 'Bidding',            description: 'Open for employee bids',                    color: 'violet'  },
    S9:  { id: 'S9',  displayId: 'S6',  label: 'Trade Requested (Pending Peer)',    description: 'Employee has requested a trade — awaiting a peer to accept',  color: 'amber'   },
    S10: { id: 'S10', displayId: 'S7',  label: 'Trade Requested (Pending Manager)', description: 'Trade accepted by a peer — awaiting manager approval',        color: 'orange'  },
    S11: { id: 'S11', displayId: 'S8',  label: 'In Progress',        description: 'Shift has started',                         color: 'blue'    },
    S13:     { id: 'S13',     displayId: 'S9',  label: 'Completed',          description: 'Shift has ended',                           color: 'gray'    },
    S15:     { id: 'S15',     displayId: 'S10', label: 'Cancelled',          description: 'Shift has been cancelled',                  color: 'red'     },
    UNKNOWN: { id: 'UNKNOWN', displayId: '—',   label: 'Unknown',            description: 'Unrecognized shift state — stale DB data',  color: 'gray'    },
};

/** Hex colours for the Tailwind tokens above — for inline-styled badges/rows. */
export const FSM_COLOR_HEX: Record<ShiftFSMStateInfo['color'], string> = {
    slate:   '#64748B',
    blue:    '#3B82F6',
    violet:  '#8B5CF6',
    emerald: '#10B981',
    amber:   '#F59E0B',
    orange:  '#F97316',
    red:     '#EF4444',
    gray:    '#94A3B8',
};

/** Display descriptor for a shift's State badge/row. */
export interface ShiftStateDisplay {
    /** Gapless UI id (S1…S10) plus the runtime emergent `*` suffix (S3/S5 only). */
    id: string;
    label: string;
    /** Hex colour for inline styling, matching the card's Time/Live rule rows. */
    color: string;
}

/**
 * Resolve the user-facing State descriptor for a card. Uses the gapless
 * {@link ShiftFSMStateInfo.displayId}, appends the runtime emergent `*` marker
 * for S3/S5 (Offered/Bidding within 4h of start), and maps the colour token to a
 * hex value so it can sit alongside the Time Rules / Live Rules rows.
 */
export function getShiftStateDisplay(
    state: ShiftStateID,
    opts?: { emergent?: boolean },
): ShiftStateDisplay {
    const meta = FSM_STATE_META[state];
    const emergentSuffix = opts?.emergent && (state === 'S3' || state === 'S5') ? '*' : '';
    return {
        id: meta.displayId + emergentSuffix,
        label: meta.label,
        color: FSM_COLOR_HEX[meta.color],
    };
}

// ─── Core derivation function ─────────────────────────────────────────────────

/**
 * Derives the FSM state from a shift's 5 lifecycle columns.
 *
 * Throws if the combination is invalid (should never happen on well-formed DB
 * data; the `validate_shift_state_invariants` trigger enforces this server-side).
 */
export function getShiftFSMState(shift: ShiftFSMInput): ShiftStateID {
    // 1. Cancelled — highest priority, short-circuits everything
    if (shift.is_cancelled) return 'S15';

    // 2. Completed
    if (shift.lifecycle_status === 'Completed') return 'S13';

    // 3. In Progress
    if (shift.lifecycle_status === 'InProgress') return 'S11';

    // 4. Published — sub-states resolved by assignment + trade fields
    if (shift.lifecycle_status === 'Published') {
        // Trade overrides assignment outcome
        if (shift.trading_status === 'TradeRequested') return 'S9';
        if (shift.trading_status === 'TradeAccepted')  return 'S10';

        if (shift.assignment_status === 'assigned') {
            // Confirmed → S4
            if (shift.assignment_outcome === 'confirmed') return 'S4';
            // NULL or any legacy value ('pending', 'offered', etc.) → S3 (Offered, awaiting decision).
            // assignment_outcome is now constrained to NULL | 'confirmed' | 'no_show', but
            // older rows may carry stale values — treat them all as "no outcome yet".
            return 'S3';
        }

        // Unassigned while published = bidding (or waiting for assignment)
        if (shift.assignment_status === 'unassigned') return 'S5';
    }

    // 5. Draft
    if (shift.lifecycle_status === 'Draft') {
        if (shift.assignment_status === 'assigned') return 'S2';
        return 'S1';
    }

    // 6. Unrecognized combination — stale DB data or schema drift.
    // Log a warning but never crash the UI; render as UNKNOWN so the card
    // shows a neutral fallback state instead of an ErrorBoundary.
    console.warn(
        `[FSM] Unrecognized shift state combination: lifecycle=${shift.lifecycle_status} ` +
        `assignment=${shift.assignment_status} outcome=${shift.assignment_outcome} ` +
        `trading=${shift.trading_status} cancelled=${shift.is_cancelled}`
    );
    return 'UNKNOWN';
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/** Returns state metadata alongside the derived state ID. */
export function getShiftFSMStateInfo(shift: ShiftFSMInput): ShiftFSMStateInfo {
    return FSM_STATE_META[getShiftFSMState(shift)];
}

/** True if the shift is in any terminal state (no further transitions possible). */
export function isShiftTerminal(shift: ShiftFSMInput): boolean {
    const state = getShiftFSMState(shift);
    return state === 'S13' || state === 'S15';
}

/** True if the shift currently has an open bidding window. */
export function isShiftOnBidding(shift: ShiftFSMInput): boolean {
    return getShiftFSMState(shift) === 'S5';
}

/** True if the shift is waiting for an offer response. */
export function isShiftOffered(shift: ShiftFSMInput): boolean {
    return getShiftFSMState(shift) === 'S3';
}
