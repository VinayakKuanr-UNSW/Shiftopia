import { useQuery } from '@tanstack/react-query';
import type { ScopeSelection } from '@/platform/auth/types';
import { insightsApi } from '../api/insights.api';
import type { BiddingKpis } from '../model/bidding-kpis.types';

export type { BiddingKpis };

/**
 * Org-level bidding KPIs for a window. The RPC contract lives in
 * insights.api; this owns caching and nothing else.
 *
 * An empty `from`/`to` disables the query, which is how callers mount a
 * comparison-period copy that only fires when Compare is on.
 */
export const useBiddingKpis = (from: string, to: string, scope: ScopeSelection) =>
    useQuery({
        queryKey: ['bidding_kpis', from, to, scope],
        queryFn: () => insightsApi.getBiddingKpis(from, to, scope),
        enabled: !!from && !!to && !!scope,
        staleTime: 5 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
    });
