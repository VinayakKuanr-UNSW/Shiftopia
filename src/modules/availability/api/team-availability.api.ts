/**
 * Team Availability API.
 *
 * Reads everything the team view needs for a scope + date range:
 *   members (scoped via user_contracts) · declared availability · placed shifts
 *   · approved leave · required headcount
 *
 * SOURCE OF TRUTH for declared availability is `availability_slots`, reached
 * through `getResolvedAvailabilities` — do not read the vestigial (empty)
 * `availabilities` table. That reader also carries the `isValidUuid` guard: one
 * non-UUID in a `.in()` list rejects the WHOLE query with a 22P02 and would
 * blank availability for everyone.
 *
 * SECURITY. `availability_slots` / `availability_rules` were readable by `anon`
 * (`FOR SELECT USING (true)` granted to `public`). CLOSED 2026-08-09 by
 * migration `20260809000200_availability_rls_close_anon_read` — reads are now
 * owner-or-manager and `anon` is revoked at the grant level. Managers still see
 * the whole workforce, deliberately: scope-narrowing here would silently shrink
 * the Auto Scheduler's candidate set.
 */

import { supabase } from '@/platform/supabase/client';
import { format } from 'date-fns';
import { getResolvedAvailabilities } from '@/modules/rosters/api/availability.api';
import { isValidUuid } from '@/modules/rosters/domain/shift.entity';
import type { ScopeSelection } from '@/platform/auth/types';
import type {
    RawLeaveDay,
    RawTeamShift,
    RequiredSource,
    TeamMember,
} from '../model/team-availability.types';
import { addDaysISO } from '../domain/team-coverage';
import { resolveComplianceBasis, sortByComplianceBasis } from '../domain/contract-basis';
import { resolveNetMinutes } from '../domain/hours-compliance';
import type { FairnessStanding } from '../domain/team-metrics';

/** "HH:mm:ss" | "HH:mm" -> "HH:mm" */
function toHHMM(time: string): string {
    const [h = '00', m = '00'] = time.split(':');
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

// ============================================================================
// MEMBERS
// ============================================================================

interface ContractRow {
    user_id: string;
    department_id: string | null;
    sub_department_id: string | null;
    role_id: string | null;
    employment_status: string | null;
    status: string | null;
    /** `numeric` — PostgREST may serialise it as a string. See ContractBasisInput. */
    contracted_weekly_hours: number | string | null;
    start_date: string | null;
}

/** `ContractRow` in the shape `contract-basis` compares. */
const toBasisInput = (row: ContractRow) => ({
    employmentStatus: row.employment_status,
    contractedWeeklyHours: row.contracted_weekly_hours,
    startDate: row.start_date,
});

/**
 * Members in scope, from active contracts.
 *
 * Reads the WHOLE `org_ids` array. The Ch.17 production audit found 13+ pages
 * reading only `scope.org_ids[0]`, which silently hides every org after the
 * first for multi-org managers.
 */
export async function getTeamMembers(scope: ScopeSelection): Promise<TeamMember[]> {
    const orgIds = (scope.org_ids ?? []).filter(isValidUuid);
    const deptIds = (scope.dept_ids ?? []).filter(isValidUuid);
    const subDeptIds = (scope.subdept_ids ?? []).filter(isValidUuid);

    if (orgIds.length === 0) return [];

    let contractQuery = supabase
        .from('user_contracts')
        .select(
            'user_id,department_id,sub_department_id,role_id,employment_status,status,contracted_weekly_hours,start_date',
        )
        .in('organization_id', orgIds)
        .eq('status', 'Active'); // capital A — 'active' matches nothing

    if (deptIds.length > 0) contractQuery = contractQuery.in('department_id', deptIds);
    if (subDeptIds.length > 0) contractQuery = contractQuery.in('sub_department_id', subDeptIds);

    const { data: contracts, error: contractErr } = await contractQuery;
    if (contractErr) {
        throw new Error(`Team members: contract fetch failed — ${contractErr.message}`);
    }

    const rows = (contracts ?? []) as ContractRow[];
    const userContractsMap = new Map<string, ContractRow[]>();
    for (const row of rows) {
        if (!row.user_id) continue;
        const list = userContractsMap.get(row.user_id) ?? [];
        list.push(row);
        userContractsMap.set(row.user_id, list);
    }
    const userIds = [...userContractsMap.keys()].filter(isValidUuid);
    if (userIds.length === 0) return [];

    const roleIds = [...new Set(rows.map((r) => r.role_id).filter(isValidUuid))] as string[];

    const [{ data: profiles, error: profileErr }, { data: roles }] = await Promise.all([
        supabase
            .from('profiles')
            .select('id,full_name,first_name,last_name,avatar_url')
            .in('id', userIds),
        roleIds.length > 0
            ? supabase.from('roles').select('id,name').in('id', roleIds)
            : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    ]);

    if (profileErr) {
        throw new Error(`Team members: profile fetch failed — ${profileErr.message}`);
    }

    const roleNamesMap = new Map<string, string>(
        ((roles ?? []) as Array<{ id: string; name: string }>).map((r) => [r.id, r.name]),
    );

    return ((profiles ?? []) as Array<{
        id: string;
        full_name: string | null;
        first_name: string | null;
        last_name: string | null;
        avatar_url: string | null;
    }>)
        .map((p) => {
            // Sorted before anything reads a "primary" off the head. Row order
            // out of PostgREST is arbitrary, and 30 of 103 people here hold
            // several active contracts, so the role and employment chip shown
            // for them used to depend on which row came back first.
            const userContracts = sortByComplianceBasis(
                (userContractsMap.get(p.id) ?? []).map((row) => ({ ...row, ...toBasisInput(row) })),
            );
            const basis = resolveComplianceBasis(userContracts);
            const contractsInfoList: Array<{ roleId: string | null; roleName: string | null; employmentStatus: string | null }> = [];
            const seenContractKeys = new Set<string>();

            for (const c of userContracts) {
                const rName = c.role_id ? roleNamesMap.get(c.role_id) ?? null : null;
                const emp = c.employment_status ?? null;
                const key = `${c.role_id ?? ''}|${emp ?? ''}`;
                if (!seenContractKeys.has(key)) {
                    seenContractKeys.add(key);
                    contractsInfoList.push({
                        roleId: c.role_id,
                        roleName: rName,
                        employmentStatus: emp,
                    });
                }
            }

            const primaryContract = contractsInfoList[0] ?? {
                roleId: null,
                roleName: null,
                employmentStatus: null,
            };

            const userRoleIds = [...new Set(userContracts.map((c) => c.role_id).filter((rid): rid is string => Boolean(rid) && isValidUuid(rid)))];
            const distinctRoleNames = userRoleIds
                .map((rid) => roleNamesMap.get(rid))
                .filter((name): name is string => Boolean(name));
            const userEmploymentStatuses = [...new Set(userContracts.map((c) => c.employment_status).filter(Boolean))];

            return {
                profileId: p.id,
                fullName:
                    p.full_name ||
                    `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() ||
                    'Unknown',
                avatarUrl: p.avatar_url ?? undefined,
                roleId: primaryContract.roleId,
                roleName: primaryContract.roleName,
                roleNames: distinctRoleNames,
                contracts: contractsInfoList,
                departmentId: userContracts[0]?.department_id ?? null,
                subDepartmentId: userContracts[0]?.sub_department_id ?? null,
                employmentStatus: primaryContract.employmentStatus ?? (userEmploymentStatuses.length > 0 ? userEmploymentStatuses.join(', ') : null),
                // Deliberately NOT `employmentStatus` above: that field is a
                // display label and may join several statuses with a comma.
                // These two are the compliance basis and have exactly one
                // answer each. See domain/contract-basis.ts.
                contractType: basis.contractType,
                contractedWeeklyHours: basis.contractedWeeklyHours,
            } satisfies TeamMember;
        })
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

// ============================================================================
// SHIFTS
// ============================================================================

/**
 * Sent to PostgREST verbatim. Every name in it must exist: one bad name rejects
 * the ENTIRE select with a 400, which this page renders as "nobody is rostered"
 * rather than as an error. Keep it comment-free.
 *
 * `net_length_minutes` is the hours answer; `scheduled_length_minutes` and
 * `unpaid_break_minutes` are here only so `resolveNetMinutes` has a correct
 * guard if it is ever null (the schema permits that; the app does not).
 */
const TEAM_SHIFT_SELECT =
    'id,shift_date,start_time,end_time,assigned_employee_id,' +
    'net_length_minutes,scheduled_length_minutes,unpaid_break_minutes,is_draft,lifecycle_status,' +
    'roles(name),departments(name),sub_departments(name)';

const SHIFT_PAGE_SIZE = 1000;
/** Matches `rosters/api/shifts.queries.ts` so the two readers truncate alike. */
const SHIFT_ROW_CAP = 8000;
const SHIFT_MAX_PAGES = 25;

export interface TeamShiftsResult {
    shifts: RawTeamShift[];
    /**
     * The read hit its ceiling and the range is only partly represented. Hours
     * and compliance computed from a truncated set read LOW and PASSING, so
     * this is surfaced in the UI, not just console-warned.
     */
    truncated: boolean;
}

export async function getTeamShifts(
    scope: ScopeSelection,
    startDate: Date,
    endDate: Date,
): Promise<TeamShiftsResult> {
    const orgIds = (scope.org_ids ?? []).filter(isValidUuid);
    const deptIds = (scope.dept_ids ?? []).filter(isValidUuid);
    const subDeptIds = (scope.subdept_ids ?? []).filter(isValidUuid);
    if (orgIds.length === 0) return { shifts: [], truncated: false };

    // supabase-js builders are single-shot — one per page.
    const buildQuery = () => {
        let query = supabase
            .from('shifts')
            .select(TEAM_SHIFT_SELECT)
            .in('organization_id', orgIds)
            .gte('shift_date', format(startDate, 'yyyy-MM-dd'))
            .lte('shift_date', format(endDate, 'yyyy-MM-dd'))
            .neq('lifecycle_status', 'Cancelled')
            .or('is_cancelled.is.null,is_cancelled.eq.false')
            .is('deleted_at', null);

        if (deptIds.length > 0) query = query.in('department_id', deptIds);
        if (subDeptIds.length > 0) query = query.in('sub_department_id', subDeptIds);

        // Ordered so paging is stable; without it a row can be skipped or
        // repeated across page boundaries.
        return query.order('shift_date').order('start_time').order('id');
    };

    const rows: any[] = [];
    let truncated = false;
    for (let page = 0; page < SHIFT_MAX_PAGES; page++) {
        if (rows.length >= SHIFT_ROW_CAP) {
            truncated = true;
            break;
        }
        const from = page * SHIFT_PAGE_SIZE;
        const { data, error } = await buildQuery().range(from, from + SHIFT_PAGE_SIZE - 1);
        if (error) throw new Error(`Team shifts fetch failed — ${error.message}`);

        const batch = (data ?? []) as any[];
        rows.push(...batch);
        if (batch.length < SHIFT_PAGE_SIZE) break;

        // A full last page with no room left to page again is also truncation.
        if (page === SHIFT_MAX_PAGES - 1) truncated = true;
    }

    return {
        shifts: rows.map((row) => ({
            id: row.id,
            shiftDate: row.shift_date,
            startTime: toHHMM(row.start_time),
            endTime: toHHMM(row.end_time),
            assignedEmployeeId: row.assigned_employee_id ?? null,
            roleName: row.roles?.name ?? null,
            netMinutes: resolveNetMinutes(row),
            isDraft: row.is_draft === true || row.lifecycle_status === 'Draft',
            deptName: row.departments?.name ?? null,
            subDeptName: row.sub_departments?.name ?? null,
            unpaidBreakMinutes: Math.max(0, Number(row.unpaid_break_minutes) || 0),
        })),
        truncated,
    };
}

// ============================================================================
// WORK-LIMITED VISAS
// ============================================================================

/**
 * Profile ids holding an active work-limited visa.
 *
 * Keyed on `has_restricted_work_limit` itself, NOT on the licence name. The
 * Annual Shift Grid matched `name.includes('Subclass 500')`, which in
 * production silently missed the 5 people on a Subclass 485 Temporary Graduate
 * visa who carry the same restriction (11 on a 500, 5 on a 485, all 16
 * flagged). The flag is the fact; the licence name is one of several ways to
 * arrive at it.
 *
 * Called with the VISIBLE page of members, as the Grid did — this is a badge,
 * not a filter, so there is no reason to read it for people nobody is looking at.
 */
export async function getTeamRestrictedWorkLimits(profileIds: string[]): Promise<Set<string>> {
    const ids = profileIds.filter(isValidUuid);
    if (ids.length === 0) return new Set();

    const { data, error } = await supabase
        .from('employee_licenses')
        .select('employee_id,has_restricted_work_limit')
        .eq('status', 'Active')
        .eq('has_restricted_work_limit', true)
        .in('employee_id', ids);

    if (error) {
        // A badge, not the subject of the page — degrade rather than fail.
        console.warn('[TeamAvailability] work-limit flags unavailable; badge omitted', error);
        return new Set();
    }

    return new Set(
        ((data ?? []) as Array<{ employee_id: string }>).map((row) => row.employee_id),
    );
}

// ============================================================================
// LEAVE
// ============================================================================

/**
 * Approved leave, expanded to one row per covered day.
 *
 * `leave_requests.start_date` / `end_date` are timestamptz in prod, so they are
 * sliced to their date part rather than compared as instants.
 */
export async function getTeamLeaveDays(
    profileIds: string[],
    startDate: Date,
    endDate: Date,
): Promise<RawLeaveDay[]> {
    const ids = profileIds.filter(isValidUuid);
    if (ids.length === 0) return [];

    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');

    const { data, error } = await supabase
        .from('leave_requests')
        .select('employee_id,start_date,end_date')
        .in('employee_id', ids)
        .eq('status', 'approved')
        .lte('start_date', `${endStr}T23:59:59`)
        .gte('end_date', `${startStr}T00:00:00`);

    if (error) {
        // Leave is an overlay, not the page's subject — degrade rather than fail.
        console.warn('[TeamAvailability] approved-leave fetch failed; leave overlay omitted', error);
        return [];
    }

    const out: RawLeaveDay[] = [];
    for (const row of (data ?? []) as Array<{
        employee_id: string;
        start_date: string;
        end_date: string;
    }>) {
        let cursor = row.start_date.slice(0, 10);
        const last = row.end_date.slice(0, 10);
        // Clamp to the requested window so a year-long leave does not explode.
        if (cursor < startStr) cursor = startStr;
        const stop = last > endStr ? endStr : last;
        let guard = 0;
        while (cursor <= stop && guard++ < 400) {
            out.push({ profileId: row.employee_id, date: cursor });
            cursor = addDaysISO(cursor, 1);
        }
    }
    return out;
}

// ============================================================================
// REQUIRED HEADCOUNT
// ============================================================================

/**
 * Required headcount from the finalised demand engine.
 *
 * DECISION (2026-08-08): forecast demand is the intended primary source of
 * REQUIRED; placed shifts represent actual planned coverage.
 *
 * It is not wired yet, and returning fabricated numbers would be worse than
 * returning none:
 *   • `demand_tensor` has 0 rows in production;
 *   • its grain is (synthesis_run_id, event_id, slice_idx, function_code,
 *     level) — `slice_idx` is an index into an event-relative time grid, and no
 *     slice→(date, hour) resolver exists on the frontend today.
 *
 * So this returns `null` until both are addressed, and the caller falls back to
 * `requiredFromShifts` and BADGES which source is live. Wiring this up is the
 * only change needed here — the rest of the page already reads `required`
 * source-agnostically.
 */
export async function getRequiredFromDemand(
    _scope: ScopeSelection,
    _startDate: Date,
    _endDate: Date,
): Promise<Map<string, Map<number, number>> | null> {
    const { count, error } = await supabase
        .from('demand_tensor')
        .select('*', { count: 'exact', head: true });

    if (error || !count) return null;

    // Deliberately unimplemented: rows exist but the slice→(date, hour) mapping
    // must come from the synthesis run's time base before they can be trusted.
    return null;
}

export interface RequiredResolution {
    required: Map<string, Map<number, number>> | null;
    source: RequiredSource;
}

/** Demand first, planned shifts as the fallback. Always reports which won. */
export async function resolveRequired(
    scope: ScopeSelection,
    startDate: Date,
    endDate: Date,
): Promise<RequiredResolution> {
    try {
        const demand = await getRequiredFromDemand(scope, startDate, endDate);
        if (demand && demand.size > 0) return { required: demand, source: 'demand' };
    } catch (err) {
        console.warn('[TeamAvailability] demand source unavailable; using planned shifts', err);
    }
    return { required: null, source: 'shifts' };
}

// ============================================================================
// AVAILABILITY passthrough
// ============================================================================

export { getResolvedAvailabilities };

// ============================================================================
// FAIRNESS STANDING
// ============================================================================

/**
 * Each member's position against the cohort, straight off `fairness_ledger`.
 *
 * READ-ONLY, and deliberately not recomputed here. The ledger is maintained by
 * a cron-driven `recompute_fairness_ledger`; in production it holds one row per
 * (employee, metric) over a 91-day window ending today, refreshed daily. This
 * page reports that standing, it does not derive a second one — a grid that
 * computed its own fairness would be the sixth rival definition of the word.
 *
 * Consequence worth knowing: the window is fixed to the ledger's, NOT to the
 * dates on screen. Navigating the grid to March does not re-window fairness,
 * and the UI has to say so rather than implying the number moved with the view.
 */
export async function getTeamFairnessStanding(
    scope: ScopeSelection,
    profileIds: string[],
): Promise<Map<string, FairnessStanding>> {
    const orgIds = (scope.org_ids ?? []).filter(isValidUuid);
    const ids = profileIds.filter(isValidUuid);
    if (orgIds.length === 0 || ids.length === 0) return new Map();

    const { data, error } = await supabase
        .from('fairness_ledger')
        .select('employee_id,metric,debt,window_start,window_end')
        .in('organization_id', orgIds)
        .in('employee_id', ids);

    if (error) {
        // An overlay, not the subject of the page — degrade rather than fail.
        console.warn('[TeamAvailability] fairness ledger unavailable; standing omitted', error);
        return new Map();
    }

    const out = new Map<string, FairnessStanding>();
    for (const row of (data ?? []) as Array<{
        employee_id: string;
        metric: string;
        debt: number | string | null;
        window_start: string | null;
        window_end: string | null;
    }>) {
        const entry = out.get(row.employee_id) ?? {
            debtByMetric: {},
            windowStart: row.window_start,
            windowEnd: row.window_end,
        };
        // `debt` is numeric — PostgREST may hand it back as a string.
        const debt = row.debt === null ? null : Number(row.debt);
        if (debt !== null && Number.isFinite(debt)) {
            entry.debtByMetric[row.metric as keyof FairnessStanding['debtByMetric']] = debt;
        }
        out.set(row.employee_id, entry);
    }
    return out;
}

export const teamAvailabilityApi = {
    getTeamMembers,
    getTeamShifts,
    getTeamLeaveDays,
    getTeamRestrictedWorkLimits,
    getTeamFairnessStanding,
    resolveRequired,
    getResolvedAvailabilities,
};
