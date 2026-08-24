import { useQuery } from '@tanstack/react-query';
import { insightsApi } from '../api/insights.api';

/**
 * The pre-populated reasons an employee picks from when dropping a shift.
 *
 * Read-only to employees (RLS allows SELECT to authenticated and nothing
 * else). Seeded in migration 20260823090200.
 */
export interface CancellationReason {
    code: string;
    label: string;
    description: string | null;
    /** When true the drop is rejected without a free-text note. */
    requires_note: boolean;
    sort_order: number;
}

export const useCancellationReasons = () =>
    useQuery({
        queryKey: ['cancellation_reasons'],
        queryFn: async (): Promise<CancellationReason[]> =>
            (await insightsApi.getCancellationReasons()) as CancellationReason[],
        // A seeded lookup table. No reason to refetch it on a schedule.
        staleTime: 60 * 60 * 1000,
        gcTime: 24 * 60 * 60 * 1000,
    });
