/**
 * Shift UI Context
 *
 * Pure logic layer — derives all display-relevant context from a shift's
 * FSM state + emergency_source + time-to-start.
 *
 * Rules:
 *  - State  → from getShiftFSMState() (canonical, never re-derived here)
 *  - Urgency → runtime TTS calculation (visual only, never affects actions)
 *  - Emergency label → from emergency_source column (historical, write-once)
 *  - Actions → from FSM state only (never from TTS)
 *
 * IMPORTANT: Do NOT write emergency_source from UI.
 * Only backend assignment APIs (set_emergency_source) may write it.
 */

import {
    getShiftFSMState,
    FSM_STATE_META,
    type ShiftStateID,
    type ShiftFSMInput,
    type EmergencySource,
} from './shift-fsm';

// ─── Tone ────────────────────────────────────────────────────────────────────

export type BadgeTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShiftUIContextInput extends ShiftFSMInput {
    /** UTC timestamp of the shift start — used for TTS calculation */
    scheduled_start: string | Date | null | undefined;
    /** Written by backend assignment APIs — never set from UI */
    emergency_source: EmergencySource;
}

export interface ShiftUIContext {
    state: ShiftStateID;
    /** Seconds until shift starts (0 if already started) */
    ttsSec: number;
    /** TTS < 24h — visual indicator only */
    isUrgent: boolean;
    /** TTS < 4h — visual indicator only */
    isEmergency: boolean;
    /** Display label derived from emergency_source; null if not an emergency assignment */
    emergencyLabel: string | null;
}

export interface ShiftBadge {
    label: string;
    tone: BadgeTone;
}

export interface ShiftLockState {
    /** All fields locked — offer sent, in progress, terminal */
    fullyLocked: boolean;
    /** Schedule locked but notes/comments still editable */
    partialLock: boolean;
}

export type ShiftAction =
    | 'PUBLISH' | 'UNPUBLISH' | 'DELETE'
    | 'ASSIGN' | 'UNASSIGN'
    | 'ACCEPT' | 'REJECT'
    | 'SELECT_BID_WINNER' | 'EMERGENCY_ASSIGN'
    | 'SWAP_REQUEST' | 'CANCEL_REQUEST' | 'ACCEPT_TRADE' | 'REJECT_TRADE' | 'APPROVE_TRADE'
    | 'CLOCK_IN' | 'CLOCK_OUT' | 'MARK_NO_SHOW'
    | 'CANCEL';

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Derive all display context for a shift.
 * Single entry point — call this once per render, pass `ctx` to all sub-helpers.
 */
export function getShiftUIContext(shift: ShiftUIContextInput): ShiftUIContext {
    const state = getShiftFSMState(shift);

    const now  = Date.now();
    const start = shift.scheduled_start
        ? new Date(shift.scheduled_start).getTime()
        : 0;
    const ttsSec = start > 0 ? Math.max(0, Math.floor((start - now) / 1000)) : 0;

    const isUrgent    = ttsSec < 24 * 60 * 60;
    const isEmergency = ttsSec < 4  * 60 * 60;

    const emergencyLabel: string | null =
        shift.emergency_source === 'manual' ? 'Emergency'
        : shift.emergency_source === 'auto'  ? 'Auto Emergency'
        : null;

    return { state, ttsSec, isUrgent, isEmergency, emergencyLabel };
}

/**
 * Build ordered badge list for a shift card.
 *
 * Order: State → Trade → Emergency (historical) → Urgency (runtime) → Terminal
 *
 * Guardrail: if emergencyLabel is present, Urgent badge is suppressed
 * (historical context takes precedence over runtime TTS indicator).
 */
export function getBadges(ctx: ShiftUIContext): ShiftBadge[] {
    const badges: ShiftBadge[] = [];

    // State badge (always present)
    const meta = FSM_STATE_META[ctx.state];
    badges.push({ label: meta.label, tone: 'info' });

    // Trade badges coexist with state badge
    if (ctx.state === 'S9')  badges.push({ label: 'Trade Requested', tone: 'warning' });
    if (ctx.state === 'S10') badges.push({ label: 'Trade Accepted',  tone: 'warning' });

    // Emergency (historical — write-once field from DB)
    if (ctx.emergencyLabel) {
        badges.push({ label: ctx.emergencyLabel, tone: 'danger' });
    }

    // Urgency (runtime TTS — suppressed if emergency badge already shown)
    if (!ctx.emergencyLabel && ctx.isUrgent && ctx.state === 'S5') {
        badges.push({ label: 'Urgent', tone: 'warning' });
    }

    // Terminal states
    if (ctx.state === 'S13') badges.push({ label: 'Completed', tone: 'success' });
    if (ctx.state === 'S15') badges.push({ label: 'Cancelled', tone: 'neutral'  });

    return badges;
}

/**
 * Field-level lock state for a shift.
 *
 * S1/S2 (draft) → nothing locked
 * S4/S5/S9/S10 (published, active) → schedule locked, notes editable
 * S3/S11/S13/S15 → fully locked
 */
export function getLockState(state: ShiftStateID | string): ShiftLockState {
    if (state === 'S1' || state === 'S2') {
        return { fullyLocked: false, partialLock: false };
    }
    // S3, S4, S5, S9, S10 (published, active) — schedule locked, notes editable
    if (state === 'S3' || state === 'S4' || state === 'S5' || state === 'S9' || state === 'S10') {
        return { fullyLocked: false, partialLock: true };
    }
    // S11, S13, S15 — fully locked
    return { fullyLocked: true, partialLock: false };
}

/**
 * Available FSM actions for a given state.
 * This is the single source of truth for action menus.
 * Time-based fields (isUrgent/isEmergency) are visual only — never restrict actions.
 */
export function getAvailableActions(state: ShiftStateID | string): ShiftAction[] {
    switch (state) {
        case 'S1':  return ['ASSIGN', 'PUBLISH', 'DELETE'];
        case 'S2':  return ['UNASSIGN', 'PUBLISH', 'DELETE'];
        case 'S3':  return ['ACCEPT', 'REJECT', 'UNPUBLISH', 'CANCEL'];
        case 'S4':  return ['SWAP_REQUEST', 'EMERGENCY_ASSIGN', 'UNPUBLISH', 'CLOCK_IN', 'CANCEL'];
        case 'S5':  return ['SELECT_BID_WINNER', 'EMERGENCY_ASSIGN', 'UNPUBLISH', 'CANCEL'];
        case 'S9':  return ['CANCEL_REQUEST', 'ACCEPT_TRADE', 'REJECT_TRADE'];
        case 'S10': return ['APPROVE_TRADE', 'REJECT_TRADE'];
        case 'S11': return ['CLOCK_OUT', 'MARK_NO_SHOW', 'CANCEL'];
        case 'S13': return [];
        case 'S15': return [];
        default:    return [];
    }
}
