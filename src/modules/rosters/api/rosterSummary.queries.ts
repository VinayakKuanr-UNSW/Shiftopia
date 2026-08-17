import { z } from 'zod';
import { callAuthenticatedRpc } from '@/platform/supabase/rpc/client';
import { ShiftFilters } from './queryKeys';
import { isValidUuid } from '../domain/shift.entity';

// ── DTOs & Schemas ────────────────────────────────────────────────────────────

export const RosterSummaryCellSchema = z.object({
    shift_date: z.string(),
    group_type: z.string().nullable(),
    sub_group_name: z.string().nullable(),
    total_shifts: z.number(),
    assigned_shifts: z.number(),
    open_shifts: z.number(),
    published_shifts: z.number(),
    draft_shifts: z.number(),
    cancelled_shifts: z.number(),
    total_net_minutes: z.number(),
    unique_employees: z.number(),
});

export type RosterSummaryCellDTO = z.infer<typeof RosterSummaryCellSchema>;

// Array schema for the RPC response
const RosterSummaryResponseSchema = z.array(RosterSummaryCellSchema);

// Single-row totals for the Roster Planner stats footer.
// `numeric` columns arrive from PostgREST as STRINGS (they exceed JS number
// precision in the general case), so every money/bigint field is coerced. The
// pre-existing est_cost/budget_cost relied on that coercion happening upstream;
// coercing here makes it explicit and keeps the new cost fields consistent.
const numeric = z.coerce.number();

export const RosterPlannerStatsSchema = z.object({
    total_shifts: z.number(),
    assigned_shifts: z.number(),
    open_shifts: z.number(),
    published_shifts: z.number(),
    cancelled_shifts: z.number(),
    total_net_minutes: numeric,
    unique_employees: z.number(),
    est_cost: numeric,
    // Pro-rated department budget for the window; 0 when no budget overlaps.
    budget_cost: numeric,
    /** The roster AS PLANNED — every live shift, filled or not. */
    scheduled_cost: numeric,
    /** What was actually worked — only shifts with a real worked window. */
    actual_cost: numeric,
    actual_net_minutes: numeric,
    costed_shifts: z.number(),
    uncosted_shifts: z.number(),
    actual_shifts: z.number(),
});

export type RosterPlannerStatsDTO = z.infer<typeof RosterPlannerStatsSchema>;

// The RPC RETURNS TABLE → an array with (at most) one row.
const RosterPlannerStatsResponseSchema = z.array(RosterPlannerStatsSchema);

// Zeroed default returned when the RPC yields no row (e.g. empty range).
const EMPTY_PLANNER_STATS: RosterPlannerStatsDTO = {
    total_shifts: 0,
    assigned_shifts: 0,
    open_shifts: 0,
    published_shifts: 0,
    cancelled_shifts: 0,
    total_net_minutes: 0,
    unique_employees: 0,
    est_cost: 0,
    budget_cost: 0,
    scheduled_cost: 0,
    actual_cost: 0,
    actual_net_minutes: 0,
    costed_shifts: 0,
    uncosted_shifts: 0,
    actual_shifts: 0,
};

// ── Queries ───────────────────────────────────────────────────────────────────

export const rosterSummaryQueries = {
    /**
     * Fetches aggregated shift summaries per (date, group) for a given date range.
     * Powered by a server-side Postgres function for millions-of-shifts scale.
     */
    async getRosterSummary(
        organizationId: string,
        startDate: string,
        endDate: string,
        filters?: ShiftFilters | null
    ): Promise<RosterSummaryCellDTO[]> {
        if (!isValidUuid(organizationId)) {
            console.warn('Invalid organization ID for getRosterSummary:', organizationId);
            return [];
        }

        return callAuthenticatedRpc(
            'get_roster_summary',
            () => ({
                p_organization_id: organizationId,
                p_start_date: startDate,
                p_end_date: endDate,
                p_department_ids: filters?.departmentIds?.filter(isValidUuid) || null,
                p_sub_department_ids: filters?.subDepartmentIds?.filter(isValidUuid) || null,
            }),
            RosterSummaryResponseSchema
        );
    },

    /**
     * Fetches single-row aggregate totals for the Roster Planner stats footer.
     * Server-side so every view (bucket / day / week / month) shows the same numbers.
     */
    async getRosterPlannerStats(
        organizationId: string,
        startDate: string,
        endDate: string,
        filters?: ShiftFilters | null
    ): Promise<RosterPlannerStatsDTO> {
        if (!isValidUuid(organizationId)) {
            console.warn('Invalid organization ID for getRosterPlannerStats:', organizationId);
            return EMPTY_PLANNER_STATS;
        }

        const rows = await callAuthenticatedRpc(
            'get_roster_planner_stats',
            () => ({
                p_organization_id: organizationId,
                p_start_date: startDate,
                p_end_date: endDate,
                p_department_ids: filters?.departmentIds?.filter(isValidUuid) || null,
                p_sub_department_ids: filters?.subDepartmentIds?.filter(isValidUuid) || null,
            }),
            RosterPlannerStatsResponseSchema
        );

        return rows[0] ?? EMPTY_PLANNER_STATS;
    }
};
