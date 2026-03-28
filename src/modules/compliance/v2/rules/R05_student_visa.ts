/**
 * R05 — Student Visa Restriction (48h per fortnight)
 *
 * Only applies to employees with contract_type === 'STUDENT_VISA'.
 * Evaluates the 14-day (fortnight) rolling window.
 *
 * BLOCKING always — this is a legal requirement regardless of stage.
 */

import { RuleEvaluatorV2, RuleHitV2 } from '../types';
import { totalHoursInWindow } from '../windows';

export const R05_student_visa: RuleEvaluatorV2 = (ctx) => {
    if (ctx.employee.contract_type !== 'STUDENT_VISA') return [];

    const limit = ctx.config.student_visa_fortnightly_h;
    const total = totalHoursInWindow(ctx.window_14d);

    if (total <= limit) return [];

    return [{
        rule_id:  'R05_STUDENT_VISA',
        severity: 'BLOCKING',
        message:
            `${total.toFixed(2)}h in the 14-day window exceeds the student visa limit of ${limit}h.`,
        resolution_hint: 'Reduce scheduled hours within this fortnight to comply with visa work restrictions.',
        affected_shifts: ctx.window_14d.map(s => s.shift_id),
    } satisfies RuleHitV2];
};
