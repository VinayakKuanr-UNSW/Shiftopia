/**
 * FSM End-to-End Suite — every state, every transition.
 *
 * Two layers, all network-free:
 *
 *  1. STATE DERIVATION  — every canonical state (S1…S10 slim lineage + UNKNOWN)
 *     derived from its 5-column DB combination, plus the gapless display-ID map.
 *
 *  2. LIFECYCLE WALKS  — real multi-step paths through the machine, mutating
 *     the 5 columns exactly the way the documented ops do and asserting the
 *     derived state at every step:
 *       • direct-assignment happy path  S1→S2→S3→S4→S8→S9
 *       • bidding path                  S1→S5→(select winner: direct-to-S4)
 *       • swap path                     S4→S6 (initiate) →S7 (peer accepts)
 *                                          →S4' (manager approves, shift reassigned)
 *       • swap rejection / expiry       S6/S7 → S4 (revert, cron `process_shift_timers`)
 *       • TTS=4h offer/bidding expiry   S3→S2, S5→S1
 *       • cancellation                  any live state → S10
 */

import { describe, it, expect } from 'vitest';
import {
    getShiftFSMState,
    getShiftStateDisplay,
    FSM_STATE_META,
    type ShiftFSMInput,
    type ShiftStateID,
} from '../shift-fsm';

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
    S6:  shift({ lifecycle_status: 'Published', assignment_status: 'assigned', assignment_outcome: 'confirmed', trading_status: 'TradeRequested' }),
    S7: shift({ lifecycle_status: 'Published', assignment_status: 'assigned', assignment_outcome: 'confirmed', trading_status: 'TradeAccepted' }),
    S8: shift({ lifecycle_status: 'InProgress', assignment_status: 'assigned', assignment_outcome: 'confirmed' }),
    S9: shift({ lifecycle_status: 'Completed', assignment_status: 'assigned', assignment_outcome: 'confirmed' }),
    S10: shift({ lifecycle_status: 'Published', assignment_status: 'assigned', is_cancelled: true }),
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
        }))).toBe('S10');
    });

    it('trade status overrides assignment outcome while Published', () => {
        // Confirmed shift with a trade in flight is S6/S7, not S4
        expect(getShiftFSMState(STATE_COMBOS.S6)).toBe('S6');
        expect(getShiftFSMState(STATE_COMBOS.S7)).toBe('S7');
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

describe('State IDs — one gapless S1…S10 model', () => {
    it.each(ALL_STATES)('%s renders as its own id', (state) => {
        expect(getShiftStateDisplay(state).id).toBe(state);
    });

    it('state IDs are exactly S1…S10', () => {
        expect([...ALL_STATES].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))))
            .toEqual(['S1','S2','S3','S4','S5','S6','S7','S8','S9','S10']);
    });

    it('UNKNOWN renders the neutral fallback', () => {
        expect(getShiftStateDisplay('UNKNOWN').id).toBe('—');
        expect(FSM_STATE_META.UNKNOWN.color).toBe('gray');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LIFECYCLE WALKS — multi-step paths, columns mutated as the real ops do
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
    it('direct-assignment happy path: S1 → S2 → S3 → S4 → S8 → S9', () => {
        walk(STATE_COMBOS.S1, [
            ['assign',   'S2'],
            ['publish',  'S3'],
            ['confirm',  'S4'],
            ['start',    'S8'],
            ['complete', 'S9'],
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

        // T1 — employee initiates a swap (shift_swaps OPEN): S4 → S6
        const s9 = apply.initiateSwap(s4);
        expect(getShiftFSMState(s9)).toBe('S6');

        // T2 — a peer's offer is accepted by the requester (sm_accept_trade,
        // shift_swaps → MANAGER_PENDING): S6 → S7
        const s10 = apply.peerAccept(s9);
        expect(getShiftFSMState(s10)).toBe('S7');

        // T5 — manager approves (sm_approve_peer_swap): assignees swapped,
        // both shifts revert to NoTrade → S4 (with the new assignee)
        const s4After = apply.resolveTrade(s10);
        expect(getShiftFSMState(s4After)).toBe('S4');
    });

    it('swap rejection walk: S7 → (manager rejects) → S4', () => {
        const s10 = apply.peerAccept(apply.initiateSwap(STATE_COMBOS.S4));
        expect(getShiftFSMState(s10)).toBe('S7');
        expect(getShiftFSMState(apply.resolveTrade(s10))).toBe('S4');
    });

    it('trade expiry (cron @ TTS=4h): S6 → S4 and S7 → S4', () => {
        const s9 = apply.initiateSwap(STATE_COMBOS.S4);
        expect(getShiftFSMState(apply.resolveTrade(s9))).toBe('S4');
        const s10 = apply.peerAccept(s9);
        expect(getShiftFSMState(apply.resolveTrade(s10))).toBe('S4');
    });

    it('TTS=4h expiry: S3 → S2 (offer) and S5 → S1 (bidding)', () => {
        expect(getShiftFSMState(apply.offerExpire(STATE_COMBOS.S3))).toBe('S2');
        expect(getShiftFSMState(apply.biddingExpire(STATE_COMBOS.S5))).toBe('S1');
    });

    it('unpublish reverts published states to draft: S3→S2, S5→S1, S7→S2', () => {
        expect(getShiftFSMState(apply.unpublish(STATE_COMBOS.S3))).toBe('S2');
        expect(getShiftFSMState(apply.unpublish(STATE_COMBOS.S5))).toBe('S1');
        // Unpublishing a trade-pending shift cancels the trade and keeps the assignee
        expect(getShiftFSMState(apply.unpublish(STATE_COMBOS.S7))).toBe('S2');
    });

    it('unassign: S2 → S1', () => {
        expect(getShiftFSMState(apply.unassign(STATE_COMBOS.S2))).toBe('S1');
    });

    it('cancellation terminates from every live state', () => {
        for (const s of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'] as const) {
            expect(getShiftFSMState(apply.cancel(STATE_COMBOS[s]))).toBe('S10');
        }
    });
});
