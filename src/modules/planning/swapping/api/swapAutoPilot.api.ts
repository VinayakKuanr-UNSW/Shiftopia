import {
    type AutoPilotAdapter,
    type AutoPilotCopy,
    type AutoPilotDecision,
    type AutoPilotPolicy,
    type AutoPilotPolicyField,
} from '@/modules/core/autopilot';
import { swapPolicyApi, type SwapApprovalPolicy, type SwapAutoDecision } from './swapPolicy.api';

/**
 * Swap-approve AutoPilot adapter — maps the existing `swapPolicyApi`
 * (swap_approval_rules / swap_decisions) onto the generic {@link AutoPilotAdapter}
 * the shared `<AutoPilotControl>` renders. Behaviour-preserving: this is the same
 * pipeline the bespoke AutoApproveSwapsControl drove, now expressed as an adapter
 * so swaps / timesheets / bids share one control.
 */

export const SWAP_AUTOPILOT_COPY: AutoPilotCopy = {
    buttonLabel: 'Auto-Approve',
    buttonTitle: 'Auto-approve swap requests',
    title: 'Auto-Approve Swaps',
    subtitle: 'Bot decides manager-pending swaps',
    liveWarning:
        'Live mode lets the bot approve and reject swaps without a manager. Its compliance check covers overlap, ' +
        '48h weekly, 11h rest and qualifications — a subset of the full rule set. Review the shadow feed below before going live.',
    emptyFeedHint: 'They appear as swaps reach manager review.',
    verbs: { approve: 'approve', reject: 'reject', review: 'review' },
    committedLabels: { approve: 'Auto-approved', reject: 'Auto-rejected' },
};

const POLICY_FIELDS: AutoPilotPolicyField[] = [
    {
        key: 'auto_approve_warnings',
        type: 'toggle',
        label: 'Auto-approve warnings',
        hint: 'Approve swaps with WARNING-level compliance hits',
        default: false,
        gatedByEnabled: true,
    },
    {
        key: 'max_auto_per_employee_per_week',
        type: 'number',
        label: 'Max auto / employee / week',
        hint: 'Further swaps route to manual review',
        default: 3,
        min: 0,
        max: 99,
        gatedByEnabled: true,
    },
];

/** Party names → "Alex ↔ Bob" | single name | open-market label. */
const decisionPartyNames = (d: SwapAutoDecision): string => {
    const name = (p?: { first_name: string | null; last_name: string | null } | null) =>
        [p?.first_name, p?.last_name].filter(Boolean).join(' ');
    const a = name(d.swap?.requested_by);
    const b = name(d.swap?.swap_with);
    if (a && b) return `${a} ↔ ${b}`;
    return a || b || 'Open market swap';
};

/** Map a raw swap decision to the normalized shape (exported for AutoDecisionChip). */
export const swapDecisionToAutoPilot = (d: SwapAutoDecision): AutoPilotDecision => ({
    id: d.id,
    entityId: d.swap_id,
    kind: d.decision,
    reason: d.reason,
    shadow: d.shadow,
    committed: d.committed,
    revertedAt: d.reverted_at,
    engineVersion: d.engine_version,
    createdAt: d.created_at,
    subtitle: decisionPartyNames(d),
});

const policyToAutoPilot = (p: SwapApprovalPolicy | null): AutoPilotPolicy | null =>
    p
        ? {
              enabled: p.enabled,
              shadow_mode: p.shadow_mode,
              version: p.version,
              fields: {
                  auto_approve_warnings: p.auto_approve_warnings,
                  max_auto_per_employee_per_week: p.max_auto_per_employee_per_week,
              },
          }
        : null;

export interface SwapAutoPilotDeps {
    organizationId: string;
    userId?: string | null;
}

export function createSwapAutoPilotAdapter({ organizationId, userId }: SwapAutoPilotDeps): AutoPilotAdapter {
    return {
        copy: SWAP_AUTOPILOT_COPY,
        policyFields: POLICY_FIELDS,
        supportsRevert: true,

        async getPolicy(): Promise<AutoPilotPolicy | null> {
            return policyToAutoPilot(await swapPolicyApi.getOrgPolicy(organizationId));
        },

        async savePolicy(next: AutoPilotPolicy): Promise<AutoPilotPolicy> {
            const saved = await swapPolicyApi.saveOrgPolicy(
                organizationId,
                {
                    enabled: next.enabled,
                    shadow_mode: next.shadow_mode,
                    auto_approve_warnings: !!next.fields.auto_approve_warnings,
                    max_auto_per_employee_per_week: Number(next.fields.max_auto_per_employee_per_week ?? 3),
                },
                userId,
            );
            return policyToAutoPilot(saved)!;
        },

        async getRecentDecisions(limit: number): Promise<AutoPilotDecision[]> {
            return (await swapPolicyApi.getRecentDecisions(limit)).map(swapDecisionToAutoPilot);
        },

        async getDecisionsForEntities(swapIds: string[]): Promise<Map<string, AutoPilotDecision>> {
            const raw = await swapPolicyApi.getDecisionsForSwaps(swapIds);
            const map = new Map<string, AutoPilotDecision>();
            for (const [swapId, d] of raw) map.set(swapId, swapDecisionToAutoPilot(d));
            return map;
        },

        async revert(decision: AutoPilotDecision): Promise<void> {
            if (!userId) throw new Error('No authenticated user');
            await swapPolicyApi.revertAutoDecision(decision.id, userId);
        },
    };
}
