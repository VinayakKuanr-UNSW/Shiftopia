import { useMemo } from 'react';
import type { Shift } from '@/modules/rosters/domain/shift.entity';
import type { PeopleModeEmployee, PeopleModeShift } from '@/modules/rosters/ui/modes/people-mode.types';

// Helper to safely access nested properties that might be missing in some API responses
const getNestedName = (obj: any, ...paths: string[]): string | undefined => {
    let current = obj;
    for (const path of paths) {
        if (!current) return undefined;
        current = current[path];
    }
    return current;
};

interface UsePeopleModeDataProps {
    employees: any[]; // Using any[] for now as the source employee type is loose in the page
    shifts: Shift[];
}

export const usePeopleModeData = ({ employees, shifts }: UsePeopleModeDataProps) => {
    const employeesWithShifts = useMemo(() => {
        const empMap = new Map<string, PeopleModeEmployee>();

        // 1. Initialize map with known employees
        employees.forEach((emp) => {
            empMap.set(emp.id, {
                id: emp.id,
                name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Unknown',
                employeeId: `ID: ${(emp.id || '').substring(0, 8)}`,
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${emp.first_name || emp.id}`,
                contractedHours: 40, // TODO: Get from contract
                currentHours: 0,
                shifts: {},
            });
        });

        const UNASSIGNED_BUCKET_ID = 'unassigned-bucket';

        // 2. Process shifts and assign to employees
        shifts.forEach((shift) => {
            // Skip if cancelled (unless we want to show cancelled shifts, but effectively they don't count towards hours)
            if (shift.is_cancelled && !shift.assigned_employee_id) return;

            const targetEmpId = shift.assigned_employee_id || UNASSIGNED_BUCKET_ID;
            let emp = empMap.get(targetEmpId);

            if (!emp) {
                if (targetEmpId === UNASSIGNED_BUCKET_ID) {
                    emp = {
                        id: UNASSIGNED_BUCKET_ID,
                        name: 'Open Shifts',
                        employeeId: 'Unassigned',
                        avatar: `https://api.dicebear.com/7.x/shapes/svg?seed=unassigned`,
                        contractedHours: 0,
                        currentHours: 0,
                        shifts: {},
                    };
                    empMap.set(UNASSIGNED_BUCKET_ID, emp);
                } else {
                    // Employee not in list (different org, etc) - create from shift data
                    const assignedProfile = (shift as any).assigned_profiles || (shift as any).profiles;
                    const firstName = assignedProfile?.first_name || 'Assigned';
                    const lastName = assignedProfile?.last_name || 'Employee';

                    emp = {
                        id: shift.assigned_employee_id!,
                        name: `${firstName} ${lastName}`.trim(),
                        employeeId: `ID: ${shift.assigned_employee_id!.substring(0, 8)}`,
                        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${shift.assigned_employee_id}`,
                        contractedHours: 40,
                        currentHours: 0,
                        shifts: {},
                    };
                    empMap.set(shift.assigned_employee_id!, emp);
                }
            }

            const dateKey = shift.shift_date;
            if (!emp.shifts[dateKey]) {
                emp.shifts[dateKey] = [];
            }

            // Calculate hours
            const shiftHours = (shift.net_length_minutes || 0) / 60;
            if (!shift.is_cancelled && shift.assigned_employee_id) {
                emp.currentHours = (emp.currentHours || 0) + shiftHours;
            }

            // Map to PeopleModeShift
            const viewShift: PeopleModeShift = {
                id: shift.id,
                role: shift.roles?.name || 'Unknown',
                remunerationLevel: shift.remuneration_levels?.level_name || 'L1',
                startTime: shift.start_time,
                endTime: shift.end_time,
                department: shift.roster_subgroup?.roster_group?.external_id || shift.group_type || 'General',
                subGroup: shift.roster_subgroup?.name || shift.sub_group_name || '',
                group: shift.roster_subgroup?.roster_group?.external_id || shift.group_type || 'convention',
                groupColor: 'blue', // Default, can be enhanced with logic
                hours: shiftHours,
                pay: shiftHours * (shift.remuneration_rate || 25),
                status: shift.assigned_employee_id ? (shift.is_draft ? 'Draft' : 'Assigned') : 'Open',
                lifecycleStatus: (shift.lifecycle_status || 'draft').toLowerCase() as 'draft' | 'published',
                assignmentStatus: shift.assigned_employee_id ? 'assigned' : 'unassigned',
                fulfillmentStatus: shift.fulfillment_status,
                isTradeRequested: !!shift.is_trade_requested,
                isCancelled: !!shift.is_cancelled,
                rawShift: shift,
            };

            emp.shifts[dateKey].push(viewShift);
        });

        return Array.from(empMap.values());
    }, [employees, shifts]);

    return employeesWithShifts;
};
