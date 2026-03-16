/**
 * Split Shift Spread Constraint — Case #5
 *
 * Risk: A swap introduces a split shift where the window from the day's
 * first shift start to last shift end exceeds the allowed spread.
 *
 * Example:
 *   Morning shift: 06:00–10:00
 *   Evening shift: 20:00–24:00
 *   Spread = 18 hours → violates 12h spread limit
 *
 * Note: This is distinct from MAX_DAILY_HOURS (net working time).
 *   - MAX_DAILY_HOURS = sum of net worked hours per day (≤ 12h)
 *   - SPLIT_SHIFT_SPREAD = total day window (last_end − first_start, ≤ max_spread)
 *
 * The default max spread is 12 hours. Systems that allow split shifts may
 * configure a higher limit (e.g. 14h) via SolverConfig.max_split_spread_hours.
 */

import type { SolverConstraint, SwapScenario, SolverConfig, ConstraintViolation, SwapParty } from '../types';
import type { ShiftTimeRange } from '../../types';
import { parseTimeToMinutes, minutesToHours } from '../../utils';

const DEFAULT_MAX_SPREAD_HOURS = 12;

function getDaySpreadMinutes(
    shifts: ShiftTimeRange[],
    date: string,
): { firstStart: number; lastEnd: number; spreadMinutes: number } | null {
    const dayShifts = shifts.filter(s => s.shift_date === date);
    if (dayShifts.length < 2) return null; // Spread only matters with ≥2 shifts

    let firstStart = Infinity;
    let lastEnd = -Infinity;

    for (const s of dayShifts) {
        const start = parseTimeToMinutes(s.start_time);
        let end = parseTimeToMinutes(s.end_time);
        if (end <= start) end += 24 * 60; // cross-midnight

        if (start < firstStart) firstStart = start;
        if (end > lastEnd) lastEnd = end;
    }

    return {
        firstStart,
        lastEnd,
        spreadMinutes: lastEnd - firstStart,
    };
}

function evaluateParty(party: SwapParty, maxSpreadHours: number): ConstraintViolation {
    const targetDate = party.received_shift.shift_date;
    const maxSpreadMinutes = maxSpreadHours * 60;

    const spread = getDaySpreadMinutes(party.hypothetical_schedule, targetDate);

    if (spread && spread.spreadMinutes > maxSpreadMinutes) {
        const spreadHours = minutesToHours(spread.spreadMinutes);
        const firstStartH = String(Math.floor(spread.firstStart / 60)).padStart(2, '0');
        const firstStartM = String(spread.firstStart % 60).padStart(2, '0');
        const lastEndAbsolute = spread.lastEnd % (24 * 60);
        const lastEndH = String(Math.floor(lastEndAbsolute / 60)).padStart(2, '0');
        const lastEndM = String(lastEndAbsolute % 60).padStart(2, '0');

        return {
            constraint_id: 'SPLIT_SHIFT_SPREAD',
            constraint_name: 'Split Shift Spread',
            employee_id: party.employee_id,
            employee_name: party.name,
            status: 'fail',
            summary: `Day spread ${spreadHours.toFixed(1)}h exceeds ${maxSpreadHours}h limit on ${targetDate}`,
            details: `Shifts on ${targetDate} span from ${firstStartH}:${firstStartM} to ${lastEndH}:${lastEndM} — a ${spreadHours.toFixed(1)}h window (limit: ${maxSpreadHours}h).`,
            calculation: {
                existing_hours: 0,
                candidate_hours: 0,
                total_hours: spreadHours,
                limit: maxSpreadHours,
                spread_hours: spreadHours,
                first_start: `${firstStartH}:${firstStartM}`,
                last_end: `${lastEndH}:${lastEndM}`,
                target_date: targetDate,
            },
            blocking: true,
        };
    }

    return {
        constraint_id: 'SPLIT_SHIFT_SPREAD',
        constraint_name: 'Split Shift Spread',
        employee_id: party.employee_id,
        employee_name: party.name,
        status: 'pass',
        summary: spread
            ? `Day spread within ${maxSpreadHours}h limit (${minutesToHours(spread.spreadMinutes).toFixed(1)}h)`
            : `Single shift on ${targetDate} — no spread constraint`,
        details: spread
            ? `Shift window on ${targetDate}: ${minutesToHours(spread.spreadMinutes).toFixed(1)}h spread.`
            : `Only one shift on ${targetDate}, split-shift spread does not apply.`,
        calculation: {
            existing_hours: 0,
            candidate_hours: 0,
            total_hours: spread ? minutesToHours(spread.spreadMinutes) : 0,
            limit: maxSpreadHours,
        },
        blocking: true,
    };
}

export const SplitShiftSpreadConstraint: SolverConstraint = {
    id: 'SPLIT_SHIFT_SPREAD',
    name: 'Split Shift Spread',
    blocking: true,
    evaluate(scenario: SwapScenario, config: SolverConfig): ConstraintViolation[] {
        // Allow config override for workplaces permitting wider split shifts
        const maxSpreadHours = (config as SolverConfig & { max_split_spread_hours?: number })
            .max_split_spread_hours ?? DEFAULT_MAX_SPREAD_HOURS;
        return [
            evaluateParty(scenario.partyA, maxSpreadHours),
            evaluateParty(scenario.partyB, maxSpreadHours),
        ];
    },
};
