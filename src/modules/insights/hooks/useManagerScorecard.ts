import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import type { ScopeSelection } from '@/platform/auth/types';

import { ManagerScorecard, EMPTY_SCORECARD } from '../model/manager-scorecard.types';

export type { ManagerScorecard };

// ---------------------------------------------------------------------------
// useManagerScorecard — calls the `get_manager_scorecard` RPC.
//
// Signature: (from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', scope: ScopeSelection)
//
// The RPC returns a single row of manager scorecard metrics (or null when
// there's no data for the window). We coalesce null → EMPTY_SCORECARD so
// consumers always get a fully-populated object. Empty scope arrays are
// omitted (passed as undefined) exactly like useMarketplaceKpis, so the RPC
// treats them as "no filter".
// ---------------------------------------------------------------------------
export const useManagerScorecard = (
    from: string,
    to: string,
    scope: ScopeSelection,
) => {
    return useQuery({
        queryKey: ['manager_scorecard', from, to, scope],
        queryFn: async (): Promise<ManagerScorecard> => {
            // Cast through any: get_manager_scorecard is not yet in the generated
            // RPC type registry, but the function exists in the deployed DB.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any).rpc('get_manager_scorecard', {
                p_from: from,
                p_to: to,
                p_org_ids: scope.org_ids.length ? scope.org_ids : undefined,
                p_dept_ids: scope.dept_ids.length ? scope.dept_ids : undefined,
                p_subdept_ids: scope.subdept_ids.length ? scope.subdept_ids : undefined,
            });
            if (error) throw error;

            // RPC returns a single row; tolerate either a row or a 1-element array.
            const row = Array.isArray(data) ? data[0] : data;
            return (row as ManagerScorecard | null) ?? EMPTY_SCORECARD;
        },
        enabled: !!from && !!to && !!scope,
    });
};
