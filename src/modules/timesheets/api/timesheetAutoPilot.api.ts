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
 * Edge worker). Backend is shadow-first: enabled=false / shadow_mode=true.
 */

// Tables are not in the generated types yet (added by migration
// 20260722100000_timesheet_auto_verify_shadow.sql) — same `as any` bridge the
// swap policy API uses.
const db = supabase as any;

export const TIMESHEET_AUTOPILOT_COPY: AutoPilotCopy = {
    buttonLabel: 'Auto-Verify',
    buttonTitle: 'Auto-verify timesheets',
    title: 'Auto-Verify Timesheets',
    subtitle: 'Bot verifies zero-variance timesheets',
    liveWarning:
        'Live mode approves clean-punch timesheets without a manager. Only shifts with clock-in/out within tolerance, ' +
        'no overtime and no manual edits are auto-verified — everything else still routes to you. Review the shadow feed below first.',
    emptyFeedHint: 'They appear as shifts finish and become reviewable.',
    verbs: { approve: 'verify', reject: 'reject', review: 'review' },
    committedLabels: { approve: 'Auto-verified', reject: 'Auto-rejected' },
};

const POLICY_FIELDS: AutoPilotPolicyField[] = [
    {
        key: 'tolerance_minutes',
        type: 'number',
        label: 'Punch tolerance',
        hint: 'Max clock-in/out variance vs schedule',
        default: 5,
        min: 0,
        max: 240,
        unit: 'min',
        gatedByEnabled: true,
    },
    {
        key: 'require_no_overtime',
        type: 'toggle',
        label: 'No overtime',
        hint: 'Only auto-verify shifts with no overtime',
        default: true,
        gatedByEnabled: true,
    },
];

const DECISION_SELECT =
    'id, shift_id, decision, reason, shadow, committed, reverted_at, engine_version, subtitle, employee_id, work_date, variance_snapshot, created_at';

interface TimesheetPolicyRow {
    id: string;
    organization_id: string;
    department_id: string | null;
    enabled: boolean;
    shadow_mode: boolean;
    tolerance_minutes: number;
    require_no_overtime: boolean;
    max_auto_per_employee_per_week: number;
    version: number;
}

interface TimesheetDecisionRow {
    id: string;
    shift_id: string;
    decision: AutoPilotDecision['kind'];
    reason: string | null;
    shadow: boolean;
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
    row
        ? {
              enabled: row.enabled,
              shadow_mode: row.shadow_mode,
              version: row.version,
              fields: {
                  tolerance_minutes: row.tolerance_minutes ?? 5,
                  require_no_overtime: row.require_no_overtime ?? true,
              },
          }
        : null;

const rowToDecision = (row: TimesheetDecisionRow): AutoPilotDecision => ({
    id: row.id,
    entityId: row.shift_id,
    kind: row.decision,
    reason: row.reason,
    shadow: row.shadow,
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

export function createTimesheetAutoPilotAdapter({ organizationId, userId }: TimesheetAutoPilotDeps): AutoPilotAdapter {
    return {
        copy: TIMESHEET_AUTOPILOT_COPY,
        policyFields: POLICY_FIELDS,
        supportsRevert: true,

        async getPolicy(): Promise<AutoPilotPolicy | null> {
            const { data, error } = await db
                .from('timesheet_approval_rules')
                .select('*')
                .eq('organization_id', organizationId)
                .is('department_id', null)
                .maybeSingle();
            if (error) throw error;
            return rowToPolicy(data as TimesheetPolicyRow | null);
        },

        async savePolicy(next: AutoPilotPolicy): Promise<AutoPilotPolicy> {
            const patch = {
                enabled: next.enabled,
                shadow_mode: next.shadow_mode,
                tolerance_minutes: Number(next.fields.tolerance_minutes ?? 5),
                require_no_overtime: !!next.fields.require_no_overtime,
                updated_by: userId ?? null,
                updated_at: new Date().toISOString(),
            };

            // Update-by-id when it exists (partial unique index makes upsert-onConflict
            // unreliable here), insert otherwise — mirrors swapPolicyApi.saveOrgPolicy.
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
                    .select()
                    .single();
                if (error) throw error;
                return rowToPolicy(data as TimesheetPolicyRow)!;
            }

            const { data, error } = await db
                .from('timesheet_approval_rules')
                .insert({ organization_id: organizationId, department_id: null, ...patch })
                .select()
                .single();
            if (error) throw error;
            return rowToPolicy(data as TimesheetPolicyRow)!;
        },

        async getRecentDecisions(limit: number): Promise<AutoPilotDecision[]> {
            const { data, error } = await db
                .from('timesheet_decisions')
                .select(DECISION_SELECT)
                .order('created_at', { ascending: false })
                .limit(limit);
            if (error) throw error;
            return ((data || []) as TimesheetDecisionRow[]).map(rowToDecision);
        },

        async getDecisionsForEntities(shiftIds: string[]): Promise<Map<string, AutoPilotDecision>> {
            const map = new Map<string, AutoPilotDecision>();
            if (shiftIds.length === 0) return map;
            const { data, error } = await db
                .from('timesheet_decisions')
                .select(DECISION_SELECT)
                .in('shift_id', shiftIds)
                .order('created_at', { ascending: false });
            if (error) throw error;
            for (const row of (data || []) as TimesheetDecisionRow[]) {
                if (!map.has(row.shift_id)) map.set(row.shift_id, rowToDecision(row));
            }
            return map;
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
