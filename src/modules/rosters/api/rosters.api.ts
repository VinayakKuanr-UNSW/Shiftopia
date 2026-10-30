// src/modules/rosters/api/rosters.api.ts
import { z } from 'zod';
import { callRpc } from '@/platform/supabase/rpc/client';
import { UuidSchema } from './contracts';

const EnsureRostersResultSchema = z.object({
    success:       z.boolean(),
    days_created:  z.number(),
    days_existing: z.number(),
    days_skipped:  z.number(),
});
type EnsureRostersResult = z.infer<typeof EnsureRostersResultSchema>;

export const rostersApi = {

    /**
     * Resolve the roster (day container) for a scope + date, creating it if it does
     * not exist yet. This is the client entry point for implicit activation.
     *
     * The RPC owns the rules, not this wrapper:
     *  - `roster.edit` RBAC on the creation path (SECURITY DEFINER bypasses the
     *    rosters_insert_rbac policy, so the function re-applies it)
     *  - refuses to CREATE for a date already past in Australia/Sydney
     *  - race-safe, so two managers hitting the same empty day is fine
     *
     * Most callers never need this: `sm_create_shift` and
     * `apply_template_to_date_range_v2` resolve internally. Use it only where a
     * roster id is required BEFORE the write — currently the demand-injection
     * path, which inserts into `shifts` directly rather than via the RPC.
     */
    resolveRoster: async (params: {
        organizationId: string;
        departmentId: string;
        subDepartmentId: string | null;
        date: string;
    }): Promise<string> => {
        return callRpc(
            'sm_resolve_roster',
            {
                p_org_id: params.organizationId,
                p_dept_id: params.departmentId,
                p_sub_dept_id: params.subDepartmentId,
                p_date: params.date,
                p_allow_past: false,
            },
            UuidSchema,
        );
    },

    /**
     * Create empty roster day containers across a range, for one or more
     * sub-departments. Backs the "No template — create empty days" option of the
     * Schedule-from-Template dialog.
     *
     * Days already past in Australia/Sydney are skipped, not rejected: picking
     * "This Month" on the 20th means the rest of the month. `days_skipped` is
     * returned so the UI can say so rather than silently doing less than asked.
     */
    ensureRostersForRange: async (params: {
        organizationId: string;
        departmentId: string;
        /** May contain `null` — that is a department-level roster, not "unset". */
        subDepartmentIds: (string | null)[];
        startDate: string;
        endDate: string;
    }): Promise<EnsureRostersResult> => {
        return callRpc(
            'sm_ensure_rosters_for_range',
            {
                p_org_id:       params.organizationId,
                p_dept_id:      params.departmentId,
                p_sub_dept_ids: params.subDepartmentIds,
                p_start_date:   params.startDate,
                p_end_date:     params.endDate,
            },
            EnsureRostersResultSchema,
        );
    },
};
