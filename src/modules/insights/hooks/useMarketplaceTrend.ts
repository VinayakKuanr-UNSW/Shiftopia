import { useQuery } from '@tanstack/react-query';
import { insightsApi } from '../api/insights.api';
import type { ScopeSelection } from '@/platform/auth/types';
import type { TrendGrain } from './useBehaviourTrend';

/**
 * Bucketed bidding + swap series, from get_kpi_marketplace_trend.
 *
 * Bucketed on the SHIFT DATE in every branch, not on when the bid or swap was
 * created — a bucket answers "what happened to the shifts scheduled that
 * week". Bucketing bids by their own timestamp would separate a bid from the
 * shift it was for.
 */
export interface MarketplaceTrendRow {
    bucket_start: string;
    open_shifts: number;
    bids_placed: number;
    winners_selected: number;
    award_rate: number;
    swaps_initiated: number;
    swaps_completed: number;
    swaps_rejected: number;
    swaps_cancelled: number;
    swap_completion_rate: number;
}

export const useMarketplaceTrend = (
    from: string,
    to: string,
    scope: ScopeSelection,
    grain: TrendGrain = 'week',
) =>
    useQuery({
        queryKey: ['kpi_marketplace_trend', from, to, grain, scope],
        queryFn: async (): Promise<MarketplaceTrendRow[]> => {
            return (await insightsApi.getMarketplaceTrend(from, to, scope, grain)) as MarketplaceTrendRow[];
        },
        enabled: !!from && !!to && !!scope,
        staleTime: 5 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
    });
