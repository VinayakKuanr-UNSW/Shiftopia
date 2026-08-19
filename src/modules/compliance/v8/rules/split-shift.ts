import { V8Hit, V8RuleEvaluator } from '../types';
import { consecutivePairs, shiftStartDate } from '../utils/rest-gap';

/**
 * V8 Rule: Split Shift (ICC EBA clause 39)
 *
 * A split shift is where a Team Member works their ordinary hours in one day
 * in two parts (definition 7.14) with "no more than a three (3) hour gap
 * between each engagement" (clause 39.4).
 *
 * Applicability:
 *   - Part-time & flexible part-time ONLY (clause 39.1).
 *   - Excludes casuals (clause 28.4 — no split-shift allowance for casuals).
 *     Their two-engagements case is governed by cl 35.4(f), which caps them at
 *     two per day, and by the 12h daily WORKED ceiling — NOT by the cl 39.2
 *     spread cap, which reaches only the split-shift structure they are
 *     excluded from.
 *   - Excludes multi-hire engagements (clause 39.4).
 *
 * This rule enforces the 3h maximum gap as a WARNING (not blocking): a larger
 * intraday gap means the pairing is not a compliant split-shift structure, but
 * the EBA does not expressly prohibit it — the hard 12h spread cap
 * (V8_SPLIT_SHIFT_SPREAD, clause 39.2) remains the blocking limit. That rule
 * gates on the same PT/FPT scope as this one; the two are limbs of a single
 * provision and must not diverge on who they reach. A compliant
 * (≤3h) split shift produces no hit; the Split Shift Allowance ($11.13/shift,
 * Schedule 2) that attaches to it is a payroll concern handled downstream.
 */

/** Clause 39.4 — the maximum gap that still qualifies as a split shift. */
export const SPLIT_SHIFT_MAX_GAP_MINUTES = 180; // 3h

export const splitShiftRule: V8RuleEvaluator = (ctx) => {
    const { shifts, employee } = ctx;

    // Split shifts apply only to part-time & flexible part-time (clause 39.1).
    const eligible =
        employee.contract_type === 'PART_TIME' ||
        employee.contract_type === 'FLEXI_PART_TIME';
    if (!eligible) return [];

    const hits: V8Hit[] = [];

    for (const { a, b, gapMinutes, sameStartDay } of consecutivePairs(shifts)) {
        if (!sameStartDay) continue;                                    // cross-day → rest-gap rule owns it
        if (gapMinutes < 0) continue;                                   // overlap → NO_OVERLAP owns it
        if (a.shift_type === 'MULTI_HIRE' || b.shift_type === 'MULTI_HIRE') continue; // clause 39.4
        // Never re-flag pure committed history — only when the current
        // operation touches at least one side of the pair.
        if (a.is_candidate === false && b.is_candidate === false) continue;
        if (gapMinutes <= SPLIT_SHIFT_MAX_GAP_MINUTES) continue;        // compliant split shift → allowance (payroll)

        const gapHours = Math.round((gapMinutes / 60) * 10) / 10;
        hits.push({
            rule_id: 'V8_SPLIT_SHIFT',
            rule_name: 'Split Shift',
            status: 'WARNING',
            summary: `Split-shift gap exceeds 3h (${gapHours}h)`,
            details:
                `The ${gapHours}h gap between the two engagements on ${shiftStartDate(a)} exceeds the ` +
                `3h maximum for a compliant split shift (ICC EBA cl. 39.4). The 12h spread cap ` +
                `(cl. 39.2) still applies as the hard limit.`,
            affected_shifts: [a.id, b.id],
            blocking: false,
            calculation: {
                gap_minutes: gapMinutes,
                gap_hours: gapHours,
                max_gap_minutes: SPLIT_SHIFT_MAX_GAP_MINUTES,
                is_split_shift: false,
            },
        });
    }

    return hits;
};
