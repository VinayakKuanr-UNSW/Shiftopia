import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import type { ScopeSelection } from '@/platform/auth/types';

import { MarketplaceKpis, EMPTY_KPIS } from '../model/marketplace-kpis.types';

export type { MarketplaceKpis };

// ---------------------------------------------------------------------------
// useMarketplaceKpis — calls the `get_marketplace_kpis` RPC.
//
// Signature: (from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', scope: ScopeSelection)
//
// The RPC returns a single row of marketplace KPIs (or null when there's no
// data for the window). We coalesce null → EMPTY_KPIS so consumers always get
// a fully-populated object. Empty scope arrays are omitted (passed as
// undefined) exactly like useQuarterlyReport, so the RPC treats them as
// "no filter".
// ---------------------------------------------------------------------------
export const useMarketplaceKpis = (
    from: string,
    to: string,
    scope: ScopeSelection,
) => {
    return useQuery({
        queryKey: ['marketplace_kpis', from, to, scope],
        queryFn: async (): Promise<MarketplaceKpis> => {
            // Cast through any: get_marketplace_kpis is not yet in the generated
            // RPC type registry, but the function exists in the deployed DB.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any).rpc('get_marketplace_kpis', {
                p_from: from,
                p_to: to,
                p_org_ids: scope.org_ids.length ? scope.org_ids : undefined,
                p_dept_ids: scope.dept_ids.length ? scope.dept_ids : undefined,
                p_subdept_ids: scope.subdept_ids.length ? scope.subdept_ids : undefined,
            });
            if (error) throw error;

            // RPC returns a single row; tolerate either a row or a 1-element array.
            const row = Array.isArray(data) ? data[0] : data;
            return (row as MarketplaceKpis | null) ?? EMPTY_KPIS;
        },
        enabled: !!from && !!to && !!scope,
    });
};
