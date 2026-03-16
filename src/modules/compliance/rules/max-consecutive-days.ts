/**
 * Maximum Consecutive Working Days Rule
 *
 * RULE_ID: MAX_CONSECUTIVE_DAYS
 * APPLIES_TO: add, assign, swap, bid
 * BLOCKING: true
 *
 * An employee must not work more than MAX_CONSECUTIVE (20) consecutive
 * calendar days without at least one full day off.
 *
 * Algorithm:
 * ──────────
 * 1. Collect all unique working dates from existing_shifts plus the candidate.
 * 2. Walk forward and backward from the candidate date, counting how many
 *    consecutive dates in the working-date set adjoin the candidate.
 * 3. If the resulting streak exceeds MAX_CONSECUTIVE, the assignment fails.
 *
 * The walk is bounded to the 28-day context window so we don't have to
 * iterate the entire calendar. Any existing streak that already exceeds the
 * limit in historical data will still be caught when the candidate shift is
 * the "last" day of that streak.
 *
 * F11 — if the caller declares shifts_window_days < MAX_CONSECUTIVE, we
 * surface a data-quality warning because the streak could be longer than
 * the history we can see.
 */

import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';

const MAX_CONSECUTIVE = 20;

// =============================================================================
// DATE HELPERS
// =============================================================================

/** Add N calendar days to a YYYY-MM-DD string. */
function addDays(dateStr: string, n: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.toISOString().slice(0, 10);
}

/** Subtract 1 calendar day from a YYYY-MM-DD string. */
function prevDay(dateStr: string): string {
    return addDays(dateStr, -1);
}

/** Add 1 calendar day to a YYYY-MM-DD string. */
function nextDay(dateStr: string): string {
    return addDays(dateStr, 1);
}

// =============================================================================
// RULE
// =============================================================================

export const MaxConsecutiveDaysRule: ComplianceRule = {
    id: 'MAX_CONSECUTIVE_DAYS',
    name: 'Maximum Consecutive Working Days',
    description:
        `Employees must not work more than ${MAX_CONSECUTIVE} consecutive ` +
        'calendar days without a full day off.',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        if (!input.employee_id) {
            return {
                rule_id:   this.id,
                rule_name: this.name,
                status:    'pass',
                summary:   'Shift is unassigned — consecutive-day check skipped',
                details:   'Consecutive-day limits only apply to assigned shifts.',
                calculation: {
                    existing_hours: 0, candidate_hours: 0,
                    total_hours:    0, limit: MAX_CONSECUTIVE
                },
                blocking: false
            };
        }

        const { candidate_shift, existing_shifts } = input;
        const candidateDate = candidate_shift.shift_date;

        // F11 — data-quality guard: warn if history might be too short to
        // detect a streak that started before the provided window.
        const insufficientWindow =
            input.shifts_window_days !== undefined &&
            input.shifts_window_days < MAX_CONSECUTIVE;

        // Build a fast-lookup set of all working dates.
        const workingDates = new Set<string>(existing_shifts.map(s => s.shift_date));
        workingDates.add(candidateDate);

        // Walk backward from candidateDate counting consecutive days.
        let streakBefore = 0;
        let cur = prevDay(candidateDate);
        // Limit the walk to MAX_CONSECUTIVE steps to avoid unbounded iteration.
        for (let i = 0; i < MAX_CONSECUTIVE; i++) {
            if (!workingDates.has(cur)) break;
            streakBefore++;
            cur = prevDay(cur);
        }

        // Walk forward from candidateDate counting consecutive days.
        let streakAfter = 0;
        cur = nextDay(candidateDate);
        for (let i = 0; i < MAX_CONSECUTIVE; i++) {
            if (!workingDates.has(cur)) break;
            streakAfter++;
            cur = nextDay(cur);
        }

        // Total consecutive streak including candidate day itself.
        const totalStreak = streakBefore + 1 + streakAfter;

        // Compute the actual start/end date of the streak for the message.
        const streakStart = addDays(candidateDate, -streakBefore);
        const streakEnd   = addDays(candidateDate,  streakAfter);

        // ── PASS ────────────────────────────────────────────────────────────
        if (totalStreak <= MAX_CONSECUTIVE) {
            const warningNote = insufficientWindow
                ? ` (Note: only ${input.shifts_window_days}d of history provided — ` +
                  'streak may extend further back.)'
                : '';

            return {
                rule_id:   this.id,
                rule_name: this.name,
                status:    insufficientWindow ? 'warning' : 'pass',
                summary:   insufficientWindow
                    ? `${totalStreak} consecutive days — history may be incomplete`
                    : `${totalStreak} consecutive day(s) — within ${MAX_CONSECUTIVE}-day limit`,
                details:
                    `Consecutive streak: ${streakStart} → ${streakEnd} ` +
                    `(${totalStreak} day(s)).${warningNote}`,
                calculation: {
                    existing_hours:   0,
                    candidate_hours:  0,
                    total_hours:      0,
                    limit:            MAX_CONSECUTIVE,
                    consecutive_days: totalStreak,
                    streak_start:     streakStart,
                    streak_end:       streakEnd,
                    streak_before:    streakBefore,
                    streak_after:     streakAfter,
                    data_quality_warning: insufficientWindow
                },
                blocking: false
            };
        }

        // ── FAIL ─────────────────────────────────────────────────────────────
        return {
            rule_id:   this.id,
            rule_name: this.name,
            status:    'fail',
            summary:
                `Exceeds ${MAX_CONSECUTIVE} consecutive days ` +
                `(${totalStreak} days: ${streakStart} → ${streakEnd})`,
            details:
                `Assigning this shift would create ${totalStreak} consecutive working days ` +
                `(${streakStart} to ${streakEnd}) without a day off. ` +
                `Maximum allowed is ${MAX_CONSECUTIVE} consecutive days.`,
            calculation: {
                existing_hours:   0,
                candidate_hours:  0,
                total_hours:      0,
                limit:            MAX_CONSECUTIVE,
                consecutive_days: totalStreak,
                streak_start:     streakStart,
                streak_end:       streakEnd,
                streak_before:    streakBefore,
                streak_after:     streakAfter
            },
            blocking: this.blocking
        };
    }
};

export default MaxConsecutiveDaysRule;
