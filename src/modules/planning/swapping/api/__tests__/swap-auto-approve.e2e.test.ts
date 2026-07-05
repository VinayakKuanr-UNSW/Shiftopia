/**
 * Auto-Approve Swaps E2E — the frontend contract for the auto-approve pipeline:
 *
 *   POLICY READ    swapPolicyApi.getOrgPolicy      — org-default row (dept NULL)
 *   POLICY WRITE   swapPolicyApi.saveOrgPolicy     — update-by-id when a row
 *                  exists (partial unique index breaks upsert-onConflict),
 *                  insert with shadow-first defaults otherwise
 *   FEED           swapPolicyApi.getRecentDecisions — newest-first bot decisions
 *   CHIPS          swapPolicyApi.getDecisionsForSwaps — LATEST decision per swap
 *   UNDO           swapPolicyApi.revertAutoDecision — sm_swap_auto_revert RPC;
 *                  ok/ALREADY_REVERTED resolve, refusals throw
 *   GUARD          isDecisionRevertable — only a committed, un-reverted
 *                  AUTO_APPROVE can be undone
 *
 * Network-free: the supabase client is mocked (same harness style as
 * swap-lifecycle.e2e.test.ts). These tests pin down the CONTRACT: which tables
 * are queried with which filters, which RPCs fire with which args, and how
 * refusal codes surface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: h.supabase }));

import {
    swapPolicyApi,
    isDecisionRevertable,
    type SwapApprovalPolicy,
    type SwapAutoDecision,
} from '../swapPolicy.api';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID    = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const POLICY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR_ID  = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SWAP_1    = '11111111-1111-4111-8111-111111111111';
const SWAP_2    = '22222222-2222-4222-8222-222222222222';
const DEC_ID    = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const policyRow = (over: Partial<SwapApprovalPolicy> = {}): SwapApprovalPolicy => ({
    id: POLICY_ID,
    organization_id: ORG_ID,
    department_id: null,
    enabled: true,
    shadow_mode: true,
    auto_approve_warnings: false,
    confidence_min: 1,
    max_auto_per_employee_per_week: 3,
    rules: {},
    version: 1,
    updated_by: null,
    updated_at: '2026-07-01T00:00:00Z',
    created_at: '2026-06-23T00:00:00Z',
    ...over,
});

const decisionRow = (over: Partial<SwapAutoDecision> = {}): SwapAutoDecision => ({
    id: DEC_ID,
    swap_id: SWAP_1,
    decision: 'AUTO_APPROVE',
    reason: 'clean',
    shadow: true,
    committed: false,
    reverted_at: null,
    reverted_by: null,
    engine_version: 'auto-approve-swaps@1.1.0',
    policy_version: 1,
    eligibility_result: {},
    created_at: '2026-07-03T00:00:00Z',
    swap: null,
    ...over,
});

const opsFor = (table: string, method: string) =>
    h.ops.filter(o => o.table === table && o.method === method);

beforeEach(() => {
    h.reset();
    vi.clearAllMocks();
    h.rpc.fn = vi.fn(async () => ({ data: { ok: true, code: 'REVERTED' }, error: null }));
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. POLICY READ — getOrgPolicy
// ═══════════════════════════════════════════════════════════════════════════

describe('policy read — getOrgPolicy', () => {
    it('selects the org-default row: organization_id match AND department_id IS NULL', async () => {
        h.enqueue({ data: policyRow(), error: null });

        const p = await swapPolicyApi.getOrgPolicy(ORG_ID);
        expect(p?.id).toBe(POLICY_ID);

        expect(opsFor('swap_approval_rules', 'eq')[0].args).toEqual(['organization_id', ORG_ID]);
        expect(opsFor('swap_approval_rules', 'is')[0].args).toEqual(['department_id', null]);
        expect(opsFor('swap_approval_rules', 'maybeSingle')).toHaveLength(1);
    });

    it('returns null when the org never opted in', async () => {
        h.enqueue({ data: null, error: null });
        expect(await swapPolicyApi.getOrgPolicy(ORG_ID)).toBeNull();
    });

    it('surfaces a query error', async () => {
        h.enqueue({ data: null, error: { message: 'rls denied' } });
        await expect(swapPolicyApi.getOrgPolicy(ORG_ID)).rejects.toEqual({ message: 'rls denied' });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. POLICY WRITE — saveOrgPolicy (update-by-id vs shadow-first insert)
// ═══════════════════════════════════════════════════════════════════════════

describe('policy write — saveOrgPolicy', () => {
    it('updates the existing row BY ID and stamps updated_by', async () => {
        h.enqueue(
            { data: policyRow(), error: null },                       // getOrgPolicy
            { data: policyRow({ shadow_mode: false }), error: null }, // update → single
        );

        const saved = await swapPolicyApi.saveOrgPolicy(ORG_ID, { shadow_mode: false }, ACTOR_ID);
        expect(saved.shadow_mode).toBe(false);

        const update = opsFor('swap_approval_rules', 'update')[0];
        const payload = update.args[0] as Record<string, unknown>;
        expect(payload.shadow_mode).toBe(false);
        expect(payload.updated_by).toBe(ACTOR_ID);
        // targeted by primary key, not re-filtered by org (the row was resolved first)
        const eqAfterUpdate = opsFor('swap_approval_rules', 'eq').find(o => o.args[0] === 'id');
        expect(eqAfterUpdate?.args).toEqual(['id', POLICY_ID]);
        // no insert happened
        expect(opsFor('swap_approval_rules', 'insert')).toHaveLength(0);
    });

    it('inserts with SHADOW-FIRST defaults when no row exists (patch may override)', async () => {
        h.enqueue(
            { data: null, error: null },                            // getOrgPolicy → none
            { data: policyRow({ enabled: true }), error: null },    // insert → single
        );

        await swapPolicyApi.saveOrgPolicy(ORG_ID, { enabled: true }, ACTOR_ID);

        const insert = opsFor('swap_approval_rules', 'insert')[0];
        const payload = insert.args[0] as Record<string, unknown>;
        expect(payload.organization_id).toBe(ORG_ID);
        expect(payload.department_id).toBeNull();
        expect(payload.enabled).toBe(true);       // patch override
        expect(payload.shadow_mode).toBe(true);   // shadow-first default preserved
        expect(payload.updated_by).toBe(ACTOR_ID);
    });

    it('a brand-new org can NOT accidentally start live: enabling without touching mode stays shadow', async () => {
        h.enqueue(
            { data: null, error: null },
            { data: policyRow(), error: null },
        );
        await swapPolicyApi.saveOrgPolicy(ORG_ID, { enabled: true });
        const payload = opsFor('swap_approval_rules', 'insert')[0].args[0] as Record<string, unknown>;
        expect(payload.shadow_mode).toBe(true);
    });

    it('surfaces an update error', async () => {
        h.enqueue(
            { data: policyRow(), error: null },
            { data: null, error: { message: 'version conflict' } },
        );
        await expect(swapPolicyApi.saveOrgPolicy(ORG_ID, { enabled: false })).rejects.toEqual({ message: 'version conflict' });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. DECISION FEED — getRecentDecisions
// ═══════════════════════════════════════════════════════════════════════════

describe('decision feed — getRecentDecisions', () => {
    it('orders newest-first and honors the limit', async () => {
        h.enqueue({ data: [decisionRow()], error: null });

        const feed = await swapPolicyApi.getRecentDecisions(5);
        expect(feed).toHaveLength(1);

        expect(opsFor('swap_decisions', 'order')[0].args).toEqual(['created_at', { ascending: false }]);
        expect(opsFor('swap_decisions', 'limit')[0].args).toEqual([5]);
    });

    it('returns [] for an empty table', async () => {
        h.enqueue({ data: [], error: null });
        expect(await swapPolicyApi.getRecentDecisions()).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. PER-SWAP CHIPS — getDecisionsForSwaps (latest per swap)
// ═══════════════════════════════════════════════════════════════════════════

describe('per-swap chips — getDecisionsForSwaps', () => {
    it('keeps only the LATEST decision per swap (rows arrive newest-first)', async () => {
        h.enqueue({
            data: [
                decisionRow({ id: 'newer', swap_id: SWAP_1, decision: 'AUTO_APPROVE', created_at: '2026-07-03T10:00:00Z' }),
                decisionRow({ id: 'older', swap_id: SWAP_1, decision: 'AUTO_REJECT', created_at: '2026-07-01T10:00:00Z' }),
                decisionRow({ id: 'other', swap_id: SWAP_2, decision: 'MANUAL_REVIEW' }),
            ],
            error: null,
        });

        const map = await swapPolicyApi.getDecisionsForSwaps([SWAP_1, SWAP_2]);
        expect(map.get(SWAP_1)?.id).toBe('newer');
        expect(map.get(SWAP_2)?.decision).toBe('MANUAL_REVIEW');

        expect(opsFor('swap_decisions', 'in')[0].args).toEqual(['swap_id', [SWAP_1, SWAP_2]]);
        expect(opsFor('swap_decisions', 'order')[0].args).toEqual(['created_at', { ascending: false }]);
    });

    it('short-circuits on an empty id list (no query at all)', async () => {
        const map = await swapPolicyApi.getDecisionsForSwaps([]);
        expect(map.size).toBe(0);
        expect(h.ops).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. UNDO — revertAutoDecision (sm_swap_auto_revert)
// ═══════════════════════════════════════════════════════════════════════════

describe('undo — revertAutoDecision', () => {
    it('calls sm_swap_auto_revert with the decision + actor', async () => {
        await swapPolicyApi.revertAutoDecision(DEC_ID, ACTOR_ID);
        expect(h.rpc.fn).toHaveBeenCalledWith('sm_swap_auto_revert', {
            p_decision_id: DEC_ID,
            p_actor: ACTOR_ID,
        });
    });

    it('ALREADY_REVERTED is idempotent success, not an error', async () => {
        h.rpc.fn = vi.fn(async () => ({ data: { ok: true, code: 'ALREADY_REVERTED' }, error: null }));
        await expect(swapPolicyApi.revertAutoDecision(DEC_ID, ACTOR_ID)).resolves.toBeUndefined();
    });

    it('a refusal (NOT_REVERTABLE) throws with the RPC note', async () => {
        h.rpc.fn = vi.fn(async () => ({
            data: { ok: false, code: 'NOT_REVERTABLE', note: 'Only a committed AUTO_APPROVE can be reverted' },
            error: null,
        }));
        await expect(swapPolicyApi.revertAutoDecision(DEC_ID, ACTOR_ID))
            .rejects.toThrow(/Only a committed AUTO_APPROVE/);
    });

    it('FORBIDDEN (non-manager caller) throws', async () => {
        h.rpc.fn = vi.fn(async () => ({ data: { ok: false, code: 'FORBIDDEN' }, error: null }));
        await expect(swapPolicyApi.revertAutoDecision(DEC_ID, ACTOR_ID)).rejects.toThrow(/FORBIDDEN/);
    });

    it('a transport error surfaces as-is', async () => {
        h.rpc.fn = vi.fn(async () => ({ data: null, error: { message: 'network down' } }));
        await expect(swapPolicyApi.revertAutoDecision(DEC_ID, ACTOR_ID)).rejects.toEqual({ message: 'network down' });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. REVERTABILITY GUARD — isDecisionRevertable
// ═══════════════════════════════════════════════════════════════════════════

describe('revertability — isDecisionRevertable', () => {
    it('true ONLY for a committed, un-reverted AUTO_APPROVE', () => {
        expect(isDecisionRevertable(decisionRow({ decision: 'AUTO_APPROVE', committed: true, shadow: false }))).toBe(true);
    });

    it('shadow (never committed) decisions cannot be undone', () => {
        expect(isDecisionRevertable(decisionRow({ decision: 'AUTO_APPROVE', committed: false, shadow: true }))).toBe(false);
    });

    it('auto-rejects and manual-review routings cannot be undone here', () => {
        expect(isDecisionRevertable(decisionRow({ decision: 'AUTO_REJECT', committed: true }))).toBe(false);
        expect(isDecisionRevertable(decisionRow({ decision: 'MANUAL_REVIEW', committed: false }))).toBe(false);
    });

    it('an already-reverted decision cannot be undone twice', () => {
        expect(isDecisionRevertable(decisionRow({
            decision: 'AUTO_APPROVE',
            committed: true,
            reverted_at: '2026-07-03T12:00:00Z',
        }))).toBe(false);
    });
});
