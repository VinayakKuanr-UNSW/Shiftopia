import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import type { ScopeSelection } from '@/platform/auth/types';

/**
 * Bucketed attendance + cancellation series, from get_kpi_behaviour_trend.
 *
 * The same aggregate expressions get_kpi_behaviour_summary uses, grouped by
 * bucket rather than collapsed — summing any column across the window
 * reproduces the headline figure, so a tile and the chart under it cannot
 * disagree. Empty buckets come back as zero rows, so a quiet week draws a gap
 * at zero instead of the line jumping over it.
 */
export interface BehaviourTrendRow {
    bucket_start: string;
    held: number;
    worked: number;
    no_show: number;
    standard_cancellations: number;
    critical_cancellations: number;
    swapped_out: number;
    on_time_in: number;
    late_clock_in: number;
    early_clock_out: number;
    auto_clock_out: number;
    attendance_compliant: number;
    no_show_rate: number;
    attendance_compliance_rate: number;
    standard_cancel_rate: number;
    critical_cancel_rate: number;
}

export type TrendGrain = 'week' | 'day';

export const useBehaviourTrend = (
    from: string,
    to: string,
    scope: ScopeSelection,
    grain: TrendGrain = 'week',
) =>
    useQuery({
        queryKey: ['kpi_behaviour_trend', from, to, grain, scope],
        queryFn: async (): Promise<BehaviourTrendRow[]> => {
            // Cast through any: newer than the generated RPC registry.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any).rpc('get_kpi_behaviour_trend', {
                p_from: from,
                p_to: to,
                p_grain: grain,
                p_org_ids: scope.org_ids.length ? scope.org_ids : undefined,
                p_dept_ids: scope.dept_ids.length ? scope.dept_ids : undefined,
                p_subdept_ids: scope.subdept_ids.length ? scope.subdept_ids : undefined,
            });
            if (error) throw error;
            return (data ?? []) as BehaviourTrendRow[];
        },
        enabled: !!from && !!to && !!scope,
        staleTime: 5 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
    });

/** "1 Sep" — short enough for an axis tick at 13 buckets across. */
export function formatBucket(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d} ${months[m - 1]}`;
}
