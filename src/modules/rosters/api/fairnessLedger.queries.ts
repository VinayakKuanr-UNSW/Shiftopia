/**
 * F1 — Fairness Ledger: Supabase Query Layer.
 *
 * CRUD operations for the `fairness_ledger` table. Thin wrapper — all
 * business logic lives in fairnessLedger.service.ts and the domain module.
 */

import { supabase } from '@/platform/supabase/client';
import type { FairnessMetric } from '@/modules/rosters/domain/fairness-ledger';

// ─── Row types ──────────────────────────────────────────────────────────────────

interface FairnessLedgerRow {
    id: string;
    organization_id: string;
    employee_id: string;
    metric: FairnessMetric;
    window_start: string;   // date
    window_end: string;     // date
    rolling_value: number;
    team_average: number;
    debt: number;
    last_updated_at: string;
    updated_by_run: string | null;
}


// ─── Queries ────────────────────────────────────────────────────────────────────

/** A row from `get_fairness_debts_latest` — no `id`/`organization_id`, and the
 *  `window_end` is whatever the latest available window was, not necessarily
 *  the as-of date the caller asked for. */
export type FairnessLedgerLatestRow = Pick<
    FairnessLedgerRow,
    'employee_id' | 'metric' | 'window_start' | 'window_end' | 'rolling_value' | 'team_average' | 'debt'
>;

export const fairnessLedgerQueries = {
    /**
     * Most recent debt row per (employee, metric) with `window_end <= asOf`.
     *
     * Audit F-04: every read used to require an EXACT `window_end = today`,
     * which matched nothing on any day without a recompute — so the ledger read
     * empty and every consumer silently behaved as though all debts were zero.
     * The RPC does the per-group "latest" in one index-ordered pass; doing it
     * here would mean pulling every historical window (one row per
     * employee/metric/DAY) and de-duplicating in the browser.
     *
     * `employeeIds` empty/omitted → every employee in the org.
     */
    async getLatestDebts(
        organizationId: string,
        employeeIds: string[] | null,
        asOf: string,
    ): Promise<FairnessLedgerLatestRow[]> {
        if (employeeIds !== null && employeeIds.length === 0) return [];

        const { data, error } = await (supabase.rpc as any)('get_fairness_debts_latest', {
            p_org_id: organizationId,
            p_employee_ids: employeeIds,
            p_as_of: asOf,
        });

        if (error) {
            console.error('[FairnessLedger] getLatestDebts failed:', error.message);
            return [];
        }

        return (data ?? []) as FairnessLedgerLatestRow[];
    },

    /**
     * Trigger the AUTHORITATIVE server-side rebuild for one org.
     *
     * `request_fairness_ledger_recompute` authorises the caller against the same
     * predicate as the `fairness_ledger_org_scoped` RLS policy, then delegates
     * to the definer-owned `recompute_fairness_ledger`. Returns the number of
     * ledger rows written.
     *
     * Audit F-04: the rebuild used to run in the browser — fetch every shift in
     * the 91-day window, classify, aggregate and upsert client-side. That made
     * it un-schedulable (it could only fire when someone clicked Publish) and,
     * had the SQL version been added alongside it, would have left two copies of
     * the debt maths to drift apart.
     */
    async requestRecompute(
        organizationId: string,
        asOf: string,
    ): Promise<number> {
        const { data, error } = await (supabase.rpc as any)('request_fairness_ledger_recompute', {
            p_org_id: organizationId,
            p_as_of: asOf,
        });

        if (error) {
            // 42501: the recompute is org-wide and needs org.manage, so a
            // manager's AutoScheduler Apply is refused by design. Not a failure:
            // nightly_fairness_recompute refreshes the ledger for everyone.
            if ((error as { code?: string }).code === '42501') {
                console.info('[FairnessLedger] Recompute is admin-only; the nightly job will refresh the ledger.');
                return 0;
            }
            console.error('[FairnessLedger] requestRecompute failed:', error.message);
            throw new Error(`fairnessLedger.requestRecompute failed: ${error.message}`);
        }

        return Number(data ?? 0);
    },

    /**
     * Fetch assigned shifts for a set of employees in a date range.
     * Used by the full-rebuild path to recompute the ledger from source.
     */
    async fetchAssignedShifts(
        organizationId: string,
        startDate: string,
        endDate: string,
        departmentId?: string,
    ): Promise<Array<{
        id: string;
        shift_date: string;
        start_time: string;
        end_time: string;
        assigned_employee_id: string;
        unpaid_break_minutes: number;
    }>> {
        let query = supabase
            .from('shifts')
            .select('id, shift_date, start_time, end_time, assigned_employee_id, unpaid_break_minutes')
            .eq('organization_id', organizationId)
            .not('assigned_employee_id', 'is', null)
            .neq('lifecycle_status', 'Cancelled')
            .gte('shift_date', startDate)
            .lte('shift_date', endDate);

        if (departmentId) {
            query = query.eq('department_id', departmentId);
        }

        const { data, error } = await query;

        if (error) {
            console.error('[FairnessLedger] fetchAssignedShifts failed:', error.message);
            return [];
        }

        return (data ?? []).map((row: any) => ({
            id: row.id,
            shift_date: row.shift_date,
            start_time: row.start_time,
            end_time: row.end_time,
            assigned_employee_id: row.assigned_employee_id,
            unpaid_break_minutes: row.unpaid_break_minutes ?? 0,
        }));
    },
};
