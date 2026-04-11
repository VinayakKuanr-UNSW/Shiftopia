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
 *  - Actions → from FSM state + Emergent policy (S1 restricted if TTS < 4h)
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
import { type ShiftUrgency } from './bidding-urgency';

// ─── Tone ────────────────────────────────────────────────────────────────────

export type BadgeTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

/**
 * Priority-ordered ring color for shift cards across all views.
 *
 * purple  — Completed (S13)
 * emerald — In Progress / clocked in (S11)
 * yellow  — Late: Published, past start time, no actual_start (clock-in missing)
 * red     — Emergent: TTS ≤ 4h
 * orange  — Urgent: TTS ≤ 24h
 * blue    — Normal: everything else
 */
export type RingColor = 'purple' | 'emerald' | 'yellow' | 'red' | 'orange' | 'blue' | null;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShiftUIContextInput extends ShiftFSMInput {
    /** UTC timestamp of the shift start — used for TTS calculation */
    scheduled_start: string | Date | null | undefined;
    /** Actual clock-in time — used to detect "Late" (past start, not clocked in) */
    actual_start?: string | null | undefined;
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
    /** TTS-based urgency — visual only, never gates actions */
    urgency: ShiftUrgency;
    /** Priority-ordered ring color for card borders/glows across all views */
    ringColor: RingColor;
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

    const urgency: ShiftUrgency =
        ttsSec === 0         ? 'emergent'
        : ttsSec < 4  * 3600 ? 'emergent'
        : ttsSec < 24 * 3600 ? 'urgent'
        : 'normal';

    // ── Ring color — priority ordered ─────────────────────────────────────────
    // Purple  > Emerald > Yellow > Red > Orange > Blue
    const isPastStart = start > 0 && now > start;

    const ringColor: RingColor = (() => {
        // Special case: Draft shifts past start_time should have NO strip
        if (shift.lifecycle_status === 'Draft' && isPastStart) return null;

        if (state === 'S13') return 'purple';                          // Completed
        if (state === 'S11') return 'emerald';                         // In Progress
        // Late: Published, start time passed, no clock-in yet
        if (
            isPastStart &&
            !shift.actual_start &&
            shift.lifecycle_status === 'Published'
        ) return 'yellow';

        if (urgency === 'emergent') return 'red';
        if (urgency === 'urgent')   return 'orange';
        return 'blue';
    })();

    return { state, ttsSec, isUrgent, isEmergency, emergencyLabel, urgency, ringColor };
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

    // Urgency (runtime TTS — suppressed if emergency badge shown or in terminal state)
    const terminalStates = ['S13', 'S15'];
    if (!ctx.emergencyLabel && !terminalStates.includes(ctx.state)) {
        if (ctx.urgency === 'emergent') {
            badges.push({ label: 'Emergent', tone: 'danger' });
        } else if (ctx.urgency === 'urgent') {
            badges.push({ label: 'Urgent', tone: 'warning' });
        }
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

// ─── Status dot ──────────────────────────────────────────────────────────────

export interface ShiftDotInput {
    lifecycle_status:   string;
    is_cancelled?:      boolean | null;
    assignment_outcome?: string | null;
    attendance_status?: string | null;
    actual_start?:      string | null;
    actual_end?:        string | null;
    start_at?:          string | null;
    end_at?:            string | null;
    shift_date?:        string | null;
    start_time?:        string | null;
    end_time?:          string | null;
}

export interface StatusBadge {
    color: string;
    label: string;
}

/**
 * Returns the status badge info (color + label) for the status dot and text
 * that replaces the left vertical strip on shift cards.
 *
 * One dot, one label, one color — same signal, clearer communication.
 *
 * Scenario map (matches the product spec table):
 *   Scenario                  | State                  | Color          | Hex     | Label
 *   ------------------------- | ---------------------- | -------------- | ------- | --------------------
 *   > 24h before start        | Normal                 | Blue           | #3B82F6 | Normal
 *   < 24h & > 4h              | Urgent                 | Orange         | #F59E0B | Urgent
 *   < 4h before start         | Emergency              | Red            | #EF4444 | Emergency
 *   Clock-in before start     | In Progress (Early)    | Indigo         | #6366F1 | In Progress (Early)
 *   Clock-in exactly on time  | In Progress (On Time)  | Green          | #10B981 | In Progress (On Time)
 *   Clock-in after start      | In Progress (Late)     | Amber          | #FBBF24 | In Progress (Late)
 *   Start passed, no clock-in | Late (Missing)         | Yellow         | #EAB308 | Late (Missing)
 *   Clock-out before end      | Completed (Early Exit) | Teal           | #14B8A6 | Completed (Early Exit)
 *   Clock-out exactly on time | Completed (On Time)    | Purple         | #8B5CF6 | Completed (On Time)
 *   Clock-out after end       | Completed (Overtime)   | Deep Purple    | #6D28D9 | Completed (Overtime)
 *   No clock-in at all        | No Show                | BLOOD RED      | #7F1D1D | No Show
 */
export function getStatusDotInfo(shift: ShiftDotInput): StatusBadge | null {
    const lc = (shift.lifecycle_status || '').toLowerCase();
    const isCancelled = lc === 'cancelled' || shift.is_cancelled;

    // 1. No Show — checked first, can coexist with any lifecycle
    if (shift.assignment_outcome === 'no_show') {
        return { color: '#7F1D1D', label: 'No Show' };
    }

    // 2. Auto clock-out — system-enforced completion, overrides generic Completed
    if (shift.attendance_status === 'auto_clock_out') {
        return { color: '#A855F7', label: 'Completed - Auto Clock-Out' };
    }

    // 3. Cancelled → no dot
    if (isCancelled) return null;

    // ── Pre-calculate times ───────────────────────────────────────────────────
    const schedStartMs = shift.start_at
        ? new Date(shift.start_at).getTime()
        : shift.shift_date && shift.start_time
            ? new Date(`${shift.shift_date}T${shift.start_time}`).getTime()
            : null;

    const schedEndMs = shift.end_at
        ? new Date(shift.end_at).getTime()
        : shift.shift_date && shift.end_time
            ? new Date(`${shift.shift_date}T${shift.end_time}`).getTime()
            : null;

    const actualStartMs = shift.actual_start ? new Date(shift.actual_start).getTime() : null;
    const actualEndMs = shift.actual_end ? new Date(shift.actual_end).getTime() : null;
    const now = Date.now();

    // 3. Completed (has actual_end)
    // We check actual times REGARDLESS of lifecycle_status to fix UI lag
    if (actualEndMs !== null) {
        if (schedEndMs !== null) {
            const diff = actualEndMs - schedEndMs;
            if (diff < -5 * 60 * 1000) return { color: '#14B8A6', label: 'Completed (Early Exit)' };
            if (diff >  5 * 60 * 1000) return { color: '#6D28D9', label: 'Completed (Overtime)' };
            return { color: '#8B5CF6', label: 'Completed (On Time)' };
        }
        return { color: '#8B5CF6', label: 'Completed (On Time)' };
    }

    // 4. In Progress (has actual_start but no actual_end)
    if (actualStartMs !== null) {
        if (schedStartMs !== null) {
            const diff = actualStartMs - schedStartMs;
            if (diff < -5 * 60 * 1000) return { color: '#6366F1', label: 'In Progress (Early)' };
            if (diff >  5 * 60 * 1000) return { color: '#FBBF24', label: 'In Progress (Late)' };
        }
        return { color: '#10B981', label: 'In Progress (On Time)' };
    }

    // 5. Published past start, no clock-in → Late (Missing)
    if (lc === 'published' && schedStartMs !== null && now > schedStartMs) {
        return { color: '#EAB308', label: 'Late (Missing)' };
    }

    // 6. Draft past start → no dot
    if (lc === 'draft' && schedStartMs !== null && now > schedStartMs) return null;

    // 7. Future/Current — TTS-based
    if (schedStartMs === null) return { color: '#3B82F6', label: 'Normal' };

    const ttsMs = schedStartMs - now;
    if (ttsMs <= 4  * 60 * 60 * 1000) return { color: '#EF4444', label: 'Emergency' };
    if (ttsMs <= 24 * 60 * 60 * 1000) return { color: '#F59E0B', label: 'Urgent'    };
    return { color: '#3B82F6', label: 'Normal' };
}

/**
 * Available FSM actions for a given state.
 * This is the single source of truth for action menus.
 * 
 * NOTE: As of 2026-04-02, S1 (Draft-Unassigned) publication is restricted 
 * to non-emergent shifts only. Emergent S1 shifts must be assigned (to S2) 
 * before they can be published (triggers direct-to-confirmed).
 */
export function getAvailableActions(state: ShiftStateID | string, urgency?: ShiftUrgency): ShiftAction[] {
    switch (state) {
        case 'S1': {
            const actions: ShiftAction[] = ['ASSIGN', 'DELETE'];
            if (urgency !== 'emergent') {
                actions.push('PUBLISH');
            }
            return actions;
        }
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

