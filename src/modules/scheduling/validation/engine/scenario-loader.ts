/**
 * ScenarioLoader — Fetches the employee's ±28-day roster from Supabase.
 *
 * Returns:
 *   - candidateShifts:  The specific shifts being validated (from shiftIds)
 *   - existingShifts:   All shifts assigned to the employee in the scenario window
 *   - employee:         Profile including role and qualifications
 *
 * IMPORTANT: existingShifts are fetched via the SECURITY DEFINER RPC
 * `get_employee_shift_window`, NOT a direct table query.  This ensures that
 * cross-department shifts are always visible regardless of the calling
 * manager's RLS scope, preventing false-pass compliance results.
 */

import { supabase } from '@/platform/supabase/client';
import { getScenarioWindow } from '@/modules/compliance';
import { fetchV8EmployeeContext } from '@/modules/compliance/employee-context';
import type { CandidateShift, EmployeeInfo, InjectedSimulationData } from '../types';

export interface LoadedScenario {
    candidateShifts: CandidateShift[];
    existingShifts: CandidateShift[];
    employee: EmployeeInfo;
}

export class ScenarioLoader {
    /**
     * Load all data needed to validate proposed assignments for a single employee.
     *
     * @param shiftIds     - The candidate shift IDs selected in the planner
     * @param employeeId   - The target employee
     * @param injectedData - (Optional) Pre-fetched data to skip network calls
     */
    async load(
        shiftIds: string[], 
        employeeId: string, 
        injectedData?: InjectedSimulationData
    ): Promise<LoadedScenario> {
        // If data is injected (e.g. by AutoScheduler), use it directly
        // to avoid thousands of redundant network calls and Navigator Locks.
        if (injectedData) {
            return injectedData;
        }

        const [candidateShifts, employee] = await Promise.all([
            this._fetchCandidateShifts(shiftIds),
            this._fetchEmployee(employeeId),
        ]);

        // Build date window from the candidate shifts (±28 days around extremes)
        const [existingShifts, leaveDays] = await Promise.all([
            this._fetchExistingShifts(employeeId, candidateShifts),
            this._fetchLeaveDays(employeeId, candidateShifts),
        ]);

        return {
            candidateShifts,
            existingShifts,
            employee: { ...employee, leave_days: leaveDays },
        };
    }

    // ---------------------------------------------------------------------------

    private async _fetchCandidateShifts(shiftIds: string[]): Promise<CandidateShift[]> {
        if (shiftIds.length === 0) return [];

        const { data, error } = await (supabase as any)
            .from('shifts')
            // target_employment_type / target_requires_flexible feed
            // V8_EMPLOYMENT_TARGET; without them the rule cannot fire and this
            // path validates assignments the DB trigger will reject.
            .select('id, shift_date, start_time, end_time, assigned_employee_id, lifecycle_status, role_id, organization_id, department_id, sub_department_id, unpaid_break_minutes, required_skills, required_licenses, start_at, end_at, target_employment_type, target_requires_flexible')
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

        // Use SECURITY DEFINER RPC so cross-department shifts are visible
        // regardless of the calling manager's RLS scope.  A direct table query
        // (.from('shifts').eq('assigned_employee_id', ...)) is RLS-scoped and
        // silently omits shifts from other departments, producing false-pass
        // compliance results (e.g. rest-gap violations not detected).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.rpc as any)('get_employee_shift_window', {
            p_employee_id: employeeId,
            p_start_date:  windowStart,
            p_end_date:    windowEnd,
            p_exclude_id:  null,
        });

        if (error) {
            console.error('[ScenarioLoader] Error fetching existing shifts via RPC:', error);
            return [];
        }

        // Map RPC result to CandidateShift shape
        return ((data ?? []) as Array<{
            id:                   string;
            shift_date:           string;
            start_time:           string;
            end_time:             string;
            unpaid_break_minutes: number | null;
        }>).map(s => ({
            id:                   s.id,
            shift_date:           s.shift_date,
            start_time:           s.start_time,
            end_time:             s.end_time,
            assigned_employee_id: employeeId,
            lifecycle_status:     null,
            role_id:              null,
            unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
        }));
    }

    /**
     * Approved-leave dates covering the candidate shift dates (audit F1).
     * Feeds V8_LEAVE_CONFLICT. Fail-open: on error returns undefined so the
     * rule stays silent rather than failing the whole load.
     */
    private async _fetchLeaveDays(
        employeeId: string,
        candidateShifts: CandidateShift[],
    ): Promise<string[] | undefined> {
        if (candidateShifts.length === 0) return undefined;
        const dates = candidateShifts.map(s => s.shift_date).sort();
        const windowStart = dates[0];
        const windowEnd = dates[dates.length - 1];

        const { data, error } = await (supabase as any)
            .from('leave_requests')
            .select('start_date, end_date, status')
            .eq('employee_id', employeeId)
            .eq('status', 'approved')
            .lte('start_date', `${windowEnd}T23:59:59`)
            .gte('end_date', windowStart);
        if (error) {
            console.warn('[ScenarioLoader] Approved-leave fetch failed — V8_LEAVE_CONFLICT silent this run', error);
            return undefined;
        }

        const toYmd = (v: unknown): string => {
            const str = String(v ?? '');
            return str.includes('T') ? str.split('T')[0] : str.slice(0, 10);
        };
        const addDays = (ymd: string, n: number): string => {
            const [y, m, d] = ymd.split('-').map(Number);
            const dt = new Date(Date.UTC(y, m - 1, d + n));
            return dt.toISOString().slice(0, 10);
        };

        const out = new Set<string>();
        for (const row of (data ?? []) as Array<{ start_date: string; end_date: string }>) {
            const from0 = toYmd(row.start_date);
            const to0 = toYmd(row.end_date);
            if (!from0 || !to0) continue;
            const from = from0 > windowStart ? from0 : windowStart;
            const to = to0 < windowEnd ? to0 : windowEnd;
            for (let d = from; d <= to; d = addDays(d, 1)) out.add(d);
        }
        return out.size > 0 ? Array.from(out).sort() : undefined;
    }

    private async _fetchEmployee(employeeId: string): Promise<EmployeeInfo> {
        // Fetch profile (name + employment end date) in parallel with v2 context
        // (contracts, qualifications, visa status via fetchV8EmployeeContext).
        const [profileRes, ctx] = await Promise.all([
            (supabase as any)
                .from('profiles')
                .select('id, full_name, termination_date')
                .eq('id', employeeId)
                .single(),
            fetchV8EmployeeContext(employeeId),
        ]);

        if (profileRes.error) {
            console.error('[ScenarioLoader] Error fetching employee profile:', profileRes.error);
        }

        const profile = profileRes.data;

        // Map the V8 contract type ('FULL_TIME'|'PART_TIME'|'CASUAL'|
        // 'FLEXI_PART_TIME') onto the 'FT'|'PT'|'CASUAL' form EmployeeInfo
        // carries. Without this, contract_type stays undefined and the V8
        // engine defaults everyone to CASUAL — which silently exempts real
        // FT/PT staff from the ordinary-hours 4-week averaging cap
        // (V8_ORD_HOURS_AVG).
        //
        // This used to carry a fifth case mapping 'STUDENT_VISA' onto 'CASUAL',
        // justified by "its binding limit is the separate student-visa cap".
        // That cap is V8_STUDENT_VISA_LIMIT, whose guard was the very value
        // being collapsed here — so the fallback the comment relied on did not
        // exist, and the rule could not fire on this path. The visa condition
        // now travels on its own axis (`is_student_visa`), forwarded below.
        const contractType: EmployeeInfo['contract_type'] =
            ctx.contract_type === 'FULL_TIME'                                  ? 'FT'
            : ctx.contract_type === 'PART_TIME' || ctx.contract_type === 'FLEXI_PART_TIME' ? 'PT'
            : 'CASUAL';

        return {
            id:                  employeeId,
            name:                profile?.full_name ?? employeeId,
            employment_end_date: profile?.termination_date ?? null,
            contract_type:       contractType,
            // ctx.contracted_weekly_hours is currently 0 (not yet sourced); leave
            // undefined so the engine falls back to its 38h default rather than 0.
            contracted_weekly_hours: ctx.contracted_weekly_hours || undefined,
            // contracts → source of truth for R10 role/hierarchy match
            contracts:           ctx.contracts,
            // Raw per-contract statuses for V8_EMPLOYMENT_TARGET. fetchV8EmployeeContext
            // already derives these from the contract rows; they were simply not
            // forwarded, leaving the rule with an empty list and no verdict.
            employment_statuses: ctx.employment_statuses,
            // EBA Schedule 3. `fetchV8EmployeeContext` has always derived this
            // (audit H-5) and it was dropped at this hop, so Sch 3 §3.1(a)'s
            // 42h/8-week cycle and §5.3(g)'s casual-security spread cap were
            // both unreachable from the AutoScheduler.
            is_security_role:    ctx.is_security_role,
            // Migration Act condition 8105 — see the contract_type note above.
            is_student_visa:     ctx.is_student_visa,
            qualifications:      (ctx.qualifications ?? []).map(q => ({
                qualification_id: q.qualification_id,
                expires_at:       q.expires_at,
            })),
        };
    }
}

export const scenarioLoader = new ScenarioLoader();
