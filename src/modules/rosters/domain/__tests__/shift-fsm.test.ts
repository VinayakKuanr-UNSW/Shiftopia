/**
 * shift-fsm.test.ts
 *
 * Unit tests for:
 *   - getShiftFSMState      (all 10 valid states + edge cases)
 *   - getLockState
 *
 * All tests are pure — no mocking, no network calls.
 */

import { describe, it, expect } from 'vitest';

import {
    getShiftFSMState,
    describeKickoffCancel,
    type ShiftFSMInput,
    type ShiftStateID,
} from '../shift-fsm';

import {
    getLockState,
} from '../shift-ui';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal ShiftFSMInput; all optional fields default to safe values. */
function fsmInput(overrides: Partial<ShiftFSMInput> & { lifecycle_status?: string }): ShiftFSMInput {
    return {
        lifecycle_status:   'Draft',
        assignment_status:  'unassigned',
        assignment_outcome: null,
        trading_status:     null,
        is_cancelled:       false,
        ...overrides,
    };
}

function assertState(input: Partial<ShiftFSMInput>, expected: ShiftStateID) {
    expect(getShiftFSMState(fsmInput(input))).toBe(expected);
}

// ─── 1. getShiftFSMState — all 10 valid states ───────────────────────────────

describe('getShiftFSMState — 10 canonical states', () => {

    it('S1  — Draft + unassigned', () => {
        assertState({ lifecycle_status: 'Draft', assignment_status: 'unassigned' }, 'S1');
    });

    it('S2  — Draft + assigned', () => {
        assertState({ lifecycle_status: 'Draft', assignment_status: 'assigned' }, 'S2');
    });

    it('S3  — Published + assigned + outcome=null', () => {
        assertState({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: null,
        }, 'S3');
    });

    it('S4  — Published + assigned + outcome=confirmed', () => {
        assertState({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
        }, 'S4');
    });

    it('S5  — Published + unassigned', () => {
        assertState({
            lifecycle_status:  'Published',
            assignment_status: 'unassigned',
        }, 'S5');
    });

    it('S6  — Published + assigned + confirmed + TradeRequested', () => {
        assertState({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
            trading_status:     'TradeRequested',
        }, 'S6');
    });

    it('S7 — Published + assigned + confirmed + TradeAccepted', () => {
        assertState({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
            trading_status:     'TradeAccepted',
        }, 'S7');
    });

    it('S8 — InProgress + assigned + confirmed', () => {
        assertState({
            lifecycle_status:   'InProgress',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
        }, 'S8');
    });

    it('S9 — Completed + assigned + confirmed', () => {
        assertState({
            lifecycle_status:   'Completed',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
        }, 'S9');
    });

    it('S10 — is_cancelled=true (any other fields)', () => {
        assertState({
            lifecycle_status:   'Draft',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
            is_cancelled:       true,
        }, 'S10');
    });
});

// ─── 2. Edge cases ────────────────────────────────────────────────────────────

describe('getShiftFSMState — edge cases', () => {

    it('assignment_outcome=no_show + InProgress → S8 (lifecycle wins)', () => {
        // The FSM returns S8 for any InProgress shift regardless of outcome value;
        // no_show does not route to a different state here.
        assertState({
            lifecycle_status:   'InProgress',
            assignment_status:  'assigned',
            assignment_outcome: 'no_show',
        }, 'S8');
    });

    it('emergency_source present → does NOT affect derived state (S4 still S4)', () => {
        // emergency_source is not part of ShiftFSMInput — it lives on ShiftUIContextInput only.
        // We verify by building a plain confirmed Published shift and checking S4.
        assertState({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
        }, 'S4');
    });

    it('bidding_status=on_bidding_urgent (legacy) → still S5 (bidding_status not an FSM input)', () => {
        // ShiftFSMInput has no bidding_status field; FSM ignores it entirely.
        // A Published + unassigned shift is always S5.
        assertState({
            lifecycle_status:  'Published',
            assignment_status: 'unassigned',
        }, 'S5');
    });

    it('is_cancelled=true + lifecycle_status=Completed → S10 (cancelled overrides everything)', () => {
        assertState({
            lifecycle_status:   'Completed',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
            is_cancelled:       true,
        }, 'S10');
    });

    it('S6 takes precedence over S4 (trade overrides assignment outcome)', () => {
        // Even though assignment_outcome=confirmed, trading_status=TradeRequested → S6
        const result = getShiftFSMState(fsmInput({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
            trading_status:     'TradeRequested',
        }));
        expect(result).toBe('S6');
        expect(result).not.toBe('S4');
    });

    it('invalid combination (empty lifecycle_status) → returns UNKNOWN', () => {
        // FSM no longer throws; it warns and returns the neutral 'UNKNOWN' fallback
        // so the UI can render a placeholder card instead of crashing the boundary.
        expect(getShiftFSMState(fsmInput({ lifecycle_status: '' }))).toBe('UNKNOWN');
    });
});

// ─── 3. getLockState ─────────────────────────────────────────────────────────

describe('getLockState', () => {

    it('S1 → { fullyLocked: false, partialLock: false }', () => {
        expect(getLockState('S1')).toEqual({ fullyLocked: false, partialLock: false });
    });

    it('S2 → { fullyLocked: false, partialLock: false }', () => {
        expect(getLockState('S2')).toEqual({ fullyLocked: false, partialLock: false });
    });

    it('S4 → { fullyLocked: false, partialLock: true }', () => {
        expect(getLockState('S4')).toEqual({ fullyLocked: false, partialLock: true });
    });

    it('S5 → { fullyLocked: false, partialLock: true }', () => {
        expect(getLockState('S5')).toEqual({ fullyLocked: false, partialLock: true });
    });

    it('S6 → { fullyLocked: false, partialLock: true }', () => {
        expect(getLockState('S6')).toEqual({ fullyLocked: false, partialLock: true });
    });

    it('S7 → { fullyLocked: false, partialLock: true }', () => {
        expect(getLockState('S7')).toEqual({ fullyLocked: false, partialLock: true });
    });

    it('S3  → { fullyLocked: false, partialLock: true } (published, schedule-locked but notes editable)', () => {
        expect(getLockState('S3')).toEqual({ fullyLocked: false, partialLock: true });
    });

    it('S8 → { fullyLocked: true, partialLock: false }', () => {
        expect(getLockState('S8')).toEqual({ fullyLocked: true, partialLock: false });
    });

    it('S9 → { fullyLocked: true, partialLock: false }', () => {
        expect(getLockState('S9')).toEqual({ fullyLocked: true, partialLock: false });
    });

    it('S10 → { fullyLocked: true, partialLock: false }', () => {
        expect(getLockState('S10')).toEqual({ fullyLocked: true, partialLock: false });
    });
});

// ─── 6. describeKickoffCancel ────────────────────────────────────────────────

describe('describeKickoffCancel (03-bidding-fsm.md B-D10)', () => {
    it.each([
        ['A', 'A — Offer ignored until the shift started'],
        ['B', 'B — Bidding found no winner'],
        ['C', 'C — Draft+Unassigned never published'],
        ['D', 'D — Draft+Assigned never published'],
        ['E', 'E — Published shift manually cancelled'],
    ])('code %s → %s', (code, label) => {
        expect(describeKickoffCancel(code)).toBe(label);
    });

    it('E carries the manager\'s note', () => {
        expect(describeKickoffCancel('E', 'Event cancelled by the client'))
            .toBe('E — Published shift manually cancelled: Event cancelled by the client');
    });

    it('a system code ignores the note', () => {
        expect(describeKickoffCancel('B', 'anything')).toBe('B — Bidding found no winner');
    });

    it.each([null, undefined, '', 'Z'])('%s → null (unknown code or absent)', code => {
        expect(describeKickoffCancel(code)).toBeNull();
    });
});
