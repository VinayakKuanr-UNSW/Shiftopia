/**
 * Casual fairness ledger: Supabase query layer.
 *
 * `casual_fairness_ledger` holds one current generation per organization,
 * recomputed nightly by `run_casual_fairness_nightly`. It is read-only to the
 * app (RLS: managers in scope, and each employee their own rows).
 */

import { supabase } from '@/platform/supabase/client';
import { ALL_FAIRNESS_METRICS, type FairnessMetric, type FairnessStanding } from '@/modules/rosters/domain/fairness-ledger';

const COLUMNS =
    'employee_id, metric, actual_hours, expected_hours, debt_hours, opportunity_count, confidence, window_start, window_end';

const isMetric = (m: string): m is FairnessMetric => (ALL_FAIRNESS_METRICS as readonly string[]).includes(m);

export const fairnessLedgerQueries = {
    /** The organization's current standings; `employeeIds` null = everyone visible. */
    async getStandings(organizationId: string, employeeIds: string[] | null): Promise<FairnessStanding[]> {
        if (employeeIds !== null && employeeIds.length === 0) return [];

        let query = supabase.from('casual_fairness_ledger').select(COLUMNS).eq('organization_id', organizationId);
        if (employeeIds !== null) query = query.in('employee_id', employeeIds);

        const { data, error } = await query;
        if (error) throw new Error(`fairnessLedger.getStandings failed: ${error.message}`);

        return (data ?? []).filter(r => isMetric(r.metric)).map(r => ({
            employeeId: r.employee_id,
            metric: r.metric as FairnessMetric,
            actualHours: Number(r.actual_hours),
            expectedHours: Number(r.expected_hours),
            debtHours: Number(r.debt_hours),
            opportunityCount: r.opportunity_count,
            confidence: Number(r.confidence),
            windowStart: r.window_start,
            windowEnd: r.window_end,
        }));
    },
};
