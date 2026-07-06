/**
 * FSM End-to-End Suite — every state, every transition.
 *
 * Three layers, all network-free:
 *
 *  1. STATE DERIVATION  — every canonical state (S1…S15 slim lineage + UNKNOWN)
 *     derived from its 5-column DB combination, plus the gapless display-ID map.
 *
 *  2. TRANSITION MATRIX — the full op × state legality table for the client
 *     gateway pre-flight (`isShiftOpLegal`), asserted exhaustively, plus a
 *     parity invariant against the LIVE DB guard `public.fsm_op_is_legal`
 *     (its CASE matrix is pinned below verbatim): the client must be a
 *     conservative subset of the DB — it may forbid more, never less.
 *
 *  3. LIFECYCLE WALKS  — real multi-step paths through the machine, mutating
 *     the 5 columns exactly the way the documented ops do and asserting the
 *     derived state at every step:
 *       • direct-assignment happy path  S1→S2→S3→S4→S11→S13
 *       • bidding path                  S1→S5→(select winner: direct-to-S4)
 *       • swap path                     S4→S9 (initiate) →S10 (peer accepts)
 *                                          →S4' (manager approves, shift reassigned)
 *       • swap rejection / expiry       S9/S10 → S4 (revert, cron `process_shift_timers`)
 *       • TTS=4h offer/bidding expiry   S3→S2, S5→S1
 *       • cancellation                  any live state → S15
 *
 * Pinned DB guard (public.fsm_op_is_legal, fetched from prod 2026-07-02):
 *   select_winner → {S5,S6}          publish  → {S1,S2}
 *   unpublish     → {S3,S4,S5,S9,S10}
 *   assign        → {S1…S8}          unassign → {S2}
 *   approve_trade → {S10}            reject_trade → {S9,S10}
 *   delete/edit   → {S1…S10}
 * (S6/S7/S8 belong to the fuller DB lineage the slim card FSM never emits.)
 */

import { describe, it, expect } from 'vitest';
import {
    getShiftFSMState,
    getShiftStateDisplay,
    isShiftTerminal,
    isShiftOnBidding,
    isShiftOffered,
    FSM_STATE_META,
    type ShiftFSMInput,
    type ShiftStateID,
} from '../shift-fsm';
import {
    isShiftOpLegal,
    OP_LEGALITY,
    type ShiftOp,
    type ShiftLegalityCtx,
} from '../shift-op-legality';

// ─── Column combos: the canonical 5-column shape of every state ───────────────

function shift(overrides: Partial<ShiftFSMInput> = {}): ShiftFSMInput {
    return {
        lifecycle_status: 'Draft',
        assignment_status: 'unassigned',
        assignment_outcome: null,
        trading_status: 'NoTrade',
        is_cancelled: false,
        ...overrides,
    };
}

/** The authoritative column combination for each canonical slim-FSM state. */
const STATE_COMBOS: Record<Exclude<ShiftStateID, 'UNKNOWN'>, ShiftFSMInput> = {
    S1:  shift(),
    S2:  shift({ assignment_status: 'assigned' }),
    S3:  shift({ lifecycle_status: 'Published', assignment_status: 'assigned', assignment_outcome: null }),
    S4:  shift({ lifecycle_status: 'Published', assignment_status: 'assigned', assignment_outcome: 'confirmed' }),
    S5:  shift({ lifecycle_status: 'Published', assignment_status: 'unassigned' }),
    S9:  shift({ lifecycle_status: 'Published', assignment_status: 'assigned', assignment_outcome: 'confirmed', trading_status: 'TradeRequested' }),
    S10: shift({ lifecycle_status: 'Published', assignment_status: 'assigned', assignment_outcome: 'confirmed', trading_status: 'TradeAccepted' }),
    S11: shift({ lifecycle_status: 'InProgress', assignment_status: 'assigned', assignment_outcome: 'confirmed' }),
    S13: shift({ lifecycle_status: 'Completed', assignment_status: 'assigned', assignment_outcome: 'confirmed' }),
    S15: shift({ lifecycle_status: 'Published', assignment_status: 'assigned', is_cancelled: true }),
};

const ALL_STATES = Object.keys(STATE_COMBOS) as Array<keyof typeof STATE_COMBOS>;

// ═══════════════════════════════════════════════════════════════════════════
// 1. STATE DERIVATION — all states
// ═══════════════════════════════════════════════════════════════════════════

describe('FSM state derivation — every canonical state', () => {
    it.each(ALL_STATES)('%s derives from its canonical column combo', (state) => {
        expect(getShiftFSMState(STATE_COMBOS[state])).toBe(state);
    });

    it('cancellation has highest priority (overrides Completed / trade / everything)', () => {
        expect(getShiftFSMState(shift({
            lifecycle_status: 'Completed',
            trading_status: 'TradeAccepted',
            is_cancelled: true,
        }))).toBe('S15');
    });

    it('trade status overrides assignment outcome while Published', () => {
        // Confirmed shift with a trade in flight is S9/S10, not S4
        expect(getShiftFSMState(STATE_COMBOS.S9)).toBe('S9');
        expect(getShiftFSMState(STATE_COMBOS.S10)).toBe('S10');
    });

    it('legacy assignment_outcome values (pending/offered) still derive S3', () => {
        for (const legacy of ['pending', 'offered']) {
            expect(getShiftFSMState(shift({
                lifecycle_status: 'Published',
                assignment_status: 'assigned',
                assignment_outcome: legacy,
            }))).toBe('S3');
        }
    });

    it('unrecognized combination degrades to UNKNOWN (never throws)', () => {
        expect(getShiftFSMState(shift({ lifecycle_status: 'Bogus' }))).toBe('UNKNOWN');
        // Published + unassigned is S5, but Published + weird assignment_status is UNKNOWN
        expect(getShiftFSMState(shift({ lifecycle_status: 'Published', assignment_status: 'weird' }))).toBe('UNKNOWN');
    });
});

describe('Display-ID mapping — gapless card IDs', () => {
    // Canonical → display (tombstones S6/S7/S8/S12/S14 collapsed)
    const EXPECTED_DISPLAY: Record<string, string> = {
        S1: 'S1', S2: 'S2', S3: 'S3', S4: 'S4', S5: 'S5',
        S9: 'S6', S10: 'S7', S11: 'S8', S13: 'S9', S15: 'S10',
    };

    it.each(ALL_STATES)('%s renders as its gapless display ID', (state) => {
        expect(getShiftStateDisplay(state).id).toBe(EXPECTED_DISPLAY[state]);
    });

    it('display IDs S1…S10 are gapless and unique', () => {
        const ids = ALL_STATES.map(s => getShiftStateDisplay(s).id);
        expect(new Set(ids).size).toBe(ids.length);
        expect([...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))))
            .toEqual(['S1','S2','S3','S4','S5','S6','S7','S8','S9','S10']);
    });

    it('UNKNOWN renders the neutral fallback', () => {
        expect(getShiftStateDisplay('UNKNOWN').id).toBe('—');
        expect(FSM_STATE_META.UNKNOWN.color).toBe('gray');
    });
});

describe('State helpers', () => {
    it('terminal = S13 & S15 only', () => {
        for (const s of ALL_STATES) {
            expect(isShiftTerminal(STATE_COMBOS[s])).toBe(s === 'S13' || s === 'S15');
        }
    });
    it('bidding = S5 only; offered = S3 only', () => {
        for (const s of ALL_STATES) {
            expect(isShiftOnBidding(STATE_COMBOS[s])).toBe(s === 'S5');
            expect(isShiftOffered(STATE_COMBOS[s])).toBe(s === 'S3');
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. TRANSITION MATRIX — exhaustive op × state
// ═══════════════════════════════════════════════════════════════════════════

const ALL_OPS = Object.keys(OP_LEGALITY) as ShiftOp[];
const MATRIX_STATES: ShiftStateID[] = [...ALL_STATES, 'UNKNOWN'];

/** Build the standard pre-start context for a state. */
function ctxFor(state: ShiftStateID): ShiftLegalityCtx {
    const assignedStates: ShiftStateID[] = ['S2', 'S3', 'S4', 'S9', 'S10', 'S11', 'S13'];
    return {
        state,
        hasStarted: false,
        isAssigned: assignedStates.includes(state),
        tradePending: state === 'S9' || state === 'S10',
    };
}

/** Expected CLIENT legality (pre-start, trade pending only in S9/S10). */
const CLIENT_LEGAL: Record<ShiftOp, ReadonlySet<ShiftStateID>> = {
    select_winner: new Set(['S5']),
    publish:       new Set(['S1', 'S2']),
    unpublish:     new Set(['S3', 'S4', 'S5', 'S9', 'S10']),
    assign:        new Set(['S1', 'S2', 'S3', 'S4', 'S5']),
    unassign:      new Set(['S2']),
    approve_trade: new Set(['S10']),
    reject_trade:  new Set(['S10']),
    delete:        new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S9', 'S10']),
    edit:          new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S9', 'S10']),
};

/**
 * The LIVE DB guard matrix — pinned verbatim from prod `public.fsm_op_is_legal`
 * (fetched 2026-07-02). If the DB function changes, update this table.
 */
const DB_LEGAL: Record<ShiftOp, ReadonlySet<string>> = {
    select_winner: new Set(['S5', 'S6']),
    publish:       new Set(['S1', 'S2']),
    unpublish:     new Set(['S3', 'S4', 'S5', 'S9', 'S10']),
    assign:        new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']),
    unassign:      new Set(['S2']),
    approve_trade: new Set(['S10']),
    reject_trade:  new Set(['S9', 'S10']),
    delete:        new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10']),
    edit:          new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10']),
};

describe('Op-legality matrix — exhaustive op × state (pre-start)', () => {
    for (const op of ALL_OPS) {
        for (const state of MATRIX_STATES) {
            const expected = CLIENT_LEGAL[op].has(state);
            it(`${op} from ${state} → ${expected ? 'LEGAL' : 'illegal'}`, () => {
                expect(isShiftOpLegal(op, ctxFor(state))).toBe(expected);
            });
        }
    }
});

describe('Client ⊆ DB guard parity (client must never allow what the DB forbids)', () => {
    for (const op of ALL_OPS) {
        it(`${op}: every client-legal state is DB-legal`, () => {
            for (const state of MATRIX_STATES) {
                if (isShiftOpLegal(op, ctxFor(state))) {
                    expect(DB_LEGAL[op].has(state),
                        `client allows ${op} from ${state} but the DB guard forbids it`,
                    ).toBe(true);
                }
            }
        });
    }
});

describe('Boundary signals', () => {
    it('hasStarted=true forbids every op from every state', () => {
        for (const op of ALL_OPS) {
            for (const state of MATRIX_STATES) {
                expect(isShiftOpLegal(op, { ...ctxFor(state), hasStarted: true })).toBe(false);
            }
        }
    });

    it('tradePending=true blocks assign even from S4', () => {
        expect(isShiftOpLegal('assign', { state: 'S4', hasStarted: false, isAssigned: true, tradePending: true })).toBe(false);
    });

    it('tradePending=false blocks approve/reject even at S10 (swap row already resolved)', () => {
        const ctx = { state: 'S10' as const, hasStarted: false, isAssigned: true, tradePending: false };
        expect(isShiftOpLegal('approve_trade', ctx)).toBe(false);
        expect(isShiftOpLegal('reject_trade', ctx)).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LIFECYCLE WALKS — multi-step paths, columns mutated as the real ops do
// ═══════════════════════════════════════════════════════════════════════════

/** Column mutations mirroring each documented operation / trigger. */
const apply = {
    assign:        (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, assignment_status: 'assigned' }),
    unassign:      (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, assignment_status: 'unassigned' }),
    publish:       (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, lifecycle_status: 'Published' }),
    unpublish:     (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, lifecycle_status: 'Draft', assignment_outcome: null, trading_status: 'NoTrade' }),
    confirm:       (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, assignment_outcome: 'confirmed' }),
    // sm_select_bid_winner: direct-to-S4 (assigned + confirmed in one jump)
    selectWinner:  (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, assignment_status: 'assigned', assignment_outcome: 'confirmed' }),
    // swapsApi.createSwapRequest → shift_swaps OPEN + trading_status TradeRequested
    initiateSwap:  (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, trading_status: 'TradeRequested' }),
    // sm_accept_trade (requester selects a peer offer) → TradeAccepted + swap MANAGER_PENDING
    peerAccept:    (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, trading_status: 'TradeAccepted' }),
    // sm_approve_peer_swap / reject_trade / trade expiry → both shifts revert to NoTrade
    resolveTrade:  (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, trading_status: 'NoTrade' }),
    // cron process_shift_timers @ TTS=4h: S3 → S2 (unpublish, keep assignee)
    offerExpire:   (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, lifecycle_status: 'Draft' }),
    // cron process_shift_timers @ TTS=4h: S5 → S1
    biddingExpire: (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, lifecycle_status: 'Draft' }),
    start:         (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, lifecycle_status: 'InProgress' }),
    complete:      (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, lifecycle_status: 'Completed' }),
    cancel:        (s: ShiftFSMInput): ShiftFSMInput => ({ ...s, is_cancelled: true }),
};

/** Walk a path asserting the derived state after every step. */
function walk(start: ShiftFSMInput, steps: Array<[keyof typeof apply, ShiftStateID]>): ShiftFSMInput {
    let cur = start;
    for (const [step, expected] of steps) {
        cur = apply[step](cur);
        expect(getShiftFSMState(cur), `after ${step}`).toBe(expected);
    }
    return cur;
}

describe('Lifecycle walks', () => {
    it('direct-assignment happy path: S1 → S2 → S3 → S4 → S11 → S13', () => {
        walk(STATE_COMBOS.S1, [
            ['assign',   'S2'],
            ['publish',  'S3'],
            ['confirm',  'S4'],
            ['start',    'S11'],
            ['complete', 'S13'],
        ]);
    });

    it('bidding path: S1 → S5 → (select winner, direct-to-S4)', () => {
        walk(STATE_COMBOS.S1, [
            ['publish',      'S5'],
            ['selectWinner', 'S4'],
        ]);
    });

    it('FULL SWAP WALK: initiate → peer accepts → manager approves', () => {
        // Start from a confirmed published shift (only S4 shifts are tradeable)
        const s4 = STATE_COMBOS.S4;

        // T1 — employee initiates a swap (shift_swaps OPEN): S4 → S9
        const s9 = apply.initiateSwap(s4);
        expect(getShiftFSMState(s9)).toBe('S9');

        // T2 — a peer's offer is accepted by the requester (sm_accept_trade,
        // shift_swaps → MANAGER_PENDING): S9 → S10
        const s10 = apply.peerAccept(s9);
        expect(getShiftFSMState(s10)).toBe('S10');

        // Manager gate: approve_trade legal exactly here
        expect(isShiftOpLegal('approve_trade', ctxFor('S10'))).toBe(true);
        expect(isShiftOpLegal('approve_trade', ctxFor('S9'))).toBe(false);

        // T5 — manager approves (sm_approve_peer_swap): assignees swapped,
        // both shifts revert to NoTrade → S4 (with the new assignee)
        const s4After = apply.resolveTrade(s10);
        expect(getShiftFSMState(s4After)).toBe('S4');
    });

    it('swap rejection walk: S10 → (manager rejects) → S4', () => {
        const s10 = apply.peerAccept(apply.initiateSwap(STATE_COMBOS.S4));
        expect(getShiftFSMState(s10)).toBe('S10');
        expect(isShiftOpLegal('reject_trade', ctxFor('S10'))).toBe(true);
        expect(getShiftFSMState(apply.resolveTrade(s10))).toBe('S4');
    });

    it('trade expiry (cron @ TTS=4h): S9 → S4 and S10 → S4', () => {
        const s9 = apply.initiateSwap(STATE_COMBOS.S4);
        expect(getShiftFSMState(apply.resolveTrade(s9))).toBe('S4');
        const s10 = apply.peerAccept(s9);
        expect(getShiftFSMState(apply.resolveTrade(s10))).toBe('S4');
    });

    it('TTS=4h expiry: S3 → S2 (offer) and S5 → S1 (bidding)', () => {
        expect(getShiftFSMState(apply.offerExpire(STATE_COMBOS.S3))).toBe('S2');
        expect(getShiftFSMState(apply.biddingExpire(STATE_COMBOS.S5))).toBe('S1');
    });

    it('unpublish reverts published states to draft: S3→S2, S5→S1, S10→S2', () => {
        expect(getShiftFSMState(apply.unpublish(STATE_COMBOS.S3))).toBe('S2');
        expect(getShiftFSMState(apply.unpublish(STATE_COMBOS.S5))).toBe('S1');
        // Unpublishing a trade-pending shift cancels the trade and keeps the assignee
        expect(getShiftFSMState(apply.unpublish(STATE_COMBOS.S10))).toBe('S2');
    });

    it('unassign: S2 → S1 (and only from S2)', () => {
        expect(getShiftFSMState(apply.unassign(STATE_COMBOS.S2))).toBe('S1');
        expect(isShiftOpLegal('unassign', ctxFor('S3'))).toBe(false);
        expect(isShiftOpLegal('unassign', ctxFor('S4'))).toBe(false);
    });

    it('cancellation terminates from every live state', () => {
        for (const s of ['S1', 'S2', 'S3', 'S4', 'S5', 'S9', 'S10', 'S11'] as const) {
            expect(getShiftFSMState(apply.cancel(STATE_COMBOS[s]))).toBe('S15');
        }
    });

    it('terminal states are absorbing: no op is legal from S13/S15', () => {
        for (const op of ALL_OPS) {
            expect(isShiftOpLegal(op, ctxFor('S13'))).toBe(false);
            expect(isShiftOpLegal(op, ctxFor('S15'))).toBe(false);
        }
    });
});
