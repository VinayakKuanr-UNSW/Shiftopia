import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import type { ScopeSelection } from '@/platform/auth/types';

import { BiddingKpis, EMPTY_BIDDING_KPIS } from '../model/bidding-kpis.types';

export type { BiddingKpis };

// ---------------------------------------------------------------------------
// useBiddingKpis — calls the `get_bidding_kpis` RPC.
//
// Signature: (from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', scope: ScopeSelection)
//
// The RPC returns a single row of bidding KPIs (or null when there's no data
// for the window). We coalesce null → EMPTY_BIDDING_KPIS so consumers always
// get a fully-populated object. Empty scope arrays are omitted (passed as
// undefined) exactly like useMarketplaceKpis, so the RPC treats them as
// "no filter".
// ---------------------------------------------------------------------------
export const useBiddingKpis = (
    from: string,
    to: string,
    scope: ScopeSelection,
) => {
    return useQuery({
        queryKey: ['bidding_kpis', from, to, scope],
        queryFn: async (): Promise<BiddingKpis> => {
            // Cast through any: get_bidding_kpis is not yet in the generated
            // RPC type registry, but the function exists in the deployed DB.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any).rpc('get_bidding_kpis', {
                p_from: from,
                p_to: to,
                p_org_ids: scope.org_ids.length ? scope.org_ids : undefined,
                p_dept_ids: scope.dept_ids.length ? scope.dept_ids : undefined,
                p_subdept_ids: scope.subdept_ids.length ? scope.subdept_ids : undefined,
            });
            if (error) throw error;

            // RPC returns a single row; tolerate either a row or a 1-element array.
            const row = Array.isArray(data) ? data[0] : data;
            return (row as BiddingKpis | null) ?? EMPTY_BIDDING_KPIS;
        },
        enabled: !!from && !!to && !!scope,
    });
};
