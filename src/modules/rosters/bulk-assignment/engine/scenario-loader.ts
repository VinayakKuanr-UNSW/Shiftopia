/**
 * ScenarioLoader — Fetches the employee's ±28-day roster from Supabase.
 *
 * Returns:
 *   - candidateShifts:  The specific shifts being bulk-assigned (from shiftIds)
 *   - existingShifts:   All shifts assigned to the employee in the scenario window
 *   - employee:         Profile including role and qualifications
 */

import { supabase } from '@/platform/realtime/client';
import { getScenarioWindow } from '@/modules/compliance';
import type { CandidateShift, EmployeeInfo } from '../types';

export interface LoadedScenario {
    candidateShifts: CandidateShift[];
    existingShifts: CandidateShift[];
    employee: EmployeeInfo;
}

export class ScenarioLoader {
    /**
     * Load all data needed to validate bulk assignment for a single employee.
     *
     * @param shiftIds   - The candidate shift IDs selected in the planner
     * @param employeeId - The target employee
     */
    async load(shiftIds: string[], employeeId: string): Promise<LoadedScenario> {
        const [candidateShifts, employee] = await Promise.all([
            this._fetchCandidateShifts(shiftIds),
            this._fetchEmployee(employeeId),
        ]);

        // Build date window from the candidate shifts (±28 days around extremes)
        const existingShifts = await this._fetchExistingShifts(
            employeeId,
            candidateShifts,
        );

        return { candidateShifts, existingShifts, employee };
    }

    // ---------------------------------------------------------------------------

    private async _fetchCandidateShifts(shiftIds: string[]): Promise<CandidateShift[]> {
        if (shiftIds.length === 0) return [];

        const { data, error } = await (supabase as any)
            .from('shifts')
            .select('id, shift_date, start_time, end_time, assigned_employee_id, lifecycle_status, role_id, unpaid_break_minutes, required_skills, required_licenses')
            .in('id', shiftIds)
            .is('deleted_at', null);

        if (error) {
            console.error('[ScenarioLoader] Error fetching candidate shifts:', error);
            return [];
        }
        return (data ?? []) as CandidateShift[];
    }

    private async _fetchExistingShifts(
        employeeId: string,
        candidateShifts: CandidateShift[],
    ): Promise<CandidateShift[]> {
        if (candidateShifts.length === 0) return [];

        // Compute the widest window covering all candidate shift dates
        const dates = candidateShifts.map(s => s.shift_date).sort();
        const earliestWindow = getScenarioWindow(dates[0]);
        const latestWindow   = getScenarioWindow(dates[dates.length - 1]);

        // Union of both windows → start of earliest, end of latest
        const windowStart = earliestWindow.start < latestWindow.start
            ? earliestWindow.start
            : latestWindow.start;
        const windowEnd = earliestWindow.end > latestWindow.end
            ? earliestWindow.end
            : latestWindow.end;

        const { data, error } = await (supabase as any)
            .from('shifts')
            .select('id, shift_date, start_time, end_time, assigned_employee_id, lifecycle_status, role_id, unpaid_break_minutes')
            .eq('assigned_employee_id', employeeId)
            .gte('shift_date', windowStart)
            .lte('shift_date', windowEnd)
            .is('deleted_at', null)
            .neq('is_cancelled', true);

        if (error) {
            console.error('[ScenarioLoader] Error fetching existing shifts:', error);
            return [];
        }
        return (data ?? []) as CandidateShift[];
    }

    private async _fetchEmployee(employeeId: string): Promise<EmployeeInfo> {
        const { data, error } = await (supabase as any)
            .from('profiles')
            .select('id, full_name, role_id, employment_end_date')
            .eq('id', employeeId)
            .single();

        if (error || !data) {
            console.error('[ScenarioLoader] Error fetching employee:', error);
            return { id: employeeId, name: employeeId };
        }

        // Fetch qualifications (skills + licenses) separately
        const [skillsRes, licensesRes] = await Promise.all([
            (supabase as any)
                .from('employee_skills')
                .select('skill_id, expires_at')
                .eq('employee_id', employeeId),
            (supabase as any)
                .from('employee_licenses')
                .select('license_id, expires_at')
                .eq('employee_id', employeeId),
        ]);

        const qualifications = [
            ...((skillsRes.data ?? []) as any[]).map((s: any) => ({
                qualification_id: s.skill_id,
                expires_at: s.expires_at,
            })),
            ...((licensesRes.data ?? []) as any[]).map((l: any) => ({
                qualification_id: l.license_id,
                expires_at: l.expires_at,
            })),
        ];

        return {
            id: data.id,
            name: data.full_name ?? data.id,
            role_id: data.role_id,
            employment_end_date: data.employment_end_date,
            qualifications,
        };
    }
}

export const scenarioLoader = new ScenarioLoader();
