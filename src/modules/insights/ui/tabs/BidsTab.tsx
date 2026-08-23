/**
 * KPI › Bids — is the open marketplace attracting bids, and awarding them?
 *
 * Almost entirely a wiring job. get_bidding_kpis has been deployed the whole
 * time and returns every headline number here in one row; useBiddingKpis and
 * the typed thresholds were written and tested but rendered by no page.
 */

import React from 'react';
import { Gavel, Trophy, Users, AlertTriangle } from 'lucide-react';
import { KpiTile } from '@/modules/core/ui/components/KpiTile';
import { PageState } from '@/modules/core/ui/components/PageState';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { useBiddingKpis } from '../../hooks/useBiddingKpis';
import { EMPTY_BIDDING_KPIS } from '../../model/bidding-kpis.types';
import { statusFor, formatMetric, labelFor, METRIC_REGISTRY } from '../../model/metric-registry';
import { computeDelta, type KpiFilters } from '../../hooks/useKpiFilters';
import { KpiBand, KpiTileGrid, CountStrip } from '../components/KpiBand';
import type { ScopeSelection } from '@/platform/auth/types';

interface BidsTabProps {
    filters: KpiFilters;
    scope: ScopeSelection;
}

export default function BidsTab({ filters, scope }: BidsTabProps) {
    const { period, comparison } = filters;

    const current = useBiddingKpis(period.startDate, period.endDate, scope);
    // The comparison query only mounts when Compare is on, so the default view
    // costs exactly one request.
    const prior = useBiddingKpis(
        comparison?.startDate ?? '',
        comparison?.endDate ?? '',
        scope,
    );

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

    // No bidding has happened at all — distinct from "none this quarter".
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

    return (
        <div className="flex flex-col gap-8">
            <KpiBand title="Headline" description="How the open marketplace performed this quarter.">
                <KpiTileGrid>
                    <KpiTile
                        label={labelFor('open_shift_fill_rate')}
                        value={loading ? null : formatMetric('open_shift_fill_rate', k.open_shift_fill_rate)}
                        status={statusFor('open_shift_fill_rate', k.open_shift_fill_rate)}
                        denominator={`${k.winners_selected} of ${k.open_bidding_shifts} open shifts awarded`}
                        tooltip={METRIC_REGISTRY.open_shift_fill_rate.description}
                        delta={deltaFor(k.open_shift_fill_rate, p?.open_shift_fill_rate, 'points')}
                        deltaGoodDirection="up"
                        icon={Trophy}
                        loading={loading}
                        href="/insights/open_shift_fill_rate"
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
                        loading={loading}
                    />
                    <KpiTile
                        /* The RPC column is bid_success_rate, but at org level it
                           means winners / ALL bids and is bounded by 1 / bids per
                           shift. Graded as bid_win_rate so a healthy competitive
                           marketplace is not painted critical. */
                        label={labelFor('bid_win_rate')}
                        value={loading ? null : formatMetric('bid_win_rate', k.bid_success_rate)}
                        status={statusFor('bid_win_rate', k.bid_success_rate)}
                        denominator={`${k.winners_selected} winners from ${k.total_bids} bids`}
                        tooltip={METRIC_REGISTRY.bid_win_rate.description}
                        delta={deltaFor(k.bid_success_rate, p?.bid_success_rate, 'points')}
                        deltaGoodDirection="up"
                        icon={Gavel}
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
                        loading={loading}
                    />
                </KpiTileGrid>
            </KpiBand>

            <KpiBand title="Volume" description="The counts behind the rates above.">
                {loading ? (
                    <Skeleton className="h-20 w-full" />
                ) : (
                    <CountStrip
                        items={[
                            { label: labelFor('open_bidding_shifts'), value: k.open_bidding_shifts },
                            { label: labelFor('total_bids'), value: k.total_bids },
                            { label: labelFor('winners_selected'), value: k.winners_selected },
                            { label: labelFor('unfilled_open_shifts'), value: k.unfilled_open_shifts },
                        ]}
                    />
                )}
            </KpiBand>
        </div>
    );
}
