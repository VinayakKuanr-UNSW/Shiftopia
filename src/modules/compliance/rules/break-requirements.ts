/**
 * Break Requirements Rule
 * 
 * RULE_ID: BREAK_REQUIREMENTS
 * LIMIT: 
 * - 5h shift -> 30m unpaid break
 * - 10h shift -> 60m unpaid break
 * APPLIES_TO: add, assign, swap, bid
 * BLOCKING: false (warning only)
 * 
 * Ensures shifts have adequate unpaid breaks recorded.
 */

import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';
import {
    parseTimeToMinutes,
    minutesToHours
} from '../utils';

export const BreakRequirementsRule: ComplianceRule = {
    id: 'BREAK_REQUIREMENTS',
    name: 'Break requirements',
    description: 'Shifts must include adequate unpaid breaks based on duration (5h->30m, 10h->60m)',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: false,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        const { candidate_shift } = input;

        const start = parseTimeToMinutes(candidate_shift.start_time);
        let end = parseTimeToMinutes(candidate_shift.end_time);

        if (end <= start) end += 24 * 60;

        const grossDuration = end - start;
        const unpaidBreak = candidate_shift.unpaid_break_minutes || 0;

        let requiredBreak = 0;
        if (grossDuration > 10 * 60) {
            requiredBreak = 60;
        } else if (grossDuration > 5 * 60) {
            requiredBreak = 30;
        }

        const violates = unpaidBreak < requiredBreak;

        return {
            rule_id: this.id,
            rule_name: this.name,
            status: violates ? 'warning' : 'pass',
            summary: violates
                ? `Missing required break (${requiredBreak}m needed)`
                : `Break requirements met`,
            details: violates
                ? `Shift of ${minutesToHours(grossDuration).toFixed(1)}h requires ${requiredBreak}m unpaid break (recorded: ${unpaidBreak}m)`
                : `Recorded break: ${unpaidBreak}m (required: ${requiredBreak}m)`,
            calculation: {
                existing_hours: 0,
                candidate_hours: 0,
                total_hours: 0,
                limit: requiredBreak,
                gross_duration_minutes: grossDuration,
                recorded_break_minutes: unpaidBreak
            },
            blocking: this.blocking
        };
    }
};

export default BreakRequirementsRule;
