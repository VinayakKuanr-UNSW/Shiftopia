import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';

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
        queryFn: async (): Promise<CancellationReason[]> => {
            // Explicit column list, no comments inside it: one unknown name
            // 400s the whole select and react-query then renders the empty
            // state, which looks identical to "no reasons configured".
            const { data, error } = await supabase
                .from('cancellation_reasons')
                .select('code,label,description,requires_note,sort_order')
                .eq('is_active', true)
                .order('sort_order', { ascending: true });
            if (error) throw error;
            return (data ?? []) as CancellationReason[];
        },
        // A seeded lookup table. No reason to refetch it on a schedule.
        staleTime: 60 * 60 * 1000,
        gcTime: 24 * 60 * 60 * 1000,
    });
