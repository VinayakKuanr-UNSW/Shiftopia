/**
 * R06 — Ordinary Hours Averaging (Rolling Window)
 *
 * EBA-compliant rolling-window check for ordinary hours averaging.
 * Replaces the previous "4-week average" approach with a correct prefix-sum
 * scan that checks EVERY possible rolling window position simultaneously.
 *
 * Three window sizes are checked, each with a hard EBA cap:
 *
 *   2-week (14-day)  → max contracted_weekly_hours × 2 (× tolerance)
 *   3-week (21-day)  → max contracted_weekly_hours × 3 (× tolerance)
 *   4-week (28-day)  → max contracted_weekly_hours × 4 (× tolerance)
 *
 * Algorithm (O(W × n), W = 3 window sizes):
 *   1. Segment all ordinary-hours shifts into per-calendar-day NET hours.
 *      Cross-midnight shifts are split correctly via segmentShiftByDay.
 *   2. Sort days chronologically and build prefix sums over daily net hours.
 *   3. For each window spec, sweep with a two-pointer to find the worst-case
 *      rolling window — any single position that exceeds the cap is a violation.
 *
 * Key differences from the old implementation:
 *   - Old: computed a single 28-day average (totalHours/4) vs contracted/week.
 *   - New: scans ALL window positions (any start date, not just reference_date).
 *   - New: uses daily net hours (segmentShiftByDay), not per-shift totals.
 *   - New: enforces 2-week and 3-week limits in addition to the 4-week limit.
 *
 * Only meaningful for FULL_TIME / PART_TIME contracts with a contracted weekly rate.
 * Severity: WARNING at DRAFT, BLOCKING at PUBLISH (via severity-resolver).
 */

import { RuleEvaluatorV2, RuleHitV2 } from '../types';
import { segmentShiftByDay, dateToMs } from '../windows';

const MS_PER_DAY = 86_400_000;

/** Rolling window specs — each checked independently at every position */
const ROLLING_WINDOWS = [
    { weeks: 2, days: 14 },
    { weeks: 3, days: 21 },
    { weeks: 4, days: 28 },
] as const;

export const R06_ordinary_hours_avg: RuleEvaluatorV2 = (ctx) => {
    const { contracted_weekly_hours, contract_type } = ctx.employee;

    // Not applicable for casual / student-visa (no contracted weekly rate)
    if (contract_type === 'CASUAL' || contract_type === 'STUDENT_VISA') return [];
    if (!contracted_weekly_hours || contracted_weekly_hours <= 0) return [];

    // Only ordinary-hours shifts contribute to the averaging rule
    const ordinaryShifts = ctx.simulated_shifts.filter(s => s.is_ordinary_hours);
    if (ordinaryShifts.length === 0) return [];

    // -------------------------------------------------------------------------
    // Step 1: Build daily net hours map (cross-midnight safe)
    //   segmentShiftByDay splits cross-midnight shifts into correct per-day
    //   segments and attributes unpaid breaks to the primary (start) day.
    // -------------------------------------------------------------------------
    const dailyHoursMap = new Map<string, number>();
    for (const shift of ordinaryShifts) {
        for (const seg of segmentShiftByDay(shift)) {
            dailyHoursMap.set(seg.date, (dailyHoursMap.get(seg.date) ?? 0) + seg.hours);
        }
    }

    const sortedDates = Array.from(dailyHoursMap.keys()).sort();
    const n = sortedDates.length;
    if (n === 0) return [];

    // -------------------------------------------------------------------------
    // Step 2: Prefix sums
    //   prefix[i] = total ordinary hours in sortedDates[0 .. i-1]
    //   windowSum(startIdx, endIdx) = prefix[endIdx+1] - prefix[startIdx]
    // -------------------------------------------------------------------------
    const prefix = new Array<number>(n + 1).fill(0);
    for (let i = 0; i < n; i++) {
        prefix[i + 1] = prefix[i] + (dailyHoursMap.get(sortedDates[i]) ?? 0);
    }

    const hits: RuleHitV2[] = [];

    // -------------------------------------------------------------------------
    // Step 3: Scan each rolling window with O(n) two-pointer sweep
    //   For each end position, find the earliest start position that falls
    //   within the window, then compute the sum via prefix subtraction.
    //   Track the worst (highest hours) window position for reporting.
    // -------------------------------------------------------------------------
    for (const win of ROLLING_WINDOWS) {
        const hardLimit = contracted_weekly_hours * win.weeks;
        const softLimit = hardLimit * ctx.config.ord_avg_tolerance_pct;

        let startPtr   = 0;
        let worstHours = 0;
        let worstEndIdx = -1;

        for (let endIdx = 0; endIdx < n; endIdx++) {
            const endMs          = dateToMs(sortedDates[endIdx]);
            // Window is [endDate-(win.days-1), endDate] inclusive
            const winStartMs     = endMs - (win.days - 1) * MS_PER_DAY;
            const winStartDate   = new Date(winStartMs).toISOString().slice(0, 10);

            // Advance startPtr past dates that fall before this window's start
            while (startPtr <= endIdx && sortedDates[startPtr] < winStartDate) {
                startPtr++;
            }

            const windowHours = prefix[endIdx + 1] - prefix[startPtr];
            if (windowHours > worstHours) {
                worstHours  = windowHours;
                worstEndIdx = endIdx;
            }
        }

        // No violation for this window size — move on
        if (worstHours <= softLimit || worstEndIdx < 0) continue;

        // Derive the calendar span of the worst window for the message
        const worstEndDate   = sortedDates[worstEndIdx];
        const worstStartDate = new Date(
            dateToMs(worstEndDate) - (win.days - 1) * MS_PER_DAY,
        ).toISOString().slice(0, 10);

        // Collect shift IDs that fall within the worst window
        const affectedShifts = ordinaryShifts.filter(
            s => s.shift_date >= worstStartDate && s.shift_date <= worstEndDate,
        );

        hits.push({
            rule_id:  'R06_ORD_HOURS_AVG',
            severity: 'WARNING',    // escalated to BLOCKING at PUBLISH by severity-resolver
            message:
                `Ordinary hours ${worstHours.toFixed(1)}h in ${win.weeks}-week window `
                + `(${worstStartDate} – ${worstEndDate}) exceeds ${hardLimit}h EBA limit `
                + `(contracted ${contracted_weekly_hours}h/week × ${win.weeks} weeks).`,
            resolution_hint:
                `Reduce ordinary-hours shifts so no ${win.weeks}-week rolling period `
                + `exceeds ${hardLimit}h.`,
            affected_shifts: affectedShifts.map(s => s.shift_id),
        } satisfies RuleHitV2);
    }

    return hits;
};
