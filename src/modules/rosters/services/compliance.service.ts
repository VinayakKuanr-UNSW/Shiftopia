import { Shift, isValidUuid } from '@/modules/rosters/api/shifts.api';

export interface ComplianceValidationResult {
    isValid: boolean;
    violations: string[];
    warnings: string[];
    weeklyHours?: number;
    maxWeeklyHours?: number;
}

export const complianceService = {
    async validateShiftCompliance(
        employeeId: string,
        shiftDate: string,
        startTime: string,
        endTime: string,
        netLengthMinutes: number,
        excludeShiftId?: string
    ): Promise<ComplianceValidationResult> {
        const violations: string[] = [];
        const warnings: string[] = [];
        const maxWeeklyHours = 48;

        try {
            try {
                const { data: overlapExists } = await supabase.rpc(
                    'check_shift_overlap',
                    {
                        p_employee_id: employeeId,
                        p_shift_date: shiftDate,
                        p_start_time: startTime,
                        p_end_time: endTime,
                        p_exclude_shift_id: excludeShiftId || undefined,
                    }
                );

                if (overlapExists) {
                    violations.push(
                        'This shift overlaps with an existing shift for the employee'
                    );
                }
            } catch {
                console.log('Overlap check RPC not available, skipping');
            }

            try {
                const weekStartDate = new Date(shiftDate);
                const dayOfWeek = weekStartDate.getDay();
                const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                weekStartDate.setDate(weekStartDate.getDate() + diff);
                const weekStartStr = weekStartDate.toISOString().split('T')[0];

                // VALIDATION: Skip RPC if employeeId is not a valid UUID (e.g. 'preview')
                if (!isValidUuid(employeeId)) {
                    // console.log('Skipping weekly hours check for invalid employee ID:', employeeId);
                    return;
                }

                const { data: weeklyMinutes, error: rpcError } = await supabase.rpc(
                    'calculate_weekly_hours',
                    {
                        p_employee_id: employeeId,
                        p_week_start_date: weekStartStr,
                    }
                );

                if (rpcError) {
                    console.error('RPC Error calculate_weekly_hours:', rpcError);
                    throw rpcError;
                }

                const currentHours = (weeklyMinutes || 0) / 60;
                const projectedHours = currentHours + netLengthMinutes / 60;

                if (projectedHours > maxWeeklyHours) {
                    violations.push(
                        `This shift would exceed weekly hours (${projectedHours.toFixed(
                            1
                        )}h / ${maxWeeklyHours}h)`
                    );
                } else if (projectedHours > maxWeeklyHours * 0.9) {
                    warnings.push(
                        `Employee is close to weekly limit (${projectedHours.toFixed(
                            1
                        )}h / ${maxWeeklyHours}h)`
                    );
                }
            } catch {
                console.log('Weekly hours RPC not available, skipping');
            }

            try {
                const { data: restPeriodOk } = await supabase.rpc(
                    'validate_rest_period',
                    {
                        p_employee_id: employeeId,
                        p_shift_date: shiftDate,
                        p_start_time: startTime,
                        p_end_time: endTime,
                        p_minimum_hours: 11,
                    }
                );

                if (!restPeriodOk) {
                    violations.push(
                        'Minimum rest period of 11 hours not met between shifts'
                    );
                }
            } catch {
                console.log('Rest period RPC not available, skipping');
            }

            return {
                isValid: violations.length === 0,
                violations,
                warnings,
                weeklyHours: 0,
                maxWeeklyHours,
            };
        } catch {
            return {
                isValid: true,
                violations: [],
                warnings: ['Compliance validation unavailable'],
            };
        }
    },
};
