/**
 * F1 — Fairness Ledger: Supabase Query Layer.
 *
 * CRUD operations for the `fairness_ledger` table. Thin wrapper — all
 * business logic lives in fairnessLedger.service.ts and the domain module.
 */

import { supabase } from '@/platform/supabase/client';
import type { FairnessMetric } from '@/modules/rosters/domain/fairness-ledger';

// ─── Row types ──────────────────────────────────────────────────────────────────

export interface FairnessLedgerRow {
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

export interface FairnessLedgerUpsertRow {
    organization_id: string;
    employee_id: string;
    metric: string;
    window_start: string;
    window_end: string;
    rolling_value: number;
    team_average: number;
    debt: number;
    updated_by_run?: string | null;
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
            console.error('[FairnessLedger] requestRecompute failed:', error.message);
            throw new Error(`fairnessLedger.requestRecompute failed: ${error.message}`);
        }

        return Number(data ?? 0);
    },

    /**
     * Fetch ledger rows for an EXACT window_end.
     *
     * Retained for the write path only: `updateAfterCommit` reads the rows it is
     * about to increment, and must never blend two different windows into one
     * upsert. Read-only consumers want `getLatestDebts` instead.
     */
    async getAllForWindow(
        organizationId: string,
        windowEnd: string,
    ): Promise<FairnessLedgerRow[]> {
        const { data, error } = await (supabase as any)
            .from('fairness_ledger')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('window_end', windowEnd);

        if (error) {
            console.error('[FairnessLedger] getAllForWindow failed:', error.message);
            return [];
        }

        return (data ?? []) as FairnessLedgerRow[];
    },

    /**
     * Bulk upsert ledger rows. Uses the composite unique index
     * (organization_id, employee_id, metric, window_end) for conflict resolution.
     */
    async upsertBatch(rows: FairnessLedgerUpsertRow[]): Promise<void> {
        if (rows.length === 0) return;

        // Supabase upsert needs the conflict columns specified
        const { error } = await (supabase as any)
            .from('fairness_ledger')
            .upsert(rows, {
                onConflict: 'organization_id,employee_id,metric,window_end',
                ignoreDuplicates: false,
            });

        if (error) {
            console.error('[FairnessLedger] upsertBatch failed:', error.message);
            throw new Error(`fairnessLedger.upsertBatch failed: ${error.message}`);
        }
    },

    /**
     * Delete all ledger rows for an organization at a given window end.
     * Used before a full rebuild.
     */
    async deleteForWindow(
        organizationId: string,
        windowEnd: string,
    ): Promise<void> {
        const { error } = await (supabase as any)
            .from('fairness_ledger')
            .delete()
            .eq('organization_id', organizationId)
            .eq('window_end', windowEnd);

        if (error) {
            console.error('[FairnessLedger] deleteForWindow failed:', error.message);
        }
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

    /**
     * Fetch all denied preferences (rejected bids) for an organization in a date range.
     * Used by the full-rebuild path to compute the `denied_preferences` metric.
     */
    async fetchDeniedPreferences(
        organizationId: string,
        startDate: string,
        endDate: string,
    ): Promise<Array<{
        employee_id: string;
        shift_id: string;
    }>> {
        // Inner join with shifts to filter by date range and org
        const { data, error } = await (supabase as any)
            .from('shift_bids')
            .select(`
                employee_id,
                shift_id,
                shift:shifts!inner(organization_id, shift_date)
            `)
            .eq('status', 'rejected')
            .eq('shift.organization_id', organizationId)
            .gte('shift.shift_date', startDate)
            .lte('shift.shift_date', endDate);

        if (error) {
            console.error('[FairnessLedger] fetchDeniedPreferences failed:', error.message);
            return [];
        }

        return (data ?? []).map((row: any) => ({
            employee_id: row.employee_id,
            shift_id: row.shift_id,
        }));
    },
};
