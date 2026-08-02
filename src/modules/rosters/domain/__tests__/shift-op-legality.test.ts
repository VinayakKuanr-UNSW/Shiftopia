/**
 * shift-op-legality.test.ts
 *
 * Unit tests for the pure op-legality matrix used by the optimistic-concurrency
 * shift gateway. All tests are pure — no mocking, no network calls.
 *
 * Coverage:
 *   - each op legal from its allowed state(s)
 *   - each op illegal from a representative disallowed state
 *   - the started / not-started boundary (publish / unpublish / delete / edit)
 *   - trade-pending gating (approve / reject)
 */

import { describe, it, expect } from 'vitest';

import {
    isShiftOpLegal,
    OP_LEGALITY,
    type ShiftOp,
    type ShiftLegalityCtx,
    type ShiftState,
} from '../shift-op-legality';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a ShiftLegalityCtx with safe defaults (pre-start, draft, unassigned). */
function ctx(overrides: Partial<ShiftLegalityCtx> & { state: ShiftState }): ShiftLegalityCtx {
    return {
        hasStarted: false,
        isAssigned: false,
        ...overrides,
    };
}

// ─── 1. select_winner — bidding only ──────────────────────────────────────────

describe('select_winner', () => {
    it('legal from S5 (bidding open)', () => {
        expect(isShiftOpLegal('select_winner', ctx({ state: 'S5' }))).toBe(true);
    });

    it('illegal from S3 (offered, not bidding)', () => {
        expect(isShiftOpLegal('select_winner', ctx({ state: 'S3', isAssigned: true }))).toBe(false);
    });

    it('illegal once started even from S5', () => {
        expect(isShiftOpLegal('select_winner', ctx({ state: 'S5', hasStarted: true }))).toBe(false);
    });
});

// ─── 2. publish — drafts only, pre-start ──────────────────────────────────────

describe('publish', () => {
    it('legal from S1 (draft, unassigned)', () => {
        expect(isShiftOpLegal('publish', ctx({ state: 'S1' }))).toBe(true);
    });

    it('legal from S2 (draft, assigned)', () => {
        expect(isShiftOpLegal('publish', ctx({ state: 'S2', isAssigned: true }))).toBe(true);
    });

    it('illegal from S3 (already published)', () => {
        expect(isShiftOpLegal('publish', ctx({ state: 'S3', isAssigned: true }))).toBe(false);
    });

    it('illegal from a draft that has already started (boundary)', () => {
        expect(isShiftOpLegal('publish', ctx({ state: 'S1', hasStarted: true }))).toBe(false);
    });
});

// ─── 3. unpublish — published only, pre-start ─────────────────────────────────

describe('unpublish', () => {
    it('legal from S4 (published, confirmed)', () => {
        expect(isShiftOpLegal('unpublish', ctx({ state: 'S4', isAssigned: true }))).toBe(true);
    });

    it('legal from S5 (published, bidding)', () => {
        expect(isShiftOpLegal('unpublish', ctx({ state: 'S5' }))).toBe(true);
    });

    it('illegal from S1 (draft — already unpublished)', () => {
        expect(isShiftOpLegal('unpublish', ctx({ state: 'S1' }))).toBe(false);
    });

    it('illegal once started even from a published state (boundary)', () => {
        expect(isShiftOpLegal('unpublish', ctx({ state: 'S4', isAssigned: true, hasStarted: true }))).toBe(false);
    });

    it('legal while a trade is pending (S9/S10) — unpublishing cancels the trade', () => {
        expect(isShiftOpLegal('unpublish', ctx({ state: 'S9', isAssigned: true, tradePending: true }))).toBe(true);
        expect(isShiftOpLegal('unpublish', ctx({ state: 'S10', isAssigned: true, tradePending: true }))).toBe(true);
    });
});

// ─── 4. assign — unassigned or reassignable, pre-start ────────────────────────

describe('assign', () => {
    it('legal from S1 (draft, unassigned)', () => {
        expect(isShiftOpLegal('assign', ctx({ state: 'S1' }))).toBe(true);
    });

    it('legal from S5 (published, unassigned/bidding)', () => {
        expect(isShiftOpLegal('assign', ctx({ state: 'S5' }))).toBe(true);
    });

    it('legal (reassign) from S4 (published, confirmed, pre-start)', () => {
        expect(isShiftOpLegal('assign', ctx({ state: 'S4', isAssigned: true }))).toBe(true);
    });

    it('legal from S1 (draft, unassigned) even if hasStarted=true', () => {
        expect(isShiftOpLegal('assign', ctx({ state: 'S1', isAssigned: false, hasStarted: true }))).toBe(true);
    });

    it('illegal from S11 (in progress / assigned and started)', () => {
        expect(isShiftOpLegal('assign', ctx({ state: 'S11', isAssigned: true, hasStarted: true }))).toBe(false);
    });

    it('illegal from S13 (completed)', () => {
        expect(isShiftOpLegal('assign', ctx({ state: 'S13', isAssigned: true }))).toBe(false);
    });

    it('illegal while a trade is pending (S10)', () => {
        expect(isShiftOpLegal('assign', ctx({ state: 'S10', isAssigned: true, tradePending: true }))).toBe(false);
    });
});

// ─── 4b. unassign — inverse of assign, draft-only (S2 → S1) ───────────────────

describe('unassign', () => {
    it('legal from S2 (draft, assigned)', () => {
        expect(isShiftOpLegal('unassign', ctx({ state: 'S2', isAssigned: true }))).toBe(true);
    });

    it('illegal from S1 (already unassigned)', () => {
        expect(isShiftOpLegal('unassign', ctx({ state: 'S1' }))).toBe(false);
    });

    it('illegal from S3/S4 (published — unpublish first)', () => {
        expect(isShiftOpLegal('unassign', ctx({ state: 'S3', isAssigned: true }))).toBe(false);
        expect(isShiftOpLegal('unassign', ctx({ state: 'S4', isAssigned: true }))).toBe(false);
    });

    it('illegal once started even from S2 (boundary)', () => {
        expect(isShiftOpLegal('unassign', ctx({ state: 'S2', isAssigned: true, hasStarted: true }))).toBe(false);
    });
});

// ─── 5. approve_trade / reject_trade — trade-pending gating ───────────────────

describe('approve_trade', () => {
    it('legal from S10 (pending manager)', () => {
        expect(isShiftOpLegal('approve_trade', ctx({ state: 'S10', isAssigned: true, tradePending: true }))).toBe(true);
    });

    it('illegal from S9 (pending peer — not yet at manager gate)', () => {
        expect(isShiftOpLegal('approve_trade', ctx({ state: 'S9', isAssigned: true, tradePending: true }))).toBe(false);
    });

    it('illegal from S4 (no trade in flight)', () => {
        expect(isShiftOpLegal('approve_trade', ctx({ state: 'S4', isAssigned: true }))).toBe(false);
    });

    it('illegal when tradePending explicitly false even in S10', () => {
        expect(isShiftOpLegal('approve_trade', ctx({ state: 'S10', isAssigned: true, tradePending: false }))).toBe(false);
    });
});

describe('reject_trade', () => {
    it('legal from S10 (pending manager = shift_swaps MANAGER_PENDING)', () => {
        expect(isShiftOpLegal('reject_trade', ctx({ state: 'S10', isAssigned: true, tradePending: true }))).toBe(true);
    });

    it('illegal from S9 (pending peer — swap not yet MANAGER_PENDING)', () => {
        expect(isShiftOpLegal('reject_trade', ctx({ state: 'S9', isAssigned: true, tradePending: true }))).toBe(false);
    });

    it('illegal from S4 (no trade pending)', () => {
        expect(isShiftOpLegal('reject_trade', ctx({ state: 'S4', isAssigned: true }))).toBe(false);
    });
});

// ─── 6. delete — unless started or terminal ───────────────────────────────────

describe('delete', () => {
    it('legal from S1 (draft)', () => {
        expect(isShiftOpLegal('delete', ctx({ state: 'S1' }))).toBe(true);
    });

    it('legal from S4 (published, pre-start)', () => {
        expect(isShiftOpLegal('delete', ctx({ state: 'S4', isAssigned: true }))).toBe(true);
    });

    it('illegal once started (boundary)', () => {
        expect(isShiftOpLegal('delete', ctx({ state: 'S4', isAssigned: true, hasStarted: true }))).toBe(false);
    });

    it('illegal from S13 (completed)', () => {
        expect(isShiftOpLegal('delete', ctx({ state: 'S13', isAssigned: true }))).toBe(false);
    });

    it('illegal from S11 (in progress)', () => {
        expect(isShiftOpLegal('delete', ctx({ state: 'S11', isAssigned: true, hasStarted: true }))).toBe(false);
    });
});

// ─── 7. edit — same boundary as delete ────────────────────────────────────────

describe('edit', () => {
    it('legal from S2 (draft, assigned)', () => {
        expect(isShiftOpLegal('edit', ctx({ state: 'S2', isAssigned: true }))).toBe(true);
    });

    it('illegal once started (boundary)', () => {
        expect(isShiftOpLegal('edit', ctx({ state: 'S3', isAssigned: true, hasStarted: true }))).toBe(false);
    });

    it('illegal from S15 (cancelled)', () => {
        expect(isShiftOpLegal('edit', ctx({ state: 'S15' }))).toBe(false);
    });
});

// ─── 8. cross-cutting: every op illegal from UNKNOWN (conservative) ───────────

describe('UNKNOWN state is conservatively illegal for all ops', () => {
    const ops: ShiftOp[] = Object.keys(OP_LEGALITY) as ShiftOp[];
    for (const op of ops) {
        it(`${op} is illegal from UNKNOWN`, () => {
            expect(isShiftOpLegal(op, ctx({ state: 'UNKNOWN' }))).toBe(false);
        });
    }
});
