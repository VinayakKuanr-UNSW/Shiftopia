import { supabase } from '@/platform/supabase/client';

/**
 * Auto-Approve Swaps — policy + decision-feed API.
 *
 * Backend contract (all live in prod, shadow-first):
 *   - `swap_approval_rules`  — per-org (dept-scoped optional) policy row. RLS: gamma+ managers
 *     have full access, org-scoped via app_access_certificates.
 *   - `swap_decisions`       — one row per bot evaluation (shadow rows have shadow=true and
 *     committed=false; live auto-approve/reject rows have committed=true). RLS: gamma+ read.
 *   - `sm_swap_auto_revert(p_decision_id, p_actor)` — undoes a committed AUTO_APPROVE
 *     (re-swaps via the gateway). Self-guards to gamma+ inside the function.
 *
 * The pipeline itself (enqueue trigger → swap_review_queue → auto-approve-swaps Edge worker
 * → sm_swap_auto_decide) is autonomous; this API only configures and observes it.
 */

const db = supabase as any;

export type SwapAutoDecisionKind = 'AUTO_APPROVE' | 'MANUAL_REVIEW' | 'AUTO_REJECT';

export interface SwapApprovalPolicy {
    id: string;
    organization_id: string;
    department_id: string | null;
    enabled: boolean;
    shadow_mode: boolean;
    auto_approve_warnings: boolean;
    confidence_min: number;
    max_auto_per_employee_per_week: number;
    rules: Record<string, unknown>;
    version: number;
    updated_by: string | null;
    updated_at: string;
    created_at: string;
}

export interface SwapPolicyPatch {
    enabled?: boolean;
    shadow_mode?: boolean;
    auto_approve_warnings?: boolean;
    confidence_min?: number;
    max_auto_per_employee_per_week?: number;
}

interface DecisionProfile {
    first_name: string | null;
    last_name: string | null;
}

export interface SwapAutoDecision {
    id: string;
    swap_id: string;
    decision: SwapAutoDecisionKind;
    reason: string | null;
    shadow: boolean;
    committed: boolean;
    reverted_at: string | null;
    reverted_by: string | null;
    engine_version: string;
    policy_version: number;
    eligibility_result: Record<string, unknown> | null;
    created_at: string;
    swap?: {
        id: string;
        status: string;
        requested_by?: DecisionProfile | null;
        swap_with?: DecisionProfile | null;
    } | null;
}

/** A committed live auto-approval that hasn't been undone yet. */
export const isDecisionRevertable = (d: SwapAutoDecision): boolean =>
    d.decision === 'AUTO_APPROVE' && d.committed && !d.reverted_at;

const DECISION_SELECT = `
    id, swap_id, decision, reason, shadow, committed, reverted_at, reverted_by,
    engine_version, policy_version, eligibility_result, created_at,
    swap:shift_swaps!swap_id(
        id, status,
        requested_by:profiles!requester_id(first_name, last_name),
        swap_with:profiles!target_id(first_name, last_name)
    )
`;

export const swapPolicyApi = {
    /**
     * Fetch the org-default policy row (department_id IS NULL). Returns null when the org
     * has never opted in.
     */
    async getOrgPolicy(organizationId: string): Promise<SwapApprovalPolicy | null> {
        const { data, error } = await db
            .from('swap_approval_rules')
            .select('*')
            .eq('organization_id', organizationId)
            .is('department_id', null)
            .maybeSingle();
        if (error) throw error;
        return data as SwapApprovalPolicy | null;
    },

    /**
     * Create or update the org-default policy row. Update-by-id when it exists (the
     * partial unique index makes upsert-onConflict unreliable here), insert otherwise.
     * `version` is bumped server-side by trg_bump_swap_policy_version.
     */
    async saveOrgPolicy(
        organizationId: string,
        patch: SwapPolicyPatch,
        actorId?: string | null,
    ): Promise<SwapApprovalPolicy> {
        const existing = await this.getOrgPolicy(organizationId);

        if (existing) {
            const { data, error } = await db
                .from('swap_approval_rules')
                .update({ ...patch, updated_by: actorId ?? null, updated_at: new Date().toISOString() })
                .eq('id', existing.id)
                .select()
                .single();
            if (error) throw error;
            return data as SwapApprovalPolicy;
        }

        const { data, error } = await db
            .from('swap_approval_rules')
            .insert({
                organization_id: organizationId,
                department_id: null,
                // Shadow-first defaults; the patch may override
                enabled: false,
                shadow_mode: true,
                ...patch,
                updated_by: actorId ?? null,
            })
            .select()
            .single();
        if (error) throw error;
        return data as SwapApprovalPolicy;
    },

    /** Recent bot decisions (newest first) for the shadow-comparison feed. */
    async getRecentDecisions(limit = 25): Promise<SwapAutoDecision[]> {
        const { data, error } = await db
            .from('swap_decisions')
            .select(DECISION_SELECT)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return (data || []) as SwapAutoDecision[];
    },

    /** Latest decision per swap, for per-request chips. */
    async getDecisionsForSwaps(swapIds: string[]): Promise<Map<string, SwapAutoDecision>> {
        const map = new Map<string, SwapAutoDecision>();
        if (swapIds.length === 0) return map;

        const { data, error } = await db
            .from('swap_decisions')
            .select(DECISION_SELECT)
            .in('swap_id', swapIds)
            .order('created_at', { ascending: false });
        if (error) throw error;

        for (const row of (data || []) as SwapAutoDecision[]) {
            if (!map.has(row.swap_id)) map.set(row.swap_id, row);
        }
        return map;
    },

    /**
     * Undo a committed auto-approval (gateway re-swaps the shifts back).
     * The RPC returns { ok, code, ... } instead of raising; surface refusals as errors.
     */
    async revertAutoDecision(decisionId: string, actorId: string): Promise<void> {
        const { data, error } = await db.rpc('sm_swap_auto_revert', {
            p_decision_id: decisionId,
            p_actor: actorId,
        });
        if (error) throw error;

        const result = data as { ok: boolean; code: string; note?: string; error?: string };
        if (!result?.ok && result?.code !== 'ALREADY_REVERTED') {
            throw new Error(result?.note || result?.error || `Revert refused (${result?.code || 'unknown'})`);
        }
    },
};
