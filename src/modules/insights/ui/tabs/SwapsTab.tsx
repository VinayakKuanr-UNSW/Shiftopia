/**
 * KPI › Swaps — are trades getting proposed, matched and approved, or dying in
 * the pipeline?
 *
 * Net-new insight. Manager Swaps has status-filter counts and nothing else; no
 * aggregate swap metric is rendered anywhere in the product today. The data was
 * already computed — get_marketplace_kpis returns all five trade rates and all
 * four offer rates, and nothing rendered them.
 */

import React from 'react';
import { ArrowLeftRight, Inbox, Timer, XCircle } from 'lucide-react';
import { KpiTile } from '@/modules/core/ui/components/KpiTile';
import { PageState } from '@/modules/core/ui/components/PageState';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { useMarketplaceKpis } from '../../hooks/useMarketplaceKpis';
import { EMPTY_KPIS } from '../../model/marketplace-kpis.types';
import { statusFor, formatMetric, labelFor, METRIC_REGISTRY } from '../../model/metric-registry';
import { computeDelta, type KpiFilters } from '../../hooks/useKpiFilters';
import { useQuarterlyReport } from '@/modules/users/hooks/usePerformanceMetrics';
import { KpiDetailTable } from '../components/KpiDetailTable';
import { KpiBand, KpiTileGrid } from '../components/KpiBand';
import type { ScopeSelection } from '@/platform/auth/types';

interface SwapsTabProps {
    filters: KpiFilters;
    scope: ScopeSelection;
}

export default function SwapsTab({ filters, scope }: SwapsTabProps) {
    const { period, comparison } = filters;

    const current = useMarketplaceKpis(period.startDate, period.endDate, scope);
    const prior = useMarketplaceKpis(
        comparison?.startDate ?? '',
        comparison?.endDate ?? '',
        scope,
    );
    // Per-employee detail. Same query key as every other tab and the Overview
    // report, so React Query serves one request no matter how many tabs read it.
    const report = useQuarterlyReport(period.year, period.quarter, scope);

    if (current.isError) {
        return (
            <PageState
                state="error"
                scope="section"
                title="Couldn't load swap KPIs"
                description={current.error instanceof Error ? current.error.message : undefined}
                onRetry={() => current.refetch()}
            />
        );
    }

    const k = current.data ?? EMPTY_KPIS;
    const p = comparison ? prior.data : undefined;
    const loading = current.isLoading;

    if (!loading && k.trades_initiated === 0 && k.offers_resolved === 0) {
        return (
            <PageState
                state="empty"
                scope="section"
                icon={ArrowLeftRight}
                title={`No swap or offer activity in ${period.label}`}
                description="Swaps employees propose to each other, and direct offers managers send, both appear here once they happen."
            />
        );
    }

    const tradeDelta = (cur: number, prev: number | undefined, unit: 'points' | 'percent') =>
        comparison && prev !== undefined
            ? computeDelta(cur, prev, {
                unit,
                label: `vs ${comparison.label}`,
                currentBase: k.trades_initiated,
                previousBase: p?.trades_initiated,
            })
            : null;

    const offerDelta = (cur: number, prev: number | undefined) =>
        comparison && prev !== undefined
            ? computeDelta(cur, prev, {
                unit: 'points',
                label: `vs ${comparison.label}`,
                currentBase: k.offers_resolved,
                previousBase: p?.offers_resolved,
            })
            : null;

    return (
        <div className="flex flex-col gap-8">
            <KpiBand title="Headline" description="Whether the trading marketplace is working.">
                <KpiTileGrid>
                    <KpiTile
                        label={labelFor('trade_completion_rate')}
                        value={loading ? null : formatMetric('trade_completion_rate', k.trade_completion_rate)}
                        status={statusFor('trade_completion_rate', k.trade_completion_rate)}
                        denominator={`of ${k.trades_initiated} swaps initiated`}
                        tooltip={METRIC_REGISTRY.trade_completion_rate.description}
                        delta={tradeDelta(k.trade_completion_rate, p?.trade_completion_rate, 'points')}
                        deltaGoodDirection="up"
                        icon={ArrowLeftRight}
                        loading={loading}
                        href="/insights/trade_completion_rate"
                    />
                    <KpiTile
                        label={labelFor('trades_initiated')}
                        value={loading ? null : formatMetric('trades_initiated', k.trades_initiated)}
                        status="neutral"
                        denominator="Volume context for the rates"
                        delta={tradeDelta(k.trades_initiated, p?.trades_initiated, 'percent')}
                        deltaGoodDirection="up"
                        loading={loading}
                    />
                    <KpiTile
                        label={labelFor('offer_accept_rate')}
                        value={loading ? null : formatMetric('offer_accept_rate', k.offer_accept_rate)}
                        status={statusFor('offer_accept_rate', k.offer_accept_rate)}
                        denominator={`of ${k.offers_resolved} offers resolved`}
                        delta={offerDelta(k.offer_accept_rate, p?.offer_accept_rate)}
                        deltaGoodDirection="up"
                        icon={Inbox}
                        loading={loading}
                    />
                    <KpiTile
                        label={labelFor('avg_time_to_fill_hours')}
                        value={loading ? null : formatMetric('avg_time_to_fill_hours', k.avg_time_to_fill_hours)}
                        status={statusFor('avg_time_to_fill_hours', k.avg_time_to_fill_hours)}
                        denominator="Mean open to filled"
                        tooltip={METRIC_REGISTRY.avg_time_to_fill_hours.description}
                        delta={tradeDelta(k.avg_time_to_fill_hours, p?.avg_time_to_fill_hours, 'percent')}
                        deltaGoodDirection="down"
                        icon={Timer}
                        loading={loading}
                    />
                </KpiTileGrid>
            </KpiBand>

            <KpiBand
                title="Where the pipeline leaks"
                description="Each of these names a different reason completion falls short of 100%, and each points at a different fix."
            >
                <KpiTileGrid>
                    <KpiTile
                        label={labelFor('trade_rejection_rate')}
                        value={loading ? null : formatMetric('trade_rejection_rate', k.trade_rejection_rate)}
                        status={statusFor('trade_rejection_rate', k.trade_rejection_rate)}
                        denominator="Manager declined"
                        delta={tradeDelta(k.trade_rejection_rate, p?.trade_rejection_rate, 'points')}
                        deltaGoodDirection="down"
                        icon={XCircle}
                        loading={loading}
                    />
                    <KpiTile
                        label={labelFor('trade_cancellation_rate')}
                        value={loading ? null : formatMetric('trade_cancellation_rate', k.trade_cancellation_rate)}
                        status={statusFor('trade_cancellation_rate', k.trade_cancellation_rate)}
                        denominator="Requester withdrew"
                        tooltip={METRIC_REGISTRY.trade_cancellation_rate.description}
                        delta={tradeDelta(k.trade_cancellation_rate, p?.trade_cancellation_rate, 'points')}
                        deltaGoodDirection="down"
                        loading={loading}
                    />
                    <KpiTile
                        label={labelFor('trade_expiry_rate')}
                        value={loading ? null : formatMetric('trade_expiry_rate', k.trade_expiry_rate)}
                        status={statusFor('trade_expiry_rate', k.trade_expiry_rate)}
                        denominator="Nobody responded"
                        tooltip={METRIC_REGISTRY.trade_expiry_rate.description}
                        delta={tradeDelta(k.trade_expiry_rate, p?.trade_expiry_rate, 'points')}
                        deltaGoodDirection="down"
                        loading={loading}
                    />
                    <KpiTile
                        label={labelFor('offer_ignore_rate')}
                        value={loading ? null : formatMetric('offer_ignore_rate', k.offer_ignore_rate)}
                        status={statusFor('offer_ignore_rate', k.offer_ignore_rate)}
                        denominator="Offers left unanswered"
                        tooltip={METRIC_REGISTRY.offer_ignore_rate.description}
                        delta={offerDelta(k.offer_ignore_rate, p?.offer_ignore_rate)}
                        deltaGoodDirection="down"
                        icon={Timer}
                        loading={loading}
                    />
                </KpiTileGrid>
            </KpiBand>

            <KpiBand
                title="Who is trading"
                description="Offer behaviour and trade activity per employee."
            >
                {report.isError ? (
                    <PageState
                        state="error"
                        scope="inline"
                        title="Couldn't load the per-employee breakdown"
                        onRetry={() => report.refetch()}
                    />
                ) : report.isLoading ? (
                    <Skeleton className="h-48 w-full" />
                ) : (
                    <KpiDetailTable
                        caption={`${(report.data ?? []).length} people · ${period.label}`}
                        defaultSort={{ key: 'trade_requests', dir: 'desc' }}
                        emptyMessage="No swap or offer activity by anyone in this quarter."
                        columns={[
                            { key: 'trade_requests', header: 'Swaps requested', graded: false },
                            { key: 'swap_rate' },
                            { key: 'acceptance_rate' },
                            { key: 'rejection_rate' },
                            { key: 'ignorance_rate' },
                        ]}
                        rows={(report.data ?? []).map((r) => ({
                            id: r.employee_id,
                            name: r.employee_name,
                            values: {
                            trade_requests: r.trade_requests ?? 0,
                            swap_rate: r.swap_rate,
                            acceptance_rate: r.acceptance_rate,
                            rejection_rate: r.rejection_rate,
                            ignorance_rate: r.ignorance_rate,
                            },
                        }))}
                    />
                )}
            </KpiBand>
        </div>
    );
}
