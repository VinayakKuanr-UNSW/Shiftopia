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
    resolveScopedBasis,
    type AvailabilityScopeRef,
    type ContractBasis,
    type ContractBasisInput,
} from '../domain/contract-basis';

/**
 * The columns every caller needs. Present in production today.
 */
const BASE_COLUMNS =
    'employment_status,contracted_weekly_hours,start_date,role_id,department_id,sub_department_id';

// `department_id` / `sub_department_id` join the BASE list rather than getting a
// probe of their own: unlike the envelope columns below they have been on
// `user_contracts` since the baseline schema, so there is no environment where
// naming them is what breaks the select.

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
 * One employee's Active contracts, mapped to the domain input shape.
 *
 * Extracted so the person-wide read, the per-job read and the scope list are
 * three questions asked of ONE query result rather than three round trips that
 * could disagree with each other mid-flight.
 *
 * `isError` is reported rather than thrown: every caller here fails CLOSED to
 * the empty basis, and they need to be able to tell "no contracts" from "could
 * not read contracts".
 */
interface ActiveContractsRead {
    inputs: ContractBasisInput[];
    roleIds: string[];
    /** The raw rows, for readers that need a column the domain shape drops. */
    rows: Array<Record<string, unknown>>;
    isError: boolean;
}

async function readActiveContracts(employeeId: string): Promise<ActiveContractsRead> {
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
            console.error('[contract-basis.api] readActiveContracts failed', error);
            return { inputs: [], roleIds: [], rows: [], isError: true };
        }
        console.info(
            '[contract-basis.api] ordinary-hours envelope columns unavailable — '
            + 'treating every contract as unrestricted (migration 20260817000000 not applied here)',
        );
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return {
        rows,
        inputs: rows.map((row) => ({
            employmentStatus: (row.employment_status as string | null) ?? null,
            contractedWeeklyHours: (row.contracted_weekly_hours as number | string | null) ?? null,
            startDate: (row.start_date as string | null) ?? null,
            ordinarySpanStart: (row.ordinary_span_start as string | null) ?? null,
            ordinarySpanEnd: (row.ordinary_span_end as string | null) ?? null,
            ordinaryDays: (row.ordinary_days as number[] | null) ?? null,
            subDepartmentId: (row.sub_department_id as string | null) ?? null,
            departmentId: (row.department_id as string | null) ?? null,
        })),
        roleIds: rows
            .map((row) => row.role_id as string | null)
            .filter((id): id is string => Boolean(id)),
        isError: false,
    };
}

/**
 * Resolve the PERSON-WIDE basis for one employee — how many hours may this
 * human work, and what does an empty calendar mean for them overall.
 *
 * Unchanged in meaning by the sub-department work, and deliberately so: the
 * rolling ordinary-hours caps and leave pricing are person-wide facts. For the
 * per-job question — may they declare availability for THIS sub-department —
 * use `fetchScopedContractBasis`.
 *
 * Fails CLOSED: a query error returns the empty basis, whose `availabilityMode`
 * is 'OPT_IN' and whose weekly hours are undefined. Both are the strict
 * reading, so a transient failure understates entitlement rather than
 * overstating it — and the caller can tell the two apart via `isError`.
 */
export async function fetchContractBasis(employeeId: string): Promise<ContractBasisRead> {
    if (!employeeId) return EMPTY_READ(false);

    const { inputs, roleIds, isError } = await readActiveContracts(employeeId);
    if (isError) return EMPTY_READ(true);

    return { ...resolveComplianceBasis(inputs), roleIds, isError: false };
}

/**
 * Resolve the basis for ONE JOB.
 *
 * `scope.subDepartmentId === null` returns the person-wide basis, so a caller
 * that has not yet resolved a scope gets today's answer rather than an empty
 * one — the same NULL semantics the database guards use.
 *
 * `roleIds` stays PERSON-WIDE on purpose. It feeds the Schedule 3 security
 * check, which asks whether someone holds a security role at all, not whether
 * this particular job is one.
 */
export async function fetchScopedContractBasis(
    employeeId: string,
    scope: AvailabilityScopeRef,
): Promise<ContractBasisRead> {
    if (!employeeId) return EMPTY_READ(false);

    const { inputs, roleIds, isError } = await readActiveContracts(employeeId);
    if (isError) return EMPTY_READ(true);

    return { ...resolveScopedBasis(inputs, scope), roleIds, isError: false };
}

// ============================================================================
// THE SCOPE LIST — which jobs may this person declare availability for
// ============================================================================

/**
 * One selectable job on the availability page.
 *
 * Carries its OWN basis rather than a flag, because every question the page
 * asks per scope — show the editor or the contract card, is silence a problem,
 * what span may they be rostered in — is answered by the same `ContractBasis`
 * the person-wide path already returns.
 */
export interface AvailabilityScope extends ContractBasis {
    /** null for a DEPARTMENT-WIDE contract, which covers the whole department. */
    subDepartmentId: string | null;
    subDepartmentName: string;
    departmentId: string | null;
    departmentName: string | null;
    /** Every Active role this person holds in this scope, for the picker's subtitle. */
    roleIds: string[];
    /**
     * May they declare availability here at all?
     *
     * The mirror of `sm_holds_active_ft_contract_in` (20260821090100): false for
     * a Full-Time job, whose unavailability is managed through Leave. A page
     * that renders the editor when this is false will simply have its write
     * rejected by the database trigger.
     */
    canDeclare: boolean;
}

/**
 * The jobs one person may declare availability for, newest contract first.
 *
 * READ FROM `user_contracts`, NEVER FROM THE TYPE X PERMISSION TREE. The
 * personal scope tree in `platform/auth/useScopeFilter.ts` is built from Type X
 * certificates, and in production three (user, department, sub-department)
 * contract scopes have no matching certificate while two people hold none at
 * all — including one who is Casual in TWO sub-departments and would be offered
 * exactly one of his two jobs. Certificates govern what you may SEE; contracts
 * govern what you may DECLARE.
 *
 * Fails CLOSED to an empty list, which renders as "no jobs to declare for"
 * rather than as an unscoped editor that would write a declaration covering
 * every job the person holds.
 */
export async function fetchAvailabilityScopes(employeeId: string): Promise<{
    scopes: AvailabilityScope[];
    isError: boolean;
}> {
    if (!employeeId) return { scopes: [], isError: false };

    const { inputs, rows, isError } = await readActiveContracts(employeeId);
    if (isError) return { scopes: [], isError: true };

    // One entry per distinct (sub-department, department) the person is
    // contracted in. Several contracts can share a scope — production has
    // people holding three Casual contracts in Set-up that differ only by role —
    // and they share ONE declaration, which is the whole reason the grain is
    // the sub-department and not the contract.
    const seen = new Map<string, AvailabilityScopeRef>();
    for (const c of inputs) {
        const key = `${c.subDepartmentId ?? 'DEPT'}|${c.departmentId ?? ''}`;
        if (!seen.has(key)) {
            seen.set(key, {
                subDepartmentId: c.subDepartmentId ?? null,
                departmentId: c.departmentId ?? null,
            });
        }
    }
    if (seen.size === 0) return { scopes: [], isError: false };

    const names = await fetchScopeNames(
        [...seen.values()].map((s) => s.subDepartmentId).filter((id): id is string => !!id),
        [...seen.values()].map((s) => s.departmentId).filter((id): id is string => !!id),
    );

    const roleIdsByScope = new Map<string, string[]>();
    rows.forEach((row, i) => {
        const c = inputs[i];
        const key = `${c.subDepartmentId ?? 'DEPT'}|${c.departmentId ?? ''}`;
        const roleId = row.role_id as string | null;
        if (!roleId) return;
        const list = roleIdsByScope.get(key) ?? [];
        if (!list.includes(roleId)) list.push(roleId);
        roleIdsByScope.set(key, list);
    });

    const scopes: AvailabilityScope[] = [...seen.entries()].map(([key, ref]) => {
        const basis = resolveScopedBasis(inputs, ref);
        const deptName = ref.departmentId ? names.departments.get(ref.departmentId) ?? null : null;
        return {
            ...basis,
            subDepartmentId: ref.subDepartmentId,
            subDepartmentName: ref.subDepartmentId
                ? names.subDepartments.get(ref.subDepartmentId) ?? 'Sub-department'
                // A department-wide contract has no sub-department to name, and
                // labelling it with the department is the truthful reading of
                // what it covers.
                : deptName
                    ? `All of ${deptName}`
                    : 'All sub-departments',
            departmentId: ref.departmentId ?? null,
            departmentName: deptName,
            roleIds: roleIdsByScope.get(key) ?? [],
            canDeclare: !basis.isFullTime,
        };
    });

    // Declarable jobs first, then alphabetical. A full-timer's scope is still
    // listed — the page has a card to show for it — but it is never what a
    // multi-contract employee lands on, because it is the one scope where there
    // is nothing for them to do.
    return {
        scopes: scopes.sort((a, b) =>
            a.canDeclare === b.canDeclare
                ? a.subDepartmentName.localeCompare(b.subDepartmentName)
                : a.canDeclare ? -1 : 1),
        isError: false,
    };
}

/**
 * Names for the picker, as two FLAT reads.
 *
 * Deliberately not a PostgREST embed off `user_contracts`: that is a VIEW over
 * `hr.user_contracts`, so relationship detection through it is not something to
 * rely on — and one unresolvable name 400s the WHOLE select, which react-query
 * would then render as an empty scope list rather than as an error.
 *
 * A failure here costs labels, not correctness: the ids are already resolved,
 * so the scopes still work and simply read as "Sub-department".
 */
async function fetchScopeNames(subDeptIds: string[], deptIds: string[]): Promise<{
    subDepartments: Map<string, string>;
    departments: Map<string, string>;
}> {
    const subDepartments = new Map<string, string>();
    const departments = new Map<string, string>();

    if (subDeptIds.length > 0) {
        const { data, error } = await (supabase as any)
            .from('sub_departments')
            .select('id,name')
            .in('id', subDeptIds);
        if (error) console.warn('[contract-basis.api] sub-department names unavailable', error);
        for (const r of (data ?? []) as Array<{ id: string; name: string }>) {
            subDepartments.set(r.id, r.name);
        }
    }

    if (deptIds.length > 0) {
        const { data, error } = await (supabase as any)
            .from('departments')
            .select('id,name')
            .in('id', deptIds);
        if (error) console.warn('[contract-basis.api] department names unavailable', error);
        for (const r of (data ?? []) as Array<{ id: string; name: string }>) {
            departments.set(r.id, r.name);
        }
    }

    return { subDepartments, departments };
}
