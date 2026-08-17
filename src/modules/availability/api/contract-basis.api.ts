/**
 * Read one person's compliance/availability basis from their Active contracts.
 *
 * WHY A SHARED READER. Three surfaces need the same answer — the availability
 * page (is this person's empty calendar a problem?), the leave form (how many
 * hours does a day of leave consume?), and the hours ledger — and each was
 * about to grow its own contract query. They must not disagree: if the page
 * tells an FT their availability is optional while the leave form prices their
 * day off a casual's zero-hour basis, one of the two is lying.
 *
 * MULTIPLE ACTIVE CONTRACTS ARE NORMAL. 30 of 103 people in production hold
 * more than one, and at least one holds two whose employment statuses disagree
 * outright. Resolution is delegated wholesale to `resolveComplianceBasis`,
 * which is the tested precedence the hours rules already use — this module
 * does no picking of its own.
 *
 * That is also the bug this replaces for the leave module:
 * `isFullTimeSecurityEmployee` selected contracts with `.maybeSingle()`, which
 * ERRORS (PGRST116) the moment a second Active row exists. Every multi-contract
 * employee silently resolved to "not full-time security" and was quoted the
 * general 152h/76h accrual instead of Schedule 3's 210h/84h.
 */

import { supabase } from '@/platform/supabase/client';
import {
    resolveComplianceBasis,
    type ContractBasis,
    type ContractBasisInput,
} from '../domain/contract-basis';

/**
 * The columns every caller needs. Present in production today.
 */
const BASE_COLUMNS = 'employment_status,contracted_weekly_hours,start_date,role_id';

/**
 * The envelope columns, added by migration 20260817000000.
 *
 * THEY ARE SELECTED SEPARATELY ON PURPOSE. PostgREST rejects the ENTIRE select
 * when any one name is unknown — a 400, not a null column — so naming these
 * before the migration is applied would take out the whole basis read, and the
 * empty basis it falls back to reads as "this person is a casual". That would
 * quietly reprice every permanent's leave and tell every full-timer their
 * availability is mandatory, on every environment that had not migrated yet.
 *
 * So the read tries the full list, and on failure retries with the base list
 * and reports an unconfigured envelope — which is the correct answer for an
 * un-migrated database anyway, since nothing there has a span. The fallback
 * self-heals the moment the migration lands.
 */
const ENVELOPE_COLUMNS = 'ordinary_span_start,ordinary_span_end,ordinary_days';

export interface ContractBasisRead extends ContractBasis {
    /** Role ids across the person's Active contracts — used for the Schedule 3 check. */
    roleIds: string[];
    /** True when the read failed. The basis is then the empty one, never a guess. */
    isError: boolean;
}

const EMPTY_READ = (isError: boolean): ContractBasisRead => ({
    ...resolveComplianceBasis([]),
    roleIds: [],
    isError,
});

/**
 * Resolve the basis for one employee.
 *
 * Fails CLOSED: a query error returns the empty basis, whose `availabilityMode`
 * is 'OPT_IN' and whose weekly hours are undefined. Both are the strict
 * reading, so a transient failure understates entitlement rather than
 * overstating it — and the caller can tell the two apart via `isError`.
 */
export async function fetchContractBasis(employeeId: string): Promise<ContractBasisRead> {
    if (!employeeId) return EMPTY_READ(false);

    const read = async (columns: string) =>
        await (supabase as any)
            .from('user_contracts')
            .select(columns)
            .eq('user_id', employeeId)
            .eq('status', 'Active');

    let { data, error } = await read(`${BASE_COLUMNS},${ENVELOPE_COLUMNS}`);

    if (error) {
        // Retry without the envelope columns — see ENVELOPE_COLUMNS. Only the
        // second failure is a real one.
        ({ data, error } = await read(BASE_COLUMNS));
        if (error) {
            console.error('[contract-basis.api] fetchContractBasis failed', error);
            return EMPTY_READ(true);
        }
        console.info(
            '[contract-basis.api] ordinary-hours envelope columns unavailable — '
            + 'treating every contract as unrestricted (migration 20260817000000 not applied here)',
        );
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const inputs: ContractBasisInput[] = rows.map((row) => ({
        employmentStatus: (row.employment_status as string | null) ?? null,
        contractedWeeklyHours: (row.contracted_weekly_hours as number | string | null) ?? null,
        startDate: (row.start_date as string | null) ?? null,
        ordinarySpanStart: (row.ordinary_span_start as string | null) ?? null,
        ordinarySpanEnd: (row.ordinary_span_end as string | null) ?? null,
        ordinaryDays: (row.ordinary_days as number[] | null) ?? null,
    }));

    return {
        ...resolveComplianceBasis(inputs),
        roleIds: rows
            .map((row) => row.role_id as string | null)
            .filter((id): id is string => Boolean(id)),
        isError: false,
    };
}
