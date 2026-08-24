import { useQuery } from '@tanstack/react-query';
import type { ScopeSelection } from '@/platform/auth/types';
import { insightsApi } from '../api/insights.api';
import type { ManagerScorecard } from '../model/manager-scorecard.types';

export type { ManagerScorecard };

/** How the roster was RUN: publish lead time, churn, emergency fills. */
export const useManagerScorecard = (from: string, to: string, scope: ScopeSelection) =>
    useQuery({
        queryKey: ['manager_scorecard', from, to, scope],
        queryFn: () => insightsApi.getManagerScorecard(from, to, scope),
        enabled: !!from && !!to && !!scope,
        staleTime: 5 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
    });
