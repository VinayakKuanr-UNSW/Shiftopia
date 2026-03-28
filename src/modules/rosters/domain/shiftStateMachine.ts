/**
 * Shift State Machine
 *
 * The authoritative implementation of the state machine spec defined in
 * skills/state-machine.md. This module is the single source of truth for:
 *
 *  - Which of the 15 valid states (S1–S15) a shift is in
 *  - Which UI actions are available from each state (§8)
 *  - Which form fields are locked in each state (§9.3)
 *  - Which buttons are visible in each state (§10)
 *  - Which transitions are legal (§3)
 *  - Which actions require a compliance check (§5)
 *
 * Design:
 *  - Pure functions — no side effects, no imports of React or Supabase
 *  - Framework-agnostic — usable in components, hooks, tests, and edge fns
 *  - Deterministic — same inputs always produce same output
 *  - Exhaustive — every state and every action is explicitly handled
 *
 * The DB mirrors this logic in resolve_shift_state() (Phase 2A migration).
 * Any change to this file must be reflected in that Postgres function.
 */

// ── State IDs ──────────────────────────────────────────────────────────────

export type ShiftStateID =
  | 'S1'   // Draft + Unassigned
  | 'S2'   // Draft + Assigned (Pending)
  | 'S3'   // Published + Offered (fully locked)
  | 'S4'   // Published + Confirmed
  | 'S5'   // Published + Unassigned + OnBiddingNormal
  | 'S6'   // Published + Unassigned + OnBiddingUrgent
  | 'S7'   // Published + EmergencyAssigned
  | 'S8'   // Published + BiddingClosedNoWinner
  | 'S9'   // Published + Confirmed + TradeRequested
  | 'S10'  // Published + Confirmed + TradeAccepted
  | 'S11'  // InProgress + Confirmed (time-locked)
  | 'S12'  // InProgress + EmergencyAssigned (time-locked)
  | 'S13'  // Completed + Confirmed (terminal)
  | 'S14'  // Completed + EmergencyAssigned (terminal)
  | 'S15'  // Cancelled (terminal)
  | 'UNKNOWN'; // Invalid / unexpected combination

// ── Actions (spec §3 & §8) ─────────────────────────────────────────────────

export type ShiftAction =
  | 'ASSIGN'
  | 'UNASSIGN'
  | 'PUBLISH'
  | 'UNPUBLISH'
  | 'ACCEPT_OFFER'
  | 'REJECT_OFFER'
  | 'SELECT_BID_WINNER'
  | 'CLOSE_BIDDING'
  | 'EMERGENCY_ASSIGN'
  | 'REQUEST_TRADE'
  | 'ACCEPT_TRADE'
  | 'APPROVE_TRADE'
  | 'CANCEL'
  | 'CHECK_IN'
  | 'MARK_NO_SHOW'
  | 'DELETE'
  | 'EDIT'
  // Timer-driven actions — executed only by the shift-state-processor cron, never by UI
  | 'EXPIRE_OFFER'      // S3 → S1: offer expired at TTS=4h (Draft+Unassigned)
  | 'EXPIRE_BIDDING'    // S5/S6 → S1: bidding closed at TTS=4h with no winner (Draft+Unassigned)
  | 'ESCALATE_URGENCY'  // S5 → S6: bidding crossed 24h threshold (Normal→Urgent)
  | 'CHECK_OUT';        // S11/S12 → S11/S12: employee clocks out (records actual_end)

// ── Field lock matrix ──────────────────────────────────────────────────────

export interface FieldLocks {
  /** Shift date, start/end time, breaks, timezone */
  schedule:     boolean;
  /** Role, remuneration level */
  role:         boolean;
  /** Required skills, licenses, events */
  requirements: boolean;
  /** Notes field */
  notes:        boolean;
  /** Assigned employee */
  assignment:   boolean;
}

// ── Button visibility (spec §10) ──────────────────────────────────────────

export interface ButtonVisibility {
  publish:    boolean;
  unpublish:  boolean;
  edit:       boolean;
  delete:     boolean;
}

// ── State descriptor ──────────────────────────────────────────────────────

export interface ShiftStateDef {
  id:           ShiftStateID;
  label:        string;
  lifecycle:    'Draft' | 'Published' | 'InProgress' | 'Completed' | 'Cancelled';
  /** No outbound transitions — Cancelled (S15), Completed (S13/S14) */
  isTerminal:   boolean;
  /** UI modal is fully locked in this state */
  isModalLocked: boolean;
}

// ── State definitions table ───────────────────────────────────────────────

const STATES: Record<Exclude<ShiftStateID, 'UNKNOWN'>, ShiftStateDef> = {
  S1:  { id: 'S1',  label: 'Draft – Unassigned',             lifecycle: 'Draft',      isTerminal: false, isModalLocked: false },
  S2:  { id: 'S2',  label: 'Draft – Assigned',               lifecycle: 'Draft',      isTerminal: false, isModalLocked: false },
  S3:  { id: 'S3',  label: 'Published – Offered',            lifecycle: 'Published',  isTerminal: false, isModalLocked: true  },
  S4:  { id: 'S4',  label: 'Published – Confirmed',          lifecycle: 'Published',  isTerminal: false, isModalLocked: false },
  S5:  { id: 'S5',  label: 'Published – Bidding (Normal)',   lifecycle: 'Published',  isTerminal: false, isModalLocked: false },
  S6:  { id: 'S6',  label: 'Published – Bidding (Urgent)',   lifecycle: 'Published',  isTerminal: false, isModalLocked: false },
  S7:  { id: 'S7',  label: 'Published – Emergency Assigned', lifecycle: 'Published',  isTerminal: false, isModalLocked: false },
  S8:  { id: 'S8',  label: 'Published – Bidding Closed',     lifecycle: 'Published',  isTerminal: false, isModalLocked: false },
  S9:  { id: 'S9',  label: 'Published – Trade Requested',    lifecycle: 'Published',  isTerminal: false, isModalLocked: false },
  S10: { id: 'S10', label: 'Published – Trade Accepted',     lifecycle: 'Published',  isTerminal: false, isModalLocked: false },
  S11: { id: 'S11', label: 'In Progress – Confirmed',        lifecycle: 'InProgress', isTerminal: false, isModalLocked: true  },
  S12: { id: 'S12', label: 'In Progress – Emergency',        lifecycle: 'InProgress', isTerminal: false, isModalLocked: true  },
  S13: { id: 'S13', label: 'Completed – Confirmed',          lifecycle: 'Completed',  isTerminal: true,  isModalLocked: true  },
  S14: { id: 'S14', label: 'Completed – Emergency',          lifecycle: 'Completed',  isTerminal: true,  isModalLocked: true  },
  S15: { id: 'S15', label: 'Cancelled',                      lifecycle: 'Cancelled',  isTerminal: true,  isModalLocked: true  },
};

// ── Transition table (spec §3) ────────────────────────────────────────────
// Maps: fromState → action → toState
// Only valid transitions are listed. canTransition() uses this.

const TRANSITIONS: Partial<Record<ShiftStateID, Partial<Record<ShiftAction, ShiftStateID>>>> = {
  S1:  { ASSIGN: 'S2',        PUBLISH: 'S5',  DELETE: 'S15', CANCEL: 'S15' },
  S2:  { ASSIGN: 'S2',        UNASSIGN: 'S1', PUBLISH: 'S3', DELETE: 'S15', CANCEL: 'S15' },
  S3:  { ACCEPT_OFFER: 'S4',  REJECT_OFFER: 'S5', EXPIRE_OFFER: 'S1', UNPUBLISH: 'S2', DELETE: 'S15', CANCEL: 'S15' },
  S4:  { REQUEST_TRADE: 'S9', CANCEL: 'S15',  DELETE: 'S15', EDIT: 'S4' },
  S5:  { SELECT_BID_WINNER: 'S4', CLOSE_BIDDING: 'S8', ESCALATE_URGENCY: 'S6', EXPIRE_BIDDING: 'S1', UNPUBLISH: 'S1', DELETE: 'S15', CANCEL: 'S15' },
  S6:  { SELECT_BID_WINNER: 'S4', CLOSE_BIDDING: 'S8', EXPIRE_BIDDING: 'S1', UNPUBLISH: 'S1', DELETE: 'S15', CANCEL: 'S15' },
  S7:  { CANCEL: 'S15', DELETE: 'S15', EDIT: 'S7' },
  S8:  { UNPUBLISH: 'S1', DELETE: 'S15', CANCEL: 'S15' },
  S9:  { ACCEPT_TRADE: 'S10' },
  S10: { APPROVE_TRADE: 'S4' }, // reverts to S4 if compliance fails
  S11: { CHECK_IN: 'S11', CHECK_OUT: 'S11', MARK_NO_SHOW: 'S11', EMERGENCY_ASSIGN: 'S12' },
  S12: { CHECK_IN: 'S12', CHECK_OUT: 'S12', MARK_NO_SHOW: 'S12' },
  // S13, S14, S15: terminal — no transitions
};

// ── Button visibility table (spec §10) ────────────────────────────────────

const BUTTON_VISIBILITY: Record<ShiftStateID, ButtonVisibility> = {
  S1:      { publish: true,  unpublish: false, edit: true,  delete: true  },
  S2:      { publish: true,  unpublish: false, edit: true,  delete: true  },
  S3:      { publish: false, unpublish: true,  edit: false, delete: true  },
  S4:      { publish: false, unpublish: false, edit: true,  delete: true  },
  S5:      { publish: false, unpublish: true,  edit: true,  delete: true  },
  S6:      { publish: false, unpublish: true,  edit: true,  delete: true  },
  S7:      { publish: false, unpublish: false, edit: true,  delete: true  },
  S8:      { publish: false, unpublish: true,  edit: true,  delete: true  },
  S9:      { publish: false, unpublish: false, edit: true,  delete: false },
  S10:     { publish: false, unpublish: false, edit: true,  delete: false },
  S11:     { publish: false, unpublish: false, edit: false, delete: false },
  S12:     { publish: false, unpublish: false, edit: false, delete: false },
  S13:     { publish: false, unpublish: false, edit: false, delete: false },
  S14:     { publish: false, unpublish: false, edit: false, delete: false },
  S15:     { publish: false, unpublish: false, edit: false, delete: false },
  UNKNOWN: { publish: false, unpublish: false, edit: false, delete: false },
};

// ── Field lock table (spec §9.3) ──────────────────────────────────────────

const LOCKED:  FieldLocks = { schedule: true,  role: true,  requirements: true,  notes: true,  assignment: true  };
const OPEN:    FieldLocks = { schedule: false, role: false, requirements: false, notes: false, assignment: false };
const PARTIAL: FieldLocks = { schedule: false, role: false, requirements: false, notes: false, assignment: true  };

const FIELD_LOCKS: Record<ShiftStateID, FieldLocks> = {
  S1:      OPEN,
  S2:      OPEN,
  S3:      LOCKED,   // Fully locked while offer is pending
  S4:      PARTIAL,
  S5:      PARTIAL,
  S6:      PARTIAL,
  S7:      PARTIAL,
  S8:      PARTIAL,
  S9:      PARTIAL,
  S10:     PARTIAL,
  S11:     LOCKED,   // Time lock — in progress
  S12:     LOCKED,   // Time lock — in progress
  S13:     LOCKED,   // Terminal
  S14:     LOCKED,   // Terminal
  S15:     LOCKED,   // Cancelled
  UNKNOWN: LOCKED,   // Defensive
};

// ── Actions requiring compliance check (spec §5) ──────────────────────────

const COMPLIANCE_ACTIONS = new Set<ShiftAction>([
  'ASSIGN',
  'EMERGENCY_ASSIGN',
  'APPROVE_TRADE',
  'SELECT_BID_WINNER',
]);

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Determine which of the 15 valid states a shift is currently in.
 *
 * Accepts the minimal set of state dimensions — no need to pass the
 * entire Shift object. Pure function, O(1), suitable for calling in
 * render-hot paths (memoize at the component level if needed).
 */
export function determineShiftState(shift: {
  lifecycle_status: string;
  assignment_status?: string | null;
  assignment_outcome?: string | null;
  bidding_status?: string | null;
  trading_status?: string | null;
  is_cancelled?: boolean | null;
}): ShiftStateID {
  const {
    lifecycle_status: lc,
    assignment_status: as_,
    assignment_outcome: ao,
    bidding_status: bs,
    trading_status: ts,
    is_cancelled,
  } = shift;

  // S15: Cancelled wins over everything
  if (lc === 'Cancelled' || is_cancelled) return 'S15';

  // S13 / S14: Completed
  if (lc === 'Completed') {
    if (ao === 'emergency_assigned') return 'S14';
    return 'S13';
  }

  // S11 / S12: InProgress
  if (lc === 'InProgress') {
    if (ao === 'emergency_assigned') return 'S12';
    return 'S11';
  }

  // Published states
  if (lc === 'Published') {
    if (ao === 'confirmed') {
      if (ts === 'TradeRequested') return 'S9';
      if (ts === 'TradeAccepted')  return 'S10';
      return 'S4';
    }
    if (ao === 'offered')           return 'S3';
    if (ao === 'emergency_assigned') return 'S7';
    // Unassigned + bidding
    if (!ao || as_ === 'unassigned') {
      if (bs === 'on_bidding_normal')        return 'S5';
      if (bs === 'on_bidding_urgent')        return 'S6';
      if (bs === 'on_bidding')               return 'S5'; // unified — client derives urgency from TTS
      if (bs === 'bidding_closed_no_winner') return 'S8';
    }
  }

  // Draft states
  if (lc === 'Draft') {
    if (as_ === 'assigned') return 'S2';
    return 'S1';
  }

  return 'UNKNOWN';
}

/**
 * Returns the full state descriptor for a given state ID.
 * Returns null for UNKNOWN.
 */
export function getStateDef(stateId: ShiftStateID): ShiftStateDef | null {
  if (stateId === 'UNKNOWN') return null;
  return STATES[stateId];
}

/**
 * Returns the field lock profile for a state.
 * Time-lock override: if start time has already passed, returns LOCKED
 * regardless of the state (spec §4.2, §7 invariant 5).
 */
export function getFieldLocks(stateId: ShiftStateID, isTimeLocked = false): FieldLocks {
  if (isTimeLocked) return LOCKED;
  return FIELD_LOCKS[stateId];
}

/**
 * Returns which buttons should be shown for a shift in the given state.
 * Note: visibility ≠ enabled — the caller must layer in time-lock rules.
 */
export function getButtonVisibility(stateId: ShiftStateID): ButtonVisibility {
  return BUTTON_VISIBILITY[stateId];
}

/**
 * Returns whether a specific action is valid from the given state.
 */
export function canTransition(stateId: ShiftStateID, action: ShiftAction): boolean {
  if (stateId === 'UNKNOWN') return false;
  return !!(TRANSITIONS[stateId]?.[action]);
}

/**
 * Returns all actions that are legally available from the given state.
 */
export function getAvailableActions(stateId: ShiftStateID): ShiftAction[] {
  if (stateId === 'UNKNOWN') return [];
  const map = TRANSITIONS[stateId];
  return map ? (Object.keys(map) as ShiftAction[]) : [];
}

/**
 * Returns the target state if the action is taken from fromState.
 * Returns null if the transition is illegal.
 */
export function getTransitionTarget(
  fromState: ShiftStateID,
  action: ShiftAction,
): ShiftStateID | null {
  if (fromState === 'UNKNOWN') return null;
  return TRANSITIONS[fromState]?.[action] ?? null;
}

/**
 * Returns whether this action requires the compliance engine to run
 * before it can be committed (spec §5).
 */
export function requiresComplianceCheck(action: ShiftAction): boolean {
  return COMPLIANCE_ACTIONS.has(action);
}

/**
 * Returns whether the shift's start time has passed — meaning the
 * time lock override kicks in and all edits are blocked (spec §7.5).
 *
 * Prefers canonical start_at (timestamptz) over legacy scheduled_start.
 */
export function isTimeLocked(shift: {
  start_at?: string | null;
  scheduled_start?: string | null;
}): boolean {
  const ref = shift.start_at ?? shift.scheduled_start;
  if (!ref) return false;
  return new Date(ref) <= new Date();
}

/**
 * Convenience: compute full UI permissions for a shift in one call.
 * Returns everything a component needs to render buttons and lock fields.
 */
export function resolveShiftPermissions(shift: {
  lifecycle_status: string;
  assignment_status?: string | null;
  assignment_outcome?: string | null;
  bidding_status?: string | null;
  trading_status?: string | null;
  is_cancelled?: boolean | null;
  start_at?: string | null;
  scheduled_start?: string | null;
}) {
  const stateId  = determineShiftState(shift);
  const timeLock = isTimeLocked(shift);
  const stateDef = getStateDef(stateId);

  return {
    stateId,
    stateDef,
    isTimeLocked:  timeLock,
    isFullyLocked: timeLock || (stateDef?.isModalLocked ?? true),
    fieldLocks:    getFieldLocks(stateId, timeLock),
    buttons:       getButtonVisibility(stateId),
    actions:       getAvailableActions(stateId),
  };
}
