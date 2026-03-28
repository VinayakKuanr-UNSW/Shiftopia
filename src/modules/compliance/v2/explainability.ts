/**
 * Compliance Engine v2 — Delta Explainability
 *
 * Computes a structured before/after comparison so managers and employees
 * can understand EXACTLY what impact a proposed change has:
 *
 *   "Adding this shift increases peak daily hours from 8h → 14h on 2026-03-18
 *    — exceeds 12h limit. 14-day total: 44.0h → 50.0h (exceeds 48h visa cap)."
 *
 * Only generated in SIMULATED mode.
 */

import {
    ShiftV2,
    StateSummaryV2,
    DeltaExplanationV2,
    DeltaChange,
    ComplianceConfigV2,
} from './types';
import {
    shiftsInRollingWindow,
    groupByCalendarDay,
    workingDaysInWindow,
    computeMaxConsecutiveStreak,
    totalHoursInWindow,
    DaySegmentV2,
} from './windows';

// =============================================================================
// STATE SUMMARY
// =============================================================================

function computeStateSummary(
    shifts:         ShiftV2[],
    reference_date: string,
    config:         ComplianceConfigV2,
): StateSummaryV2 {
    const w28      = shiftsInRollingWindow(shifts, reference_date, 28);
    const w14      = shiftsInRollingWindow(shifts, reference_date, 14);
    const byDay    = groupByCalendarDay(shifts);
    const wDays    = workingDaysInWindow(byDay, reference_date, 28);
    const streak   = computeMaxConsecutiveStreak(wDays);

    // Find peak daily hours
    let peakHours = 0;
    let peakDate  = '';
    const fromDate28 = addDaysSimple(reference_date, -28);
    for (const [date, segs] of byDay) {
        if (date < fromDate28 || date > reference_date) continue;
        const dayHours = segs.reduce((sum, s: DaySegmentV2) => sum + s.hours, 0);
        if (dayHours > peakHours) { peakHours = dayHours; peakDate = date; }
    }

    return {
        total_hours_28d:       totalHoursInWindow(w28),
        total_hours_14d:       totalHoursInWindow(w14),
        working_days_28d:      wDays.length,
        max_consecutive_days:  streak,
        peak_daily_hours:      Math.round(peakHours * 100) / 100,
        peak_daily_hours_date: peakDate,
    };
}

/** Inline date offset to avoid circular import with windows.ts */
function addDaysSimple(dateStr: string, days: number): string {
    const ms = new Date(dateStr + 'T00:00:00Z').getTime() + days * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
}

// =============================================================================
// DELTA CHANGE BUILDER
// =============================================================================

function direction(b: number, a: number): DeltaChange['direction'] {
    if (a > b) return 'INCREASE';
    if (a < b) return 'DECREASE';
    return 'UNCHANGED';
}

function buildChanges(
    before: StateSummaryV2,
    after:  StateSummaryV2,
    config: ComplianceConfigV2,
): DeltaChange[] {
    const candidates: DeltaChange[] = [
        {
            metric:            'Peak daily hours',
            before_value:      before.peak_daily_hours,
            after_value:       after.peak_daily_hours,
            unit:              'h',
            threshold:         config.max_daily_hours,
            threshold_label:   'Daily maximum',
            direction:         direction(before.peak_daily_hours, after.peak_daily_hours),
            exceeds_threshold: after.peak_daily_hours > config.max_daily_hours,
        },
        {
            metric:            'Hours in 14-day window',
            before_value:      before.total_hours_14d,
            after_value:       after.total_hours_14d,
            unit:              'h',
            threshold:         config.student_visa_fortnightly_h,
            threshold_label:   'Student visa fortnightly cap',
            direction:         direction(before.total_hours_14d, after.total_hours_14d),
            exceeds_threshold: after.total_hours_14d > config.student_visa_fortnightly_h,
        },
        {
            metric:            'Hours in 28-day window',
            before_value:      before.total_hours_28d,
            after_value:       after.total_hours_28d,
            unit:              'h',
            direction:         direction(before.total_hours_28d, after.total_hours_28d),
            exceeds_threshold: false,
        },
        {
            metric:            'Working days (28-day)',
            before_value:      before.working_days_28d,
            after_value:       after.working_days_28d,
            unit:              'days',
            threshold:         config.max_working_days_per_28,
            direction:         direction(before.working_days_28d, after.working_days_28d),
            exceeds_threshold: after.working_days_28d > config.max_working_days_per_28,
        },
        {
            metric:            'Max consecutive days',
            before_value:      before.max_consecutive_days,
            after_value:       after.max_consecutive_days,
            unit:              'days',
            threshold:         config.max_consecutive_days,
            direction:         direction(before.max_consecutive_days, after.max_consecutive_days),
            exceeds_threshold: after.max_consecutive_days > config.max_consecutive_days,
        },
    ];

    return candidates.filter(c => c.direction !== 'UNCHANGED');
}

// =============================================================================
// NARRATIVE
// =============================================================================

function buildNarrative(
    before:           StateSummaryV2,
    after:            StateSummaryV2,
    candidate_shifts: ShiftV2[],
    config:           ComplianceConfigV2,
): string {
    const label = candidate_shifts.length === 1
        ? `Adding shift on ${candidate_shifts[0].shift_date} (${candidate_shifts[0].start_time}–${candidate_shifts[0].end_time})`
        : `Adding ${candidate_shifts.length} shifts`;

    const parts: string[] = [];

    if (after.peak_daily_hours !== before.peak_daily_hours) {
        const breach = after.peak_daily_hours > config.max_daily_hours
            ? ` — exceeds ${config.max_daily_hours}h limit` : '';
        parts.push(
            `${label} increases peak daily hours `
            + `from ${before.peak_daily_hours.toFixed(1)}h → ${after.peak_daily_hours.toFixed(1)}h `
            + `on ${after.peak_daily_hours_date}${breach}`
        );
    }

    if (after.total_hours_14d !== before.total_hours_14d) {
        const breach = after.total_hours_14d > config.student_visa_fortnightly_h
            ? ` — exceeds ${config.student_visa_fortnightly_h}h visa cap` : '';
        parts.push(
            `14-day total: ${before.total_hours_14d.toFixed(1)}h → ${after.total_hours_14d.toFixed(1)}h${breach}`
        );
    }

    if (after.max_consecutive_days !== before.max_consecutive_days) {
        const breach = after.max_consecutive_days > config.max_consecutive_days
            ? ` — exceeds ${config.max_consecutive_days}-day limit` : '';
        parts.push(
            `Consecutive-day streak: ${before.max_consecutive_days} → ${after.max_consecutive_days} days${breach}`
        );
    }

    if (after.working_days_28d !== before.working_days_28d) {
        parts.push(
            `Working days (28-day window): ${before.working_days_28d} → ${after.working_days_28d}`
        );
    }

    return parts.length > 0
        ? parts.join('. ') + '.'
        : 'No significant scheduling impact detected.';
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Computes a structured delta explanation comparing existing vs simulated state.
 * Should only be called when mode === 'SIMULATED'.
 */
export function computeDeltaExplanation(
    existing:         ShiftV2[],
    simulated:        ShiftV2[],
    candidate_shifts: ShiftV2[],
    reference_date:   string,
    config:           ComplianceConfigV2,
): DeltaExplanationV2 {
    const before  = computeStateSummary(existing,  reference_date, config);
    const after   = computeStateSummary(simulated, reference_date, config);
    const changes = buildChanges(before, after, config);
    const narrative = buildNarrative(before, after, candidate_shifts, config);

    return { before, after, changes, narrative };
}
