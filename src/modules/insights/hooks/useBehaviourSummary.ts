import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import type { ScopeSelection } from '@/platform/auth/types';

/**
 * Org-level attendance and cancellation aggregate, from
 * get_kpi_behaviour_summary.
 *
 * Summed from assignment_snapshots with the same definitions
 * get_quarterly_performance_report uses per employee, so the org figures and
 * the per-employee table reconcile. Averaging the per-employee rates instead
 * would weight a one-shift casual the same as a full-timer.
 */
export interface BehaviourSummary {
    // Counts
    held: number;
    worked: number;
    no_show: number;
    standard_cancellations: number;
    critical_cancellations: number;
    swapped_out: number;
    reassigned: number;
    emergency_assigned: number;
    on_time_in: number;
    on_time_out: number;
    early_clock_in: number;
    late_clock_in: number;
    early_clock_out: number;
    late_clock_out: number;
    auto_clock_out: number;
    attendance_compliant: number;
    employees: number;

    // Rates, 0–100. Punctuality is over WORKED shifts; no-show and the two
    // cancellation kinds are over HELD shifts (every assignment episode).
    no_show_rate: number;
    on_time_in_rate: number;
    on_time_out_rate: number;
    early_clock_in_rate: number;
    late_clock_in_rate: number;
    early_clock_out_rate: number;
    late_clock_out_rate: number;
    auto_clock_out_rate: number;
    attendance_compliance_rate: number;
    standard_cancel_rate: number;
    critical_cancel_rate: number;
    total_cancel_rate: number;
}

export const EMPTY_BEHAVIOUR: BehaviourSummary = {
    held: 0, worked: 0, no_show: 0, standard_cancellations: 0, critical_cancellations: 0,
    swapped_out: 0, reassigned: 0, emergency_assigned: 0, on_time_in: 0, on_time_out: 0,
    early_clock_in: 0, late_clock_in: 0, early_clock_out: 0, late_clock_out: 0,
    auto_clock_out: 0, attendance_compliant: 0, employees: 0,
    no_show_rate: 0, on_time_in_rate: 0, on_time_out_rate: 0, early_clock_in_rate: 0,
    late_clock_in_rate: 0, early_clock_out_rate: 0, late_clock_out_rate: 0,
    auto_clock_out_rate: 0, attendance_compliance_rate: 0,
    standard_cancel_rate: 0, critical_cancel_rate: 0, total_cancel_rate: 0,
};

export const useBehaviourSummary = (from: string, to: string, scope: ScopeSelection) =>
    useQuery({
        queryKey: ['kpi_behaviour_summary', from, to, scope],
        queryFn: async (): Promise<BehaviourSummary> => {
            // Cast through any: get_kpi_behaviour_summary is newer than the
            // generated RPC registry in platform/supabase/types.ts.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any).rpc('get_kpi_behaviour_summary', {
                p_from: from,
                p_to: to,
                p_org_ids: scope.org_ids.length ? scope.org_ids : undefined,
                p_dept_ids: scope.dept_ids.length ? scope.dept_ids : undefined,
                p_subdept_ids: scope.subdept_ids.length ? scope.subdept_ids : undefined,
            });
            if (error) throw error;
            const row = Array.isArray(data) ? data[0] : data;
            return (row as BehaviourSummary | null) ?? EMPTY_BEHAVIOUR;
        },
        enabled: !!from && !!to && !!scope,
        staleTime: 5 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
    });
