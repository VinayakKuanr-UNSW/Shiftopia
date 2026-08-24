import { useQuery } from '@tanstack/react-query';
import { insightsApi } from '../api/insights.api';
import type { ScopeSelection } from '@/platform/auth/types';

/**
 * Why people cancelled, one row per reason.
 *
 * Reads the CANCELLED / LATE_CANCELLED events sm_employee_drop_shift writes —
 * the only place a reason is recorded. Drops made before reason capture
 * existed report as `UNSPECIFIED` rather than disappearing from the
 * denominator, so the shares always add to 100%.
 */
export interface CancellationReasonRow {
    reason_code: string;
    reason_label: string;
    total: number;
    /** Dropped with more than 24h notice. */
    standard_count: number;
    /** Dropped with 24h notice or less. */
    critical_count: number;
    /**
     * Subset of critical_count taken inside the 4h emergent window. Self-service
     * cannot reach it — the drop button is locked — so a non-zero value here
     * means a manager or override path was used.
     */
    emergent_count: number;
    share_pct: number;
    avg_notice_hours: number | null;
}

export const useCancellationReasonBreakdown = (
    from: string,
    to: string,
    scope: ScopeSelection,
) =>
    useQuery({
        queryKey: ['cancellation_reason_breakdown', from, to, scope],
        queryFn: async (): Promise<CancellationReasonRow[]> => {
            return (await insightsApi.getCancellationReasonBreakdown(from, to, scope)) as CancellationReasonRow[];
        },
        enabled: !!from && !!to && !!scope,
        staleTime: 5 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
    });
