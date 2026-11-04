/**
 * Timesheets Supabase API
 * Fetches shift data with timesheet overlays from Supabase
 */

import { supabase } from '@/platform/supabase/client';
import { assertWrote } from '@/platform/supabase/writes';
import { parseZonedDateTime } from '@/modules/core/lib/date.utils';
import { getShiftDayType } from '@/modules/core/lib/holidays';
import { getDailyToilByDay } from '@/modules/toil/api/toil.api';
import { isSecurityRoleName } from '@/modules/compliance/security-role';
import type { ScheduledBreakItem } from '@/modules/compliance/shape/types';
import type { TimesheetBreakItem } from '@/modules/rosters/domain/shift.entity';
import {
    snapToQuarterHour,
    isShiftFinished,
    resolveBillableSide,
    calculateNetMinutes,
    applyMinEngagementFloor,
} from '../domain/billable-time';

// Re-exported for existing external consumers (AttendancePage.tsx et al.) —
// the canonical implementation now lives in ../domain/billable-time.


export interface TimesheetShiftRow {
    id: string;
    shiftId: string;
    timesheetId: string | null;
    billableId: string | null;

    // Employee info
    employeeId: string | null;
    employeeName: string;

    // Organizational hierarchy
    organizationId: string | null;
    organizationName: string;
    departmentId: string;
    departmentName: string;
    subDepartmentId: string;
    subDepartmentName: string;

    // Group info
    groupType: string | null;
    subGroupName: string | null;

    // Role & Remuneration
    roleId: string | null;
    roleName: string;
    remunerationLevelId: string | null;
    remunerationLevel: string;
    /** The shift's stored level as a number (0 = Introductory). */
    remunerationLevelNumber: number | null;

    // Scheduled times
    shiftDate: string;
    scheduledStart: string;
    scheduledEnd: string;

    // Actual/Clock times (from timesheet if exists)
    clockIn: string | null;
    clockOut: string | null;

    // Adjusted times (manager edits)
    adjustedStart: string | null;
    adjustedEnd: string | null;
    adjustedStartSource: 'manual' | 'snapped' | 'auto' | null;
    adjustedEndSource: 'manual' | 'snapped' | 'auto' | null;
    isAdjustedManual: boolean;

    // Breaks
    paidBreakMinutes: number;
    unpaidBreakMinutes: number;
    paidBreak: string;
    unpaidBreak: string;
    unpaidBreakIsManual?: boolean;
    actualUnpaidBreakMinutes?: number | null;
    hasOpenBreak?: boolean;
    timesheetBreaks?: TimesheetBreakItem[];
    unpaidBreaks?: ScheduledBreakItem[] | null;
    rosteredBreakStart: string | null;
    rosteredBreakEnd: string | null;
    actualBreakStart: string | null;
    actualBreakEnd: string | null;
    breakVarianceMinutes: number | null;
    hasBreakVarianceFlag: boolean;

    // Calculated
    scheduledLengthMinutes: number;
    netLengthMinutes: number;
    /** True when netLengthMinutes was raised to the EBA minimum-engagement floor. */
    wasToppedUpToMinEngagement: boolean;
    /** The EBA minimum (minutes) that applied, or null when the floor doesn't apply (no-show/cancelled). */
    requiredEngagementMinutes: number | null;
    /** Training-shift flag (drives the 2h EBA tier) — needed downstream for edit-form floor validation. */
    isTraining: boolean;
    /**
     * The employment basis this shift is PAID on — `shifts.target_employment_type`,
     * falling back to `profiles.employment_type` only when the shift has none.
     * Feeds the min-engagement floor and the pay-estimate calls.
     *
     * NOT simply the profile scalar: a person holding both a Full-Time and a
     * Casual contract has one profile value and differently-paid shifts, and
     * pricing their casual shift off the profile drops the 25% casual loading.
     */
    employmentType: string | null;
    /** Role name (lowercased) includes 'security' — selects the Security Sch 3 floor tiers. */
    isSecurityRole: boolean;

    // Status
    shiftStatus: string;
    lifecycleStatus: string;
    liveStatus: string;
    timesheetStatus: string | null;
    rawStartAt: string | null;
    rawEndAt: string | null;

    // Attendance (from public.timesheets tracks + public.billables)
    attendanceStatus: string | null;
    arrivalTrack: string | null;
    departureTrack: string | null;
    isNoShow: boolean;
    payrollExported: boolean;
    attendanceNote: string | null;
    // Minutes between actual times and scheduled times
    clockInVarianceMinutes: number | null;
    clockOutVarianceMinutes: number | null;
    varianceMinutes: number | null; // Legacy for clock-in

    // Manager notes (override reason on approve / rejection reason)
    notes: string | null;
    rejectedReason: string | null;

    // Audit / concurrency
    editCount: number;           // F7 — manager billable/break edit count (📝 badge)
    version: number | null;      // F18 — optimistic-lock row version at load time

    // Billable variance reasons (per-side; null when on-roster)
    arrivalVarianceReason: string | null;
    departureVarianceReason: string | null;

    /**
     * Time in lieu this approved timesheet's DAY earned under the daily rule
     * (billable over 7.6h), in minutes — 0 when none. Salaried class-1 contracts
     * only; read back from `toil_ledger`, never computed here. A day of several
     * shifts shows the day's figure on each of them. Weekly top-ups are in the
     * TOIL ledger, not on a row.
     */
    toilMinutes: number;
}

export interface TimesheetFilters {
    organizationId?: string | null;
    departmentId?: string | null;
    subDepartmentId?: string | null;
    searchQuery?: string;
    shiftStatus?: string | null;
    timesheetStatus?: string | null;
    roleId?: string | null;
    groupType?: string | null;
    subGroupName?: string | null;
}

/**
 * Fetch shifts for timesheet display
 */

export async function getShiftsForTimesheet(
    startDate: string,
    filters: TimesheetFilters = {},
    endDate?: string
): Promise<TimesheetShiftRow[]> {
    try {
        // Query shifts without the employee join (no FK relationship)
        let query = supabase
            .from('shifts')
            .select(`
                id,
                shift_date,
                start_time,
                end_time,
                start_at,
                end_at,
                assignment_status,
                assignment_outcome,
                lifecycle_status,
                roster_subgroup_id,
                break_start,
                break_end,
                paid_break_minutes,
                unpaid_break_minutes,
                unpaid_breaks,
                net_length_minutes,
                scheduled_length_minutes,
                is_training,
                target_employment_type,
                user_contract_id,
                organization_id,
                department_id,
                sub_department_id,
                role_id,
                assigned_employee_id,
                notes,
                organizations(id, name),
                departments(id, name),
                sub_departments(id, name),
                roles(id, name, remuneration_level),
                roster_subgroups!roster_subgroup_id(name, roster_groups(name, external_id))
            `)
            .gte('shift_date', startDate)
            .lte('shift_date', endDate || startDate)
            .in('lifecycle_status', ['Published', 'InProgress', 'Completed'])
            .order('start_time');

        // Apply filters
        if (filters.organizationId) {
            query = query.eq('organization_id', filters.organizationId);
        }
        if (filters.departmentId) {
            query = query.eq('department_id', filters.departmentId);
        }
        if (filters.subDepartmentId) {
            query = query.eq('sub_department_id', filters.subDepartmentId);
        }
        if (filters.shiftStatus) {
            query = query.eq('assignment_status', filters.shiftStatus as any);
        }
        if (filters.roleId) {
            query = query.eq('role_id', filters.roleId);
        }

        const { data: shifts, error } = await query;

        if (error) {
            console.error('[getShiftsForTimesheet] Error:', error);
            return [];
        }

        if (!shifts || shifts.length === 0) {
            return [];
        }

        let filteredShifts = shifts;
        if (filters.groupType) {
            filteredShifts = shifts.filter((s: any) => {
                const rg = s.roster_subgroups?.roster_groups;
                const extId = rg?.external_id;
                const name = rg?.name?.toLowerCase().replace(/\s+/g, '_');
                return extId === filters.groupType || name === filters.groupType || rg?.name === filters.groupType;
            });
        }

        if (filteredShifts.length === 0) {
            return [];
        }

        // Fetch employees separately (no FK relationship in schema)
        const employeeIds: string[] = Array.from(new Set(filteredShifts.map(s => s.assigned_employee_id).filter((id): id is string => !!id)));
        let employeeMap = new Map<string, { first_name: string; last_name: string; employment_type: string | null }>();

        if (employeeIds.length > 0) {
            const { data: profiles } = await supabase
                .from('profiles')
                .select('id, first_name, last_name, employment_type')
                .in('id', employeeIds);

            if (profiles) {
                employeeMap = new Map(profiles.map(p => [p.id, {
                    first_name: p.first_name || '',
                    last_name: p.last_name || '',
                    employment_type: (p as any).employment_type ?? null,
                }]));
            }
        }

        // Fetch ground-truth attendance actuals (timesheets) and manager verification/payroll (billables) in parallel
        const shiftIds: string[] = filteredShifts.map(s => s.id);
        const [{ data: timesheets }, { data: billables }] = await Promise.all([
            supabase
                .from('timesheets')
                .select('id, shift_id, clock_in, clock_out, arrival_track, departure_track, is_no_show, worker_notes, timesheet_breaks(id, timesheet_id, shift_id, break_seq, break_start, break_end, duration_minutes)')
                .in('shift_id', shiftIds),
            supabase
                .from('billables')
                .select('*')
                .in('shift_id', shiftIds),
        ]);

        const timesheetMap = new Map(
            (timesheets || []).map(t => [t.shift_id, t])
        );
        const billableMap = new Map(
            (billables || []).map(b => [b.shift_id, b])
        );

        // Map to TimesheetShiftRow
        const rows: TimesheetShiftRow[] = filteredShifts.map((shift: any) => {
            const timesheet = timesheetMap.get(shift.id);
            const billable = billableMap.get(shift.id);
            const employee = shift.assigned_employee_id ? employeeMap.get(shift.assigned_employee_id) : null;
            const org = shift.organizations;
            const dept = shift.departments;
            const subDept = shift.sub_departments;
            const role = shift.roles;
            const remLevel = (shift as any).remuneration_levels;

            const employeeName = employee
                ? `${employee.first_name || ''} ${employee.last_name || ''}`.trim()
                : 'Unassigned';

            const scheduledMins = shift.scheduled_length_minutes ||
                calculateMinutes(shift.start_time, shift.end_time);

            const clockIn = timesheet?.clock_in ?? null;
            const clockOut = timesheet?.clock_out ?? null;
            const arrivalTrack = timesheet?.arrival_track ?? null;
            const departureTrack = timesheet?.departure_track ?? null;
            const physicalNoShow = timesheet?.is_no_show === true || shift.assignment_outcome === 'no_show';
            const managerOverrodeNoShow = !!(
                billable &&
                billable.status !== 'no_show' &&
                (billable.billable_start || billable.billable_end)
            );
            const effectiveNoShow = (physicalNoShow || billable?.status === 'no_show') && !managerOverrodeNoShow;
            const derivedAttendanceStatus = effectiveNoShow
                ? 'no_show'
                : arrivalTrack === 'late_in'
                ? 'late'
                : clockIn
                ? 'checked_in'
                : null;

            const rawBreaks = Array.isArray(timesheet?.timesheet_breaks) ? timesheet.timesheet_breaks : [];
            const sortedBreaks: TimesheetBreakItem[] = [...rawBreaks]
                .sort((a: any, b: any) => (a.break_seq ?? 0) - (b.break_seq ?? 0))
                .map((b: any) => ({
                    id: String(b.id),
                    timesheet_id: String(b.timesheet_id),
                    shift_id: String(b.shift_id),
                    break_seq: Number(b.break_seq ?? 1),
                    break_start: String(b.break_start),
                    break_end: b.break_end ? String(b.break_end) : null,
                    duration_minutes:
                        b.duration_minutes !== undefined && b.duration_minutes !== null
                            ? Number(b.duration_minutes)
                            : null,
                }));
            const completedBreaks = sortedBreaks.filter(b => b.break_end && b.duration_minutes !== null);
            const actualUnpaidBreakMinutes = completedBreaks.length > 0
                ? completedBreaks.reduce((acc, b) => acc + (b.duration_minutes ?? 0), 0)
                : null;
            const hasOpenBreak = sortedBreaks.some(b => !b.break_end);

            // Resolve each side ONCE — every field below (net minutes, adjusted
            // start/end, and their source) derives from these two results so the
            // tier logic can't drift between them.
            const finished = isShiftFinished(shift.shift_date, shift.start_time, shift.end_time, clockOut);
            const resolvedStart = resolveBillableSide(billable?.billable_start, clockIn, finished);
            const resolvedEnd = resolveBillableSide(billable?.billable_end, clockOut, finished);

            // Zero-fallback rule: unpaid break derives from billables (if manager edited or DB synced)
            // or from actual completed timesheet_breaks. NEVER falls back to shift.unpaid_break_minutes!
            const unpaidBreakForNet = billable?.unpaid_break_minutes != null
                ? billable.unpaid_break_minutes
                : (actualUnpaidBreakMinutes ?? 0);
            const paidBreakForNet = billable?.paid_break_minutes != null ? billable.paid_break_minutes : (shift.paid_break_minutes || 0);
            const rawNetMins = calculateNetMinutes(resolvedStart, resolvedEnd, unpaidBreakForNet);

            // EBA minimum-engagement floor (F-locked 2026-07-28): only applied
            // once the billable window has actually resolved (rawNetMins !== null)
            // — a missing punch must stay a missing punch, never get floored up to
            // the minimum before a manager fixes it. Automatic, no exemption path.
            // That null-check is ALSO the no-show/cancelled gate: it does NOT
            // additionally key off attendance_status/lifecycle_status, because a
            // manager can legitimately enter a manual billable override on a shift
            // still flagged no-show/cancelled, and that resolved window must still
            // get the floor (see applyMinEngagementFloor's docstring).
            const { isSunday, isPublicHoliday } = getShiftDayType(shift.shift_date);
            const isSecurityRoleForFloor = isSecurityRoleName(role?.name);
            const flooredNet = rawNetMins !== null
                ? applyMinEngagementFloor(rawNetMins, {
                      isTraining: shift.is_training === true,
                      isSunday,
                      isPublicHoliday,
                      // Regex-matched against the raw DB value ('full_time',
                      // 'flexible_part_time', ...) — resolvePaymentMinEngagementMinutes
                      // is tolerant of snake_case, no mapping needed here.
                      employmentType: shift.target_employment_type ?? employee?.employment_type ?? null,
                      isSecurityRole: isSecurityRoleForFloor,
                  })
                : { netMinutes: 0, requiredMins: 0, wasToppedUp: false };
            const calculatedNetMins = flooredNet.netMinutes;

            // ── Variances (drive attendance/performance metrics) ────────────
            // A manually adjusted time OVERRIDES the raw clock for its own side
            // only — mirrors the per-side `*` on the Live Rules badges. Sched-
            // uled fallbacks are venue wall-clock (Sydney), never browser-local.
            const scheduledStartMs = shift.start_at
                ? new Date(shift.start_at).getTime()
                : parseZonedDateTime(shift.shift_date, shift.start_time).getTime();
            const scheduledEndMs = shift.end_at
                ? new Date(shift.end_at).getTime()
                : (() => {
                      const ms = parseZonedDateTime(shift.shift_date, shift.end_time).getTime();
                      return ms <= scheduledStartMs ? ms + 24 * 60 * 60 * 1000 : ms; // overnight
                  })();
            const clockInVariance = (() => {
                const effectiveMs = clockIn ? new Date(clockIn).getTime() : null;
                if (effectiveMs === null) return null;
                return Math.round((effectiveMs - scheduledStartMs) / 60000);
            })();
            const clockOutVariance = (() => {
                const effectiveMs = clockOut ? new Date(clockOut).getTime() : null;
                if (effectiveMs === null) return null;
                return Math.round((effectiveMs - scheduledEndMs) / 60000);
            })();

            return {
                id: shift.id,
                shiftId: shift.id,
                timesheetId: timesheet?.id || null,
                billableId: billable?.id || null,

                employeeId: shift.assigned_employee_id,
                employeeName,

                organizationId: shift.organization_id,
                organizationName: org?.name || '',
                departmentId: shift.department_id,
                departmentName: dept?.name || '',
                subDepartmentId: shift.sub_department_id,
                subDepartmentName: subDept?.name || '',

                // Prefer normalized roster_subgroups join
                groupType: shift.roster_subgroups?.roster_groups?.name ?? null,
                subGroupName: shift.roster_subgroups?.name ?? null,

                roleId: shift.role_id,
                roleName: role?.name || '',
                remunerationLevelId: role?.remuneration_level != null ? role.remuneration_level.toString() : ((shift as any).remuneration_level != null ? (shift as any).remuneration_level.toString() : null),
                remunerationLevel: remLevel?.level_name || (role?.remuneration_level != null ? `Level ${role.remuneration_level}` : ''),
                remunerationLevelNumber: role?.remuneration_level ?? (shift as any).remuneration_level ?? null,

                shiftDate: shift.shift_date,
                scheduledStart: shift.start_time,
                scheduledEnd: shift.end_time,

                // Actual/Clock times
                // Source of truth: ALWAYS public.timesheets.clock_in / clock_out (raw data)
                // We deliberately do NOT fall back to billables adjustments here, as
                // the "Actual" column must preserve the true ground-truth punch history.
                clockIn,
                clockOut,

                // Adjusted times (billable) — resolved once above via resolveBillableSide:
                //   1. Explicit manager edit → billable.billable_start / billable_end (source = 'manual')
                //   2. Snapped actual clock  → snap clock_in/clock_out once finished (source = 'snapped')
                //   3. 'missing' (rendered as null here) once finished with neither —
                //      deliberately NOT filled from the schedule, so a blank cell
                //      keeps signalling "needs manager attention" instead of hiding it.
                adjustedStart: resolvedStart.hhmm,
                adjustedEnd: resolvedEnd.hhmm,
                // Whether the manager has explicitly saved a custom adjusted time
                adjustedStartSource: resolvedStart.source === 'missing' ? null : resolvedStart.source,
                adjustedEndSource: resolvedEnd.source === 'manual'
                    ? 'manual'
                    : (resolvedEnd.source === 'missing' ? null : resolvedEnd.source),
                isAdjustedManual: !!(billable?.billable_start || billable?.billable_end),
                editCount: billable?.edit_count ?? 0,
                version: billable?.version ?? null,
                arrivalVarianceReason: billable?.arrival_variance_reason ?? null,
                departureVarianceReason: billable?.departure_variance_reason ?? null,

                ...(() => {
                    let breakVarianceMinutes: number | null = null;
                    let hasBreakVarianceFlag = false;
                    if (billable?.break_start && shift.break_start) {
                        const aTime = billable.break_start.slice(0, 5);
                        const rTime = shift.break_start.slice(0, 5);
                        const [aH, aM] = aTime.split(':').map(Number);
                        const [rH, rM] = rTime.split(':').map(Number);
                        if (!isNaN(aH) && !isNaN(aM) && !isNaN(rH) && !isNaN(rM)) {
                            let diff = Math.abs((aH * 60 + aM) - (rH * 60 + rM));
                            if (diff > 720) diff = 1440 - diff;
                            breakVarianceMinutes = diff;
                            hasBreakVarianceFlag = diff > 15;
                        }
                    }
                    return {
                        rosteredBreakStart: shift.break_start || null,
                        rosteredBreakEnd: shift.break_end || null,
                        actualBreakStart: billable?.break_start || null,
                        actualBreakEnd: billable?.break_end || null,
                        breakVarianceMinutes,
                        hasBreakVarianceFlag,
                    };
                })(),

                paidBreakMinutes: paidBreakForNet,
                unpaidBreakMinutes: unpaidBreakForNet,
                paidBreak: String(paidBreakForNet),
                unpaidBreak: String(unpaidBreakForNet),
                unpaidBreakIsManual: billable?.unpaid_break_is_manual ?? false,
                actualUnpaidBreakMinutes,
                hasOpenBreak,
                timesheetBreaks: sortedBreaks,
                unpaidBreaks: shift.unpaid_breaks ?? null,
                scheduledLengthMinutes: scheduledMins,
                netLengthMinutes: calculatedNetMins,
                // EBA minimum-engagement top-up (F-locked 2026-07-28): true when
                // `calculatedNetMins` above was raised to the statutory floor
                // because the raw billable window netted less than it.
                wasToppedUpToMinEngagement: flooredNet.wasToppedUp,
                requiredEngagementMinutes: flooredNet.requiredMins || null,
                isTraining: shift.is_training === true,
                employmentType: shift.target_employment_type ?? employee?.employment_type ?? null,
                isSecurityRole: isSecurityRoleForFloor,

                shiftStatus: shift.assignment_status || 'open',
                lifecycleStatus: shift.lifecycle_status || 'scheduled',
                liveStatus: shift.lifecycle_status || 'Scheduled',
                timesheetStatus: billable?.status || (effectiveNoShow ? 'no_show' : null),
                rawStartAt: shift.start_at || null,
                rawEndAt: shift.end_at || null,

                attendanceStatus: derivedAttendanceStatus,
                arrivalTrack,
                departureTrack,
                isNoShow: timesheet?.is_no_show === true,
                payrollExported: billable?.payroll_exported === true,
                attendanceNote: shift.notes || timesheet?.worker_notes || null,
                clockInVarianceMinutes: clockInVariance,
                clockOutVarianceMinutes: clockOutVariance,
                varianceMinutes: clockInVariance, // legacy alias for clock-in variance

                notes: billable?.notes || null,
                rejectedReason: billable?.rejected_reason || null,
                toilMinutes: 0,
            };
        });

        // Time in lieu booked by the database for these days (best-effort: a
        // failed read only hides the badge).
        try {
            const approved = rows.filter(r => r.timesheetStatus === 'approved' && (r.billableId || r.timesheetId) && r.employeeId);
            if (approved.length > 0) {
                const dates = approved.map(r => r.shiftDate).sort();
                const toil = await getDailyToilByDay(
                    approved.map(r => r.employeeId!), dates[0], dates[dates.length - 1]);
                for (const r of approved) {
                    const day = toil.get(`${r.employeeId}:${r.shiftDate}`);
                    const matchedId =
                        (r.billableId && day?.timesheetIds.includes(r.billableId)) ||
                        (r.timesheetId && day?.timesheetIds.includes(r.timesheetId));
                    if (day && day.minutes > 0 && matchedId) r.toilMinutes = day.minutes;
                }
            }
        } catch (e) {
            console.error('[getShiftsForTimesheet] TOIL read failed:', e);
        }

        // Apply search filter client-side (searches name, role, department, sub-group)
        if (filters.searchQuery) {
            const q = filters.searchQuery.toLowerCase();
            return rows.filter(row =>
                row.employeeName.toLowerCase().includes(q) ||
                row.roleName.toLowerCase().includes(q) ||
                row.departmentName.toLowerCase().includes(q) ||
                (row.subGroupName ?? '').toLowerCase().includes(q) ||
                (row.groupType ?? '').toLowerCase().includes(q)
            );
        }

        return rows;
    } catch (error) {
        console.error('[getShiftsForTimesheet] Exception:', error);
        return [];
    }
}

/**
 * Calculate minutes between two HH:MM:SS time strings
 */
function calculateMinutes(start: string, end: string): number {
    if (!start || !end) return 0;

    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);

    const startMins = sh * 60 + sm;
    let endMins = eh * 60 + em;

    // Handle overnight
    if (endMins < startMins) {
        endMins += 24 * 60;
    }

    return endMins - startMins;
}

/** Returns true if value looks like an ISO datetime string (not a plain HH:MM time) */
function isIsoTimestamp(value: string): boolean {
    return value.includes('T') || value.includes(' ') || /^\d{4}-/.test(value);
}

/**
 * Update timesheet entry
 */
/**
 * Thrown when an optimistic-lock CAS fails: the row was changed by someone else
 * since the editor loaded it. Callers should prompt a refresh + review (F18).
 * Only raised when an `expectedVersion` is supplied — bulk/legacy paths that
 * don't pass one keep their prior last-write-wins behaviour.
 */
export class TimesheetConflictError extends Error {
    readonly code = 'TIMESHEET_CONFLICT';
    constructor(public readonly shiftId: string) {
        super('This timesheet was changed by someone else. Refresh and review before saving.');
        this.name = 'TimesheetConflictError';
    }
}

export async function updateTimesheetEntry(
    shiftId: string,
    updates: {
        clockIn?: string;
        clockOut?: string;
        adjustedStart?: string;
        adjustedEnd?: string;
        status?: string;
        notes?: string;
        rejectedReason?: string;
        length?: string;
        netLength?: string;
        paidBreak?: string;
        unpaidBreak?: string;
        actualBreakStart?: string | null;
        actualBreakEnd?: string | null;
        arrivalVarianceReason?: string | null;
        departureVarianceReason?: string | null;
    },
    opts?: { expectedVersion?: number | null; actorId?: string | null }
): Promise<boolean> {
    try {
        // 1. Check if billables row exists for this shift
        const { data: existing } = await (supabase
            .from('billables')
            .select('id, status, billable_start, billable_end, payroll_exported, version, timesheet_id, unpaid_break_minutes')
            .eq('shift_id', shiftId) as any)
            .maybeSingle();

        // Always get shift + ground-truth timesheets details to determine default snapped/scheduled times and no_show status
        const { data: shift } = await supabase
            .from('shifts')
            .select('assignment_outcome, start_time, end_time, shift_date, timesheets(id, clock_in, clock_out, arrival_track, departure_track, is_no_show)')
            .eq('id', shiftId)
            .single();

        const rawTs = (shift as any)?.timesheets;
        const tsRow = Array.isArray(rawTs) ? rawTs[0] ?? null : rawTs ?? null;
        const actualClockIn: string | null = tsRow?.clock_in ?? null;
        const actualClockOut: string | null = tsRow?.clock_out ?? null;
        const isShiftNoShow =
            tsRow?.is_no_show === true ||
            (shift as any)?.assignment_outcome === 'no_show';

        // Every live shift (assigned, not Draft, not cancelled) carries a billable
        // created by trg_sync_timesheets_on_shift_change. No row means the shift
        // is not live, so there is nothing to review.
        if (!existing) {
            console.warn(`[updateTimesheetEntry] No billable for shift ${shiftId} — it is draft, unassigned or cancelled.`);
            return false;
        }

        // Audit H-13: once this shift's payroll has been EXPORTED
        // (billables.payroll_exported), the record is truly terminal —
        // nothing is allowed through here, not even a notes/reason annotation,
        // because those numbers were already paid out; a later clarification
        // belongs in the NEXT pay run, not a silent edit to history.
        const isExported = existing.payroll_exported === true;

        if (isExported) {
            console.warn(`[updateTimesheetEntry] Blocking update for shift ${shiftId} — already exported to payroll.`);
            return false;
        }

        // 2. Safety Guard: If it's already Approved, Rejected, or No-Show
        // Block updates to finalized records, UNLESS manager is editing metrics.
        // A no-show's billable is still the untouched 'draft' row created with the shift.
        let currentStatus = (existing.status || '').toLowerCase();
        if ((!currentStatus || currentStatus === 'draft') && isShiftNoShow) {
            currentStatus = 'no_show';
        }

        const isEditingMetrics =
            updates.adjustedStart !== undefined ||
            updates.adjustedEnd !== undefined ||
            updates.paidBreak !== undefined ||
            updates.unpaidBreak !== undefined ||
            updates.actualBreakStart !== undefined ||
            updates.actualBreakEnd !== undefined;

        // Audit H-12: notes / rejection-reason / variance-reason edits are
        // METADATA, not a pay-affecting change — a manager annotating an
        // approved entry, or fixing a typo in a rejection reason, must not
        // silently no-op while the UI reports "Entry Updated". Allowed
        // through so long as no pay-affecting field rides along and any
        // supplied `status` is unchanged (a real status transition on a
        // finalized record stays blocked below).
        const touchesMetadata =
            updates.notes !== undefined ||
            updates.rejectedReason !== undefined ||
            updates.arrivalVarianceReason !== undefined ||
            updates.departureVarianceReason !== undefined;
        const statusUnchanged = updates.status === undefined || updates.status.toLowerCase() === currentStatus;
        const touchesPayAffecting =
            updates.clockIn !== undefined ||
            updates.clockOut !== undefined ||
            updates.length !== undefined ||
            updates.netLength !== undefined;
        const isMetadataOnlyEdit = touchesMetadata && statusUnchanged && !touchesPayAffecting;

        if (['approved', 'rejected', 'no_show'].includes(currentStatus)) {
            if (!isEditingMetrics && !isMetadataOnlyEdit) {
                // Allow idempotency if the only change is setting the SAME status
                const isStatusOnly = Object.keys(updates).length === 1 && updates.status;
                if (isStatusOnly && updates.status?.toLowerCase() === currentStatus) return true;

                console.warn(`[updateTimesheetEntry] Blocking update for finalized shift ${shiftId} (Current: ${currentStatus})`);
                // H-12: report the block honestly — a silent `true` here made
                // the caller believe a discarded edit had saved.
                return false;
            }
        }

        // If transitioning from a no_show state by editing metrics, clear shift assignment_outcome if set
        if (isEditingMetrics && currentStatus === 'no_show' && (shift as any)?.assignment_outcome === 'no_show') {
            const { error: shiftUpdateErr } = await supabase
                .from('shifts')
                .update({
                    assignment_outcome: null,
                    notes: 'No-Show overridden by manager',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', shiftId);

            if (shiftUpdateErr) {
                console.error('[updateTimesheetEntry] Shift assignment_outcome clearance error:', shiftUpdateErr);
            }
        }

        // 3. Build payload for public.billables (and optional raw punch overrides for public.timesheets)
        const payload: any = {
            updated_at: new Date().toISOString()
        };
        const rawClockPayload: { clock_in?: string; clock_out?: string } = {};

        // clock_in/clock_out are timestamptz on public.timesheets — only set if value is a proper ISO timestamp
        if (updates.clockIn !== undefined && updates.clockIn && isIsoTimestamp(updates.clockIn)) {
            rawClockPayload.clock_in = updates.clockIn;
        }
        if (updates.clockOut !== undefined && updates.clockOut && isIsoTimestamp(updates.clockOut)) {
            rawClockPayload.clock_out = updates.clockOut;
        }

        const validTime = (val: string | undefined): string | null | undefined => {
            if (val === undefined) return undefined;
            if (!val || val === '-' || val === 'NIL' || val.trim() === '') return null;
            if (/^\d{1,2}:\d{2}$/.test(val)) return `${val.padStart(5, '0')}:00`;
            return val;
        };

        const normalizeToHHMM = (timeStr: string | null | undefined): string | null => {
            if (!timeStr || timeStr === '-' || timeStr === 'NIL') return null;
            const match = timeStr.match(/^(\d{1,2}):(\d{2})/);
            if (match) {
                return `${match[1].padStart(2, '0')}:${match[2]}`;
            }
            return null;
        };

        const effectiveClockIn = rawClockPayload.clock_in ?? actualClockIn;
        const effectiveClockOut = rawClockPayload.clock_out ?? actualClockOut;

        if (updates.adjustedStart !== undefined) {
            const adjStart = validTime(updates.adjustedStart);
            const normAdjStart = normalizeToHHMM(adjStart);
            const defaultStart = shift ? normalizeToHHMM(snapToQuarterHour(effectiveClockIn)) : null;

            if (normAdjStart && normAdjStart !== defaultStart) {
                payload.billable_start = adjStart;
            } else {
                payload.billable_start = null;
            }
        }

        if (updates.adjustedEnd !== undefined) {
            const adjEnd = validTime(updates.adjustedEnd);
            const normAdjEnd = normalizeToHHMM(adjEnd);
            const defaultEnd = shift ? normalizeToHHMM(snapToQuarterHour(effectiveClockOut)) : null;

            if (normAdjEnd && normAdjEnd !== defaultEnd) {
                payload.billable_end = adjEnd;
            } else {
                payload.billable_end = null;
            }
        }

        // Reset status to submitted if editing metrics on a finalized billable record
        if (isEditingMetrics && ['approved', 'rejected', 'no_show'].includes(currentStatus)) {
            payload.status = (updates.status || 'submitted').toLowerCase();
        } else if (updates.status !== undefined) {
            payload.status = updates.status.toLowerCase();
        }

        if (updates.notes !== undefined) payload.notes = updates.notes;
        if (updates.rejectedReason !== undefined) payload.rejected_reason = updates.rejectedReason;

        // Billable variance reasons (null clears them when a side is back on-roster)
        if (updates.arrivalVarianceReason !== undefined) payload.arrival_variance_reason = updates.arrivalVarianceReason || null;
        if (updates.departureVarianceReason !== undefined) payload.departure_variance_reason = updates.departureVarianceReason || null;

        // Breaks (minutes and window on public.billables)
        if (updates.paidBreak !== undefined) payload.paid_break_minutes = parseInt(updates.paidBreak, 10) || 0;
        // The editor always sends the break it displayed (billable value, else 0).
        // Only a CHANGED value is a manager override; re-sending the displayed
        // one must not freeze the break against later timesheet_breaks syncs.
        if (updates.unpaidBreak !== undefined) {
            const unpaidBreakMinutes = parseInt(updates.unpaidBreak, 10) || 0;
            if (unpaidBreakMinutes !== (existing.unpaid_break_minutes ?? 0)) {
                payload.unpaid_break_minutes = unpaidBreakMinutes;
                payload.unpaid_break_is_manual = true;
            }
        }
        if (updates.actualBreakStart !== undefined) payload.break_start = updates.actualBreakStart || null;
        if (updates.actualBreakEnd !== undefined) payload.break_end = updates.actualBreakEnd || null;

        // NOTE: gross_length_minutes / net_length_minutes on public.billables are
        // maintained automatically by the DB BEFORE trigger fn_billable_defaults_and_lengths().
        // updates.length / updates.netLength from the UI form are intentionally ignored.

        // 4. Completeness guard: refuse to move a FINISHED shift to 'approved'
        // while either side of the billable window is still unresolved (no
        // manager edit AND no actual clock time — e.g. a forgotten clock-out).
        // Approving it anyway used to let the payroll adapter silently price
        // the missing side from the SCHEDULED time with no record that the
        // clock-out never happened. This is the one place that must catch it —
        // downstream pricing trusts an 'approved' status to mean real hours.
        if (payload.status === 'approved') {
            const finishedForApproval = isShiftFinished(
                shift?.shift_date ?? '', shift?.start_time ?? '', shift?.end_time ?? '', effectiveClockOut,
            );
            const existingManualStart = existing?.billable_start ?? (existing as any)?.start_time ?? null;
            const existingManualEnd = existing?.billable_end ?? (existing as any)?.end_time ?? null;
            const effectiveManualStart = payload.billable_start !== undefined ? payload.billable_start : existingManualStart;
            const effectiveManualEnd = payload.billable_end !== undefined ? payload.billable_end : existingManualEnd;
            const approvalStart = resolveBillableSide(effectiveManualStart, effectiveClockIn, finishedForApproval);
            const approvalEnd = resolveBillableSide(effectiveManualEnd, effectiveClockOut, finishedForApproval);

            if (approvalStart.source === 'missing' || approvalEnd.source === 'missing') {
                console.error(
                    `[updateTimesheetEntry] Refusing to approve shift ${shiftId}: missing ` +
                    `${approvalStart.source === 'missing' ? 'clock-in' : 'clock-out'} time. ` +
                    `Enter an adjusted time before approving.`,
                );
                return false;
            }
        }

        // Stamp who/when on a manual approval; clear the stamps on a reopen. The
        // auto-verify RPC already stamps these for bot approvals — manual ones
        // used to leave approved_at/approved_by NULL, blinding payroll/reporting
        // to who signed off and when.
        if (payload.status === 'approved') {
            payload.approved_at = new Date().toISOString();
            if (opts?.actorId) payload.approved_by = opts.actorId;
        } else if (payload.status === 'submitted' || payload.status === 'draft') {
            payload.approved_at = null;
            payload.approved_by = null;
        }

        // If raw ISO punch edits were explicitly passed, persist them to public.timesheets
        if (rawClockPayload.clock_in || rawClockPayload.clock_out) {
            const { data: shiftMeta } = await supabase
                .from('shifts')
                .select('assigned_employee_id, organization_id')
                .eq('id', shiftId)
                .single();
            if (shiftMeta?.assigned_employee_id && shiftMeta?.organization_id) {
                const { data: upsertedTs } = await supabase
                    .from('timesheets')
                    .upsert({
                        shift_id: shiftId,
                        employee_id: shiftMeta.assigned_employee_id,
                        organization_id: shiftMeta.organization_id,
                        ...rawClockPayload,
                        source: 'manager_override',
                        updated_at: new Date().toISOString(),
                    }, { onConflict: 'shift_id' })
                    .select('id')
                    .single();
                if (upsertedTs?.id && !existing.timesheet_id) {
                    payload.timesheet_id = upsertedTs.id;
                }
            }
        }

        // Optimistic-lock bump alongside the CAS guard below.
        // fn_billable_defaults_and_lengths() only auto-increments when
        // NEW.version IS NOT DISTINCT FROM OLD.version, so setting
        // expectedVersion + 1 here lands cleanly on expectedVersion + 1.
        if (opts?.expectedVersion != null) {
            payload.version = opts.expectedVersion + 1;
        }
        // Update existing billables row — with an optimistic-lock CAS when the caller passed
        // the version it loaded. A stale version matches zero rows (no error),
        // which we surface as a conflict instead of clobbering the newer row.
        let updateQuery = supabase
            .from('billables')
            .update(payload)
            .eq('id', existing.id);
        if (opts?.expectedVersion != null) {
            updateQuery = updateQuery.eq('version', opts.expectedVersion);
        }
        const { data: updatedRows, error } = await updateQuery.select('id');

        if (error) throw error;
        if (opts?.expectedVersion != null && (!updatedRows || updatedRows.length === 0)) {
            throw new TimesheetConflictError(shiftId);
        }
        // Without a version, zero rows means row-level security refused the
        // caller (timesheet.approve where the shift sits) — it must not read
        // as saved. The catch below turns it into the honest `false`.
        assertWrote({ error, data: updatedRows }, 'change this timesheet');

        // Cleanup: If approved, mark shift as Completed
        if (updates.status === 'approved') {
            const { data: shiftData } = await supabase
                .from('shifts')
                .select('lifecycle_status')
                .eq('id', shiftId)
                .single();

            if (shiftData && !['Completed', 'Cancelled', 'Draft'].includes(shiftData.lifecycle_status)) {
                await supabase
                    .from('shifts')
                    .update({ lifecycle_status: 'Completed', updated_at: new Date().toISOString() })
                    .eq('id', shiftId);
            }
        }

        return true;
    } catch (error) {
        if (error instanceof TimesheetConflictError) throw error;  // let the caller prompt a refresh
        console.error('[updateTimesheetEntry] Error:', error);
        return false;
    }
}

/**
 * Bulk approve timesheets
 */
/**
 * AUDIT FIX M-14: bulk approve/reject previously called `updateTimesheetEntry`
 * with no `expectedVersion` at all, which deliberately skips the optimistic-
 * lock CAS (the "legacy/bulk path" the single-row F18 fix carved out) — so a
 * bulk action could silently clobber a concurrent single-row edit by another
 * manager with no conflict signal. `expectedVersions` is optional and keyed
 * by shiftId; when supplied (the live TimesheetPage caller now does), each
 * row gets the SAME CAS protection single-row edits already have. Omitting it
 * preserves the exact prior last-write-wins behaviour for any other caller.
 */
export async function bulkUpdateTimesheetStatus(
    ids: string[],
    userId: string,
    status: 'approved' | 'rejected',
    expectedVersions?: Record<string, number | null | undefined>,
): Promise<{ success: number; failed: number; conflicted: number }> {
    let success = 0;
    let failed = 0;
    let conflicted = 0;

    for (const shiftId of ids) {
        try {
            const result = await updateTimesheetEntry(shiftId, {
                status,
                notes: `Bulk ${status} by manager`,
                // Bulk reject still records a reason (single-row reject requires one),
                // so the employee always sees WHY a timesheet was rejected.
                ...(status === 'rejected' ? { rejectedReason: 'Bulk rejected by manager' } : {}),
            }, { actorId: userId, expectedVersion: expectedVersions?.[shiftId] ?? null });

            if (result) {
                success++;
            } else {
                failed++;
            }
        } catch (err) {
            if (err instanceof TimesheetConflictError) {
                conflicted++;
            } else {
                failed++;
            }
        }
    }

    return { success, failed, conflicted };
}

/**
 * Mark a shift as No-Show
 */
export async function markShiftAsNoShow(
    shiftId: string,
    userId: string
): Promise<boolean> {
    try {
        const nowIso = new Date().toISOString();

        // Update shift assignment_outcome + lifecycle_status
        const { data: updatedShifts, error: shiftError } = await supabase
            .from('shifts')
            .update({
                assignment_outcome: 'no_show',
                lifecycle_status: 'Completed',
                updated_at: nowIso,
                last_modified_by: userId
            })
            .eq('id', shiftId)
            .select('id, assigned_employee_id, organization_id');

        if (shiftError) {
            console.error('[markShiftAsNoShow] Shift error:', shiftError);
            return false;
        }
        // Zero rows: row-level security refused the caller. Not a no-show.
        if (!updatedShifts || updatedShifts.length === 0) {
            console.error('[markShiftAsNoShow] Refused: no shift updated (outside the caller\'s access?)', shiftId);
            return false;
        }

        const markedShift = updatedShifts[0];
        if (markedShift.assigned_employee_id && markedShift.organization_id) {
            const { data: existingTs } = await supabase
                .from('timesheets')
                .select('id, clock_in, clock_out')
                .eq('shift_id', shiftId)
                .maybeSingle();

            if (!existingTs || (!existingTs.clock_in && !existingTs.clock_out)) {
                await supabase
                    .from('timesheets')
                    .upsert({
                        shift_id: shiftId,
                        employee_id: markedShift.assigned_employee_id,
                        organization_id: markedShift.organization_id,
                        arrival_track: 'missing',
                        departure_track: 'missing',
                        source: 'manager_no_show',
                        updated_at: nowIso,
                    }, { onConflict: 'shift_id' });
            }
        }

        // Ensure a billables row exists at status 'no_show'.
        const billableOk = await updateTimesheetEntry(shiftId, {
            status: 'no_show',
            notes: 'Marked as No-Show by manager',
        }, { actorId: userId });
        if (!billableOk) {
            console.warn(`[markShiftAsNoShow] shift ${shiftId} marked no-show, but its billables row could not be written.`);
        }

        return true;
    } catch (error) {
        console.error('[markShiftAsNoShow] Error:', error);
        return false;
    }
}
