import { supabase } from '@/platform/supabase/client';
import {
    type AutoPilotAdapter,
    type AutoPilotCopy,
    type AutoPilotDecision,
    type AutoPilotPolicy,
    type AutoPilotPolicyField,
} from '@/modules/core/autopilot';

/**
 * Open Bids AutoPilot adapter — maps `bid_approval_rules` / `bid_decisions`
 * (migration 20260722110000_bid_auto_assign_shadow.sql) onto the generic
 * {@link AutoPilotAdapter}. The worker picks a compliance-clear winner when a
 * shift's bidding closes with no winner; this adapter configures + observes it.
 * Shadow-first: enabled=false / shadow_mode=true.
 */

const db = supabase as any;

export const BID_AUTOPILOT_COPY: AutoPilotCopy = {
    buttonLabel: 'Auto-Assign',
    buttonTitle: 'Auto-assign bid winners',
    title: 'Auto-Assign Bids',
    subtitle: 'Bot assigns a winner when bidding closes',
    liveWarning:
        'Live mode assigns the first compliance-clear bidder without a manager when bidding closes with no winner. ' +
        'The commit still passes the hardened winner gateway (state, winner-pending and 4h lock). Review the shadow feed below before going live.',
    emptyFeedHint: 'They appear as shifts finish bidding with no winner.',
    verbs: { approve: 'assign', reject: 'reject', review: 'review' },
    committedLabels: { approve: 'Auto-assigned', reject: 'Auto-rejected' },
};

const POLICY_FIELDS: AutoPilotPolicyField[] = [
    {
        key: 'auto_assign_warnings',
        type: 'toggle',
        label: 'Assign with warnings',
        hint: 'Assign bidders with WARNING-level compliance hits',
        default: false,
        gatedByEnabled: true,
    },
];

const DECISION_SELECT =
    'id, shift_id, winner_id, decision, reason, shadow, committed, reverted_at, engine_version, subtitle, created_at';

interface BidPolicyRow {
    id: string;
    organization_id: string;
    department_id: string | null;
    enabled: boolean;
    shadow_mode: boolean;
    auto_assign_warnings: boolean;
    version: number;
}

interface BidDecisionRow {
    id: string;
    shift_id: string;
    winner_id: string | null;
    decision: AutoPilotDecision['kind'];
    reason: string | null;
    shadow: boolean;
    committed: boolean;
    reverted_at: string | null;
    engine_version: string;
    subtitle: string | null;
    created_at: string;
}

const rowToPolicy = (row: BidPolicyRow | null): AutoPilotPolicy | null =>
    row
        ? {
              enabled: row.enabled,
              shadow_mode: row.shadow_mode,
              version: row.version,
              fields: { auto_assign_warnings: row.auto_assign_warnings ?? false },
          }
        : null;

const rowToDecision = (row: BidDecisionRow): AutoPilotDecision => ({
    id: row.id,
    entityId: row.shift_id,
    kind: row.decision,
    reason: row.reason,
    shadow: row.shadow,
    committed: row.committed,
    revertedAt: row.reverted_at,
    engineVersion: row.engine_version,
    createdAt: row.created_at,
    subtitle: row.subtitle || 'Bid',
});

export interface BidAutoPilotDeps {
    organizationId: string;
    userId?: string | null;
}

const isTableMissingError = (err: any) =>
    err && (
        err.code === '42P01' ||
        err.status === 404 ||
        err.code === 'PGRST204' ||
        (typeof err.message === 'string' && (err.message.includes('does not exist') || err.message.includes('not found')))
    );

const EMPTY_MAP = new Map<string, AutoPilotDecision>();

export function createBidAutoPilotAdapter({ organizationId, userId }: BidAutoPilotDeps): AutoPilotAdapter {
    return {
        copy: BID_AUTOPILOT_COPY,
        policyFields: POLICY_FIELDS,
        supportsRevert: true,

        async getPolicy(): Promise<AutoPilotPolicy | null> {
            try {
                const { data, error } = await db
                    .from('bid_approval_rules')
                    .select('*')
                    .eq('organization_id', organizationId)
                    .is('department_id', null)
                    .maybeSingle();
                if (error) {
                    if (isTableMissingError(error)) return null;
                    throw error;
                }
                return rowToPolicy(data as BidPolicyRow | null);
            } catch (err) {
                if (isTableMissingError(err)) return null;
                throw err;
            }
        },

        async savePolicy(next: AutoPilotPolicy): Promise<AutoPilotPolicy> {
            const patch = {
                enabled: next.enabled,
                shadow_mode: next.shadow_mode,
                auto_assign_warnings: !!next.fields.auto_assign_warnings,
                updated_by: userId ?? null,
                updated_at: new Date().toISOString(),
            };

            const { data: existing } = await db
                .from('bid_approval_rules')
                .select('id')
                .eq('organization_id', organizationId)
                .is('department_id', null)
                .maybeSingle();

            if (existing?.id) {
                const { data, error } = await db
                    .from('bid_approval_rules')
                    .update(patch)
                    .eq('id', existing.id)
                    .select()
                    .single();
                if (error) throw error;
                return rowToPolicy(data as BidPolicyRow)!;
            }

            const { data, error } = await db
                .from('bid_approval_rules')
                .insert({ organization_id: organizationId, department_id: null, ...patch })
                .select()
                .single();
            if (error) throw error;
            return rowToPolicy(data as BidPolicyRow)!;
        },

        async getRecentDecisions(limit: number): Promise<AutoPilotDecision[]> {
            try {
                const { data, error } = await db
                    .from('bid_decisions')
                    .select(DECISION_SELECT)
                    .order('created_at', { ascending: false })
                    .limit(limit);
                if (error) {
                    if (isTableMissingError(error)) return [];
                    throw error;
                }
                return ((data || []) as BidDecisionRow[]).map(rowToDecision);
            } catch (err) {
                if (isTableMissingError(err)) return [];
                throw err;
            }
        },

        async getDecisionsForEntities(shiftIds: string[]): Promise<Map<string, AutoPilotDecision>> {
            if (shiftIds.length === 0) return EMPTY_MAP;
            try {
                const { data, error } = await db
                    .from('bid_decisions')
                    .select(DECISION_SELECT)
                    .in('shift_id', shiftIds)
                    .order('created_at', { ascending: false });
                if (error) {
                    if (isTableMissingError(error)) return EMPTY_MAP;
                    throw error;
                }
                if (!data || data.length === 0) return EMPTY_MAP;
                const map = new Map<string, AutoPilotDecision>();
                for (const row of (data || []) as BidDecisionRow[]) {
                    if (!map.has(row.shift_id)) map.set(row.shift_id, rowToDecision(row));
                }
                return map;
            } catch (err) {
                if (isTableMissingError(err)) return EMPTY_MAP;
                throw err;
            }
        },

        async revert(decision: AutoPilotDecision): Promise<void> {
            if (!userId) throw new Error('No authenticated user');
            const { data, error } = await db.rpc('sm_bid_auto_revert', {
                p_decision_id: decision.id,
                p_actor: userId,
            });
            if (error) throw error;
            const result = data as { ok: boolean; code: string; note?: string; error?: string };
            if (!result?.ok && result?.code !== 'ALREADY_REVERTED') {
                throw new Error(result?.note || result?.error || `Revert refused (${result?.code || 'unknown'})`);
            }
        },
    };
}
