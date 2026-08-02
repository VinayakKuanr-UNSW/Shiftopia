import { V8Hit, V8RuleEvaluator } from '../types';
import { consecutivePairs, shiftStartDate } from '../utils/rest-gap';

/**
 * V8 Rule: Multi-Hire Eligibility (ICC EBA clause 13.1(f))
 *
 * A genuine multi-hire engagement — typically a separate role/department
 * booking on the same day — qualifies for the reduced 2h minimum engagement
 * (cl 13, payroll-side) and the 8h rest break (cl 40.3, `minRestGapRule`)
 * instead of the standard split-shift treatment. Audit M-1: nothing checked
 * that a MULTI_HIRE-flagged pair was actually a separate engagement rather
 * than the SAME role split across two shift records — which would let the
 * reduced floor / relaxed rest gap be used to effectively split a single
 * continuous engagement and dodge the split-shift 3h-gap rule or daily/
 * weekly overtime.
 *
 * WARNING, not blocking: a same-role multi-hire pairing is unusual but not
 * expressly prohibited by the EBA text (a genuine second, separate booking
 * for the same role later that day is conceivable) — this flags the pattern
 * for a manager to confirm rather than silently paying the eligibility-gated
 * rates.
 */
export const multiHireEligibilityRule: V8RuleEvaluator = (ctx) => {
    const { shifts } = ctx;
    const hits: V8Hit[] = [];

    for (const { a, b, sameStartDay } of consecutivePairs(shifts)) {
        if (!sameStartDay) continue;
        if (a.shift_type !== 'MULTI_HIRE' && b.shift_type !== 'MULTI_HIRE') continue;
        // Never re-flag pure committed history — only when the current
        // operation touches at least one side of the pair.
        if (a.is_candidate === false && b.is_candidate === false) continue;
        if (!a.role_id || !b.role_id || a.role_id !== b.role_id) continue; // different role → genuinely eligible

        hits.push({
            rule_id: 'V8_MULTI_HIRE_ELIGIBILITY',
            rule_name: 'Multi-Hire Eligibility',
            status: 'WARNING',
            summary: 'Multi-hire pairing is in the same role',
            details:
                `Both engagements on ${shiftStartDate(a)} are flagged MULTI_HIRE but share the same role. ` +
                `Clause 13.1(f)'s reduced 2h minimum engagement and 8h rest break are intended for a ` +
                `genuinely separate hire — confirm this isn't a single continuous engagement split to ` +
                `reset the split-shift gap or overtime clock.`,
            affected_shifts: [a.id, b.id],
            blocking: false,
            calculation: {
                same_role: true,
                role_id: a.role_id,
            },
        });
    }

    return hits;
};
