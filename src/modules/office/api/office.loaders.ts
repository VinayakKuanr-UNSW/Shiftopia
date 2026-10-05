/**
 * Office — reading the world.
 *
 * Every function here is READ-ONLY. Generation must not touch a live shift, so
 * the write path is confined entirely to `office.commands.ts#applyRun`.
 *
 * TWO SCOPES, DELIBERATELY DIFFERENT. Eligibility and generation are scoped to
 * the selected sub-department; CONSUMPTION is scoped to the employee. A
 * full-timer's 152h ceiling is a property of the person, so hours they work in
 * another sub-department fill the same ceiling and must be counted — reading
 * only the sub-department being rostered would over-roster them, which is the
 * failure this feature exists to prevent.
 *
 * PostgREST caution: one bad column name 400s the WHOLE select, and
 * react-query's `= []` default then renders it as an empty state — a silent
 * "no employees are eligible" rather than a visible error. Every select here
 * lists columns explicitly, never interpolates, and never carries a comment
 * inside the literal.
 */

import { supabase } from '@/platform/supabase/client';
import {
    resolveComplianceBasis,
    type ContractBasisInput,
} from '@/modules/availability/domain/contract-basis';
import { isSecurityRoleName } from '@/modules/compliance/security-role';
import { LEAVE_POLICIES, resolveOrdinaryHoursCredit } from '@/modules/leave/domain/leave-policy';
import type { LeaveElectionMode, LeaveTypeCode } from '@/modules/leave/model/leave.types';
import type { SnapshotShiftRef } from './digest';
import type {
    EmployeeContractFacts,
    ExistingShift,
    Finding,
    RawLeaveDay,
} from '../domain/types';

/* ────────────────────────────────────────────────────────────────────────────
   Eligible employees
   ──────────────────────────────────────────────────────────────────────────── */

export interface EligibleEmployee {
    facts: EmployeeContractFacts;
    name: string;
    /**
     * The role the CONTRACT authorises, by name.
     *
     * Carried so the table can show it without a second lookup. It is displayed
     * read-only: `BFT_PATTERN_ROLE_MISMATCH` is BLOCKING for any other role, so
     * offering a choice would be offering a way to break the row. Changing
     * someone's role is a contract change, and the finding says so.
     */
    roleName: string;
    /**
     * `profiles.avatar_url`, for the grid's identity column. Null is normal and
     * the column falls back to initials — it is never a reason to hide a row.
     */
    avatarUrl: string | null;
    isSecurityRole: boolean;
}

export interface EligibilityLoad {
    employees: EligibleEmployee[];
    findings: Finding[];
    /** Fed to `inputDigest`. */
    rawContracts: Array<Record<string, unknown>>;
}

const CONTRACT_COLUMNS =
    'id, user_id, organization_id, department_id, sub_department_id, role_id, status, ' +
    'start_date, end_date, employment_status, contracted_weekly_hours, ' +
    'ordinary_hours_cycle_weeks, ordinary_hours_cycle_anchor';

/**
 * Resolve who the baseline applies to.
 *
 * Uses `isWhollyFullTime`, NOT `isFullTime`. The latter reports the GOVERNING
 * contract, and Full-Time governs a mixed scope correctly for "how many hours
 * may this person work" — but somebody who is a Full-Time Supervisor here and
 * a Casual Usher elsewhere should not have a full-time baseline generated for
 * the casual half. Generating against the governing contract alone would
 * over-roster them.
 */
export async function loadEligibleEmployees(
    subDepartmentId: string,
    periodStart: string,
    periodEnd: string,
): Promise<EligibilityLoad> {
    const findings: Finding[] = [];

    // Contracts IN this sub-department that overlap the period.
    const { data: scoped, error } = await supabase
        .from('user_contracts')
        .select(CONTRACT_COLUMNS)
        .eq('sub_department_id', subDepartmentId)
        .eq('status', 'Active')
        .lte('start_date', periodEnd)
        .or(`end_date.is.null,end_date.gte.${periodStart}`);

    if (error) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_CONTRACTS_READ_FAILED',
            plain: 'The team\'s contracts could not be read.',
            overridable: false,
            calculation: { error: error.message },
        });
        return { employees: [], findings, rawContracts: [] };
    }

    const rows = (scoped ?? []) as unknown as Array<Record<string, unknown>>;
    const userIds = [...new Set(rows.map(r => String(r.user_id)))].sort();
    if (userIds.length === 0) return { employees: [], findings, rawContracts: [] };

    // EVERY active contract for those people, including ones outside this
    // sub-department — `resolveComplianceBasis` and `isWhollyFullTime` are only
    // correct over the person's whole engagement.
    const [{ data: allContracts }, { data: profiles }, { data: roles }] = await Promise.all([
        supabase.from('user_contracts').select(CONTRACT_COLUMNS)
            .in('user_id', userIds).eq('status', 'Active'),
        supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds),
        supabase.from('roles').select('id, name'),
    ]);

    const nameById = new Map((profiles ?? []).map(p => [String(p.id), String(p.full_name ?? '')]));
    const avatarById = new Map((profiles ?? []).map(
        p => [String(p.id), (p.avatar_url as string | null) ?? null]));
    const roleNameById = new Map((roles ?? []).map(r => [String(r.id), String(r.name ?? '')]));

    const byUser = new Map<string, Array<Record<string, unknown>>>();
    for (const c of (allContracts ?? []) as unknown as Array<Record<string, unknown>>) {
        const uid = String(c.user_id);
        const bucket = byUser.get(uid);
        if (bucket) bucket.push(c);
        else byUser.set(uid, [c]);
    }

    const employees: EligibleEmployee[] = [];

    for (const userId of userIds) {
        const contracts = byUser.get(userId) ?? [];
        const basisInputs: ContractBasisInput[] = contracts.map(c => ({
            employmentStatus: c.employment_status as string | null,
            contractedWeeklyHours: (c.contracted_weekly_hours as number | null) ?? null,
            startDate: c.start_date as string | null,
            // NOT `cycleWeeks`/`cycleAnchor` -- those are the names on the
            // OUTPUT (`ContractBasis`), and passing them on the INPUT is
            // silently ignored, falling back to the 4-week default. Invisible
            // in production today because every contract declares exactly that,
            // which is precisely how a silent-drop hydration gap survives.
            ordinaryHoursCycleWeeks: c.ordinary_hours_cycle_weeks as number | null,
            ordinaryHoursCycleAnchor: c.ordinary_hours_cycle_anchor as string | null,
        }));

        const basis = resolveComplianceBasis(basisInputs);
        const name = nameById.get(userId) || userId;

        if (!basis.isWhollyFullTime) {
            findings.push({
                severity: 'INFO',
                code: 'BFT_NOT_WHOLLY_FULL_TIME',
                plain:
                    `${name} holds a contract that is not full-time, so no baseline is generated ` +
                    `for them. Their existing hours still count toward everyone's limits.`,
                overridable: false,
                employeeId: userId,
                calculation: {
                    contract_types: contracts.map(c => c.employment_status),
                },
            });
            continue;
        }

        // The contract that is actually IN this sub-department — the one the
        // baseline discharges.
        const local = rows.find(r => String(r.user_id) === userId);
        if (!local) continue;

        const roleName = roleNameById.get(String(local.role_id)) ?? '';
        if (isSecurityRoleName(roleName)) {
            findings.push({
                severity: 'INFO',
                code: 'BFT_FT_SECURITY_EXCLUDED',
                plain:
                    `${name} is full-time Security, who work a 12-hour continuous eight-week ` +
                    `roster averaging 42 hours a week. That is a different structure from the ` +
                    `general full-time one, so they are excluded from this generator.`,
                clause: 'ICC EBA Schedule 3 §1.1, §3.1',
                overridable: false,
                employeeId: userId,
            });
            continue;
        }

        employees.push({
            name,
            roleName,
            avatarUrl: avatarById.get(userId) ?? null,
            isSecurityRole: false,
            facts: {
                employeeId: userId,
                userContractId: String(local.id),
                contractedWeeklyHours: basis.contractedWeeklyHours,
                cycleWeeks: basis.cycleWeeks,
                cycleAnchor: basis.cycleAnchor,
                contractStart: String(local.start_date ?? periodStart),
                contractEnd: (local.end_date as string | null) ?? null,
                roleId: String(local.role_id ?? ''),
                subDepartmentId,
            },
        });
    }

    employees.sort((a, b) =>
        a.facts.employeeId < b.facts.employeeId ? -1 : a.facts.employeeId > b.facts.employeeId ? 1 : 0);

    return { employees, findings, rawContracts: rows };
}

/* ────────────────────────────────────────────────────────────────────────────
   Consumption
   ──────────────────────────────────────────────────────────────────────────── */

export interface ConsumptionLoad {
    shiftsByEmployee: Map<string, ExistingShift[]>;
    /** Every shift read, for the snapshot digest. */
    snapshotRefs: SnapshotShiftRef[];
}

/**
 * Existing shifts for these employees over a date window, in EVERY
 * sub-department.
 *
 * The window is widened by the caller to whole cycles, because hours worked
 * earlier in a cycle fill the same ceiling as hours inside the roster period.
 */
export async function loadExistingShifts(
    employeeIds: readonly string[],
    fromDate: string,
    toDate: string,
): Promise<ConsumptionLoad> {
    const shiftsByEmployee = new Map<string, ExistingShift[]>();
    const snapshotRefs: SnapshotShiftRef[] = [];
    if (employeeIds.length === 0) return { shiftsByEmployee, snapshotRefs };

    const { data, error } = await supabase
        .from('shifts')
        .select(
            'id, version, assigned_employee_id, shift_date, start_time, end_time, ' +
            'net_length_minutes, scheduled_length_minutes, unpaid_break_minutes, ' +
            'sub_department_id, lifecycle_status, is_cancelled, deleted_at, ' +
            'roster_id, rosters!inner(is_locked, status)',
        )
        .in('assigned_employee_id', employeeIds as string[])
        .gte('shift_date', fromDate)
        .lte('shift_date', toDate)
        .is('deleted_at', null)
        .eq('is_cancelled', false);

    if (error) throw error;

    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        // A cancelled or terminal shift is not consumption — the employee is
        // not working it, so it must not offset what they are owed.
        const lifecycle = String(row.lifecycle_status ?? '');
        if (lifecycle === 'Cancelled') continue;

        const employeeId = String(row.assigned_employee_id ?? '');
        if (!employeeId) continue;

        const roster = row.rosters as { is_locked?: boolean; status?: string } | null;
        const net = Number(
            row.net_length_minutes
            ?? (Number(row.scheduled_length_minutes ?? 0) - Number(row.unpaid_break_minutes ?? 0)),
        );

        const shift: ExistingShift = {
            id: String(row.id),
            date: String(row.shift_date),
            startTime: String(row.start_time ?? '').slice(0, 5),
            endTime: String(row.end_time ?? '').slice(0, 5),
            netMinutes: Number.isFinite(net) && net > 0 ? net : 0,
            subDepartmentId: (row.sub_department_id as string | null) ?? null,
            rosterPublishedOrLocked:
                Boolean(roster?.is_locked) || String(roster?.status ?? '') === 'published',
        };

        const bucket = shiftsByEmployee.get(employeeId);
        if (bucket) bucket.push(shift);
        else shiftsByEmployee.set(employeeId, [shift]);

        snapshotRefs.push({ id: shift.id, version: Number(row.version ?? 0) });
    }

    // Stable order in, stable order out.
    for (const bucket of shiftsByEmployee.values()) {
        bucket.sort((a, b) => (a.date === b.date
            ? (a.id < b.id ? -1 : 1)
            : (a.date < b.date ? -1 : 1)));
    }

    return { shiftsByEmployee, snapshotRefs };
}

/* ────────────────────────────────────────────────────────────────────────────
   Leave
   ──────────────────────────────────────────────────────────────────────────── */

/** Expand a request's inclusive date range into per-day rows. */
function expandDates(startISO: string, endISO: string): string[] {
    const out: string[] = [];
    const start = new Date(`${startISO}T00:00:00Z`);
    const end = new Date(`${endISO}T00:00:00Z`);
    for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
}

/**
 * Approved and pending leave, already classified against the policy table.
 *
 * `resolveOrdinaryHoursCredit` is what turns cl 55.1 / cl 58.2's election into
 * an answer — or leaves it unresolved when the election was never recorded, in
 * which case the calculator reports both readings rather than guessing.
 *
 * RETURNS `RawLeaveDay`, WITHOUT `creditHours`. How many hours a leave day
 * discharges depends on the PATTERN — cl 44.7 pays "the Team Member's ordinary
 * hours of work in the period", not a weekly average — and patterns are now
 * per-employee and edited live in the table. Computing the credit here would
 * mean re-reading leave from the database on every keystroke. It is attached in
 * the pure layer instead, by `attachLeaveCredit`, where the employee's own
 * pattern is already in hand.
 */
export async function loadLeaveDays(
    employeeIds: readonly string[],
    fromDate: string,
    toDate: string,
): Promise<Map<string, RawLeaveDay[]>> {
    const out = new Map<string, RawLeaveDay[]>();
    if (employeeIds.length === 0) return out;

    // `election_mode` arrives with migration 20260828100000. A database that
    // has not taken it yet would 400 the ENTIRE select on that one name, and
    // react-query's `= []` default would render that as "nobody has any leave"
    // -- which silently removes every leave credit and over-rosters the whole
    // team. So the column is requested, and its absence is retried around
    // rather than allowed to fail open. Mirrors the same guard in
    // `compliance/employee-context.ts` for the work-cycle columns.
    const BASE_COLUMNS =
        'id, employee_id, leave_type, start_date, end_date, status, requested_hours';

    let rows: Array<Record<string, unknown>>;
    const withElection = await supabase
        .from('leave_requests')
        .select(`${BASE_COLUMNS}, election_mode`)
        .in('employee_id', employeeIds as string[])
        .in('status', ['approved', 'pending'])
        .lte('start_date', `${toDate}T23:59:59Z`)
        .gte('end_date', `${fromDate}T00:00:00Z`);

    if (withElection.error) {
        const fallback = await supabase
            .from('leave_requests')
            .select(BASE_COLUMNS)
            .in('employee_id', employeeIds as string[])
            .in('status', ['approved', 'pending'])
            .lte('start_date', `${toDate}T23:59:59Z`)
            .gte('end_date', `${fromDate}T00:00:00Z`);
        if (fallback.error) throw fallback.error;
        rows = (fallback.data ?? []) as unknown as Array<Record<string, unknown>>;
    } else {
        rows = (withElection.data ?? []) as unknown as Array<Record<string, unknown>>;
    }

    for (const row of rows) {
        const employeeId = String(row.employee_id);
        const leaveType = String(row.leave_type) as LeaveTypeCode;
        const policy = LEAVE_POLICIES[leaveType];

        // An unknown leave type is a data problem, not a licence to guess. It
        // blocks the day (the person is absent) and credits nothing.
        const credit = policy
            ? resolveOrdinaryHoursCredit(policy, row.election_mode as LeaveElectionMode | null)
            : 'BLOCKS';

        const start = String(row.start_date ?? '').slice(0, 10);
        const end = String(row.end_date ?? '').slice(0, 10);

        for (const date of expandDates(start, end)) {
            if (date < fromDate || date > toDate) continue;
            const day: RawLeaveDay = {
                date,
                leaveType,
                credit,
                status: String(row.status) === 'approved' ? 'approved' : 'pending',
            };
            const bucket = out.get(employeeId);
            if (bucket) bucket.push(day);
            else out.set(employeeId, [day]);
        }
    }

    for (const bucket of out.values()) {
        bucket.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }
    return out;
}

/* ────────────────────────────────────────────────────────────────────────────
   Public holidays
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Public holidays in the window.
 *
 * Reads the TABLE rather than `core/lib/holidays.ts`, which computes NSW dates
 * from a library. Three rival holiday sources already exist in this codebase
 * and a roster's pay depends on which one is right, so the one an
 * administrator can correct is the one that governs here.
 *
 * `jurisdiction` and `applies_to_state` are both present on the table and say
 * the same thing in different vocabularies; the newer NOT NULL `jurisdiction`
 * is used, and the reconciliation of the two is a separate cleanup.
 */
export async function loadPublicHolidays(
    fromDate: string,
    toDate: string,
    jurisdiction = 'AU-NSW',
): Promise<string[]> {
    const { data, error } = await supabase
        .from('public_holidays')
        .select('holiday_date, jurisdiction')
        .eq('jurisdiction', jurisdiction)
        .gte('holiday_date', fromDate)
        .lte('holiday_date', toDate);

    if (error) throw error;
    return [...new Set((data ?? []).map(r => String(r.holiday_date)))].sort();
}
