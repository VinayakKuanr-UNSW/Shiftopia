/**
 * determineShiftState — exhaustive test suite
 *
 * Covers all 15 canonical states (S1–S15), the Unknown fallback, and edge
 * cases including missing fields, conflicting signals, and the priority order
 * of the state machine.
 *
 * State reference:
 *   S1  Draft + unassigned
 *   S2  Draft + assigned          (pending outcome)
 *   S3  Published + assigned + offered
 *   S4  Published + assigned + confirmed (no trade)
 *   S5  Published + unassigned    (normal / open bidding)
 *   S6  Published + unassigned + on_bidding_urgent
 *   S7  Published + assigned + emergency_assigned
 *   S8  Published + unassigned + bidding_closed_no_winner
 *   S9  Published + assigned + confirmed + trade_requested
 *   S10 (not directly detectable via shift fields alone)
 *   S11 InProgress + assigned + confirmed
 *   S12 InProgress + assigned + emergency_assigned
 *   S13 Completed + assigned + confirmed
 *   S14 Completed + assigned + emergency_assigned
 *   S15 Cancelled
 */

import { describe, it, expect } from 'vitest';
import { determineShiftState, getShiftStateDebugString, type ShiftStateID } from '../shift-state.utils';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal shift factory — only sets the fields the test cares about. */
function shift(overrides: Parameters<typeof determineShiftState>[0]) {
    return overrides;
}

function assertState(s: Parameters<typeof determineShiftState>[0], expected: ShiftStateID) {
    expect(determineShiftState(s)).toBe(expected);
}

// ── S15: Cancelled (highest priority) ────────────────────────────────────────

describe('S15 — Cancelled', () => {
    it('matches when lifecycle_status is Cancelled', () => {
        assertState(shift({ lifecycle_status: 'Cancelled' }), 'S15');
    });

    it('matches when is_cancelled is true (lifecycle can be anything)', () => {
        assertState(shift({ is_cancelled: true }), 'S15');
        assertState(shift({ is_cancelled: true, lifecycle_status: 'Draft' }), 'S15');
        assertState(shift({ is_cancelled: true, lifecycle_status: 'Published' }), 'S15');
        assertState(shift({ is_cancelled: true, lifecycle_status: 'Completed' }), 'S15');
    });

    it('takes priority over all other field combinations', () => {
        assertState(
            shift({
                lifecycle_status: 'Cancelled',
                assignment_status: 'assigned',
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

    it('matches regardless of assignment_outcome (pending outcome state)', () => {
        assertState(shift({ lifecycle_status: 'Draft', assignment_status: 'assigned', assignment_outcome: 'pending' }), 'S2');
        assertState(shift({ lifecycle_status: 'Draft', assignment_status: 'assigned', assignment_outcome: 'offered' }), 'S2');
    });
});

// ── S5: Published + unassigned (baseline) ────────────────────────────────────

describe('S5 — Published unassigned (open)', () => {
    it('matches Published + unassigned without special bidding status', () => {
        assertState(shift({ lifecycle_status: 'Published', assignment_status: 'unassigned' }), 'S5');
    });

    it('matches when bidding_status is not_on_bidding', () => {
        assertState(
            shift({ lifecycle_status: 'Published', assignment_status: 'unassigned', bidding_status: 'not_on_bidding' }),
            'S5',
        );
    });
});

// ── S6: Published + unassigned + urgent ──────────────────────────────────────

describe('S6 — Published unassigned urgent bidding', () => {
    it('matches on_bidding_urgent', () => {
        assertState(
            shift({ lifecycle_status: 'Published', assignment_status: 'unassigned', bidding_status: 'on_bidding_urgent' }),
            'S6',
        );
    });
});

// ── S8: Published + unassigned + closed no winner ────────────────────────────

describe('S8 — Published unassigned bidding closed', () => {
    it('matches bidding_closed_no_winner', () => {
        assertState(
            shift({ lifecycle_status: 'Published', assignment_status: 'unassigned', bidding_status: 'bidding_closed_no_winner' }),
            'S8',
        );
    });
});

// ── S3: Published + assigned + offered ───────────────────────────────────────

describe('S3 — Published assigned offered', () => {
    it('matches Published + assigned + offered', () => {
        assertState(
            shift({ lifecycle_status: 'Published', assignment_status: 'assigned', assignment_outcome: 'offered' }),
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

    it('does NOT match when trade_requested_at is set (that is S9)', () => {
        expect(
            determineShiftState(shift({
                lifecycle_status: 'Published',
                assignment_status: 'assigned',
                assignment_outcome: 'confirmed',
                trade_requested_at: '2024-01-01T10:00:00Z',
            })),
        ).not.toBe('S4');
    });
});

// ── S9: Published + assigned + confirmed + trade_requested ────────────────────

describe('S9 — Published assigned confirmed with trade request', () => {
    it('matches when trade_requested_at is set', () => {
        assertState(
            shift({
                lifecycle_status:   'Published',
                assignment_status:  'assigned',
                assignment_outcome: 'confirmed',
                trade_requested_at: '2024-01-01T10:00:00Z',
            }),
            'S9',
        );
    });
});

// ── S7: Published + assigned + emergency ─────────────────────────────────────

describe('S7 — Published assigned emergency', () => {
    it('matches Published + assigned + emergency_assigned', () => {
        assertState(
            shift({
                lifecycle_status:   'Published',
                assignment_status:  'assigned',
                assignment_outcome: 'emergency_assigned',
            }),
            'S7',
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

// ── S12: InProgress + assigned + emergency ───────────────────────────────────

describe('S12 — InProgress assigned emergency', () => {
    it('matches', () => {
        assertState(
            shift({ lifecycle_status: 'InProgress', assignment_status: 'assigned', assignment_outcome: 'emergency_assigned' }),
            'S12',
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

// ── S14: Completed + assigned + emergency ────────────────────────────────────

describe('S14 — Completed assigned emergency', () => {
    it('matches', () => {
        assertState(
            shift({ lifecycle_status: 'Completed', assignment_status: 'assigned', assignment_outcome: 'emergency_assigned' }),
            'S14',
        );
    });
});

// ── Unknown ───────────────────────────────────────────────────────────────────

describe('Unknown — unrecognised combinations', () => {
    it('returns Unknown for an empty object', () => {
        assertState(shift({}), 'Unknown');
    });

    it('returns Unknown for InProgress + unassigned (no defined state)', () => {
        assertState(
            shift({ lifecycle_status: 'InProgress', assignment_status: 'unassigned' }),
            'Unknown',
        );
    });

    it('returns Unknown for Completed + unassigned', () => {
        assertState(
            shift({ lifecycle_status: 'Completed', assignment_status: 'unassigned' }),
            'Unknown',
        );
    });

    it('returns Unknown for Published + assigned with no outcome', () => {
        assertState(
            shift({ lifecycle_status: 'Published', assignment_status: 'assigned' }),
            'Unknown',
        );
    });
});

// ── Priority: S15 beats everything ───────────────────────────────────────────

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

    it('S9 takes precedence over S4 when trade_requested_at is present', () => {
        assertState(
            shift({
                lifecycle_status:   'Published',
                assignment_status:  'assigned',
                assignment_outcome: 'confirmed',
                trade_requested_at: '2024-03-15T08:00:00Z',
            }),
            'S9',
        );
    });

    it('S6 takes precedence over S5 when bidding is urgent', () => {
        assertState(
            shift({
                lifecycle_status:  'Published',
                assignment_status: 'unassigned',
                bidding_status:    'on_bidding_urgent',
            }),
            'S6',
        );
    });

    it('S8 takes precedence over S5 when bidding is closed', () => {
        assertState(
            shift({
                lifecycle_status:  'Published',
                assignment_status: 'unassigned',
                bidding_status:    'bidding_closed_no_winner',
            }),
            'S8',
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

    it('fills outcome with Pending for S2 when outcome is null', () => {
        const debug = getShiftStateDebugString(shift({
            lifecycle_status:  'Draft',
            assignment_status: 'assigned',
        }));
        expect(debug.id).toBe('S2');
        expect(debug.outcome).toBe('Pending');
    });

    it('returns trading: Trade Requested when trade_requested_at is set', () => {
        const debug = getShiftStateDebugString(shift({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
            trade_requested_at: '2024-01-01T10:00:00Z',
        }));
        expect(debug.trading).toBe('Trade Requested');
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
        // format() uses /\b\w/: no boundary between 'n' and 'P' in 'InProgress',
        // so the camelCase is preserved verbatim.
        expect(debug.lifecycle).toBe('InProgress');
    });
});

// ── All 14 detectable states covered ─────────────────────────────────────────

describe('Full state coverage — one canonical fixture per state', () => {
    const cases: [string, Parameters<typeof determineShiftState>[0], ShiftStateID][] = [
        ['S1',  { lifecycle_status: 'Draft',      assignment_status: 'unassigned' },                                                                                           'S1'],
        ['S2',  { lifecycle_status: 'Draft',      assignment_status: 'assigned' },                                                                                             'S2'],
        ['S3',  { lifecycle_status: 'Published',  assignment_status: 'assigned',   assignment_outcome: 'offered' },                                                           'S3'],
        ['S4',  { lifecycle_status: 'Published',  assignment_status: 'assigned',   assignment_outcome: 'confirmed' },                                                         'S4'],
        ['S5',  { lifecycle_status: 'Published',  assignment_status: 'unassigned' },                                                                                           'S5'],
        ['S6',  { lifecycle_status: 'Published',  assignment_status: 'unassigned', bidding_status: 'on_bidding_urgent' },                                                      'S6'],
        ['S7',  { lifecycle_status: 'Published',  assignment_status: 'assigned',   assignment_outcome: 'emergency_assigned' },                                                'S7'],
        ['S8',  { lifecycle_status: 'Published',  assignment_status: 'unassigned', bidding_status: 'bidding_closed_no_winner' },                                               'S8'],
        ['S9',  { lifecycle_status: 'Published',  assignment_status: 'assigned',   assignment_outcome: 'confirmed',        trade_requested_at: '2024-01-01T00:00:00Z' },      'S9'],
        ['S11', { lifecycle_status: 'InProgress', assignment_status: 'assigned',   assignment_outcome: 'confirmed' },                                                         'S11'],
        ['S12', { lifecycle_status: 'InProgress', assignment_status: 'assigned',   assignment_outcome: 'emergency_assigned' },                                                'S12'],
        ['S13', { lifecycle_status: 'Completed',  assignment_status: 'assigned',   assignment_outcome: 'confirmed' },                                                         'S13'],
        ['S14', { lifecycle_status: 'Completed',  assignment_status: 'assigned',   assignment_outcome: 'emergency_assigned' },                                                'S14'],
        ['S15', { lifecycle_status: 'Cancelled' },                                                                                                                             'S15'],
    ];

    it.each(cases)('%s is correctly identified', (_label, input, expected) => {
        assertState(shift(input), expected);
    });
});
