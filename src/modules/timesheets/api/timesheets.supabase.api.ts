/**
 * Timesheets Supabase API
 * Fetches shift data with timesheet overlays from Supabase
 */

import { supabase } from '@/platform/supabase/client';
import { parseZonedDateTime, formatInTimezone, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { getShiftDayType } from '@/modules/core/lib/holidays';
import { isSecurityRoleName } from '@/modules/compliance/security-role';
import {
    snapToQuarterHour,
    isShiftFinished,
    resolveBillableSide,
    calculateNetMinutes,
    applyMinEngagementFloor,
} from '../domain/billable-time';

// Re-exported for existing external consumers (AttendancePage.tsx et al.) —
// the canonical implementation now lives in ../domain/billable-time.
export { snapToQuarterHour, isShiftFinished };


export interface TimesheetShiftRow {
    id: string;
    shiftId: string;
    timesheetId: string | null;

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

    // Attendance (from shifts table)
    attendanceStatus: string | null;
    attendanceNote: string | null;
    // Minutes between actual times and scheduled times
    clockInVarianceMinutes: number | null;
    clockOutVarianceMinutes: number | null;
    varianceMinutes: number | null; // Legacy for clock-in

    // Pay
    hourlyRate: number | null;
    estimatedPay: number | null;

    // Manager notes (override reason on approve / rejection reason)
    notes: string | null;
    rejectedReason: string | null;

    // Audit / concurrency
    editCount: number;           // F7 — manager billable/break edit count (📝 badge)
    version: number | null;      // F18 — optimistic-lock row version at load time

    // Billable variance reasons (per-side; null when on-roster)
    arrivalVarianceReason: string | null;
    departureVarianceReason: string | null;
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
                lifecycle_status,
                attendance_status,
                actual_start,
                actual_end,
                attendance_note,
                group_type,
                sub_group_name,
                roster_subgroup_id,
                paid_break_minutes,
                unpaid_break_minutes,
                net_length_minutes,
                scheduled_length_minutes,
                remuneration_rate,
                is_training,
                target_employment_type,
                organization_id,
                department_id,
                sub_department_id,
                role_id,
                remuneration_level,
                assigned_employee_id,
                organizations(id, name),
                departments(id, name),
                sub_departments(id, name),
                roles(id, name),
                remuneration_levels(level_number, level_name, hourly_rate_min),
                roster_subgroups!roster_subgroup_id(name, roster_groups(name))
            `)
            .gte('shift_date', startDate)
            .lte('shift_date', endDate || startDate)
            .in('lifecycle_status', ['Published', 'InProgress', 'Completed'])
            .is('deleted_at', null)
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
        if (filters.groupType) {
            query = query.eq('group_type', filters.groupType as any);
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

        // Fetch employees separately (no FK relationship in schema)
        const employeeIds: string[] = Array.from(new Set(shifts.map(s => s.assigned_employee_id).filter((id): id is string => !!id)));
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

        // Fetch timesheets for these shifts
        const shiftIds: string[] = shifts.map(s => s.id);
        const { data: timesheets } = await supabase
            .from('timesheets')
            .select('*')
            .in('shift_id', shiftIds);

        const timesheetMap = new Map(
            (timesheets || []).map(t => [t.shift_id, t])
        );

        // Map to TimesheetShiftRow
        const rows: TimesheetShiftRow[] = shifts.map((shift: any) => {
            const timesheet = timesheetMap.get(shift.id);
            const employee = shift.assigned_employee_id ? employeeMap.get(shift.assigned_employee_id) : null;
            const org = shift.organizations;
            const dept = shift.departments;
            const subDept = shift.sub_departments;
            const role = shift.roles;
            const remLevel = shift.remuneration_levels;

            const employeeName = employee
                ? `${employee.first_name || ''} ${employee.last_name || ''}`.trim()
                : 'Unassigned';

            const scheduledMins = shift.scheduled_length_minutes ||
                calculateMinutes(shift.start_time, shift.end_time);
            const netMins = shift.net_length_minutes ||
                (scheduledMins - (shift.unpaid_break_minutes || 0));

            const hourlyRate = remLevel?.hourly_rate_min || shift.remuneration_rate || 0;

            // Resolve each side ONCE — every field below (net minutes, adjusted
            // start/end, and their source) derives from these two results so the
            // tier logic can't drift between them.
            const finished = isShiftFinished(shift.shift_date, shift.start_time, shift.end_time, shift.actual_end);
            const resolvedStart = resolveBillableSide(timesheet?.start_time, shift.actual_start, finished);
            const resolvedEnd = resolveBillableSide(timesheet?.end_time, shift.actual_end, finished);
            const unpaidBreakForNet = timesheet?.unpaid_break_minutes !== undefined ? timesheet.unpaid_break_minutes : (shift.unpaid_break_minutes || 0);
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

            const currentEstimatedPay = (calculatedNetMins / 60) * hourlyRate;

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
                const effectiveMs = shift.actual_start ? new Date(shift.actual_start).getTime() : null;
                if (effectiveMs === null) return null;
                return Math.round((effectiveMs - scheduledStartMs) / 60000);
            })();
            const clockOutVariance = (() => {
                const effectiveMs = shift.actual_end ? new Date(shift.actual_end).getTime() : null;
                if (effectiveMs === null) return null;
                return Math.round((effectiveMs - scheduledEndMs) / 60000);
            })();

            return {
                id: shift.id,
                shiftId: shift.id,
                timesheetId: timesheet?.id || null,

                employeeId: shift.assigned_employee_id,
                employeeName,

                organizationId: shift.organization_id,
                organizationName: org?.name || '',
                departmentId: shift.department_id,
                departmentName: dept?.name || '',
                subDepartmentId: shift.sub_department_id,
                subDepartmentName: subDept?.name || '',

                // Prefer normalized roster_subgroups join; fall back to legacy columns
                groupType: shift.roster_subgroups?.roster_groups?.name ?? shift.group_type ?? null,
                subGroupName: shift.roster_subgroups?.name ?? shift.sub_group_name ?? null,

                roleId: shift.role_id,
                roleName: role?.name || '',
                remunerationLevelId: shift.remuneration_level ? shift.remuneration_level.toString() : null,
                remunerationLevel: remLevel?.level_name || '',

                shiftDate: shift.shift_date,
                scheduledStart: shift.start_time,
                scheduledEnd: shift.end_time,

                // Actual/Clock times
                // Source of truth: ALWAYS shift.actual_start / actual_end (raw data)
                // We deliberately do NOT fall back to timesheet adjustments here, as 
                // the "Actual" column must preserve the true history record.
                clockIn: shift.actual_start ?? null,
                clockOut: shift.actual_end ?? null,

                // Adjusted times (billable) — resolved once above via resolveBillableSide:
                //   1. Explicit manager edit → timesheet.start_time / end_time  (source = 'manual')
                //   2. Snapped actual clock  → snap actual_start/end once finished (source = 'snapped')
                //   3. 'missing' (rendered as null here) once finished with neither —
                //      deliberately NOT filled from the schedule, so a blank cell
                //      keeps signalling "needs manager attention" instead of hiding it.
                adjustedStart: resolvedStart.hhmm,
                adjustedEnd: resolvedEnd.hhmm,
                // Whether the manager has explicitly saved a custom adjusted time
                adjustedStartSource: resolvedStart.source === 'missing' ? null : resolvedStart.source,
                // An auto clock-out owns the OUT side (unless a manager overrode it):
                // mark it 'auto' so the billable end carries the 🤖 marker instead of
                // a bare '-'. The IN side is a real clock-in, so it's left as-is.
                adjustedEndSource: resolvedEnd.source === 'manual'
                    ? 'manual'
                    : (resolvedEnd.source === 'missing' ? null : resolvedEnd.source),
                isAdjustedManual: !!(timesheet?.start_time || timesheet?.end_time),
                editCount: (timesheet as any)?.edit_count ?? 0,
                version: (timesheet as any)?.version ?? null,
                arrivalVarianceReason: (timesheet as any)?.arrival_variance_reason ?? null,
                departureVarianceReason: (timesheet as any)?.departure_variance_reason ?? null,

                paidBreakMinutes: timesheet?.paid_break_minutes !== undefined ? timesheet.paid_break_minutes : (shift.paid_break_minutes || 0),
                unpaidBreakMinutes: timesheet?.unpaid_break_minutes !== undefined ? timesheet.unpaid_break_minutes : (shift.unpaid_break_minutes || 0),
                paidBreak: String(timesheet?.paid_break_minutes !== undefined ? timesheet.paid_break_minutes : (shift.paid_break_minutes || 0)),
                unpaidBreak: String(timesheet?.unpaid_break_minutes !== undefined ? timesheet.unpaid_break_minutes : (shift.unpaid_break_minutes || 0)),
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
                timesheetStatus: timesheet?.status || null,
                rawStartAt: shift.start_at || null,
                rawEndAt: shift.end_at || null,

                attendanceStatus: shift.attendance_status || null,
                attendanceNote: shift.attendance_note || null,
                clockInVarianceMinutes: clockInVariance,
                clockOutVarianceMinutes: clockOutVariance,
                varianceMinutes: clockInVariance, // legacy alias for clock-in variance

                hourlyRate,
                estimatedPay: Math.round(currentEstimatedPay * 100) / 100,

                notes: timesheet?.notes || null,
                rejectedReason: timesheet?.rejected_reason || null,
            };
        });

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

    let startMins = sh * 60 + sm;
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
        approximatePay?: string;
        paidBreak?: string;
        unpaidBreak?: string;
        arrivalVarianceReason?: string | null;
        departureVarianceReason?: string | null;
    },
    opts?: { expectedVersion?: number | null; actorId?: string | null }
): Promise<boolean> {
    try {
        // 1. Check if timesheet exists
        const { data: existing } = await (supabase
            .from('timesheets')
            .select('id, status, start_time, end_time')
            .eq('shift_id', shiftId) as any)
            .maybeSingle();

        // Always get shift details to determine default snapped/scheduled times and handle no_show status
        const { data: shift } = await supabase
            .from('shifts')
            .select('attendance_status, start_time, end_time, actual_start, actual_end, shift_date, payroll_exported')
            .eq('id', shiftId)
            .single();

        // Audit H-13: once this shift's payroll has been EXPORTED
        // (shifts.payroll_exported), the record is truly terminal — this is the
        // real mechanism the vestigial in-memory API's 'LOCKED' status was
        // standing in for, now backed by the live schema (shifts.payroll_exported
        // → synced to shift_payroll_records by the DB trigger
        // _sync_payroll_record). Nothing is allowed through here — not even a
        // notes/reason annotation — because those numbers were already paid
        // out; a later clarification belongs in the NEXT pay run, not a silent
        // edit to history.
        if (shift?.payroll_exported) {
            console.warn(`[updateTimesheetEntry] Blocking update for shift ${shiftId} — already exported to payroll.`);
            return false;
        }

        // 2. Safety Guard: If it's already Approved, Rejected, or No-Show
        // Block updates to finalized records, UNLESS manager is editing metrics.
        let currentStatus = (existing?.status || '').toLowerCase();
        if (!currentStatus && shift?.attendance_status === 'no_show') {
            currentStatus = 'no_show';
        }

        const isEditingMetrics =
            updates.adjustedStart !== undefined ||
            updates.adjustedEnd !== undefined ||
            updates.paidBreak !== undefined ||
            updates.unpaidBreak !== undefined;

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
            updates.netLength !== undefined ||
            updates.approximatePay !== undefined;
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

        // If transitioning from a no_show state by editing metrics, clear the shift no_show status
        if (isEditingMetrics && currentStatus === 'no_show') {
            const { error: shiftUpdateErr } = await supabase
                .from('shifts')
                .update({
                    attendance_status: null as any,
                    attendance_note: 'No-Show overridden by manager',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', shiftId);

            if (shiftUpdateErr) {
                console.error('[updateTimesheetEntry] Shift attendance status clearance error:', shiftUpdateErr);
            }
        }

        // 3. Build payload
        const payload: any = {
            updated_at: new Date().toISOString()
        };

        // clock_in/clock_out are timestamptz — only set if value is a proper ISO timestamp
        if (updates.clockIn !== undefined && updates.clockIn && isIsoTimestamp(updates.clockIn)) {
            payload.clock_in = updates.clockIn;
        }
        if (updates.clockOut !== undefined && updates.clockOut && isIsoTimestamp(updates.clockOut)) {
            payload.clock_out = updates.clockOut;
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

        if (updates.adjustedStart !== undefined) {
            const adjStart = validTime(updates.adjustedStart);
            const normAdjStart = normalizeToHHMM(adjStart);
            const defaultStart = shift ? normalizeToHHMM(snapToQuarterHour(shift.actual_start)) : null;

            if (normAdjStart && normAdjStart !== defaultStart) {
                payload.start_time = adjStart;
            } else {
                payload.start_time = null;
            }
        }

        if (updates.adjustedEnd !== undefined) {
            const adjEnd = validTime(updates.adjustedEnd);
            const normAdjEnd = normalizeToHHMM(adjEnd);
            const defaultEnd = shift ? normalizeToHHMM(snapToQuarterHour(shift.actual_end)) : null;

            if (normAdjEnd && normAdjEnd !== defaultEnd) {
                payload.end_time = adjEnd;
            } else {
                payload.end_time = null;
            }
        }

        // Reset status to submitted if editing metrics on a finalized timesheet
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

        // Breaks (minutes)
        if (updates.paidBreak !== undefined) payload.paid_break_minutes = parseInt(updates.paidBreak, 10) || 0;
        if (updates.unpaidBreak !== undefined) payload.unpaid_break_minutes = parseInt(updates.unpaidBreak, 10) || 0;
        
        // NOTE: Length / Net / Pay are DERIVED on read (billable minutes × rate);
        // the `timesheets` table has NO length/net_length/approximate_pay columns,
        // so writing them 400s (PGRST204) and fails the whole save. The
        // updates.length/netLength/approximatePay fields are intentionally ignored.

        // 4. Completeness guard: refuse to move a FINISHED shift to 'approved'
        // while either side of the billable window is still unresolved (no
        // manager edit AND no actual clock time — e.g. a forgotten clock-out).
        // Approving it anyway used to let the payroll adapter silently price
        // the missing side from the SCHEDULED time with no record that the
        // clock-out never happened. This is the one place that must catch it —
        // downstream pricing trusts an 'approved' status to mean real hours.
        if (payload.status === 'approved') {
            const finishedForApproval = isShiftFinished(
                shift?.shift_date ?? '', shift?.start_time ?? '', shift?.end_time ?? '', shift?.actual_end,
            );
            const effectiveManualStart = payload.start_time !== undefined ? payload.start_time : (existing?.start_time ?? null);
            const effectiveManualEnd = payload.end_time !== undefined ? payload.end_time : (existing?.end_time ?? null);
            const approvalStart = resolveBillableSide(effectiveManualStart, shift?.actual_start, finishedForApproval);
            const approvalEnd = resolveBillableSide(effectiveManualEnd, shift?.actual_end, finishedForApproval);

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

        if (existing) {
            // App-level optimistic-lock bump: prod has the `version` column but no
            // bump trigger, so increment it here alongside the CAS guard below.
            // Forward-compatible with a future trigger (both land on
            // expectedVersion+1). Only the guarded path bumps; bulk/legacy writes
            // stay last-write-wins by design.
            if (opts?.expectedVersion != null) {
                payload.version = opts.expectedVersion + 1;
            }
            // Update existing — with an optimistic-lock CAS when the caller passed
            // the version it loaded. A stale version matches zero rows (no error),
            // which we surface as a conflict instead of clobbering the newer row.
            let updateQuery = supabase
                .from('timesheets')
                .update(payload)
                .eq('id', existing.id);
            if (opts?.expectedVersion != null) {
                updateQuery = updateQuery.eq('version', opts.expectedVersion);
            }
            let { data: updatedRows, error } = await updateQuery.select('id');

            // Graceful fallback if variance columns are unmapped in PostgREST schema cache
            if (error?.code === 'PGRST204' && (payload.arrival_variance_reason !== undefined || payload.departure_variance_reason !== undefined)) {
                const fallbackPayload = { ...payload };
                delete fallbackPayload.arrival_variance_reason;
                delete fallbackPayload.departure_variance_reason;
                let retryQuery = supabase
                    .from('timesheets')
                    .update(fallbackPayload)
                    .eq('id', existing.id);
                if (opts?.expectedVersion != null) {
                    retryQuery = retryQuery.eq('version', opts.expectedVersion);
                }
                const retryRes = await retryQuery.select('id');
                updatedRows = retryRes.data;
                error = retryRes.error;
            }

            if (error) throw error;
            if (opts?.expectedVersion != null && (!updatedRows || updatedRows.length === 0)) {
                throw new TimesheetConflictError(shiftId);
            }
        } else {
            // Get shift details for new timesheet
            const { data: shift } = await supabase
                .from('shifts')
                .select('assigned_employee_id, shift_date, start_time, end_time, start_at, end_at, actual_start, actual_end')
                .eq('id', shiftId)
                .single();

            if (!shift) throw new Error('Shift not found');
            if (!shift.assigned_employee_id) throw new Error('Cannot create timesheet for unassigned shift');

            const clockInTs: string = updates.clockIn
                ? (isIsoTimestamp(updates.clockIn) ? updates.clockIn : `${shift.shift_date}T${shift.start_time}`)
                : (shift.actual_start ?? shift.start_at ?? `${shift.shift_date}T${shift.start_time}`);

            const clockOutTs: string | null = updates.clockOut
                ? (isIsoTimestamp(updates.clockOut) ? updates.clockOut : null)
                : (shift.actual_end ?? shift.end_at ?? null);

            let insertRes = await supabase
                .from('timesheets')
                .insert({
                    shift_id: shiftId,
                    employee_id: shift.assigned_employee_id,
                    profile_id: shift.assigned_employee_id,
                    work_date: shift.shift_date,
                    clock_in: clockInTs,
                    ...(clockOutTs ? { clock_out: clockOutTs } : {}),
                    status: (updates.status || 'draft').toLowerCase(),
                    ...payload,
                });

            if (insertRes.error?.code === 'PGRST204' && (payload.arrival_variance_reason !== undefined || payload.departure_variance_reason !== undefined)) {
                const fallbackPayload = { ...payload };
                delete fallbackPayload.arrival_variance_reason;
                delete fallbackPayload.departure_variance_reason;
                insertRes = await supabase
                    .from('timesheets')
                    .insert({
                        shift_id: shiftId,
                        employee_id: shift.assigned_employee_id,
                        profile_id: shift.assigned_employee_id,
                        work_date: shift.shift_date,
                        clock_in: clockInTs,
                        ...(clockOutTs ? { clock_out: clockOutTs } : {}),
                        status: (updates.status || 'draft').toLowerCase(),
                        ...fallbackPayload,
                    });
            }

            if (insertRes.error) throw insertRes.error;
        }

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

        // Provenance is owned by the DB trigger `trg_timesheet_provenance` (migration
        // 20260725100000): it fires on every timesheets write and appends the
        // lifecycle event (MANUALLY_APPROVED / REJECTED / EDITED / REOPENED / NO_SHOW)
        // to the append-only timesheet_audit_log. No client-side insert here — that
        // would double-log every event.
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
        // Update shift status
        const { error: shiftError } = await supabase
            .from('shifts')
            .update({
                attendance_status: 'no_show',
                lifecycle_status: 'Completed',
                updated_at: new Date().toISOString(),
                last_modified_by: userId
            })
            .eq('id', shiftId);

        if (shiftError) {
            console.error('[markShiftAsNoShow] Shift error:', shiftError);
            return false;
        }

        // Ensure a timesheet row exists at status 'no_show'. Zero hours/pay is
        // derived on read — there are no length/net/pay columns to write.
        const tsOk = await updateTimesheetEntry(shiftId, {
            status: 'no_show',
            notes: 'Marked as No-Show by manager',
        }, { actorId: userId });
        if (!tsOk) {
            console.warn(`[markShiftAsNoShow] shift ${shiftId} marked no-show, but its timesheet row could not be written.`);
        }

        return true;
    } catch (error) {
        console.error('[markShiftAsNoShow] Error:', error);
        return false;
    }
}
