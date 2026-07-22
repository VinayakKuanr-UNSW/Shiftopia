/**
 * AutoPilot — the shared shape behind every "auto-decision" surface.
 *
 * Swap Requests (auto-approve), Open Bids (auto-assign) and Timesheets
 * (auto-verify) all run the same shadow-first pipeline: a per-org policy with an
 * OFF / SHADOW / LIVE mode, an autonomous worker that logs a decision per entity,
 * and a manager-facing control that configures the policy + reviews the decision
 * feed (with undo for committed auto-approvals).
 *
 * Each domain provides a thin {@link AutoPilotAdapter} that maps its own tables
 * onto these normalized types; the generic `<AutoPilotControl>` and
 * `<AutoPilotDecisionChip>` render every domain identically.
 */

export type AutoPilotMode = 'OFF' | 'SHADOW' | 'LIVE';

export type AutoPilotDecisionKind = 'AUTO_APPROVE' | 'MANUAL_REVIEW' | 'AUTO_REJECT';

/**
 * Normalized policy. Every domain shares `enabled` / `shadow_mode` / `version`;
 * domain-specific knobs (tolerance, per-week caps, warning handling …) live in
 * `fields`, keyed by the same `key`s the adapter declares in `policyFields`.
 */
export interface AutoPilotPolicy {
    enabled: boolean;
    shadow_mode: boolean;
    version: number;
    fields: Record<string, number | boolean>;
}

/** A blank policy for an org that has never opted in — badge shows OFF. */
export const emptyPolicy = (fields: Record<string, number | boolean> = {}): AutoPilotPolicy => ({
    enabled: false,
    shadow_mode: true,
    version: 0,
    fields,
});

export const policyMode = (
    p: Pick<AutoPilotPolicy, 'enabled' | 'shadow_mode'> | null,
): AutoPilotMode => (!p || !p.enabled ? 'OFF' : p.shadow_mode ? 'SHADOW' : 'LIVE');

/**
 * Normalized decision for the feed + per-row chip. The adapter maps its raw
 * decision row into this shape (building `subtitle` / `target` however it likes).
 */
export interface AutoPilotDecision {
    /** decision-row id — passed back to {@link AutoPilotAdapter.revert} */
    id: string;
    /** the domain entity id (swap / shift / timesheet) for keying + lookups */
    entityId: string;
    kind: AutoPilotDecisionKind;
    reason: string | null;
    shadow: boolean;
    committed: boolean;
    revertedAt: string | null;
    engineVersion: string;
    createdAt: string;
    /** entity label — e.g. "Alex ↔ Bob", "Casey · Fri 09:00–17:00" */
    subtitle: string;
    /** optional winner/target label (bids), rendered as "→ X" */
    target?: string | null;
}

/** A committed live auto-approval that hasn't been undone yet. */
export const isDecisionRevertable = (d: AutoPilotDecision): boolean =>
    d.kind === 'AUTO_APPROVE' && d.committed && !d.revertedAt;

export type AutoPilotFieldType = 'toggle' | 'number';

/** A single policy knob rendered generically in the control's popover. */
export interface AutoPilotPolicyField {
    key: string;
    type: AutoPilotFieldType;
    label: string;
    hint?: string;
    /** value shown for an org with no policy row yet (falls back to min / false) */
    default?: number | boolean;
    /** number fields only */
    min?: number;
    max?: number;
    /** number fields only — unit suffix shown next to the input (e.g. "min") */
    unit?: string;
    /** dim + disable while the policy is OFF (most knobs only matter when enabled) */
    gatedByEnabled?: boolean;
}

/** Human-facing copy for one domain. Keeps the generic control domain-agnostic. */
export interface AutoPilotCopy {
    /** header button label — "Auto-Approve" | "Auto-Verify" | "Auto-Assign" */
    buttonLabel: string;
    /** header button tooltip */
    buttonTitle: string;
    /** popover title */
    title: string;
    /** popover subtitle (one line under the title) */
    subtitle: string;
    /** shown in the amber going-LIVE warning box */
    liveWarning: string;
    /** empty-feed helper line */
    emptyFeedHint: string;
    /** verbs used to phrase shadow "would …" chips */
    verbs: { approve: string; reject: string; review: string };
    /** committed-decision chip labels */
    committedLabels: { approve: string; reject: string };
}

/**
 * The per-domain contract. Construct an adapter bound to an org + actor, then
 * hand it to `<AutoPilotControl adapter={…} />`.
 */
export interface AutoPilotAdapter {
    copy: AutoPilotCopy;
    policyFields: AutoPilotPolicyField[];
    /** whether committed auto-approvals can be undone (drives the Undo button) */
    supportsRevert: boolean;

    getPolicy(): Promise<AutoPilotPolicy | null>;
    savePolicy(next: AutoPilotPolicy): Promise<AutoPilotPolicy>;
    getRecentDecisions(limit: number): Promise<AutoPilotDecision[]>;
    /** latest decision per entity id, for per-row chips */
    getDecisionsForEntities?(entityIds: string[]): Promise<Map<string, AutoPilotDecision>>;
    revert?(decision: AutoPilotDecision): Promise<void>;
}
