/**
 * Minimum Rest Gap Rule
 *
 * RULE_ID: MIN_REST_GAP
 * APPLIES_TO: add, assign, swap, bid
 * BLOCKING: true
 *
 * Default minimum rest between any two consecutive shifts: 10 hours (User Story 10).
 * A configuration toggle (input.rest_gap_hours) allows relaxing to 8 hours.
 *
 * Algorithm (F1 + F3 fix — replaces the old calendar-day-only approach):
 * ─────────────────────────────────────────────────────────────────────
 * All shifts (existing + candidate) are converted to absolute millisecond
 * [startMs, endMs] intervals anchored to UTC midnight of the shift_date.
 * The gap between two non-overlapping shifts is the positive distance
 * between one's endMs and the other's startMs.
 *
 * This correctly handles:
 *   (a) Cross-midnight shifts (F1) — a 22:00-06:00 shift on Day N has
 *       endMs = Day N midnight + 30 h = Day N+1 06:00. The actual 06:00
 *       boundary is used, not the old midnight cap that caused false negatives.
 *   (b) Same-calendar-day gaps (F3) — a 2 h break between two same-day
 *       shifts is now evaluated against the rest-gap threshold. Previously
 *       the rule only looked at adjacent calendar dates and missed intraday gaps.
 *   (c) Multi-day separation — trivially passes without extra logic.
 *
 * The previous buggy approach used getLatestEndTimeForDate() which capped
 * overnight shifts at 1440 (midnight) of the primary date. This reported a
 * gap of (candidateStart) minutes instead of (candidateStart - overflowMins),
 * producing false negatives for candidates starting before ~(minRest - overflow).
 */

import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';
import { parseTimeToMinutes, minutesToHours } from '../utils';

const DEFAULT_REST_HOURS = 10;

// =============================================================================
// ABSOLUTE TIMESTAMP CONVERSION
// =============================================================================

interface AbsoluteShift {
    startMs: number;
    endMs: number;
    label: string;  // Human-readable for violation messages
}

/**
 * Convert a shift_date + HH:mm times to absolute millisecond offsets.
 *
 * Anchored to UTC midnight of shift_date so DST has no effect on the
 * arithmetic (we treat times as "wall-clock minutes" relative to a fixed
 * reference, not as real UTC instants).
 *
 * Cross-midnight detection: if endMins <= startMins, the shift crosses
 * midnight and its end is placed on the next calendar day.
 */
function toAbsolute(
    shift_date: string,
    start_time: string,
    end_time: string
): AbsoluteShift {
    const [y, m, d] = shift_date.split('-').map(Number);
    const baseMidnightMs = Date.UTC(y, m - 1, d);

    const startMins = parseTimeToMinutes(start_time);
    const endMins   = parseTimeToMinutes(end_time);

    const startMs = baseMidnightMs + startMins * 60_000;
    const endMs   = endMins > startMins
        ? baseMidnightMs + endMins * 60_000
        // cross-midnight: end is on the next calendar day
        : baseMidnightMs + (24 * 60 + endMins) * 60_000;

    return { startMs, endMs, label: `${shift_date} ${start_time}–${end_time}` };
}

// =============================================================================
// VIOLATION RECORD
// =============================================================================

interface RestGapViolation {
    gapHours: number;
    otherLabel: string;
    /** 'after' = existing shift ends before candidate starts (gap is between existing-end → candidate-start)
     *  'before' = candidate ends before existing shift starts (gap is between candidate-end → existing-start) */
    direction: 'before' | 'after';
}

// =============================================================================
// RULE
// =============================================================================

export const MinRestGapRule: ComplianceRule = {
    id: 'MIN_REST_GAP',
    name: 'Rest Gap Between Shifts',
    description:
        'Minimum 10h rest required between any two consecutive shifts, ' +
        'including same-calendar-day gaps. Configurable to 8h relaxed mode.',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        const minRestHours = input.rest_gap_hours ?? DEFAULT_REST_HOURS;
        const minRestMs    = minRestHours * 3_600_000;
        const modeLabel    = minRestHours < DEFAULT_REST_HOURS
            ? ` (relaxed ${minRestHours}h mode)` : '';

        // F11 — data-quality guard
        if (
            input.shifts_window_days !== undefined &&
            input.shifts_window_days < 2
        ) {
            return {
                rule_id:  this.id,
                rule_name: this.name,
                status:  'warning',
                summary: 'Insufficient shift history for rest-gap check',
                details:
                    `shifts_window_days=${input.shifts_window_days}. ` +
                    'At least 2 days of history are required. Result may be inaccurate.',
                calculation: {
                    existing_hours: 0, candidate_hours: 0, total_hours: 0,
                    limit: minRestHours,
                    rest_gap_mode: minRestHours < DEFAULT_REST_HOURS ? 'relaxed' : 'standard',
                    data_quality_warning: true
                },
                blocking: false
            };
        }

        const { candidate_shift, existing_shifts } = input;

        const cand = toAbsolute(
            candidate_shift.shift_date,
            candidate_shift.start_time,
            candidate_shift.end_time
        );

        const candidateDurMins =
            parseTimeToMinutes(candidate_shift.end_time) > parseTimeToMinutes(candidate_shift.start_time)
                ? parseTimeToMinutes(candidate_shift.end_time) - parseTimeToMinutes(candidate_shift.start_time)
                : (24 * 60 - parseTimeToMinutes(candidate_shift.start_time)) + parseTimeToMinutes(candidate_shift.end_time);
        const candidateHours = minutesToHours(candidateDurMins);

        const violations: RestGapViolation[] = [];

        // Track the shortest observed gap in each direction for the
        // calculation payload (used by the UI timeline visualisation).
        let shortestAfterMs:  number | null = null; // gap: existing-end → candidate-start
        let shortestBeforeMs: number | null = null; // gap: candidate-end → existing-start

        for (const existing of existing_shifts) {
            // Same-day split shifts have no rest gap requirement — only cross-day
            // pairs (different shift_date) must satisfy the minimum rest gap.
            if (existing.shift_date === candidate_shift.shift_date) continue;

            const ex = toAbsolute(
                existing.shift_date,
                existing.start_time,
                existing.end_time
            );

            let gapMs: number;
            let direction: 'before' | 'after';

            if (cand.startMs >= ex.endMs) {
                // existing ends before candidate starts
                gapMs     = cand.startMs - ex.endMs;
                direction = 'after';
                if (shortestAfterMs === null || gapMs < shortestAfterMs) shortestAfterMs = gapMs;
            } else if (ex.startMs >= cand.endMs) {
                // candidate ends before existing starts
                gapMs     = ex.startMs - cand.endMs;
                direction = 'before';
                if (shortestBeforeMs === null || gapMs < shortestBeforeMs) shortestBeforeMs = gapMs;
            } else {
                // Overlap — handled by NO_OVERLAP rule; skip here
                continue;
            }

            // A gap of exactly 0 is an overlap (≤ 0 is handled above by the
            // overlap branch). We only flag positive gaps below threshold.
            if (gapMs > 0 && gapMs < minRestMs) {
                violations.push({ gapHours: gapMs / 3_600_000, otherLabel: ex.label, direction });
            }
        }

        const prevGapH = shortestAfterMs  !== null ? shortestAfterMs  / 3_600_000 : null;
        const nextGapH = shortestBeforeMs !== null ? shortestBeforeMs / 3_600_000 : null;

        // ── PASS ─────────────────────────────────────────────────────────────
        if (violations.length === 0) {
            const shortestGap =
                prevGapH !== null || nextGapH !== null
                    ? Math.min(prevGapH ?? Infinity, nextGapH ?? Infinity)
                    : null;

            return {
                rule_id:  this.id,
                rule_name: this.name,
                status:  'pass',
                summary: `Adequate rest gap (${minRestHours}h+ required${modeLabel})`,
                details: `All gaps between consecutive shifts meet the ${minRestHours}h minimum.`,
                calculation: {
                    existing_hours:     0,
                    candidate_hours:    candidateHours,
                    total_hours:        0,
                    limit:              minRestHours,
                    prev_day_gap_hours: prevGapH,
                    next_day_gap_hours: nextGapH,
                    shortest_gap_hours: shortestGap,
                    target_date:        candidate_shift.shift_date,
                    rest_gap_mode:      minRestHours < DEFAULT_REST_HOURS ? 'relaxed' : 'standard'
                },
                blocking: this.blocking
            };
        }

        // ── FAIL ─────────────────────────────────────────────────────────────
        // Sort by gap ascending so the worst (shortest) violation is first.
        violations.sort((a, b) => a.gapHours - b.gapHours);
        const worst = violations[0];

        const violationLines = violations.map(v => {
            const context = v.direction === 'after'
                ? `after existing shift  ${v.otherLabel}`
                : `before upcoming shift ${v.otherLabel}`;
            return `  • ${v.gapHours.toFixed(1)}h rest ${context} (min ${minRestHours}h)`;
        });

        return {
            rule_id:  this.id,
            rule_name: this.name,
            status:  'fail',
            summary:
                `Insufficient rest: ${worst.gapHours.toFixed(1)}h gap ` +
                `(min ${minRestHours}h${modeLabel})`,
            details:
                `${violations.length} rest-gap violation(s):\n` +
                violationLines.join('\n'),
            calculation: {
                existing_hours:     0,
                candidate_hours:    candidateHours,
                total_hours:        0,
                limit:              minRestHours,
                prev_day_gap_hours: prevGapH,
                next_day_gap_hours: nextGapH,
                shortest_gap_hours: worst.gapHours,
                violation_count:    violations.length,
                violations: violations.map(v => ({
                    gap_hours:   v.gapHours,
                    direction:   v.direction,
                    other_shift: v.otherLabel
                })),
                target_date:   candidate_shift.shift_date,
                rest_gap_mode: minRestHours < DEFAULT_REST_HOURS ? 'relaxed' : 'standard'
            },
            blocking: this.blocking
        };
    }
};

export default MinRestGapRule;
