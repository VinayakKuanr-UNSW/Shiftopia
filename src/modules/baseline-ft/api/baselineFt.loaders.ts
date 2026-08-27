/**
 * Baseline FT — reading the world.
 *
 * Every function here is READ-ONLY. Generation must not touch a live shift, so
 * the write path is confined entirely to `baselineFt.commands.ts#applyRun`.
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
import { isoWeekdayOf } from '../domain/requirementCalculator';
import type { SnapshotShiftRef } from './digest';
import type {
    BaselinePattern,
    EmployeeContractFacts,
    ExistingShift,
    Finding,
    IsoWeekday,
    LeaveDay,
    PatternSlot,
} from '../domain/types';

/* ────────────────────────────────────────────────────────────────────────────
   Pattern
   ──────────────────────────────────────────────────────────────────────────── */

export interface PatternLoad {
    pattern: BaselinePattern | null;
    findings: Finding[];
    /** Raw slot rows, fed to `inputDigest` so a template edit changes the digest. */
    rawSlots: Array<Record<string, unknown>>;
}

/** Minutes between two `HH:mm[:ss]` times, wrapping past midnight. */
function grossMinutes(start: string, end: string): number {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const s = sh * 60 + sm;
    let e = eh * 60 + em;
    if (e <= s) e += 1440;
    return e - s;
}

/**
 * Load a template as a baseline pattern.
 *
 * `template_shifts` has no `sub_department_id` — it lives on the template — so
 * one template is one sub-department, and that is read from the parent rather
 * than assumed per row.
 */
export async function loadPattern(templateId: string): Promise<PatternLoad> {
    const findings: Finding[] = [];

    const { data: tpl, error: tplErr } = await supabase
        .from('roster_templates')
        .select('id, sub_department_id, department_id, organization_id, name, is_active')
        .eq('id', templateId)
        .single();

    if (tplErr || !tpl) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_TEMPLATE_NOT_FOUND',
            plain: 'That template could not be read. It may have been deleted.',
            overridable: false,
            calculation: { template_id: templateId, error: tplErr?.message },
        });
        return { pattern: null, findings, rawSlots: [] };
    }

    if (!tpl.sub_department_id) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_TEMPLATE_NO_SUB_DEPARTMENT',
            plain:
                `"${tpl.name}" is not tied to a sub-department, so there is no team to generate ` +
                `a baseline for. Set its sub-department first.`,
            overridable: false,
            calculation: { template_id: templateId },
        });
        return { pattern: null, findings, rawSlots: [] };
    }

    // groups -> subgroups -> shifts. Nested rather than three round trips so
    // the shape cannot half-load.
    const { data: groups, error: grpErr } = await supabase
        .from('template_groups')
        .select(`
            id,
            template_subgroups (
                id,
                template_shifts (
                    id, role_id, start_time, end_time,
                    unpaid_break_minutes, paid_break_minutes, net_length_hours,
                    day_of_week, sort_order, target_employment_type, target_requires_flexible
                )
            )
        `)
        .eq('template_id', templateId);

    if (grpErr) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_TEMPLATE_READ_FAILED',
            plain: 'The template\'s shifts could not be read.',
            overridable: false,
            calculation: { template_id: templateId, error: grpErr.message },
        });
        return { pattern: null, findings, rawSlots: [] };
    }

    const rawSlots: Array<Record<string, unknown>> = [];
    const slots: PatternSlot[] = [];
    let missingWeekday = 0;
    let nonFtTarget = 0;

    for (const g of groups ?? []) {
        for (const sg of ((g as never as { template_subgroups?: unknown[] }).template_subgroups ?? [])) {
            const shifts = (sg as { template_shifts?: Record<string, unknown>[] }).template_shifts ?? [];
            for (const row of shifts) {
                rawSlots.push(row);

                if (row.day_of_week === null || row.day_of_week === undefined) {
                    missingWeekday++;
                    continue;
                }
                if (row.target_employment_type !== 'FT') {
                    nonFtTarget++;
                    continue;
                }

                const start = String(row.start_time ?? '').slice(0, 5);
                const end = String(row.end_time ?? '').slice(0, 5);
                if (!start || !end) continue;

                const unpaid = Number(row.unpaid_break_minutes ?? 0);
                const paid = Number(row.paid_break_minutes ?? 0);

                slots.push({
                    templateShiftId: String(row.id),
                    // `day_of_week` is stored 0-6 with 0 = Sunday, matching
                    // JavaScript. The domain speaks ISO (1 = Monday), because
                    // every cycle boundary is anchored to a Monday. Converting
                    // here keeps that translation in exactly one place.
                    dayOfWeek: (Number(row.day_of_week) === 0 ? 7 : Number(row.day_of_week)) as IsoWeekday,
                    startTime: start,
                    endTime: end,
                    unpaidBreakMinutes: unpaid,
                    paidBreakMinutes: paid,
                    netMinutes: grossMinutes(start, end) - unpaid,
                    roleId: String(row.role_id ?? ''),
                    sortOrder: Number(row.sort_order ?? 0),
                });
            }
        }
    }

    if (missingWeekday > 0) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_PATTERN_NO_WEEKDAY',
            plain:
                `${missingWeekday} shift(s) in "${tpl.name}" have no day of the week set, so the ` +
                `template describes shift shapes but not a weekly pattern. Set a day on each ` +
                `shift before using it as a baseline.`,
            overridable: false,
            calculation: { template_id: templateId, shifts_without_weekday: missingWeekday },
        });
    }

    if (nonFtTarget > 0) {
        findings.push({
            severity: 'WARNING',
            code: 'BFT_PATTERN_NON_FT_SHIFTS_IGNORED',
            plain:
                `${nonFtTarget} shift(s) in "${tpl.name}" target part-time or casual staff and are ` +
                `not part of the full-time baseline. They have been ignored.`,
            overridable: true,
            calculation: { ignored_count: nonFtTarget },
        });
    }

    return {
        pattern: {
            templateId,
            subDepartmentId: String(tpl.sub_department_id),
            slots,
        },
        findings,
        rawSlots,
    };
}

/* ────────────────────────────────────────────────────────────────────────────
   Eligible employees
   ──────────────────────────────────────────────────────────────────────────── */

export interface EligibleEmployee {
    facts: EmployeeContractFacts;
    name: string;
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
        supabase.from('profiles').select('id, full_name').in('id', userIds),
        supabase.from('roles').select('id, name'),
    ]);

    const nameById = new Map((profiles ?? []).map(p => [String(p.id), String(p.full_name ?? '')]));
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
            cycleWeeks: c.ordinary_hours_cycle_weeks as number | null,
            cycleAnchor: c.ordinary_hours_cycle_anchor as string | null,
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
 */
export async function loadLeaveDays(
    employeeIds: readonly string[],
    fromDate: string,
    toDate: string,
    /**
     * Net ordinary hours the pattern rosters on each weekday.
     *
     * A leave day discharges the hours it displaces, so the measure is the
     * PATTERN's own shape for that weekday — cl 44.7 pays "the Team Member's
     * ordinary hours of work in the period", not a weekly average. Leave
     * falling on a day the pattern does not work discharges nothing, which is
     * correct: there was no obligation there to discharge.
     */
    patternHoursByWeekday: ReadonlyMap<IsoWeekday, number>,
): Promise<Map<string, LeaveDay[]>> {
    const out = new Map<string, LeaveDay[]>();
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
            const day: LeaveDay = {
                date,
                leaveType,
                credit,
                creditHours: patternHoursByWeekday.get(isoWeekdayOf(date)) ?? 0,
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
