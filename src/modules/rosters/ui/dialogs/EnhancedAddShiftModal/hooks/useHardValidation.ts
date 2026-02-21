import { useState, useEffect } from 'react';
import { supabase } from '@/platform/realtime/client';
import { runHardValidation, HardValidationResult, ShiftTimeRange } from '@/modules/compliance';
import { format, addDays, subDays } from 'date-fns';
import { getNowInTimezone, SYDNEY_TZ } from '@/modules/core/lib/date.utils';

interface UseHardValidationProps {
    watchStart: string;
    watchEnd: string;
    watchShiftDate: Date | undefined;
    watchEmployeeId: string | null | undefined;
    isTemplateMode: boolean;
    existingShiftId?: string;
    timezone?: string;
}

interface UseHardValidationReturn {
    hardValidation: HardValidationResult;
    employeeExistingShifts: ShiftTimeRange[];
}

export function useHardValidation({
    watchStart,
    watchEnd,
    watchShiftDate,
    watchEmployeeId,
    isTemplateMode,
    existingShiftId,
    timezone = SYDNEY_TZ,
}: UseHardValidationProps): UseHardValidationReturn {
    const [hardValidation, setHardValidation] = useState<HardValidationResult>({ passed: true, errors: [] });
    const [employeeExistingShifts, setEmployeeExistingShifts] = useState<ShiftTimeRange[]>([]);

    // Fetch existing shifts when employee changes
    useEffect(() => {
        console.debug('[HardValidation] useEffect triggered', { watchEmployeeId, watchShiftDate: watchShiftDate?.toISOString(), isTemplateMode });

        const fetchEmployeeShifts = async () => {
            if (!watchEmployeeId || isTemplateMode) {
                console.debug('[HardValidation] Skipping fetch - no employee assigned or template mode', { watchEmployeeId, isTemplateMode });
                setEmployeeExistingShifts([]);
                return;
            }

            const shiftDateStr = watchShiftDate ? format(watchShiftDate, 'yyyy-MM-dd') : null;
            if (!shiftDateStr || !watchShiftDate) {
                console.debug('[HardValidation] Skipping fetch - no shift date', { shiftDateStr });
                setEmployeeExistingShifts([]);
                return;
            }

            // Calculate +/- 14 days rolling window context
            const startDate = format(subDays(watchShiftDate, 14), 'yyyy-MM-dd');
            const endDate = format(addDays(watchShiftDate, 14), 'yyyy-MM-dd');

            try {
                console.debug('[HardValidation] Fetching shifts for employee:', watchEmployeeId, 'range:', startDate, 'to', endDate);
                const { data, error } = await supabase
                    .from('shifts')
                    .select('id, start_time, end_time, shift_date, unpaid_break_minutes')
                    .eq('assigned_employee_id', watchEmployeeId)
                    .gte('shift_date', startDate)
                    .lte('shift_date', endDate)
                    .is('deleted_at', null)
                    .eq('is_cancelled', false);

                console.debug('[HardValidation] Query result:', { data, error });

                if (!error && data) {
                    // Filter out current shift if editing
                    const shifts = data
                        .filter(s => !existingShiftId || s.id !== existingShiftId)
                        .map(s => ({
                            start_time: s.start_time,
                            end_time: s.end_time,
                            shift_date: s.shift_date,
                            unpaid_break_minutes: s.unpaid_break_minutes || 0
                        }));
                    console.debug('[HardValidation] Processed shifts:', shifts);
                    setEmployeeExistingShifts(shifts);
                } else if (error) {
                    console.error('[HardValidation] Query error:', error);
                }
            } catch (err) {
                console.error('[HardValidation] Error fetching employee shifts:', err);
            }
        };

        fetchEmployeeShifts();
    }, [watchEmployeeId, watchShiftDate, isTemplateMode, existingShiftId]);

    // Run Hard validation: Run on time/date changes
    useEffect(() => {
        if (!watchStart || !watchEnd) {
            setHardValidation({ passed: true, errors: [] });
            return;
        }

        const shiftDateStr = isTemplateMode
            ? format(new Date(), 'yyyy-MM-dd') // Templates don't have dates, use today for validation
            : (watchShiftDate ? format(watchShiftDate, 'yyyy-MM-dd') : '');

        if (!shiftDateStr && !isTemplateMode) {
            setHardValidation({ passed: true, errors: [] });
            return;
        }

        console.debug('[HardValidation] Running validation with:', {
            shift_date: shiftDateStr,
            start_time: watchStart,
            end_time: watchEnd,
            employee_id: watchEmployeeId,
            existing_shifts_count: employeeExistingShifts.length,
            existing_shifts: employeeExistingShifts
        });

        const result = runHardValidation({
            shift_date: shiftDateStr,
            start_time: watchStart,
            end_time: watchEnd,
            employee_id: watchEmployeeId,
            existing_shifts: employeeExistingShifts,
            current_time: getNowInTimezone(timezone),
            is_template: isTemplateMode
        });

        console.debug('[HardValidation] Result:', result);
        console.debug('[HardValidation] Errors with context:', result.errors);

        setHardValidation(result);
    }, [watchStart, watchEnd, watchShiftDate, watchEmployeeId, employeeExistingShifts, isTemplateMode, timezone]);

    return { hardValidation, employeeExistingShifts };
}
