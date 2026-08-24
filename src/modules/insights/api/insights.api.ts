import { supabase } from '@/platform/supabase/client';
import {
    InsightsFilters,
    InsightsSummary,
    TrendRow,
    DeptBreakdownRow,
} from '../model/metric.types';
import type { ScopeSelection } from '@/platform/auth/types';
import { type BiddingKpis, EMPTY_BIDDING_KPIS } from '../model/bidding-kpis.types';
import { type MarketplaceKpis, EMPTY_KPIS } from '../model/marketplace-kpis.types';
import { type ManagerScorecard, EMPTY_SCORECARD } from '../model/manager-scorecard.types';

/**
 * The KPI module's data access. Every RPC contract lives here — parameter
 * names, null-vs-empty scope handling, and the row-or-array coercion the
 * single-row RPCs need.
 *
 * It is one module rather than one-per-hook on purpose. PostgREST fails
 * silently in a specific way: a single unknown column name 400s the WHOLE
 * select, react-query hands back its default, and the UI renders an empty
 * state indistinguishable from "no data". Keeping the contracts together is
 * what makes that reviewable. The hooks above this layer do caching and
 * nothing else.
 *
 * All functions are read-only, and every one throws on error rather than
 * coercing to a default — the caller decides what a failure looks like.
 */

/** Scope arrays are omitted when empty so the RPC reads them as "no filter". */
const scopeArgs = (scope: ScopeSelection) => ({
    p_org_ids:     scope.org_ids.length     ? scope.org_ids     : undefined,
    p_dept_ids:    scope.dept_ids.length    ? scope.dept_ids    : undefined,
    p_subdept_ids: scope.subdept_ids.length ? scope.subdept_ids : undefined,
});

/** Single-row RPCs come back as a row or a 1-element array depending on shape. */
const firstRow = <T,>(data: unknown, fallback: T): T =>
    ((Array.isArray(data) ? data[0] : data) as T | null | undefined) ?? fallback;

export const insightsApi = {
    /**
     * Single-call aggregate for all Overview KPIs in a date range.
     * Backed by get_insights_summary RPC.
     */
    async getSummary(filters: InsightsFilters): Promise<InsightsSummary> {
        const { data, error } = await supabase.rpc('get_insights_summary', {
            p_start_date:  filters.startDate,
            p_end_date:    filters.endDate,
            p_org_ids:     filters.orgIds?.length     ? filters.orgIds     : undefined,
            p_dept_ids:    filters.deptIds?.length    ? filters.deptIds    : undefined,
            p_subdept_ids: filters.subdeptIds?.length ? filters.subdeptIds : undefined,
        });
        if (error) throw error;
        return data as unknown as InsightsSummary;
    },

    /**
     * Daily fill-rate and cost by department — used for trend line chart.
     * Backed by get_insights_trend RPC.
     */
    async getTrend(filters: InsightsFilters): Promise<TrendRow[]> {
        const { data, error } = await supabase.rpc('get_insights_trend', {
            p_start_date:  filters.startDate,
            p_end_date:    filters.endDate,
            p_org_ids:     filters.orgIds?.length     ? filters.orgIds     : undefined,
            p_dept_ids:    filters.deptIds?.length    ? filters.deptIds    : undefined,
            // Added in 20260823090100. The RPC used to ignore sub-department
            // scope entirely, so narrowing the scope filter moved the KPI cards
            // but not the trend chart sitting beside them.
            p_subdept_ids: filters.subdeptIds?.length ? filters.subdeptIds : undefined,
        });
        if (error) throw error;
        return (data ?? []) as TrendRow[];
    },

    /**
     * Per-department aggregates — used for breakdown table & bar chart.
     * Backed by get_dept_insights_breakdown RPC.
     */
    async getDeptBreakdown(filters: InsightsFilters): Promise<DeptBreakdownRow[]> {
        const { data, error } = await supabase.rpc('get_dept_insights_breakdown', {
            p_start_date:  filters.startDate,
            p_end_date:    filters.endDate,
            p_org_ids:     filters.orgIds?.length     ? filters.orgIds     : undefined,
            p_dept_ids:    filters.deptIds?.length    ? filters.deptIds    : undefined,
            // See get_insights_trend above — same fix, same migration.
            p_subdept_ids: filters.subdeptIds?.length ? filters.subdeptIds : undefined,
        });
        if (error) throw error;
        return (data ?? []) as DeptBreakdownRow[];
    },

    /**
     * Comprehensive analysis for a specific metric.
     * Backed by get_metric_detailed_analysis RPC.
     */
    async getMetricAnalysis(metricId: string, filters: InsightsFilters) {
        const { data, error } = await supabase.rpc('get_metric_detailed_analysis', {
            p_metric_id:  metricId,
            p_start_date: filters.startDate,
            p_end_date:    filters.endDate,
            p_org_ids:     filters.orgIds?.length     ? filters.orgIds     : undefined,
            p_dept_ids:    filters.deptIds?.length    ? filters.deptIds    : undefined,
        });
        if (error) throw error;
        return data;
    },

    // ── Behaviour: attendance + cancellations, from assignment_snapshots ─────

    async getBehaviourSummary(from: string, to: string, scope: ScopeSelection) {
        const { data, error } = await supabase.rpc('get_kpi_behaviour_summary', {
            p_from: from, p_to: to, ...scopeArgs(scope),
        });
        if (error) throw error;
        return firstRow(data, null);
    },

    async getBehaviourTrend(from: string, to: string, scope: ScopeSelection, grain: 'week' | 'day') {
        const { data, error } = await supabase.rpc('get_kpi_behaviour_trend', {
            p_from: from, p_to: to, p_grain: grain, ...scopeArgs(scope),
        });
        if (error) throw error;
        return data ?? [];
    },

    async getCancellationReasonBreakdown(from: string, to: string, scope: ScopeSelection) {
        const { data, error } = await supabase.rpc('get_cancellation_reason_breakdown', {
            p_from: from, p_to: to, ...scopeArgs(scope),
        });
        if (error) throw error;
        return data ?? [];
    },

    /**
     * The seeded reason catalogue an employee picks from when dropping a shift.
     * Explicit column list with NO comment inside it — a SQL `--` comment in a
     * select literal truncates the rest of the string.
     */
    async getCancellationReasons() {
        const { data, error } = await supabase
            .from('cancellation_reasons')
            .select('code,label,description,requires_note,sort_order')
            .eq('is_active', true)
            .order('sort_order', { ascending: true });
        if (error) throw error;
        return data ?? [];
    },

    // ── Marketplace: bidding + swaps ─────────────────────────────────────────

    async getBiddingKpis(from: string, to: string, scope: ScopeSelection): Promise<BiddingKpis> {
        const { data, error } = await supabase.rpc('get_bidding_kpis', {
            p_from: from, p_to: to, ...scopeArgs(scope),
        });
        if (error) throw error;
        return firstRow(data, EMPTY_BIDDING_KPIS);
    },

    async getMarketplaceKpis(from: string, to: string, scope: ScopeSelection): Promise<MarketplaceKpis> {
        const { data, error } = await supabase.rpc('get_marketplace_kpis', {
            p_from: from, p_to: to, ...scopeArgs(scope),
        });
        if (error) throw error;
        return firstRow(data, EMPTY_KPIS);
    },

    async getMarketplaceTrend(from: string, to: string, scope: ScopeSelection, grain: 'week' | 'day') {
        const { data, error } = await supabase.rpc('get_kpi_marketplace_trend', {
            p_from: from, p_to: to, p_grain: grain, ...scopeArgs(scope),
        });
        if (error) throw error;
        return data ?? [];
    },

    async getManagerScorecard(from: string, to: string, scope: ScopeSelection): Promise<ManagerScorecard> {
        const { data, error } = await supabase.rpc('get_manager_scorecard', {
            p_from: from, p_to: to, ...scopeArgs(scope),
        });
        if (error) throw error;
        return firstRow(data, EMPTY_SCORECARD);
    },
};

// Re-export for convenience
export type { InsightsFilters };
