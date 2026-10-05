import { useQuery } from '@tanstack/react-query';
import type { ScopeSelection } from '@/platform/auth/types';
import { insightsApi } from '../api/insights.api';
import type { MarketplaceKpis } from '../model/marketplace-kpis.types';

export type { MarketplaceKpis };

/** Org-level marketplace KPIs: coverage, churn, offers and trades. */
export const useMarketplaceKpis = (from: string, to: string, scope: ScopeSelection) =>
    useQuery({
        queryKey: ['marketplace_kpis', from, to, scope],
        queryFn: () => insightsApi.getMarketplaceKpis(from, to, scope),
        enabled: !!from && !!to && !!scope,
        staleTime: 5 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
    });
