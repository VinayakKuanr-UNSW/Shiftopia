/**
 * Swap Lifecycle E2E — the authoritative shift_swaps flow, end to end:
 *
 *   INITIATE      swapsApi.createSwapRequest  — employee puts a shift up for
 *                 trade (shift_swaps OPEN, shift S4 → S9 TradeRequested)
 *   PEER OFFER    swapsApi.makeOffer          — a peer offers their shift
 *                 (swap_offers SUBMITTED)
 *   PEER SELECT   swapsApi.acceptTrade        — requester selects an offer
 *                 (sm_accept_trade → MANAGER_PENDING, shift S9 → S10)
 *   MANAGER       swapsApi.approveSwapRequest — gateway op `approve_trade`
 *                 swapsApi.rejectSwapRequest  — gateway op `reject_trade`
 *   PLUS          cancel (requester), reject offer (requester), §9 time-lock
 *
 * Network-free: the supabase client, the compliance solver, and the shift
 * mutation gateway are all mocked. What these tests pin down is the CONTRACT:
 * which tables are written with which payloads, which RPCs/gateway ops are
 * invoked with which arguments, and which state guards throw.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addDays, format } from 'date-fns';

// ─── Hoisted mock state ───────────────────────────────────────────────────────

type MockResult = { data?: unknown; error?: { message: string } | null };

const h = vi.hoisted(() => {
    const queue: MockResult[] = [];
    const ops: Array<{ table: string; method: string; args: unknown[] }> = [];

    const dequeue = (): MockResult => queue.shift() ?? { data: null, error: null };

    function makeChain(table: string): any {
        const chain: any = new Proxy({}, {
            get(_t, prop) {
                if (typeof prop !== 'string') return undefined;
                if (prop === 'then') {
                    // `await chain` (no .single()) — e.g. update/insert without select
                    return (res: any, rej: any) => Promise.resolve(dequeue()).then(res, rej);
                }
                if (prop === 'single' || prop === 'maybeSingle') {
                    return (...args: unknown[]) => {
                        ops.push({ table, method: prop, args });
                        return Promise.resolve(dequeue());
                    };
                }
                return (...args: unknown[]) => {
                    ops.push({ table, method: prop, args });
                    return chain;
                };
            },
        });
        return chain;
    }

    const rpc = { fn: null as any };
    const supabase = {
        from: (table: string) => makeChain(table),
        rpc: (...args: unknown[]) => rpc.fn(...args),
    };

    return {
        queue,
        ops,
        supabase,
        rpc,
        enqueue: (...items: MockResult[]) => queue.push(...items),
        reset: () => { queue.length = 0; ops.length = 0; },
        // Per-test–overridable dependency mocks
        applyShiftOp: { fn: null as any },
        evaluate: { fn: null as any },
        runSwapGuards: { fn: null as any },
        getEmployeeShifts: { fn: null as any },
    };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: h.supabase }));

vi.mock('@/modules/rosters', () => ({
    shiftsApi: { getEmployeeShifts: (...a: unknown[]) => h.getEmployeeShifts.fn(...a) },
}));

vi.mock('@/modules/rosters/api/shifts.api', () => ({
    applyShiftOp: (...a: unknown[]) => h.applyShiftOp.fn(...a),
}));

vi.mock('@/modules/compliance', () => {
    class SwapGuardError extends Error {
        result: unknown;
        constructor(result: unknown) { super('Swap guard failed'); this.result = result; }
    }
    return {
        swapEvaluator: { evaluate: (...a: unknown[]) => h.evaluate.fn(...a) },
        runSwapGuards: (...a: unknown[]) => h.runSwapGuards.fn(...a),
        SwapGuardError,
    };
});

import { swapsApi } from '../swaps.api';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EMP_A  = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // requester
const EMP_B  = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // peer / offerer
const SHIFT_A = '11111111-1111-4111-8111-111111111111'; // requester's shift
const SHIFT_B = '22222222-2222-4222-8222-222222222222'; // peer's offered shift
const SWAP_ID = '33333333-3333-4333-8333-333333333333';
const OFFER_ID = '44444444-4444-4444-8444-444444444444';

// §9 time lock is 4h — a shift a week out is safely unlocked; yesterday is locked.
const FUTURE_DATE = format(addDays(new Date(), 7), 'yyyy-MM-dd');
const PAST_DATE   = format(addDays(new Date(), -1), 'yyyy-MM-dd');

const futureShiftA = { id: SHIFT_A, shift_date: FUTURE_DATE, start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 0, version: 7 };
const futureShiftB = { id: SHIFT_B, shift_date: FUTURE_DATE, start_time: '10:00', end_time: '18:00', unpaid_break_minutes: 0 };

/** ops recorded against a table+method */
const opsFor = (table: string, method: string) =>
    h.ops.filter(o => o.table === table && o.method === method);

beforeEach(() => {
    h.reset();
    vi.clearAllMocks();
    // Defaults: compliance passes, guards pass, gateway applies, empty rosters.
    h.evaluate.fn         = vi.fn(() => ({ feasible: true, violations: [] }));
    h.runSwapGuards.fn    = vi.fn(async () => ({ passed: true }));
    h.applyShiftOp.fn     = vi.fn(async () => ({ ok: true, code: 'APPLIED', version: 8, state: 'S4' }));
    h.getEmployeeShifts.fn = vi.fn(async () => []);
    h.rpc.fn              = vi.fn(async () => ({ data: { success: true }, error: null }));
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. INITIATE — createSwapRequest (S4 → S9, shift_swaps OPEN)
// ═══════════════════════════════════════════════════════════════════════════

describe('initiate swap — createSwapRequest', () => {
    it('creates an OPEN request atomically via sm_create_swap_request and returns the row', async () => {
        const swapRow = { id: SWAP_ID, status: 'OPEN', requester_shift_id: SHIFT_A, requester_id: EMP_A };
        h.rpc.fn = vi.fn(async () => ({ data: { success: true, swap_id: SWAP_ID }, error: null }));
        h.enqueue(
            { data: { shift_date: FUTURE_DATE, start_time: '09:00' }, error: null }, // client time-lock fetch
            { data: swapRow, error: null },                                          // shift_swaps select → single
        );

        const result = await swapsApi.createSwapRequest(SHIFT_A, EMP_A, null, 'family thing');
        expect(result.status).toBe('OPEN');

        // The insert (shift_swaps OPEN + expires_at trigger) and the shift flip to
        // TradeRequested (S4 → S9) now happen server-side in ONE transaction — the
        // API delegates to the definer RPC rather than doing a two-step client write.
        expect(h.rpc.fn).toHaveBeenCalledWith('sm_create_swap_request', expect.objectContaining({
            p_requester_shift_id: SHIFT_A,
            p_target_id: null,
            p_reason: 'family thing',
        }));
    });

    it('§9 time lock: refuses to initiate on a shift starting < 4h away', async () => {
        h.enqueue({ data: { shift_date: PAST_DATE, start_time: '09:00' }, error: null });

        await expect(swapsApi.createSwapRequest(SHIFT_A, EMP_A)).rejects.toThrow(/Time locked/);
        expect(h.rpc.fn).not.toHaveBeenCalled(); // client pre-check fails — RPC never reached
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PEER OFFER — makeOffer (swap_offers SUBMITTED)
// ═══════════════════════════════════════════════════════════════════════════

describe('peer offers a swap — makeOffer', () => {
    it('submits an offer with the peer shift attached', async () => {
        h.enqueue(
            // self-offer guard + requester-shift time-lock fetch (requester shift is > 4h out)
            { data: { requester_id: EMP_A, requester_shift: { shift_date: FUTURE_DATE, start_time: '09:00' } }, error: null },
            { data: { shift_date: FUTURE_DATE, start_time: '10:00' }, error: null }, // time-lock on offered shift
            { error: null },                                                         // swap_offers insert
        );

        await swapsApi.makeOffer(SWAP_ID, SHIFT_B, EMP_B);

        const insert = opsFor('swap_offers', 'insert')[0];
        expect(insert.args[0]).toMatchObject({
            swap_request_id: SWAP_ID,
            offerer_id: EMP_B,
            status: 'SUBMITTED',
            offered_shift_id: SHIFT_B,
        });
    });

    it('giveaway offer (no shift) skips the offered-shift time lock but still guards the requester shift', async () => {
        h.enqueue(
            // requester shift is > 4h out — giveaway offer is allowed
            { data: { requester_id: EMP_A, requester_shift: { shift_date: FUTURE_DATE, start_time: '09:00' } }, error: null },
            { error: null }, // insert
        );

        await swapsApi.makeOffer(SWAP_ID, undefined, EMP_B);

        const payload = opsFor('swap_offers', 'insert')[0].args[0] as Record<string, unknown>;
        expect(payload.status).toBe('SUBMITTED');
        expect('offered_shift_id' in payload).toBe(false);
    });

    it('blocks offering on your own swap request', async () => {
        // requester == offerer (requester shift is future, but the self-offer guard fires first)
        h.enqueue({ data: { requester_id: EMP_B, requester_shift: { shift_date: FUTURE_DATE, start_time: '09:00' } }, error: null });

        await expect(swapsApi.makeOffer(SWAP_ID, SHIFT_B, EMP_B))
            .rejects.toThrow(/your own swap request/);
        expect(opsFor('swap_offers', 'insert')).toHaveLength(0);
    });

    it('§9 time lock: refuses an offered shift starting < 4h away', async () => {
        h.enqueue(
            { data: { requester_id: EMP_A, requester_shift: { shift_date: FUTURE_DATE, start_time: '09:00' } }, error: null },
            { data: { shift_date: PAST_DATE, start_time: '10:00' }, error: null },
        );

        await expect(swapsApi.makeOffer(SWAP_ID, SHIFT_B, EMP_B)).rejects.toThrow(/Time locked/);
        expect(opsFor('swap_offers', 'insert')).toHaveLength(0);
    });

    it('§9 time lock: refuses ANY offer (even giveaway) when the REQUESTER shift starts < 4h away', async () => {
        // requester shift is already inside the 4h lock — Fix 4: the offer must be rejected
        // regardless of whether an offered shift is attached.
        h.enqueue({ data: { requester_id: EMP_A, requester_shift: { shift_date: PAST_DATE, start_time: '10:00' } }, error: null });

        await expect(swapsApi.makeOffer(SWAP_ID, undefined, EMP_B)).rejects.toThrow(/Time locked/);
        expect(opsFor('swap_offers', 'insert')).toHaveLength(0);
    });

    it('handles the requester-shift join arriving as an array', async () => {
        // PostgREST embeds can surface as arrays; the guard must unwrap [0].
        h.enqueue(
            { data: { requester_id: EMP_A, requester_shift: [{ shift_date: FUTURE_DATE, start_time: '09:00' }] }, error: null },
            { error: null }, // insert
        );

        await swapsApi.makeOffer(SWAP_ID, undefined, EMP_B);

        expect(opsFor('swap_offers', 'insert')).toHaveLength(1);
    });

    it('fails closed when the requester shift date/time is missing', async () => {
        h.enqueue({ data: { requester_id: EMP_A, requester_shift: null }, error: null });

        await expect(swapsApi.makeOffer(SWAP_ID, undefined, EMP_B))
            .rejects.toThrow(/requester shift date\/time is missing/);
        expect(opsFor('swap_offers', 'insert')).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. PEER SELECT — acceptTrade (S9 → S10, MANAGER_PENDING via sm_accept_trade)
// ═══════════════════════════════════════════════════════════════════════════

describe('requester accepts a peer offer — acceptTrade', () => {
    const openSwapRow = {
        id: SWAP_ID, status: 'OPEN', requester_id: EMP_A,
        requester_shift: { ...futureShiftA },
    };

    it('runs compliance for BOTH parties then calls sm_accept_trade atomically', async () => {
        h.enqueue(
            { data: openSwapRow, error: null },   // swap fetch (status guard)
            { data: futureShiftB, error: null },  // offered shift fetch
        );

        await swapsApi.acceptTrade(SWAP_ID, OFFER_ID, EMP_B, SHIFT_B);

        // Both parties' rosters were pulled for the solver
        expect(h.getEmployeeShifts.fn).toHaveBeenCalledWith(EMP_A, expect.any(String), expect.any(String));
        expect(h.getEmployeeShifts.fn).toHaveBeenCalledWith(EMP_B, expect.any(String), expect.any(String));

        // Atomic transition delegated to the RPC (FOR UPDATE anti-race)
        expect(h.rpc.fn).toHaveBeenCalledWith('sm_accept_trade', expect.objectContaining({
            p_swap_id: SWAP_ID,
            p_offer_id: OFFER_ID,
            p_offerer_id: EMP_B,
            p_offer_shift_id: SHIFT_B,
        }));
    });

    it('guards the OPEN state: a non-OPEN swap cannot accept an offer', async () => {
        h.enqueue({ data: { ...openSwapRow, status: 'MANAGER_PENDING' }, error: null });

        await expect(swapsApi.acceptTrade(SWAP_ID, OFFER_ID, EMP_B, SHIFT_B))
            .rejects.toThrow(/no longer OPEN/);
        expect(h.rpc.fn).not.toHaveBeenCalled();
    });

    it('blocks acceptance when the solver finds a blocking violation', async () => {
        h.evaluate.fn = vi.fn(() => ({
            feasible: false,
            violations: [{ blocking: true, employee_name: 'Offerer', summary: 'Rest gap < 10h' }],
        }));
        h.enqueue(
            { data: openSwapRow, error: null },
            { data: futureShiftB, error: null },
        );

        await expect(swapsApi.acceptTrade(SWAP_ID, OFFER_ID, EMP_B, SHIFT_B))
            .rejects.toThrow(/Compliance violation.*Rest gap/);
        expect(h.rpc.fn).not.toHaveBeenCalled(); // no state transition on failure
    });

    it('surfaces an RPC-level failure (e.g. lost the double-accept race)', async () => {
        h.rpc.fn = vi.fn(async () => ({ data: { success: false, error: 'Swap is not OPEN' }, error: null }));
        h.enqueue(
            { data: openSwapRow, error: null },
            { data: futureShiftB, error: null },
        );

        await expect(swapsApi.acceptTrade(SWAP_ID, OFFER_ID, EMP_B, SHIFT_B))
            .rejects.toThrow(/not OPEN/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. MANAGER DECISION — approve / reject via the shift-mutation gateway
// ═══════════════════════════════════════════════════════════════════════════

describe('manager approves — approveSwapRequest', () => {
    /** shift_swaps row as getSwapById selects it (MANAGER_PENDING, offer selected). */
    const managerPendingRow = {
        id: SWAP_ID,
        requester_shift_id: SHIFT_A,
        requester_id: EMP_A,
        target_id: EMP_B,
        target_shift_id: SHIFT_B,
        status: 'MANAGER_PENDING',
        reason: null,
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T01:00:00Z',
        requester_shift: { ...futureShiftA },
        target_shift: null,
        requested_by: { id: EMP_A, first_name: 'Req', last_name: 'User' },
        swap_with: { id: EMP_B, first_name: 'Peer', last_name: 'User' },
        swap_offers: [],
    };
    const selectedOfferRow = {
        id: OFFER_ID, swap_request_id: SWAP_ID, offerer_id: EMP_B,
        offered_shift_id: SHIFT_B, status: 'SELECTED',
        offered_shift: { ...futureShiftB },
    };

    it('re-verifies compliance then routes through gateway op approve_trade (version-CAS)', async () => {
        h.enqueue(
            { data: managerPendingRow, error: null }, // getSwapById
            { data: selectedOfferRow, error: null },  // best-effort offer fetch (maybeSingle)
        );

        await swapsApi.approveSwapRequest(SWAP_ID);

        // Compliance re-verified at approval time (not just at accept time)
        expect(h.evaluate.fn).toHaveBeenCalledTimes(1);

        // Gateway invocation: S10-guarded approve_trade on the requester shift,
        // version-chained off the fetched row.
        expect(h.applyShiftOp.fn).toHaveBeenCalledWith({
            shiftId: SHIFT_A,
            expectedVersion: 7,
            op: 'approve_trade',
            payload: { compliance_ok: true },
        });
    });

    it('refuses when no target employee was selected (no accepted offer)', async () => {
        h.enqueue({ data: { ...managerPendingRow, target_id: null }, error: null });

        await expect(swapsApi.approveSwapRequest(SWAP_ID)).rejects.toThrow(/No target employee/);
        expect(h.applyShiftOp.fn).not.toHaveBeenCalled();
    });

    it('blocks approval when compliance fails at decision time (drift)', async () => {
        h.evaluate.fn = vi.fn(() => ({
            feasible: false,
            violations: [{ blocking: true, employee_name: 'Requester', summary: 'Weekly hours exceeded' }],
        }));
        h.enqueue(
            { data: managerPendingRow, error: null },
            { data: selectedOfferRow, error: null },
        );

        await expect(swapsApi.approveSwapRequest(SWAP_ID))
            .rejects.toThrow(/Cannot approve swap.*Weekly hours/);
        expect(h.applyShiftOp.fn).not.toHaveBeenCalled();
    });

    it('surfaces a gateway ILLEGAL_TRANSITION (shift moved on) as a user-readable error', async () => {
        h.applyShiftOp.fn = vi.fn(async () => ({
            ok: false, code: 'ILLEGAL_TRANSITION', current_state: 'S4', attempted: 'approve_trade',
        }));
        h.enqueue(
            { data: managerPendingRow, error: null },
            { data: selectedOfferRow, error: null },
        );

        await expect(swapsApi.approveSwapRequest(SWAP_ID))
            .rejects.toThrow(/now S4.*approve_trade no longer applies/);
    });
});

describe('manager rejects — rejectSwapRequest', () => {
    it('routes through gateway op reject_trade from MANAGER_PENDING', async () => {
        h.enqueue({
            data: { status: 'MANAGER_PENDING', requester_shift_id: SHIFT_A, requester_shift: { version: 3 } },
            error: null,
        });

        await swapsApi.rejectSwapRequest(SWAP_ID, 'Coverage risk');

        expect(h.applyShiftOp.fn).toHaveBeenCalledWith({
            shiftId: SHIFT_A,
            expectedVersion: 3,
            op: 'reject_trade',
            payload: { reason: 'Coverage risk' },
        });
    });

    it('state guard: rejection is only legal from MANAGER_PENDING', async () => {
        h.enqueue({ data: { status: 'OPEN', requester_shift_id: SHIFT_A }, error: null });

        await expect(swapsApi.rejectSwapRequest(SWAP_ID))
            .rejects.toThrow(/Must be MANAGER_PENDING/);
        expect(h.applyShiftOp.fn).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. REQUESTER-SIDE RESOLUTION — cancel / reject an offer
// ═══════════════════════════════════════════════════════════════════════════

describe('requester cancels — cancelSwapRequest', () => {
    it('cancels an OPEN swap atomically via sm_cancel_swap_request', async () => {
        h.rpc.fn = vi.fn(async () => ({ data: { success: true }, error: null }));

        await swapsApi.cancelSwapRequest(SWAP_ID);

        // Flip to CANCELLED + revert the shift to NoTrade now happen server-side in
        // one transaction (with the OPEN-only guard + requester authz).
        expect(h.rpc.fn).toHaveBeenCalledWith('sm_cancel_swap_request', { p_swap_id: SWAP_ID });
    });

    it('state guard: cancel is only legal from OPEN (server returns "Must be OPEN")', async () => {
        h.rpc.fn = vi.fn(async () => ({
            data: { success: false, code: 'SWAP_NOT_OPEN', error: 'Cannot cancel swap in state MANAGER_PENDING. Must be OPEN.' },
            error: null,
        }));

        await expect(swapsApi.cancelSwapRequest(SWAP_ID)).rejects.toThrow(/Must be OPEN/);
    });
});

describe('requester rejects an offer — rejectTrade', () => {
    it('marks the offer REJECTED (swap stays OPEN for other offers)', async () => {
        h.enqueue({ error: null });

        await swapsApi.rejectTrade(OFFER_ID);

        expect(opsFor('swap_offers', 'update')[0].args[0]).toMatchObject({ status: 'REJECTED' });
    });
});
