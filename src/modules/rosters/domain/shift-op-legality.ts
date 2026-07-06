/**
 * Shift Op-Legality Matrix
 *
 * Pure, network-free legality table for manager operations on a shift, used by
 * the optimistic-concurrency shift gateway to reject illegal ops *before* a
 * round-trip (the DB `sm_*` guards re-check authoritatively on commit).
 *
 * The state vocabulary is the slim **card** FSM lineage from {@link shift-fsm.ts}
 * — `getShiftFSMState()` returns exactly:
 *
 *   S1  Draft                            S5  Bidding (Published, unassigned, on_bidding)
 *   S2  Draft (Assigned)                 S9  Trade Requested (Pending Peer)
 *   S3  Offered  (Published, assigned)   S10 Trade Requested (Pending Manager)
 *   S4  Confirmed                        S11 In Progress
 *                                        S13 Completed
 *                                        S15 Cancelled
 *
 * This slim lineage deliberately has NO S7 (emergency_assigned) and NO S8
 * (bidding_closed_no_winner): those only exist in the fuller DB derivation that
 * reads `bidding_status`, and the cards/this gateway ignore them. We do NOT
 * invent them here.
 *
 * Bidding is unified as `on_bidding` and surfaces as the single S5 state.
 *
 * NOTE on `hasStarted`: the FSM already moves a shift to S11/S13 once it is
 * InProgress/Completed, but a shift can also be *past its start time* while still
 * sitting in an earlier state (clock-in not yet processed, stale row, etc.). The
 * gateway therefore carries an explicit `hasStarted` clock signal so the
 * start/not-started boundary is enforced independently of the lifecycle column.
 */

import type { ShiftStateID } from './shift-fsm';

// ─── Op + State vocabulary ────────────────────────────────────────────────────

export type ShiftOp =
    | 'assign'
    | 'unassign'
    | 'publish'
    | 'unpublish'
    | 'select_winner'
    | 'approve_trade'
    | 'reject_trade'
    | 'delete'
    | 'edit';

/**
 * Canonical card-FSM state strings. Re-exported alias of the slim
 * {@link ShiftStateID} so callers of the gateway have one import. `UNKNOWN` is
 * intentionally included — every op is conservatively *illegal* from it.
 */
export type ShiftState = ShiftStateID;

// ─── Context ──────────────────────────────────────────────────────────────────

export interface ShiftLegalityCtx {
    /** Canonical card-FSM state (from `getShiftFSMState`). */
    state: ShiftState;
    /** True once the shift's start time has passed (clock signal, see file header). */
    hasStarted: boolean;
    /** True when the shift currently has an employee assigned. */
    isAssigned: boolean;
    /** True when a trade is awaiting peer/manager action (S9 / S10). Optional. */
    tradePending?: boolean;
}

// ─── Semantic predicates ──────────────────────────────────────────────────────

/** Terminal states — no manager op is legal from these. */
const TERMINAL_STATES: ReadonlySet<ShiftState> = new Set<ShiftState>(['S13', 'S15']);

/** Draft (unpublished) states. */
const DRAFT_STATES: ReadonlySet<ShiftState> = new Set<ShiftState>(['S1', 'S2']);

/** Published, pre-start states (offered / confirmed / bidding / trade-pending). */
const PUBLISHED_STATES: ReadonlySet<ShiftState> = new Set<ShiftState>([
    'S3', 'S4', 'S5', 'S9', 'S10',
]);

/** True if the shift is in a terminal (completed/cancelled) state. */
function isTerminal(ctx: ShiftLegalityCtx): boolean {
    return TERMINAL_STATES.has(ctx.state);
}

/**
 * True if the state is `UNKNOWN` — a stale/unrecognized DB combination. We never
 * permit a mutating op from here: the state is unreliable, so be conservative.
 * The state-specific ops (publish/unpublish/select_winner/trade) already exclude
 * UNKNOWN by keying on concrete states; this guards the boundary-only ops
 * (assign/delete/edit) which would otherwise pass on the not-started check alone.
 */
function isUnknown(ctx: ShiftLegalityCtx): boolean {
    return ctx.state === 'UNKNOWN';
}

/**
 * True if the shift is "locked" against mutation because it has begun or is
 * already over. Combines the explicit clock signal with the lifecycle states
 * the FSM uses for InProgress (S11) and the terminal set (S13/S15).
 */
function isStartedOrPast(ctx: ShiftLegalityCtx): boolean {
    return ctx.hasStarted || ctx.state === 'S11' || isTerminal(ctx);
}

// ─── Legality matrix ──────────────────────────────────────────────────────────

/**
 * Per-op legality predicates. Each predicate is pure and returns `true` only
 * when the op is legal from the given context. When a case is ambiguous we
 * default to `false` (conservative / illegal) and flag it with a `// TODO`.
 */
export const OP_LEGALITY: Record<ShiftOp, (ctx: ShiftLegalityCtx) => boolean> = {
    /**
     * select_winner — pick a bid winner. Legal ONLY while bidding is open, i.e.
     * the slim FSM's S5 (Published + unassigned + on_bidding). Never after start.
     */
    select_winner: (ctx) =>
        ctx.state === 'S5' && !isStartedOrPast(ctx),

    /**
     * publish — Draft → Published. Legal only from a draft state (S1/S2) and
     * only before the shift has started. A shift that is already Published or
     * later cannot be published again.
     */
    publish: (ctx) =>
        DRAFT_STATES.has(ctx.state) && !isStartedOrPast(ctx),

    /**
     * unpublish — Published → Draft. Legal from a Published pre-start state
     * (offered S3 / confirmed S4 / bidding S5 / trade-pending S9/S10), mirroring the DB
     * guard `fsm_op_is_legal` which admits exactly {S3,S4,S5,S9,S10}. Drafts
     * (already unpublished) and started/terminal shifts are illegal.
     */
    unpublish: (ctx) =>
        PUBLISHED_STATES.has(ctx.state)
        && !isStartedOrPast(ctx),

    /**
     * assign — set/replace the assigned employee. Legal when the shift is
     * unassigned OR reassignable, as long as it has not started and is not
     * terminal. A trade in flight (S9/S10) must be resolved first, so assigning
     * over it is conservatively illegal.
     */
    assign: (ctx) => {
        if (isStartedOrPast(ctx) || isUnknown(ctx)) return false;
        if (ctx.tradePending || ctx.state === 'S9' || ctx.state === 'S10') return false;
        // Unassigned (S1/S5) → assign; assigned-but-pre-start (S2/S3/S4) → reassign.
        return true;
    },

    /**
     * unassign — remove the assigned employee; the inverse of `assign`. Legal ONLY
     * from S2 (Draft + assigned) → S1 (Draft + unassigned). A Published assigned
     * shift (S3/S4) must be `unpublish`ed first: a Published + unassigned + not-on-
     * bidding row has NO defined slim-FSM state (fn_shift_state returns UNKNOWN), so
     * direct removal from a published shift is intentionally disallowed. Never after
     * start / terminal / unknown.
     */
    unassign: (ctx) => {
        if (isStartedOrPast(ctx) || isUnknown(ctx)) return false;
        return ctx.state === 'S2';
    },

    /**
     * approve_trade — manager approves a pending trade. Legal only when a trade
     * is pending awaiting manager action (S10), and not after start. We key on
     * the explicit `tradePending` flag when provided, falling back to the state.
     */
    approve_trade: (ctx) => {
        if (isStartedOrPast(ctx)) return false;
        if (ctx.tradePending === false) return false;
        // Manager approval gate is S10 (Pending Manager).
        return ctx.state === 'S10';
    },

    /**
     * reject_trade — manager rejects a pending trade. Legal only at S10
     * (TradeAccepted = the authoritative shift_swaps `MANAGER_PENDING`), the only
     * state swaps.api lets a manager reject. Not after start.
     */
    reject_trade: (ctx) => {
        if (isStartedOrPast(ctx)) return false;
        if (ctx.tradePending === false) return false;
        return ctx.state === 'S10';
    },

    /**
     * delete — remove the shift. Legal unless it has already started or is in a
     * terminal state (completed/cancelled). Drafts and pre-start published shifts
     * are deletable.
     */
    delete: (ctx) =>
        !isStartedOrPast(ctx) && !isUnknown(ctx),

    /**
     * edit — modify shift fields. Same boundary as delete: legal unless started
     * or terminal. (Field-level edit restrictions on published shifts are left to
     * the caller / DB guards; this gate only enforces the lifecycle boundary.)
     */
    edit: (ctx) =>
        !isStartedOrPast(ctx) && !isUnknown(ctx),
};

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Returns `true` if `op` is legal to attempt from the given shift context.
 * Pure — no network, no Supabase. The DB `sm_*` guards remain authoritative on
 * commit; this is the optimistic, client-side pre-flight.
 */
export function isShiftOpLegal(op: ShiftOp, ctx: ShiftLegalityCtx): boolean {
    const predicate = OP_LEGALITY[op];
    // Unknown op string (shouldn't happen with the typed union) → illegal.
    if (!predicate) return false;
    return predicate(ctx);
}
