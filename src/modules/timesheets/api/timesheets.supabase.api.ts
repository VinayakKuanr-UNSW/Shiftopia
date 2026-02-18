/**
 * Timesheets Supabase API
 * Fetches shift data with timesheet overlays from Supabase
 */

import { supabase } from '@/platform/realtime/client';

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

    // Breaks
    paidBreakMinutes: number;
    unpaidBreakMinutes: number;

    // Calculated
    scheduledLengthMinutes: number;
    netLengthMinutes: number;

    // Status
    shiftStatus: string;
    lifecycleStatus: string;
    timesheetStatus: string | null;

    // Pay
    hourlyRate: number | null;
    estimatedPay: number | null;
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
    date: string,
    filters: TimesheetFilters = {}
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
                assignment_status,
                lifecycle_status,
                group_type,
                sub_group_name,
                paid_break_minutes,
                unpaid_break_minutes,
                net_length_minutes,
                scheduled_length_minutes,
                remuneration_rate,
                organization_id,
                department_id,
                sub_department_id,
                role_id,
                remuneration_level_id,
                assigned_employee_id,
                organizations(id, name),
                departments(id, name),
                sub_departments(id, name),
                roles(id, name),
                remuneration_levels(id, level_name, hourly_rate_min)
            `)
            .eq('shift_date', date)
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
        const employeeIds = [...new Set(shifts.map(s => s.assigned_employee_id).filter(Boolean))];
        let employeeMap = new Map<string, { first_name: string; last_name: string }>();

        if (employeeIds.length > 0) {
            const { data: profiles } = await supabase
                .from('profiles')
                .select('id, first_name, last_name')
                .in('id', employeeIds);

            if (profiles) {
                employeeMap = new Map(profiles.map(p => [p.id, {
                    first_name: p.first_name || '',
                    last_name: p.last_name || ''
                }]));
            }
        }

        // Fetch timesheets for these shifts
        const shiftIds = shifts.map(s => s.id);
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
            const estimatedPay = (netMins / 60) * hourlyRate;

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

                groupType: shift.group_type,
                subGroupName: shift.sub_group_name,

                roleId: shift.role_id,
                roleName: role?.name || '',
                remunerationLevelId: shift.remuneration_level_id,
                remunerationLevel: remLevel?.level_name || '',

                shiftDate: shift.shift_date,
                scheduledStart: shift.start_time,
                scheduledEnd: shift.end_time,

                clockIn: timesheet?.clock_in || null,
                clockOut: timesheet?.clock_out || null,

                adjustedStart: timesheet?.start_time || null,
                adjustedEnd: timesheet?.end_time || null,

                paidBreakMinutes: shift.paid_break_minutes || 0,
                unpaidBreakMinutes: shift.unpaid_break_minutes || 0,

                scheduledLengthMinutes: scheduledMins,
                netLengthMinutes: netMins,

                shiftStatus: shift.assignment_status || 'open',
                lifecycleStatus: shift.lifecycle_status || 'scheduled',
                timesheetStatus: timesheet?.status || null,

                hourlyRate,
                estimatedPay: Math.round(estimatedPay * 100) / 100,
            };
        });

        // Apply search filter client-side
        if (filters.searchQuery) {
            const q = filters.searchQuery.toLowerCase();
            return rows.filter(row =>
                row.employeeName.toLowerCase().includes(q) ||
                row.roleName.toLowerCase().includes(q) ||
                row.departmentName.toLowerCase().includes(q) ||
                row.subGroupName?.toLowerCase().includes(q)
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

/**
 * Update timesheet for a shift
 */
export async function updateTimesheetEntry(
    shiftId: string,
    updates: {
        clockIn?: string;
        clockOut?: string;
        adjustedStart?: string;
        adjustedEnd?: string;
        status?: string;
        notes?: string;
    }
): Promise<boolean> {
    try {
        // Check if timesheet exists
        const { data: existing } = await supabase
            .from('timesheets')
            .select('id')
            .eq('shift_id', shiftId)
            .maybeSingle();

        const payload: any = {
            updated_at: new Date().toISOString(),
        };

        if (updates.clockIn !== undefined) payload.clock_in = updates.clockIn;
        if (updates.clockOut !== undefined) payload.clock_out = updates.clockOut;
        if (updates.adjustedStart !== undefined) payload.start_time = updates.adjustedStart;
        if (updates.adjustedEnd !== undefined) payload.end_time = updates.adjustedEnd;
        if (updates.status !== undefined) payload.status = updates.status;
        if (updates.notes !== undefined) payload.notes = updates.notes;

        if (existing) {
            // Update existing
            const { error } = await supabase
                .from('timesheets')
                .update(payload)
                .eq('id', existing.id);

            if (error) throw error;
        } else {
            // Get shift details for new timesheet
            const { data: shift } = await supabase
                .from('shifts')
                .select('assigned_employee_id, shift_date, start_time, end_time')
                .eq('id', shiftId)
                .single();

            if (!shift) throw new Error('Shift not found');

            // Create new timesheet
            const { error } = await supabase
                .from('timesheets')
                .insert({
                    shift_id: shiftId,
                    employee_id: shift.assigned_employee_id,
                    profile_id: shift.assigned_employee_id || '', // Required field
                    work_date: shift.shift_date,
                    start_time: updates.adjustedStart || shift.start_time,
                    end_time: updates.adjustedEnd || shift.end_time,
                    clock_in: updates.clockIn || shift.start_time,
                    status: updates.status || 'draft',
                    ...payload,
                });

            if (error) throw error;
        }

        return true;
    } catch (error) {
        console.error('[updateTimesheetEntry] Error:', error);
        return false;
    }
}

/**
 * Bulk update timesheet status
 */
export async function bulkUpdateTimesheetStatus(
    shiftIds: string[],
    status: 'approved' | 'rejected',
    userId: string
): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const shiftId of shiftIds) {
        const result = await updateTimesheetEntry(shiftId, {
            status,
        });

        if (result) {
            success++;
        } else {
            failed++;
        }
    }

    return { success, failed };
}
