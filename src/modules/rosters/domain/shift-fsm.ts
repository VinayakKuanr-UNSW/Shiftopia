/**
 * Shift FSM — State Derivation Utility
 *
 * Single source of truth for deriving the logical FSM state of a shift from
 * its 5 DB columns. This mirrors the PL/pgSQL `get_shift_fsm_state()` function
 * exactly — any change here must be reflected there, and vice versa.
 *
 * Inputs:  lifecycle_status, assignment_status, assignment_outcome,
 *          trading_status, is_cancelled
 * Output:  ShiftStateID  ('S1' … 'S10')
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
    | 'S6'      // Published – Trade Requested (Pending Peer)
    | 'S7'      // Published – Trade Requested (Pending Manager)
    | 'S8'      // In Progress
    | 'S9'      // Completed
    | 'S10'     // Cancelled
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

interface ShiftFSMStateInfo {
    /**
     * State ID (S1…S10) — shown on cards AND a TS↔PL/pgSQL contract: DB
     * transition guards (`sm_*`, `fsm_op_is_legal`) branch on these exact
     * strings returned by `get_shift_fsm_state()`. Renumbering needs a migration.
     */
    id: ShiftStateID;
    label: string;
    description: string;
    /** Tailwind colour token — use with bg-/text-/border- prefixes */
    color: 'slate' | 'blue' | 'violet' | 'emerald' | 'amber' | 'orange' | 'red' | 'gray';
}

export const FSM_STATE_META: Record<ShiftStateID, ShiftFSMStateInfo> = {
    S1:      { id: 'S1',      label: 'Draft',             description: 'Created, not yet assigned or published',    color: 'slate'   },
    S2:      { id: 'S2',      label: 'Draft (Assigned)',   description: 'Assigned in draft — not yet published',     color: 'slate'   },
    S3:      { id: 'S3',      label: 'Offered',            description: 'Published and offered to an employee',      color: 'blue'    },
    S4:      { id: 'S4',      label: 'Confirmed',          description: 'Assignment accepted and confirmed',         color: 'emerald' },
    S5:      { id: 'S5',      label: 'Bidding',            description: 'Open for employee bids',                    color: 'violet'  },
    S6:      { id: 'S6',      label: 'Trade Requested (Pending Peer)',    description: 'Employee has requested a trade — awaiting a peer to accept',  color: 'amber'   },
    S7:      { id: 'S7',      label: 'Trade Requested (Pending Manager)', description: 'Trade accepted by a peer — awaiting manager approval',        color: 'orange'  },
    S8:      { id: 'S8',      label: 'In Progress',        description: 'Shift has started',                         color: 'blue'    },
    S9:      { id: 'S9',      label: 'Completed',          description: 'Shift has ended',                           color: 'gray'    },
    S10:     { id: 'S10',     label: 'Cancelled',          description: 'Shift has been cancelled',                  color: 'red'     },
    UNKNOWN: { id: 'UNKNOWN', label: 'Unknown',            description: 'Unrecognized shift state — stale DB data',  color: 'gray'    },
};

/**
 * Why a shift was cancelled (shifts.kickoff_cancel_code; docs/design/shift-trading/03-bidding-fsm.md B-D10).
 * System-coded cancellations at kickoff (A, B, C, D) or manager manual cancellation (E).
 */
export type KickoffCancelCode = 'A' | 'B' | 'C' | 'D' | 'E';

export const KICKOFF_CANCEL_REASONS: Record<KickoffCancelCode, string> = {
    A: 'Offer ignored until the shift started',
    B: 'Bidding found no winner',
    C: 'Draft+Unassigned never published',
    D: 'Draft+Assigned never published',
    E: 'Published shift manually cancelled',
};

/**
 * "B — Bidding found no winner", or null when the code is absent or unknown.
 * For E the manager's required note follows: "E — Published shift manually cancelled: <note>".
 */
export function describeKickoffCancel(code: string | null | undefined, note?: string | null): string | null {
    if (!code || !(code in KICKOFF_CANCEL_REASONS)) return null;
    const label = `${code} — ${KICKOFF_CANCEL_REASONS[code as KickoffCancelCode]}`;
    return code === 'E' && note?.trim() ? `${label}: ${note.trim()}` : label;
}

/** Hex colours for the Tailwind tokens above — for inline-styled badges/rows. */
const FSM_COLOR_HEX: Record<ShiftFSMStateInfo['color'], string> = {
    slate:   '#64748B',
    blue:    '#3B82F6',
    violet:  '#8B5CF6',
    emerald: '#10B981',
    amber:   '#F59E0B',
    orange:  '#F97316',
    red:     '#EF4444',
    gray:    '#94A3B8',
};

/**
 * Semantic state color palette tokens for circular shift state badges (canonical S1...S10).
 * Features dark tinted backgrounds with high-contrast text derived from the corresponding state palette.
 */
interface ShiftStateBadgeToken {
    bg: string;
    text: string;
    border?: string;
    label: string;
}

export const SHIFT_STATE_BADGE_TOKENS: Record<ShiftStateID, ShiftStateBadgeToken> = {
    S1:      { bg: '#303542', text: '#E2E8F0', border: 'rgba(226, 232, 240, 0.15)', label: 'Draft' },
    S2:      { bg: '#34445F', text: '#CBD5E1', border: 'rgba(203, 213, 225, 0.15)', label: 'Draft (Assigned)' },
    S3:      { bg: '#075985', text: '#BAE6FD', border: 'rgba(186, 230, 253, 0.25)', label: 'Offered' },
    S4:      { bg: '#166534', text: '#BBF7D0', border: 'rgba(187, 247, 208, 0.25)', label: 'Confirmed' },
    S5:      { bg: '#854D0E', text: '#FDE68A', border: 'rgba(253, 230, 138, 0.25)', label: 'Bidding' },
    S6:      { bg: '#9A3412', text: '#FED7AA', border: 'rgba(254, 215, 170, 0.25)', label: 'Trade (Peer)' },
    S7:      { bg: '#6B21A8', text: '#E9D5FF', border: 'rgba(233, 213, 255, 0.25)', label: 'Trade (Mgr)' },
    S8:      { bg: '#1D4ED8', text: '#BFDBFE', border: 'rgba(191, 219, 254, 0.25)', label: 'In Progress' },
    S9:      { bg: '#115E59', text: '#99F6E4', border: 'rgba(153, 246, 228, 0.25)', label: 'Completed' },
    S10:     { bg: '#991B1B', text: '#FECACA', border: 'rgba(254, 202, 202, 0.25)', label: 'Cancelled' },
    UNKNOWN: { bg: '#334155', text: '#E2E8F0', border: 'rgba(226, 232, 240, 0.15)', label: 'Unknown' },
};

/** Display descriptor for a shift's State badge/row. */
export interface ShiftStateDisplay {
    /** State id (S1…S10). */
    id: string;
    label: string;
    /** Hex colour for inline styling, matching the card's Time/Live rule rows. */
    color: string;
}

/**
 * Resolve the user-facing State descriptor for a card, mapping the colour token
 * to a hex value so it can sit alongside the Time Rules / Live Rules rows.
 */
export function getShiftStateDisplay(state: ShiftStateID): ShiftStateDisplay {
    const meta = FSM_STATE_META[state];
    return {
        id: state === 'UNKNOWN' ? '—' : meta.id,
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
    // 1. Cancelled — highest priority, short-circuits everything. Either signal
    //    counts, as in get_shift_fsm_state().
    if (shift.is_cancelled || shift.lifecycle_status === 'Cancelled') return 'S10';

    // 2. Completed
    if (shift.lifecycle_status === 'Completed') return 'S9';

    // 3. In Progress
    if (shift.lifecycle_status === 'InProgress') return 'S8';

    // 4. Published — sub-states resolved by assignment + trade fields
    if (shift.lifecycle_status === 'Published') {
        // Trade overrides assignment outcome
        if (shift.trading_status === 'TradeRequested') return 'S6';
        if (shift.trading_status === 'TradeAccepted')  return 'S7';

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
