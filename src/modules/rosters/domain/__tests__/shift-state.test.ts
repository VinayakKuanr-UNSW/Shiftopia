/**
 * determineShiftState — exhaustive test suite
 *
 * Mirrors the canonical FSM in shift-fsm.ts:
 *   - State derivation reads { lifecycle_status, assignment_status,
 *     assignment_outcome, trading_status, is_cancelled } only.
 *   - Legacy bidding_status and trade_requested_at columns are NOT FSM inputs.
 *   - S6, S7, S8, S12, S14 are never returned (kept in the union for
 *     backward-compatible type-checks only).
 *   - Unrecognized combinations resolve to 'UNKNOWN' (not 'Unknown').
 *
 * State reference (active):
 *   S1  Draft + unassigned
 *   S2  Draft + assigned
 *   S3  Published + assigned + outcome IS NULL
 *   S4  Published + assigned + outcome='confirmed'
 *   S5  Published + unassigned
 *   S9  Published + assigned + confirmed + trading_status='TradeRequested'
 *   S10 Published + assigned + confirmed + trading_status='TradeAccepted'
 *   S11 InProgress + assigned + confirmed
 *   S13 Completed + assigned + confirmed
 *   S15 is_cancelled=true (overrides everything)
 */

import { describe, it, expect } from 'vitest';
import { determineShiftState, getShiftStateDebugString, type ShiftStateID } from '../shift-state.utils';

function shift(overrides: Parameters<typeof determineShiftState>[0]) {
    return overrides;
}

function assertState(s: Parameters<typeof determineShiftState>[0], expected: ShiftStateID) {
    expect(determineShiftState(s)).toBe(expected);
}

// ── S15: Cancelled (highest priority) ────────────────────────────────────────

describe('S15 — Cancelled', () => {
    it('matches when is_cancelled is true', () => {
        assertState(shift({ is_cancelled: true }), 'S15');
        assertState(shift({ is_cancelled: true, lifecycle_status: 'Draft' }), 'S15');
        assertState(shift({ is_cancelled: true, lifecycle_status: 'Published' }), 'S15');
        assertState(shift({ is_cancelled: true, lifecycle_status: 'Completed' }), 'S15');
    });

    it('takes priority over all other field combinations', () => {
        assertState(
            shift({
                is_cancelled:       true,
                lifecycle_status:   'Published',
                assignment_status:  'assigned',
                assignment_outcome: 'confirmed',
            }),
            'S15',
        );
    });
});

// ── S1: Draft + unassigned ────────────────────────────────────────────────────

describe('S1 — Draft unassigned', () => {
    it('matches Draft + unassigned', () => {
        assertState(shift({ lifecycle_status: 'Draft', assignment_status: 'unassigned' }), 'S1');
    });

    it('does NOT match when assignment_status is assigned', () => {
        expect(determineShiftState(shift({ lifecycle_status: 'Draft', assignment_status: 'assigned' }))).not.toBe('S1');
    });
});

// ── S2: Draft + assigned ──────────────────────────────────────────────────────

describe('S2 — Draft assigned', () => {
    it('matches Draft + assigned', () => {
        assertState(shift({ lifecycle_status: 'Draft', assignment_status: 'assigned' }), 'S2');
    });

    it('matches regardless of assignment_outcome', () => {
        assertState(shift({ lifecycle_status: 'Draft', assignment_status: 'assigned', assignment_outcome: null }), 'S2');
        assertState(shift({ lifecycle_status: 'Draft', assignment_status: 'assigned', assignment_outcome: 'confirmed' }), 'S2');
    });
});

// ── S5: Published + unassigned (always — bidding_status is not an FSM input) ──

describe('S5 — Published unassigned (open)', () => {
    it('matches Published + unassigned', () => {
        assertState(shift({ lifecycle_status: 'Published', assignment_status: 'unassigned' }), 'S5');
    });

    it('still matches when legacy bidding_status fields are present (FSM ignores them)', () => {
        assertState(
            shift({ lifecycle_status: 'Published', assignment_status: 'unassigned', bidding_status: 'on_bidding_urgent' } as any),
            'S5',
        );
        assertState(
            shift({ lifecycle_status: 'Published', assignment_status: 'unassigned', bidding_status: 'bidding_closed_no_winner' } as any),
            'S5',
        );
    });
});

// ── S3: Published + assigned + outcome IS NULL (awaiting acceptance) ─────────

describe('S3 — Published assigned awaiting acceptance', () => {
    it('matches Published + assigned + outcome=null', () => {
        assertState(
            shift({ lifecycle_status: 'Published', assignment_status: 'assigned', assignment_outcome: null }),
            'S3',
        );
    });

    it('matches Published + assigned with no outcome field provided', () => {
        assertState(
            shift({ lifecycle_status: 'Published', assignment_status: 'assigned' }),
            'S3',
        );
    });
});

// ── S4: Published + assigned + confirmed (no trade) ──────────────────────────

describe('S4 — Published assigned confirmed', () => {
    it('matches Published + assigned + confirmed with no trade', () => {
        assertState(
            shift({ lifecycle_status: 'Published', assignment_status: 'assigned', assignment_outcome: 'confirmed' }),
            'S4',
        );
    });

    it('does NOT match when trading_status=TradeRequested (that is S9)', () => {
        expect(
            determineShiftState(shift({
                lifecycle_status:   'Published',
                assignment_status:  'assigned',
                assignment_outcome: 'confirmed',
                trading_status:     'TradeRequested',
            })),
        ).not.toBe('S4');
    });
});

// ── S9: Published + assigned + confirmed + trading_status='TradeRequested' ────

describe('S9 — Published assigned confirmed with trade request', () => {
    it('matches when trading_status is TradeRequested', () => {
        assertState(
            shift({
                lifecycle_status:   'Published',
                assignment_status:  'assigned',
                assignment_outcome: 'confirmed',
                trading_status:     'TradeRequested',
            }),
            'S9',
        );
    });
});

// ── S11: InProgress + assigned + confirmed ───────────────────────────────────

describe('S11 — InProgress assigned confirmed', () => {
    it('matches', () => {
        assertState(
            shift({ lifecycle_status: 'InProgress', assignment_status: 'assigned', assignment_outcome: 'confirmed' }),
            'S11',
        );
    });
});

// ── S13: Completed + assigned + confirmed ────────────────────────────────────

describe('S13 — Completed assigned confirmed', () => {
    it('matches', () => {
        assertState(
            shift({ lifecycle_status: 'Completed', assignment_status: 'assigned', assignment_outcome: 'confirmed' }),
            'S13',
        );
    });
});

// ── UNKNOWN fallback ──────────────────────────────────────────────────────────

describe('UNKNOWN — unrecognised combinations', () => {
    it('returns UNKNOWN for an empty object', () => {
        assertState(shift({}), 'UNKNOWN');
    });

    it('returns S11 for InProgress + unassigned (lifecycle wins, FSM does not branch on assignment here)', () => {
        // The FSM resolves any InProgress shift to S11. The unassigned-but-in-progress
        // combination is rare/invalid in practice, but the FSM returns S11 not UNKNOWN.
        assertState(
            shift({ lifecycle_status: 'InProgress', assignment_status: 'unassigned' }),
            'S11',
        );
    });

    it('returns S13 for Completed + unassigned (same — lifecycle wins)', () => {
        assertState(
            shift({ lifecycle_status: 'Completed', assignment_status: 'unassigned' }),
            'S13',
        );
    });

    it('returns S3 for Published + assigned with no outcome (awaiting acceptance)', () => {
        assertState(
            shift({ lifecycle_status: 'Published', assignment_status: 'assigned' }),
            'S3',
        );
    });
});

// ── Priority rules ───────────────────────────────────────────────────────────

describe('Priority rules', () => {
    it('S15 beats InProgress + confirmed', () => {
        assertState(
            shift({
                lifecycle_status:   'InProgress',
                assignment_status:  'assigned',
                assignment_outcome: 'confirmed',
                is_cancelled:       true,
            }),
            'S15',
        );
    });

    it('S9 takes precedence over S4 when trading_status=TradeRequested', () => {
        assertState(
            shift({
                lifecycle_status:   'Published',
                assignment_status:  'assigned',
                assignment_outcome: 'confirmed',
                trading_status:     'TradeRequested',
            }),
            'S9',
        );
    });

    it('S10 takes precedence over S4 when trading_status=TradeAccepted', () => {
        assertState(
            shift({
                lifecycle_status:   'Published',
                assignment_status:  'assigned',
                assignment_outcome: 'confirmed',
                trading_status:     'TradeAccepted',
            }),
            'S10',
        );
    });
});

// ── getShiftStateDebugString ──────────────────────────────────────────────────

describe('getShiftStateDebugString', () => {
    it('returns the correct state id', () => {
        const debug = getShiftStateDebugString(shift({
            lifecycle_status:  'Draft',
            assignment_status: 'unassigned',
        }));
        expect(debug.id).toBe('S1');
    });

    it('outcome is "-" when no assignment_outcome is provided', () => {
        const debug = getShiftStateDebugString(shift({
            lifecycle_status:  'Draft',
            assignment_status: 'assigned',
        }));
        expect(debug.id).toBe('S2');
        expect(debug.outcome).toBe('-');
    });

    it('returns trading: Trade Requested when trading_status=TradeRequested', () => {
        const debug = getShiftStateDebugString(shift({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
            trading_status:     'TradeRequested',
        }));
        // format() applies /\b\w/ → uppercase first char only; PascalCase passes through unchanged.
        expect(debug.trading).toBe('TradeRequested');
    });

    it('returns trading: No when trade is not requested', () => {
        const debug = getShiftStateDebugString(shift({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
        }));
        expect(debug.trading).toBe('No');
    });

    it('formats lifecycle status label correctly', () => {
        const debug = getShiftStateDebugString(shift({
            lifecycle_status:  'InProgress',
            assignment_status: 'assigned',
            assignment_outcome: 'confirmed',
        }));
        expect(debug.lifecycle).toBe('InProgress');
    });
});

// ── All active states covered by canonical fixtures ──────────────────────────

describe('Full state coverage — one canonical fixture per active FSM state', () => {
    const cases: [string, Parameters<typeof determineShiftState>[0], ShiftStateID][] = [
        ['S1',  { lifecycle_status: 'Draft',      assignment_status: 'unassigned' },                                                                                            'S1'],
        ['S2',  { lifecycle_status: 'Draft',      assignment_status: 'assigned' },                                                                                              'S2'],
        ['S3',  { lifecycle_status: 'Published',  assignment_status: 'assigned',   assignment_outcome: null },                                                                  'S3'],
        ['S4',  { lifecycle_status: 'Published',  assignment_status: 'assigned',   assignment_outcome: 'confirmed' },                                                           'S4'],
        ['S5',  { lifecycle_status: 'Published',  assignment_status: 'unassigned' },                                                                                            'S5'],
        ['S9',  { lifecycle_status: 'Published',  assignment_status: 'assigned',   assignment_outcome: 'confirmed', trading_status: 'TradeRequested' },                         'S9'],
        ['S10', { lifecycle_status: 'Published',  assignment_status: 'assigned',   assignment_outcome: 'confirmed', trading_status: 'TradeAccepted'  },                         'S10'],
        ['S11', { lifecycle_status: 'InProgress', assignment_status: 'assigned',   assignment_outcome: 'confirmed' },                                                           'S11'],
        ['S13', { lifecycle_status: 'Completed',  assignment_status: 'assigned',   assignment_outcome: 'confirmed' },                                                           'S13'],
        ['S15', { is_cancelled: true },                                                                                                                                          'S15'],
    ];

    it.each(cases)('%s is correctly identified', (_label, input, expected) => {
        assertState(shift(input), expected);
    });
});
