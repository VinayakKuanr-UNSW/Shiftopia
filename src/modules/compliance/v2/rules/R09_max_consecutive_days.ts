/**
 * R09 — Maximum Consecutive Working Days
 *
 * Computes the longest streak of consecutive calendar days where at least
 * one shift segment exists, using the full shifts_by_day index (cross-midnight safe).
 *
 * Severity: WARNING at DRAFT, BLOCKING at PUBLISH (via severity-resolver).
 */

import { RuleEvaluatorV2, RuleHitV2 } from '../types';
import { workingDaysInWindow, computeMaxConsecutiveStreak } from '../windows';

export const R09_max_consecutive_days: RuleEvaluatorV2 = (ctx) => {
    const max         = ctx.config.max_consecutive_days;
    const workingDays = workingDaysInWindow(ctx.shifts_by_day, ctx.reference_date, 28);
    const streak      = computeMaxConsecutiveStreak(workingDays);

    if (streak <= max) return [];

    return [{
        rule_id:  'R09_MAX_CONSECUTIVE_DAYS',
        severity: 'WARNING',    // escalated to BLOCKING at PUBLISH by severity-resolver
        message:
            `${streak} consecutive working days detected — maximum is ${max}.`,
        resolution_hint: 'Insert at least one rest day to break the consecutive streak.',
        affected_shifts: ctx.window_28d.map(s => s.shift_id),
    } satisfies RuleHitV2];
};
