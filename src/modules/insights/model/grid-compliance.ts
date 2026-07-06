/**
 * Grid Compliance — client-side compliance computation for the Annual Shift Grid.
 *
 * Extracted from GridPage.tsx so it is independently testable.
 *
 * IMPORTANT — casual exemption:
 *   This mirrors the canonical v8 rule in
 *   src/modules/compliance/v8/rules/ordinary-hours-avg.ts, which EXEMPTS casuals
 *   from the ordinary-hours averaging (rolling-window) caps:
 *       if (employee.contract_type === 'CASUAL') return [];
 *   and uses the employee's `contracted_weekly_hours` (falling back to 38) as the
 *   weekly basis rather than a flat 38.
 *
 *   The production org is ~102/103 casuals, so applying the rolling caps to
 *   casuals paints a wall of false "VIOLATION" badges for schedules that every
 *   gate that actually created them treats as compliant. Casuals therefore get
 *   NO rolling-window badges, and rolling windows never drive their overall
 *   severity. Daily caps (12h hard / 10h soft) still apply to EVERYONE.
 */

import { getISOWeek } from 'date-fns';

// ── Types ──────────────────────────────────────────────────────────────

export interface ShiftPillData {
    id: string;
    netHours: number;
    orgName?: string;
    deptName?: string;
    subDeptName?: string;
    roleName?: string;
    isDraft: boolean;
}

// ── Compliance types ──────────────────────────────────────────────────────────

export type CompV8Severity = 'violation' | 'warning' | 'ok';

export interface WindowViolation {
    weeks: 2 | 3 | 4;
    hours: number;
    limit: number;
    severity: CompV8Severity;
}

export interface WeekComp {
    weekHours: number;
    windows: WindowViolation[];
    worstV8Severity: CompV8Severity;
}

export interface EmpComp {
    overallV8Severity: CompV8Severity;
    worstDesc: string;
    weeks: Record<number, WeekComp>;
    dailyViolations: Set<string>;
    dailyWarnings: Set<string>;
}

export type GridContractType = 'FT' | 'PT' | 'CASUAL' | null | undefined;

// ── EBA constants ─────────────────────────────────────────────────────────────

export const EBA_WEEKLY_LIMIT  = 38;   // h/week — default weekly basis (fallback)
export const DAILY_CAP_HARD    = 12;   // h — violation
export const DAILY_CAP_SOFT    = 10;   // h — warning
export const NEAR_LIMIT_RATIO  = 0.90; // 90 % of limit triggers warning badge

export const ROLLING_WINDOWS = [
    { weeks: 2 as const, days: 14 },
    { weeks: 3 as const, days: 21 },
    { weeks: 4 as const, days: 28 },
] as const;

// ── computeEmpComp ────────────────────────────────────────────────────────────

/**
 * Compute per-employee compliance for the Annual Shift Grid.
 *
 * Mirrors the casual exemption in
 * src/modules/compliance/v8/rules/ordinary-hours-avg.ts:
 *   - CASUAL employees are exempt from the rolling ordinary-hours averaging caps
 *     (2/3/4-week windows); they get no rolling-window badges and rolling windows
 *     never drive their overall severity.
 *   - The weekly basis is the employee's `contractedWeeklyHours` (falling back to
 *     EBA_WEEKLY_LIMIT = 38), NOT a flat 38.
 *   - Daily caps (DAILY_CAP_HARD / DAILY_CAP_SOFT) apply to EVERYONE.
 *   - Unknown/null contract types (employees discovered only via shifts, with no
 *     contract record) KEEP the rolling checks — conservative, so we don't hide
 *     potential issues.
 */
export function computeEmpComp(
    byWeek: Record<number, number>,
    byDate: Record<string, ShiftPillData[]>,
    sortedWeekNums: number[],
    contractType: GridContractType,
    contractedWeeklyHours?: number,
): EmpComp {
    const isCasual = contractType === 'CASUAL';
    const weeklyLimit = contractedWeeklyHours && contractedWeeklyHours > 0
        ? contractedWeeklyHours
        : EBA_WEEKLY_LIMIT;

    // 1. Daily cap checks (apply to everyone, including casuals)
    const dailyViolations = new Set<string>();
    const dailyWarnings   = new Set<string>();
    for (const [date, shifts] of Object.entries(byDate)) {
        const hours = shifts.reduce((sum, s) => sum + s.netHours, 0);
        if (hours > DAILY_CAP_HARD)       dailyViolations.add(date);
        else if (hours > DAILY_CAP_SOFT)  dailyWarnings.add(date);
    }

    // 2. Per-week entries
    const weekComps: Record<number, WeekComp> = {};
    for (const wn of sortedWeekNums) {
        weekComps[wn] = { weekHours: byWeek[wn] || 0, windows: [], worstV8Severity: 'ok' };
    }

    // 3. Bubble daily cap severity into week
    for (const date of dailyViolations) {
        const wn = getISOWeek(new Date(date));
        if (weekComps[wn]) weekComps[wn].worstV8Severity = 'violation';
    }
    for (const date of dailyWarnings) {
        const wn = getISOWeek(new Date(date));
        if (weekComps[wn] && weekComps[wn].worstV8Severity === 'ok')
            weekComps[wn].worstV8Severity = 'warning';
    }

    // 4. Rolling-window checks (prefix-sum sweep over sorted week indices).
    //    Casuals are EXEMPT (mirrors ordinary-hours-avg.ts) — skip entirely.
    if (!isCasual) {
        for (const win of ROLLING_WINDOWS) {
            const limit     = weeklyLimit * win.weeks;
            const warnLimit = limit * NEAR_LIMIT_RATIO;

            for (let endIdx = win.weeks - 1; endIdx < sortedWeekNums.length; endIdx++) {
                let sum = 0;
                for (let i = endIdx - win.weeks + 1; i <= endIdx; i++) {
                    sum += byWeek[sortedWeekNums[i]] || 0;
                }
                if (sum <= warnLimit) continue;

                const severity: CompV8Severity = sum > limit ? 'violation' : 'warning';
                const endWn = sortedWeekNums[endIdx];
                if (!weekComps[endWn]) continue;

                const existing = weekComps[endWn].windows.find(w => w.weeks === win.weeks);
                if (existing) {
                    if (sum > existing.hours) {
                        existing.hours    = parseFloat(sum.toFixed(1));
                        existing.severity = severity;
                    }
                } else {
                    weekComps[endWn].windows.push({
                        weeks: win.weeks,
                        hours: parseFloat(sum.toFixed(1)),
                        limit,
                        severity,
                    });
                }

                if (severity === 'violation') {
                    weekComps[endWn].worstV8Severity = 'violation';
                } else if (severity === 'warning' && weekComps[endWn].worstV8Severity === 'ok') {
                    weekComps[endWn].worstV8Severity = 'warning';
                }
            }
        }
    }

    // 5. Derive overall severity + description
    let overallV8Severity: CompV8Severity = 'ok';
    let worstDesc = 'All checks passed';

    for (const comp of Object.values(weekComps)) {
        for (const win of comp.windows) {
            if (win.severity === 'violation' && overallV8Severity !== 'violation') {
                overallV8Severity = 'violation';
                worstDesc = `${win.hours}h in ${win.weeks}w window (limit ${win.limit}h)`;
            } else if (win.severity === 'warning' && overallV8Severity === 'ok') {
                overallV8Severity = 'warning';
                worstDesc = `Near limit: ${win.hours}h in ${win.weeks}w window`;
            }
        }
    }
    if (dailyViolations.size > 0 && overallV8Severity !== 'violation') {
        overallV8Severity = 'violation';
        worstDesc = `Daily cap exceeded on ${dailyViolations.size} day(s) (>${DAILY_CAP_HARD}h)`;
    } else if (dailyWarnings.size > 0 && overallV8Severity === 'ok') {
        overallV8Severity = 'warning';
        worstDesc = `Near daily cap on ${dailyWarnings.size} day(s) (>${DAILY_CAP_SOFT}h)`;
    }

    return { overallV8Severity, worstDesc, weeks: weekComps, dailyViolations, dailyWarnings };
}
