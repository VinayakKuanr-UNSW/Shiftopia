/**
 * Break Requirements Rule
 *
 * RULE_ID: BREAK_REQUIREMENTS
 * APPLIES_TO: add, assign, swap, bid
 * BLOCKING: true
 *
 * National Employment Standards (NES) — Fair Work Act s.101:
 *
 *   Shift > 5 consecutive hours  → 1 unpaid meal break of ≥ 30 minutes required.
 *   Shift > 10 consecutive hours → 2 unpaid meal breaks of ≥ 30 minutes each required.
 *
 * The rule inspects the shift's unpaid_break_minutes field to verify the
 * required break time has been scheduled. A shift with zero break time and
 * a duration exceeding the threshold is flagged as a blocking failure.
 *
 * Note on gross vs. net duration:
 *   Duration for threshold comparison uses GROSS minutes (start → end), because
 *   the entitlement triggers based on time at work, not paid time. The check of
 *   whether enough break has been allocated uses unpaid_break_minutes directly.
 */

import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';
import { parseTimeToMinutes, minutesToHours } from '../utils';

// NES thresholds (hours)
const FIRST_BREAK_TRIGGER_HOURS  = 5;   // > 5h gross → 1 break required
const SECOND_BREAK_TRIGGER_HOURS = 10;  // > 10h gross → 2 breaks required
const BREAK_DURATION_MINUTES     = 30;  // Each break must be ≥ 30 min

function getGrossDurationMinutes(
    start_time: string,
    end_time: string
): number {
    const startMins = parseTimeToMinutes(start_time);
    const endMins   = parseTimeToMinutes(end_time);
    if (endMins > startMins) return endMins - startMins;
    return (24 * 60 - startMins) + endMins; // cross-midnight
}

export const BreakRequirementsRule: ComplianceRule = {
    id: 'BREAK_REQUIREMENTS',
    name: 'Mandatory Meal Break',
    description:
        'NES: shifts > 5h require a 30-min unpaid break; ' +
        'shifts > 10h require two 30-min unpaid breaks.',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        if (!input.employee_id) {
            return {
                rule_id:   this.id,
                rule_name: this.name,
                status:    'pass',
                summary:   'Shift is unassigned — break check skipped',
                details:   'Break requirements only apply to assigned shifts.',
                calculation: {
                    existing_hours: 0, candidate_hours: 0,
                    total_hours:    0, limit: 0
                },
                blocking: false
            };
        }

        const { candidate_shift } = input;
        const grossMins    = getGrossDurationMinutes(
            candidate_shift.start_time,
            candidate_shift.end_time
        );
        const grossHours   = minutesToHours(grossMins);
        const scheduledBreakMins = candidate_shift.unpaid_break_minutes ?? 0;

        // Determine how many breaks are required
        let requiredBreaks = 0;
        if (grossHours > SECOND_BREAK_TRIGGER_HOURS) {
            requiredBreaks = 2;
        } else if (grossHours > FIRST_BREAK_TRIGGER_HOURS) {
            requiredBreaks = 1;
        }

        const requiredBreakMins = requiredBreaks * BREAK_DURATION_MINUTES;

        // No break needed for short shifts
        if (requiredBreaks === 0) {
            return {
                rule_id:   this.id,
                rule_name: this.name,
                status:    'pass',
                summary:   `No break required (shift is ${grossHours.toFixed(1)}h — under ${FIRST_BREAK_TRIGGER_HOURS}h threshold)`,
                details:   `Shift gross duration ${grossHours.toFixed(1)}h does not exceed the ${FIRST_BREAK_TRIGGER_HOURS}h NES trigger.`,
                calculation: {
                    existing_hours:        0,
                    candidate_hours:       grossHours,
                    total_hours:           grossHours,
                    limit:                 0,
                    gross_duration_hours:  grossHours,
                    required_breaks:       0,
                    required_break_mins:   0,
                    scheduled_break_mins:  scheduledBreakMins
                },
                blocking: false
            };
        }

        const breakSufficient = scheduledBreakMins >= requiredBreakMins;

        if (breakSufficient) {
            return {
                rule_id:   this.id,
                rule_name: this.name,
                status:    'pass',
                summary:   `${requiredBreaks} break(s) scheduled (${scheduledBreakMins} min ≥ ${requiredBreakMins} min required)`,
                details:
                    `Shift of ${grossHours.toFixed(1)}h requires ${requiredBreaks} × ` +
                    `${BREAK_DURATION_MINUTES}-min unpaid break(s). ` +
                    `${scheduledBreakMins} min has been allocated.`,
                calculation: {
                    existing_hours:       0,
                    candidate_hours:      grossHours,
                    total_hours:          grossHours,
                    limit:                requiredBreakMins,
                    gross_duration_hours: grossHours,
                    required_breaks:      requiredBreaks,
                    required_break_mins:  requiredBreakMins,
                    scheduled_break_mins: scheduledBreakMins
                },
                blocking: this.blocking
            };
        }

        // Determine deficit description
        const deficitMins = requiredBreakMins - scheduledBreakMins;
        const breakWord   = requiredBreaks === 1 ? 'break' : 'breaks';
        const scheduledDesc = scheduledBreakMins === 0
            ? 'none scheduled'
            : `${scheduledBreakMins} min scheduled`;

        return {
            rule_id:   this.id,
            rule_name: this.name,
            status:    'fail',
            summary:
                `Insufficient break: ${scheduledBreakMins} min scheduled, ` +
                `${requiredBreakMins} min required for a ${grossHours.toFixed(1)}h shift`,
            details:
                `A shift of ${grossHours.toFixed(1)}h requires ${requiredBreaks} × ` +
                `${BREAK_DURATION_MINUTES}-min unpaid ${breakWord} (NES s.101). ` +
                `${scheduledDesc}. Deficit: ${deficitMins} min.`,
            calculation: {
                existing_hours:       0,
                candidate_hours:      grossHours,
                total_hours:          grossHours,
                limit:                requiredBreakMins,
                gross_duration_hours: grossHours,
                required_breaks:      requiredBreaks,
                required_break_mins:  requiredBreakMins,
                scheduled_break_mins: scheduledBreakMins,
                deficit_mins:         deficitMins
            },
            blocking: this.blocking
        };
    }
};

export default BreakRequirementsRule;
