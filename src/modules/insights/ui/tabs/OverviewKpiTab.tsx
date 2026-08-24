/**
 * KPI › Overview — coverage, cost, compliance and department performance.
 *
 * Implements the minimal, consistent analytics dashboard aesthetic with:
 *  - Top 5 sparkline KPI cards with ambient wave gradients
 *  - High-clarity multi-department trend lines
 *  - Smart Operational Insights AI card
 *  - Department cost distribution & detail breakdown
 */

import React from 'react';
import {
    ChartBar, DollarSign, CheckCircle2, Clock, Users, Zap, TrendingUp, AlertTriangle, ShieldCheck,
} from 'lucide-react';
import { KpiTile } from '@/modules/core/ui/components/KpiTile';
import { PageState } from '@/modules/core/ui/components/PageState';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { useInsightsSummary } from '../../hooks/useInsightsSummary';
import { useInsightsTrend } from '../../hooks/useInsightsTrend';
import { useDeptBreakdown } from '../../hooks/useDeptBreakdown';
import { statusFor, formatMetric, analysisHref } from '../../model/metric-registry';
import { computeDelta, type KpiFilters } from '../../hooks/useKpiFilters';
import { KpiTrendChart, SERIES_COLORS } from '../components/KpiTrendChart';
import { KpiBand, CountStrip } from '../components/KpiBand';
import { KpiSmartInsights, type InsightItem } from '../components/KpiSmartInsights';
import { KpiHorizontalBars } from '../components/KpiHorizontalBars';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import type { ScopeSelection } from '@/platform/auth/types';
import type { InsightsFilters } from '../../model/metric.types';

const DEPT_COLORS = [
    '#3b82f6', '#8b5cf6', '#14b8a6', '#f97316',
    '#64748b', '#ec4899', '#06b6d4', '#84cc16',
];

function fmt$(n: number) {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
    return `$${n.toFixed(0)}`;
}

interface OverviewKpiTabProps {
    filters: KpiFilters;
    scope: ScopeSelection;
}

export default function OverviewKpiTab({ filters, scope }: OverviewKpiTabProps) {
    const { period, comparison } = filters;

    const insightsFilters: InsightsFilters = {
        startDate: period.startDate,
        endDate: period.endDate,
        orgIds: filters.orgIds,
        deptIds: filters.deptIds,
        subdeptIds: filters.subdeptIds,
    };

    const current = useInsightsSummary(insightsFilters);
    const trend = useInsightsTrend(insightsFilters);
    const depts = useDeptBreakdown(insightsFilters);

    // Comparison period query
    const compFilters: InsightsFilters = {
        startDate: comparison?.startDate ?? '',
        endDate: comparison?.endDate ?? '',
        orgIds: filters.orgIds,
        deptIds: filters.deptIds,
        subdeptIds: filters.subdeptIds,
    };
    const prior = useInsightsSummary(compFilters);

    if (current.isError) {
        return (
            <PageState
                state="error"
                scope="section"
                title="Couldn't load overview KPIs"
                description={current.error instanceof Error ? current.error.message : undefined}
                onRetry={() => current.refetch()}
            />
        );
    }

    const s = current.data;
    const p = comparison ? prior.data : undefined;
    const loading = current.isLoading;

    const delta = (cur: number | undefined, prev: number | undefined, unit: 'points' | 'percent') =>
        comparison && cur !== undefined && prev !== undefined
            ? computeDelta(cur, prev, {
                unit,
                label: `vs ${comparison.label}`,
                currentBase: s?.shifts_total,
                previousBase: p?.shifts_total,
            })
            : null;

    const chartData = trend.data?.chart ?? [];
    const deptNames = trend.data?.deptNames ?? [];
    const deptRows = depts.data ?? [];

    const fillRateSeries = deptNames.map((name, i) => ({
        key: name,
        label: name,
        color: DEPT_COLORS[i % DEPT_COLORS.length],
        type: 'line' as const,
    }));

    const costBarData = deptRows.map((r) => ({
        bucket: r.dept_name.length > 14 ? r.dept_name.slice(0, 14) + '…' : r.dept_name,
        cost: Number(r.estimated_cost),
    }));

    const costPerHour = s && s.scheduled_hours > 0 ? s.estimated_cost / s.scheduled_hours : 0;
    const prevCostPerHour = p && (p.scheduled_hours ?? 0) > 0 ? (p.estimated_cost ?? 0) / (p.scheduled_hours ?? 1) : undefined;

    // Build intelligent operational takeaways
    const smartInsights: InsightItem[] = [];
    if (s) {
        if (s.shift_fill_rate >= 90) {
            smartInsights.push({
                id: 'opt-fill',
                type: 'highlight',
                title: 'High Roster Fulfillment',
                description: `Roster fill rate reached ${s.shift_fill_rate}% across ${s.shifts_total} shifts in ${period.label}.`,
                actionLabel: 'View shifts',
                actionHref: '/rosters/planner',
            });
        } else if (s.shift_fill_rate > 0) {
            smartInsights.push({
                id: 'alert-fill',
                type: 'alert',
                title: 'Unassigned Shifts Detected',
                description: `${s.shifts_unassigned} shifts remain unassigned. Open bidding or auto-scheduling can backfill them.`,
                actionLabel: 'Resolve unassigned',
                actionHref: '/bids/manager',
            });
        }

        if (s.compliance_overrides > 0) {
            smartInsights.push({
                id: 'alert-overrides',
                type: 'alert',
                title: `${s.compliance_overrides} Compliance Overrides`,
                description: 'Manager exceptions were recorded. Review shift audit logs to ensure rest period requirements are met.',
                actionLabel: 'Audit logs',
                actionHref: '/insights?tab=attendance',
            });
        } else {
            smartInsights.push({
                id: 'high-comp',
                type: 'opportunity',
                title: 'Clean Compliance Record',
                description: 'Zero compliance overrides recorded this quarter across all published rosters.',
            });
        }

        if (s.shifts_emergency > 0) {
            smartInsights.push({
                id: 'info-emerg',
                type: 'info',
                title: 'Emergency Assignments Monitored',
                description: `${s.shifts_emergency} shifts required short-lead emergency cover. Review drop lead times in Cancellations.`,
                actionLabel: 'View cancellations',
                actionHref: '/insights?tab=cancellations',
            });
        }
    }

    return (
        <div className="flex flex-col gap-8">
            {/* ── Band A: 5-Card Top Headline Grid with Ambient Sparklines ── */}
            <section aria-label="Key Performance Indicators">
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3.5">
                    <KpiTile
                        label="Shift Fill Rate"
                        value={loading ? null : `${s?.shift_fill_rate ?? 0}%`}
                        status={statusFor('shift_fill_rate', s?.shift_fill_rate ?? 0)}
                        denominator={`${s?.shifts_assigned ?? 0} of ${s?.shifts_total ?? 0} shifts`}
                        tooltip="Assigned shifts as a share of total shifts in the period."
                        delta={delta(s?.shift_fill_rate, p?.shift_fill_rate, 'points')}
                        deltaGoodDirection="up"
                        icon={ChartBar}
                        sparklineColor="purple"
                        loading={loading}
                        href={analysisHref('shift_fill_rate', period.label)}
                    />
                    <KpiTile
                        label="Total Labour Cost"
                        value={loading ? null : fmt$(s?.estimated_cost ?? 0)}
                        status="neutral"
                        denominator={`${s?.scheduled_hours ?? 0}h scheduled`}
                        tooltip="Total estimated labour cost across all rostered shifts in scope."
                        delta={delta(s?.estimated_cost, p?.estimated_cost, 'percent')}
                        deltaGoodDirection="down"
                        icon={DollarSign}
                        sparklineColor="emerald"
                        loading={loading}
                    />
                    <KpiTile
                        label="Cost per Hour"
                        value={loading ? null : (costPerHour > 0 ? fmt$(costPerHour) : '—')}
                        status="neutral"
                        denominator="Estimated cost ÷ scheduled hours"
                        tooltip="Average hourly labour rate across all active contracts."
                        delta={delta(costPerHour, prevCostPerHour, 'percent')}
                        deltaGoodDirection="down"
                        sparklineColor="blue"
                        loading={loading}
                    />
                    <KpiTile
                        label="No-Show Rate"
                        value={loading ? null : `${s?.no_show_rate ?? 0}%`}
                        status={statusFor('no_show_rate', s?.no_show_rate ?? 0)}
                        denominator={`${s?.shifts_no_show ?? 0} missed of ${s?.shifts_assigned ?? 0} assigned`}
                        tooltip="No-shows ÷ assigned shifts. See Attendance tab for held-based breakdown."
                        delta={delta(s?.no_show_rate, p?.no_show_rate, 'points')}
                        deltaGoodDirection="down"
                        icon={Users}
                        sparklineColor="rose"
                        loading={loading}
                        href={analysisHref('no_show_rate', period.label)}
                    />
                    <KpiTile
                        label="Compliance Overrides"
                        value={loading ? null : String(s?.compliance_overrides ?? 0)}
                        status={statusFor('compliance_overrides', s?.compliance_overrides ?? 0)}
                        denominator="Approved rule exceptions"
                        tooltip="Exceptions approved by a manager despite compliance warnings."
                        delta={delta(s?.compliance_overrides, p?.compliance_overrides, 'percent')}
                        deltaGoodDirection="down"
                        icon={CheckCircle2}
                        sparklineColor="teal"
                        loading={loading}
                    />
                </div>
            </section>

            {/* ── Band B: Middle Row (Trend Chart 2/3 + Smart Insights 1/3) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                <div className="lg:col-span-2">
                    <KpiBand
                        title="Fill Rate Trend by Department"
                        description="Department fill rates across the quarter window."
                        className="h-full justify-between"
                    >
                        {trend.isError ? (
                            <PageState
                                state="error"
                                scope="inline"
                                title="Couldn't load trend data"
                                onRetry={() => trend.refetch()}
                            />
                        ) : trend.isLoading ? (
                            <Skeleton className="h-[280px] w-full rounded-2xl" />
                        ) : (
                            <KpiTrendChart
                                data={chartData}
                                xKey="date"
                                caption={`Fill rate by department, ${period.label}`}
                                emptyMessage={`No shift trend data in ${period.label}.`}
                                series={fillRateSeries}
                                height={260}
                            />
                        )}
                    </KpiBand>
                </div>

                <div className="lg:col-span-1 flex flex-col">
                    <KpiSmartInsights
                        title="Operational Insights"
                        badgeLabel="AI"
                        insights={smartInsights}
                        className="h-full"
                    />
                </div>
            </div>

            {/* ── Band C: Secondary Operational Breakdown (Labour Cost & Distribution) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                <KpiBand
                    title="Labour Cost by Department"
                    description="Estimated expenditure per department."
                >
                    {depts.isError ? (
                        <PageState
                            state="error"
                            scope="inline"
                            title="Couldn't load cost data"
                            onRetry={() => depts.refetch()}
                        />
                    ) : depts.isLoading ? (
                        <Skeleton className="h-[260px] w-full rounded-2xl" />
                    ) : deptRows.length === 0 ? (
                        <p className={cn(text.bodyMuted, 'rounded-2xl border border-border bg-muted/30 p-5 text-center text-xs')}>
                            No department data for {period.label}.
                        </p>
                    ) : (
                        <KpiTrendChart
                            data={costBarData}
                            xKey="bucket"
                            caption={`Labour cost by department, ${period.label}`}
                            emptyMessage="No cost data available."
                            series={[
                                { key: 'cost', label: 'Estimated Cost', color: SERIES_COLORS.good, type: 'bar' },
                            ]}
                            height={240}
                        />
                    )}
                </KpiBand>

                <KpiHorizontalBars
                    title="Department Fill Rates"
                    subtitle="Fulfillment ranking across active departments"
                    items={deptRows.map((r) => ({
                        id: r.dept_id,
                        label: r.dept_name,
                        value: Number(r.fill_rate),
                        displayValue: `${r.fill_rate}% (${r.shifts_assigned}/${r.shifts_total})`,
                    }))}
                    footerNote={`Total scheduled: ${s?.scheduled_hours ?? 0}h across ${s?.shifts_total ?? 0} shifts`}
                />
            </div>

            {/* ── Shift Status Strip ────────────────────────────────────── */}
            {!loading && s && s.shifts_total > 0 && (
                <KpiBand title="Shift Lifecycle Summary" description="Roster terminal outcomes for the selected period.">
                    <CountStrip
                        items={[
                            { label: 'Total Shifts', value: s.shifts_total },
                            { label: 'Published', value: s.shifts_published, tone: 'text-blue-500' },
                            { label: 'Assigned', value: s.shifts_assigned, tone: 'text-emerald-600 dark:text-emerald-400' },
                            { label: 'Unassigned', value: s.shifts_unassigned, tone: s.shifts_unassigned > 0 ? 'text-amber-600 dark:text-amber-400' : undefined },
                            { label: 'Cancelled', value: s.shifts_cancelled, tone: s.shifts_cancelled > 0 ? 'text-rose-600 dark:text-rose-400' : undefined },
                            { label: 'Completed', value: s.shifts_completed, tone: 'text-violet-600 dark:text-violet-400' },
                        ]}
                    />
                </KpiBand>
            )}
        </div>
    );
}
