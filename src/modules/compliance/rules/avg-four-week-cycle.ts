/**
 * Ordinary Hours Averaging Rule
 *
 * RULE_ID: AVG_FOUR_WEEK_CYCLE
 * APPLIES_TO: add, assign, swap, bid
 * BLOCKING: true
 *
 * Employees must average 38 hours per week (EBA).
 * All four rolling window sizes are enforced simultaneously:
 *
 *   1-week  (7 days)  →  38h max
 *   2-weeks (14 days) →  76h max
 *   3-weeks (21 days) → 114h max
 *   4-weeks (28 days) → 152h max
 *
 * ALGORITHM (O(W × n), W = 4 window sizes):
 *   1. Build a daily net-hours map from all shifts (existing + candidate).
 *   2. Sort by date and build prefix sums.
 *   3. For each window size, sweep every possible end-date position with a
 *      two-pointer to find the worst (highest-hours) rolling window.
 *   4. The rule FAILS if any window size's worst position exceeds its limit.
 *
 * WHY NOT anchor the window to the candidate shift date?
 *   A single anchor only catches violations in windows that happen to end
 *   on the candidate date.  Clustered high-hour weeks before the candidate
 *   date (e.g. weeks 2+3 violating the 14-day cap) are silently missed.
 *   Scanning every position guarantees full coverage.
 */

import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';
import { differenceInMinutes } from 'date-fns';
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';

const WEEKLY_LIMIT_HOURS = 38;
const MS_PER_DAY = 86_400_000;

// ─── Window sizes to check ────────────────────────────────────────────────────
const WINDOW_SPECS = [
    { weeks: 1, days: 7  },
    { weeks: 2, days: 14 },
    { weeks: 3, days: 21 },
    { weeks: 4, days: 28 },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CycleData {
    weeks:                number;
    total_hours:          number;   // worst rolling window hours for this size
    limit:                number;   // weeks × WEEKLY_LIMIT_HOURS
    average_weekly_hours: number;
    status:               'pass' | 'fail';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getShiftMinutes(
    s: { shift_date: string; start_time: string; end_time: string; unpaid_break_minutes?: number },
    tz: string = SYDNEY_TZ,
): number {
    const start = parseZonedDateTime(s.shift_date, s.start_time, tz);
    const end   = parseZonedDateTime(s.shift_date, s.end_time, tz);
    let mins    = differenceInMinutes(end, start);
    if (mins < 0) mins += 1440;                              // cross-midnight
    return Math.max(0, mins - (s.unpaid_break_minutes || 0));
}

/** YYYY-MM-DD → epoch ms (UTC midnight) */
function dateToMs(d: string): number {
    return new Date(d + 'T00:00:00Z').getTime();
}

// ─── Rule ─────────────────────────────────────────────────────────────────────

export const AvgFourWeekCycleRule: ComplianceRule = {
    id: 'AVG_FOUR_WEEK_CYCLE',
    name: 'Ordinary Hours Averaging',
    description: 'Employees must average ≤38h/week across any rolling 1/2/3/4-week period (EBA).',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        if (!input.employee_id) {
            return {
                rule_id:   this.id,
                rule_name: this.name,
                status:    'pass',
                summary:   'Shift is unassigned',
                details:   'Compliance checks skipped for unassigned shift',
                calculation: {
                    existing_hours: 0, candidate_hours: 0,
                    total_hours: 0, limit: 152,
                    average_weekly_hours: 0, cycle_weeks: 4,
                    weekly_limit: WEEKLY_LIMIT_HOURS,
                },
                blocking: false,
            };
        }

        const { candidate_shift, existing_shifts } = input;
        const tz        = input.org_timezone ?? SYDNEY_TZ;
        const cycleWeeks: 1 | 2 | 3 | 4 = input.averaging_cycle_weeks ?? 4;

        // ── Step 1: daily net-hours map ───────────────────────────────────────
        // All hours attributed to shift_date (cross-midnight shifts are minor
        // edge cases in rolling-window totals; attribution to start date is
        // consistent with the V1 engine contract).
        const dailyHoursMap = new Map<string, number>();

        const addShift = (s: typeof candidate_shift) => {
            const hrs = getShiftMinutes(s, tz) / 60;
            dailyHoursMap.set(s.shift_date, (dailyHoursMap.get(s.shift_date) ?? 0) + hrs);
        };

        existing_shifts.forEach(addShift);
        addShift(candidate_shift);

        const sortedDates = Array.from(dailyHoursMap.keys()).sort();
        const n           = sortedDates.length;

        // ── Step 2: prefix sums ───────────────────────────────────────────────
        // prefix[i] = total hours for sortedDates[0 .. i-1]
        const prefix = new Array<number>(n + 1).fill(0);
        for (let i = 0; i < n; i++) {
            prefix[i + 1] = prefix[i] + (dailyHoursMap.get(sortedDates[i]) ?? 0);
        }

        // ── Step 3: scan every window size with two-pointer ───────────────────
        const allCycles: CycleData[] = [];
        let hasViolation = false;
        let worstCycle: CycleData | null = null;

        for (const spec of WINDOW_SPECS) {
            const limit = spec.weeks * WEEKLY_LIMIT_HOURS;

            let startPtr   = 0;
            let worstHours = 0;

            for (let endIdx = 0; endIdx < n; endIdx++) {
                const endMs         = dateToMs(sortedDates[endIdx]);
                const winStartMs    = endMs - (spec.days - 1) * MS_PER_DAY;
                const winStartDate  = new Date(winStartMs).toISOString().slice(0, 10);

                // Advance startPtr past dates before this window's start
                while (startPtr <= endIdx && sortedDates[startPtr] < winStartDate) {
                    startPtr++;
                }

                const windowHours = prefix[endIdx + 1] - prefix[startPtr];
                if (windowHours > worstHours) worstHours = windowHours;
            }

            const status: 'pass' | 'fail' = worstHours > limit ? 'fail' : 'pass';
            const entry: CycleData = {
                weeks:                spec.weeks,
                total_hours:          parseFloat(worstHours.toFixed(1)),
                limit,
                average_weekly_hours: parseFloat((worstHours / spec.weeks).toFixed(1)),
                status,
            };

            allCycles.push(entry);

            if (status === 'fail') {
                hasViolation = true;
                // Track the most-violated window (highest ratio above limit)
                if (!worstCycle || (worstHours - limit) > (worstCycle.total_hours - worstCycle.limit)) {
                    worstCycle = entry;
                }
            }
        }

        // Convenience refs
        const activeCycle = allCycles.find(c => c.weeks === cycleWeeks)!;
        const candidateHours = getShiftMinutes(candidate_shift, tz) / 60;

        if (hasViolation && worstCycle) {
            const wks  = worstCycle.weeks;
            const lbl  = wks === 1 ? '1-week' : `${wks}-week`;
            return {
                rule_id:   this.id,
                rule_name: this.name,
                status:    'fail',
                summary:   `Exceeds ${worstCycle.limit}h in ${lbl} window `
                           + `(worst: ${worstCycle.total_hours}h / avg ${worstCycle.average_weekly_hours}h/wk)`,
                details:   `Rolling ${lbl} window contains ${worstCycle.total_hours}h, `
                           + `exceeding the ${WEEKLY_LIMIT_HOURS}h/wk × ${wks} = ${worstCycle.limit}h EBA limit. `
                           + `All rolling window positions were checked — not just the window ending on the candidate date.`,
                calculation: {
                    existing_hours:       parseFloat((worstCycle.total_hours - candidateHours).toFixed(2)),
                    candidate_hours:      parseFloat(candidateHours.toFixed(2)),
                    total_hours:          worstCycle.total_hours,
                    limit:                worstCycle.limit,
                    average_weekly_hours: worstCycle.average_weekly_hours,
                    cycle_weeks:          worstCycle.weeks,
                    weekly_limit:         WEEKLY_LIMIT_HOURS,
                    all_cycles:           allCycles,
                },
                blocking: this.blocking,
            };
        }

        return {
            rule_id:   this.id,
            rule_name: this.name,
            status:    'pass',
            summary:   `Within all rolling window limits `
                       + `(${cycleWeeks}-wk worst: ${activeCycle.total_hours}h / ${activeCycle.limit}h)`,
            details:   `All rolling 1/2/3/4-week windows checked at every position. `
                       + `No window exceeded its EBA limit.`,
            calculation: {
                existing_hours:       parseFloat((activeCycle.total_hours - candidateHours).toFixed(2)),
                candidate_hours:      parseFloat(candidateHours.toFixed(2)),
                total_hours:          activeCycle.total_hours,
                limit:                activeCycle.limit,
                average_weekly_hours: activeCycle.average_weekly_hours,
                cycle_weeks:          cycleWeeks,
                weekly_limit:         WEEKLY_LIMIT_HOURS,
                all_cycles:           allCycles,
            },
            blocking: this.blocking,
        };
    },
};
