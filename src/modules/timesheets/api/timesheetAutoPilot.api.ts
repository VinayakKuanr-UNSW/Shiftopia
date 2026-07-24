import { supabase } from '@/platform/supabase/client';
import {
    type AutoPilotAdapter,
    type AutoPilotCopy,
    type AutoPilotDecision,
    type AutoPilotPolicy,
    type AutoPilotPolicyField,
} from '@/modules/core/autopilot';

/**
 * Timesheets AutoPilot adapter — maps `timesheet_approval_rules` /
 * `timesheet_decisions` onto the generic {@link AutoPilotAdapter} the shared
 * `<AutoPilotControl>` renders. Mirrors the swap auto-approve policy API.
 *
 * Rule: zero-variance clean punches (evaluated in the auto-verify-timesheets
 * Edge worker). AutoPilot is a per-org ON/OFF switch (enabled=false default).
 */

// Tables are not in the generated types yet (added by migration
// 20260722100000_timesheet_auto_verify.sql) — same `as any` bridge the
// swap policy API uses.
const db = supabase as any;

export const TIMESHEET_AUTOPILOT_COPY: AutoPilotCopy = {
    buttonLabel: 'Autopilot',
    buttonTitle: 'Timesheet AutoPilot',
    title: 'Autopilot',
    subtitle: 'Bot verifies zero-variance timesheets',
    onWarning:
        'Turning AutoPilot on approves clean-punch timesheets overnight without a manager. Only shifts with clock-in and ' +
        'clock-out within ±7.5 min of schedule (and no manual edits) are auto-verified — everything else routes to you.',
    emptyFeedHint: 'They appear as shifts finish and become reviewable.',
    committedLabels: { approve: 'Auto-verified', reject: 'Auto-rejected' },
    howItWorks: [
        'When ON, the bot runs only 6 PM – 6 AM (Australia/Sydney). During office hours it stays off and you review timesheets yourself.',
        'A shift is picked up the moment it becomes reviewable (clock-out, auto clock-out or no-show). Daytime completions wait in the queue and are swept that night.',
        'Clean punches — both clock-in and clock-out within ±7.5 min of the roster — are auto-approved. Billable time is the actual punch rounded to the nearest 15 min, exactly as in manual review.',
        'Anything else (bigger variance, missing punch, auto clock-out, no-show or a manual edit) is left for you and shows up in that shift’s History as “needs review”.',
        'Timesheets are never auto-rejected, and a decision you undo is never re-verified by the bot.',
    ],
};

// No configurable knobs: the ±7.5 min tolerance and 6 PM–6 AM window are fixed
// in the worker/DB. The control is a pure ON/OFF switch plus the "i" explainer.
const POLICY_FIELDS: AutoPilotPolicyField[] = [];

const DECISION_SELECT =
    'id, shift_id, decision, reason, committed, reverted_at, engine_version, subtitle, employee_id, work_date, variance_snapshot, created_at';

interface TimesheetPolicyRow {
    id: string;
    organization_id: string;
    department_id: string | null;
    enabled: boolean;
    version: number;
}

interface TimesheetDecisionRow {
    id: string;
    shift_id: string;
    decision: AutoPilotDecision['kind'];
    reason: string | null;
    committed: boolean;
    reverted_at: string | null;
    engine_version: string;
    subtitle: string | null;
    employee_id: string | null;
    work_date: string | null;
    variance_snapshot: Record<string, unknown> | null;
    created_at: string;
}

const rowToPolicy = (row: TimesheetPolicyRow | null): AutoPilotPolicy | null =>
    row ? { enabled: row.enabled, version: row.version, fields: {} } : null;

const rowToDecision = (row: TimesheetDecisionRow): AutoPilotDecision => ({
    id: row.id,
    entityId: row.shift_id,
    kind: row.decision,
    reason: row.reason,
    committed: row.committed,
    revertedAt: row.reverted_at,
    engineVersion: row.engine_version,
    createdAt: row.created_at,
    subtitle: row.subtitle || [row.work_date].filter(Boolean).join(' · ') || 'Timesheet',
});

export interface TimesheetAutoPilotDeps {
    organizationId: string;
    userId?: string | null;
}

const isTableMissingError = (err: any) =>
    err && (
        err.code === '42P01' ||
        err.code === '42703' ||
        err.status === 400 ||
        err.status === 404 ||
        err.code === 'PGRST204' ||
        err.code === 'PGRST200' ||
        (typeof err.code === 'string' && err.code.startsWith('PGRST')) ||
        (typeof err.message === 'string' && (
            err.message.includes('does not exist') ||
            err.message.includes('not found') ||
            err.message.includes('Could not find') ||
            err.message.includes('schema cache') ||
            err.message.includes('column')
        ))
    );

const EMPTY_MAP = new Map<string, AutoPilotDecision>();

export function createTimesheetAutoPilotAdapter({ organizationId, userId }: TimesheetAutoPilotDeps): AutoPilotAdapter {
    return {
        copy: TIMESHEET_AUTOPILOT_COPY,
        policyFields: POLICY_FIELDS,
        supportsRevert: true,
        // Bot decisions live in each shift's own history (the per-row History
        // popover), so no separate global list in the control popover.
        showDecisionFeed: false,

        async getPolicy(): Promise<AutoPilotPolicy | null> {
            try {
                const { data, error } = await db
                    .from('timesheet_approval_rules')
                    .select('*')
                    .eq('organization_id', organizationId)
                    .is('department_id', null)
                    .maybeSingle();
                if (error) {
                    if (isTableMissingError(error)) return null;
                    throw error;
                }
                return rowToPolicy(data as TimesheetPolicyRow | null);
            } catch (err) {
                if (isTableMissingError(err)) return null;
                throw err;
            }
        },

        async savePolicy(next: AutoPilotPolicy): Promise<AutoPilotPolicy> {
            // Pure ON/OFF: tolerance (±7.5m) and the 6 PM–6 AM window are fixed
            // server-side, so we only ever write `enabled`. Other columns keep
            // their table defaults on insert.
            const patch = {
                enabled: next.enabled,
                updated_by: userId ?? null,
                updated_at: new Date().toISOString(),
            };

            const { data: existing } = await db
                .from('timesheet_approval_rules')
                .select('id')
                .eq('organization_id', organizationId)
                .is('department_id', null)
                .maybeSingle();

            if (existing?.id) {
                const { data, error } = await db
                    .from('timesheet_approval_rules')
                    .update(patch)
                    .eq('id', existing.id)
                    .select('id, organization_id, department_id, enabled, version')
                    .single();
                if (error) throw error;
                return rowToPolicy(data as TimesheetPolicyRow)!;
            }

            const { data, error } = await db
                .from('timesheet_approval_rules')
                .insert({ organization_id: organizationId, department_id: null, ...patch })
                .select('id, organization_id, department_id, enabled, version')
                .single();
            if (error) throw error;
            return rowToPolicy(data as TimesheetPolicyRow)!;
        },

        async getRecentDecisions(limit: number): Promise<AutoPilotDecision[]> {
            try {
                const { data, error } = await db
                    .from('timesheet_decisions')
                    .select(DECISION_SELECT)
                    .order('created_at', { ascending: false })
                    .limit(limit);
                if (error) {
                    if (isTableMissingError(error)) return [];
                    throw error;
                }
                return ((data || []) as TimesheetDecisionRow[]).map(rowToDecision);
            } catch (err) {
                if (isTableMissingError(err)) return [];
                throw err;
            }
        },

        async getDecisionsForEntities(shiftIds: string[]): Promise<Map<string, AutoPilotDecision>> {
            if (shiftIds.length === 0) return EMPTY_MAP;
            try {
                const { data, error } = await db
                    .from('timesheet_decisions')
                    .select(DECISION_SELECT)
                    .in('shift_id', shiftIds)
                    .order('created_at', { ascending: false });
                if (error) {
                    if (isTableMissingError(error)) return EMPTY_MAP;
                    throw error;
                }
                if (!data || data.length === 0) return EMPTY_MAP;
                const map = new Map<string, AutoPilotDecision>();
                for (const row of (data || []) as TimesheetDecisionRow[]) {
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
            const { data, error } = await db.rpc('sm_timesheet_auto_revert', {
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
