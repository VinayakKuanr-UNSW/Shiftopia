/**
 * KPI › Bids — is the open marketplace attracting bids, and awarding them?
 *
 * Implements the minimal, consistent analytics dashboard aesthetic with:
 *  - Top sparkline KPI cards with ambient wave gradients
 *  - Demand vs Award trend line & volume distribution
 *  - Smart Bidding Insights AI card
 *  - Volume count strips & per-employee bidding detail table
 */

import React, { useState } from 'react';
import { Gavel, Trophy, Users, AlertTriangle } from 'lucide-react';
import { KpiTile } from '@/modules/core/ui/components/KpiTile';
import { PageState } from '@/modules/core/ui/components/PageState';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { useBiddingKpis } from '../../hooks/useBiddingKpis';
import { EMPTY_BIDDING_KPIS } from '../../model/bidding-kpis.types';
import { statusFor, formatMetric, labelFor, METRIC_REGISTRY, analysisHref } from '../../model/metric-registry';
import { computeDelta, type KpiFilters } from '../../hooks/useKpiFilters';
import { useQuarterlyReport } from '@/modules/users/hooks/usePerformanceMetrics';
import { useMarketplaceTrend } from '../../hooks/useMarketplaceTrend';
import { formatBucket } from '../../hooks/useBehaviourTrend';
import { KpiTrendChart, SERIES_COLORS } from '../components/KpiTrendChart';
import { KpiDetailTable, type KpiDetailRow } from '../components/KpiDetailTable';
import { EmployeeDrillDown } from '../components/EmployeeDrillDown';
import { KpiBand, CountStrip } from '../components/KpiBand';
import { KpiSmartInsights, type InsightItem } from '../components/KpiSmartInsights';
import { KpiHorizontalBars } from '../components/KpiHorizontalBars';
import type { ScopeSelection } from '@/platform/auth/types';

interface BidsTabProps {
    filters: KpiFilters;
    scope: ScopeSelection;
}

export default function BidsTab({ filters, scope }: BidsTabProps) {
    const { period, comparison } = filters;

    const current = useBiddingKpis(period.startDate, period.endDate, scope);
    const prior = useBiddingKpis(
        comparison?.startDate ?? '',
        comparison?.endDate ?? '',
        scope,
    );
    const report = useQuarterlyReport(period.year, period.quarter, scope);
    const [selected, setSelected] = useState<KpiDetailRow | null>(null);
    const trend = useMarketplaceTrend(period.startDate, period.endDate, scope);

    if (current.isError) {
        return (
            <PageState
                state="error"
                scope="section"
                title="Couldn't load bidding KPIs"
                description={current.error instanceof Error ? current.error.message : undefined}
                onRetry={() => current.refetch()}
            />
        );
    }

    const k = current.data ?? EMPTY_BIDDING_KPIS;
    const p = comparison ? prior.data : undefined;
    const loading = current.isLoading;

    if (!loading && k.open_bidding_shifts === 0 && k.total_bids === 0) {
        return (
            <PageState
                state="empty"
                scope="section"
                icon={Gavel}
                title={`No bidding activity in ${period.label}`}
                description="Shifts routed to open bidding appear here once they are published and employees start bidding."
            />
        );
    }

    const deltaFor = (
        cur: number, prev: number | undefined, unit: 'points' | 'percent',
    ) => (comparison && prev !== undefined
        ? computeDelta(cur, prev, {
            unit,
            label: `vs ${comparison.label}`,
            currentBase: k.open_bidding_shifts,
            previousBase: p?.open_bidding_shifts,
        })
        : null);

    // Smart Bidding Insights
    const bidInsights: InsightItem[] = [];
    if (k.unfilled_open_shift_rate > 10) {
        bidInsights.push({
            id: 'unfilled-alert',
            type: 'alert',
            title: `${k.unfilled_open_shift_rate}% Unfilled Open Shifts`,
            description: `${k.unfilled_open_shifts} shifts expired without finding a winning bidder. Consider earlier publish lead times.`,
            actionLabel: 'Open shift manager',
            actionHref: '/bids/manager',
        });
    } else {
        bidInsights.push({
            id: 'high-award',
            type: 'highlight',
            title: 'High Open-Shift Award Rate',
            description: `${k.open_shift_fill_rate}% of open bidding shifts were successfully matched with winning bidders.`,
        });
    }

    if (k.avg_bids_per_open_shift >= 2.5) {
        bidInsights.push({
            id: 'strong-demand',
            type: 'opportunity',
            title: 'Strong Marketplace Demand',
            description: `Averaging ${k.avg_bids_per_open_shift} bids per open shift, showing high bidder competition.`,
        });
    } else {
        bidInsights.push({
            id: 'low-demand',
            type: 'info',
            title: 'Moderate Bidding Volume',
            description: `${k.total_bids} total bids submitted across ${k.open_bidding_shifts} open shifts this quarter.`,
        });
    }

    return (
        <div className="flex flex-col gap-8">
            {/* ── Band A: 4-Card Top Headline Grid with Ambient Sparklines ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <KpiTile
                    label={labelFor('open_shift_fill_rate')}
                    value={loading ? null : formatMetric('open_shift_fill_rate', k.open_shift_fill_rate)}
                    status={statusFor('open_shift_fill_rate', k.open_shift_fill_rate)}
                    denominator={`${k.winners_selected} of ${k.open_bidding_shifts} open shifts awarded`}
                    tooltip={METRIC_REGISTRY.open_shift_fill_rate.description}
                    delta={deltaFor(k.open_shift_fill_rate, p?.open_shift_fill_rate, 'points')}
                    deltaGoodDirection="up"
                    icon={Trophy}
                    sparklineColor="purple"
                    loading={loading}
                    href={analysisHref('open_shift_fill_rate', period.label)}
                />
                <KpiTile
                    label={labelFor('avg_bids_per_open_shift')}
                    value={loading ? null : formatMetric('avg_bids_per_open_shift', k.avg_bids_per_open_shift)}
                    status="neutral"
                    denominator={`${k.total_bids} bids across ${k.open_bidding_shifts} shifts`}
                    tooltip={METRIC_REGISTRY.avg_bids_per_open_shift.description}
                    delta={deltaFor(k.avg_bids_per_open_shift, p?.avg_bids_per_open_shift, 'percent')}
                    deltaGoodDirection="up"
                    icon={Users}
                    sparklineColor="blue"
                    loading={loading}
                />
                <KpiTile
                    label={labelFor('bid_win_rate')}
                    value={loading ? null : formatMetric('bid_win_rate', k.bid_success_rate)}
                    status={statusFor('bid_win_rate', k.bid_success_rate)}
                    denominator={`${k.winners_selected} winners from ${k.total_bids} bids`}
                    tooltip={METRIC_REGISTRY.bid_win_rate.description}
                    delta={deltaFor(k.bid_success_rate, p?.bid_success_rate, 'points')}
                    deltaGoodDirection="up"
                    icon={Gavel}
                    sparklineColor="teal"
                    loading={loading}
                />
                <KpiTile
                    label={labelFor('unfilled_open_shift_rate')}
                    value={loading ? null : formatMetric('unfilled_open_shift_rate', k.unfilled_open_shift_rate)}
                    status={statusFor('unfilled_open_shift_rate', k.unfilled_open_shift_rate)}
                    denominator={`${k.unfilled_open_shifts} left without a winner`}
                    delta={deltaFor(k.unfilled_open_shift_rate, p?.unfilled_open_shift_rate, 'points')}
                    deltaGoodDirection="down"
                    icon={AlertTriangle}
                    sparklineColor="rose"
                    loading={loading}
                />
            </div>

            {/* ── Band B: Middle Row (Trend Chart 2/3 + Smart Insights 1/3) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                <div className="lg:col-span-2">
                    <KpiBand
                        title="Bidding Trend Over Time"
                        description="Open shifts published each week against total bids placed and the resulting award rate."
                        className="h-full justify-between"
                    >
                        {trend.isError ? (
                            <PageState
                                state="error"
                                scope="inline"
                                title="Couldn't load the bidding trend"
                                onRetry={() => trend.refetch()}
                            />
                        ) : trend.isLoading ? (
                            <Skeleton className="h-[280px] w-full rounded-2xl" />
                        ) : (
                            <KpiTrendChart
                                data={(trend.data ?? []).map((r) => ({
                                    bucket: formatBucket(r.bucket_start),
                                    'Open shifts': r.open_shifts,
                                    'Bids placed': r.bids_placed,
                                    'Award rate': r.award_rate,
                                }))}
                                xKey="bucket"
                                caption={`Bidding by week, ${period.label}`}
                                emptyMessage={`No open shifts in ${period.label}.`}
                                series={[
                                    { key: 'Open shifts', label: 'Open shifts', color: SERIES_COLORS.primary, type: 'bar' },
                                    { key: 'Bids placed', label: 'Bids placed', color: SERIES_COLORS.muted,   type: 'bar' },
                                    { key: 'Award rate',  label: 'Award rate',  color: SERIES_COLORS.good,    type: 'line', rightAxis: true, unit: '%' },
                                ]}
                                height={260}
                            />
                        )}
                    </KpiBand>
                </div>

                <div className="lg:col-span-1 flex flex-col">
                    <KpiSmartInsights
                        title="Marketplace Insights"
                        badgeLabel="AI"
                        insights={bidInsights}
                        className="h-full"
                    />
                </div>
            </div>

            {/* ── Band C: Volume Counts ── */}
            <KpiBand title="Bidding Volume Breakdown" description="The counts behind the rates above.">
                {loading ? (
                    <Skeleton className="h-20 w-full rounded-2xl" />
                ) : (
                    <CountStrip
                        items={[
                            { label: labelFor('open_bidding_shifts'), value: k.open_bidding_shifts },
                            { label: labelFor('total_bids'), value: k.total_bids },
                            { label: labelFor('winners_selected'), value: k.winners_selected, tone: 'text-emerald-600 dark:text-emerald-400' },
                            { label: labelFor('unfilled_open_shifts'), value: k.unfilled_open_shifts, tone: k.unfilled_open_shifts > 0 ? 'text-rose-600 dark:text-rose-400' : undefined },
                        ]}
                    />
                )}
            </KpiBand>

            {/* ── Band D: Employee Leaderboard Detail Table ── */}
            <KpiBand
                title="Employee Bidding Participation"
                description="Per-employee bidding activity. Individual hit rate reflects personal selection frequency."
            >
                {report.isError ? (
                    <PageState
                        state="error"
                        scope="inline"
                        title="Couldn't load the per-employee breakdown"
                        onRetry={() => report.refetch()}
                    />
                ) : report.isLoading ? (
                    <Skeleton className="h-48 w-full rounded-2xl" />
                ) : (
                    <KpiDetailTable
                        caption={`${(report.data ?? []).length} employees · ${period.label}`}
                        onSelect={setSelected}
                        defaultSort={{ key: 'total_bids', dir: 'desc' }}
                        emptyMessage="Nobody placed a bid in this quarter."
                        columns={[
                            { key: 'total_bids', header: 'Bids placed', graded: false },
                            { key: 'bids_accepted', header: 'Winning bids', graded: false },
                            { key: 'bid_success_rate' },
                        ]}
                        rows={(report.data ?? []).map((r) => ({
                            id: r.employee_id,
                            name: r.employee_name,
                            values: {
                                total_bids: r.total_bids,
                                bids_accepted: r.bids_accepted,
                                bid_success_rate: r.bid_success_rate,
                            },
                        }))}
                    />
                )}
            </KpiBand>

            <EmployeeDrillDown
                employeeId={selected?.id ?? null}
                employeeName={selected?.name ?? ''}
                periodLabel={period.label}
                year={period.year}
                quarter={period.quarter}
                onClose={() => setSelected(null)}
            />
        </div>
    );
}
