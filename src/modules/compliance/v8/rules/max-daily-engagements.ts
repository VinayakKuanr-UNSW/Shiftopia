import { V8Hit, V8RuleEvaluator, V8Shift } from '../types';
import { shiftStartDate } from '../utils/rest-gap';

/**
 * V8 Rule: Maximum Daily Engagements — Casual (ICC EBA clause 35.4(f))
 *
 * A casual Team Member may be engaged for "no more than two (2) separate
 * engagements (shifts) on any one day" (clause 35.4(f)). This is the numeric
 * companion to the split-shift structure (clause 39): where split-shift.ts
 * governs the ≤3h gap between the *two parts* of a PART_TIME / FLEXI_PART_TIME
 * split, this rule enforces the hard count ceiling for casuals — the group the
 * clause is actually written for.
 *
 * Scope (policy-locked 2026-07-05):
 *   - CASUAL only. Full-time / part-time / flexi are not capped here (FT is
 *     salaried full-day; PT/flexi split structure is owned by clause 39). See
 *     [[eba-compliance-audit-remediation]].
 *   - STUDENT_VISA is modelled as its own contract type and is intentionally
 *     out of scope for this literal casual reading.
 *
 * Training exemption: training/onboarding engagements do NOT count toward the
 * two — a casual may work two rostered shifts plus a training shift the same
 * day. Consistent with the training precedence baked into minEngagementRule.
 *
 * Candidate scoping: a day is only flagged when the current operation actually
 * touches it (at least one counted shift is a candidate). Purely historical
 * days are never re-flagged, mirroring split-shift.ts.
 *
 * Blocking: this is a hard EBA ceiling, so it BLOCKS (unlike the split-shift
 * gap, which only warns).
 */

/** Clause 35.4(f) — the maximum number of separate engagements a casual may work per day. */
export const CASUAL_MAX_DAILY_ENGAGEMENTS = 2;

export const maxDailyEngagementsRule: V8RuleEvaluator = (ctx) => {
    const { shifts, employee } = ctx;

    // Clause 35.4(f) is written for casuals only.
    if (employee.contract_type !== 'CASUAL') return [];

    // Group by calendar day, excluding training engagements (they don't count).
    const perDay = new Map<string, V8Shift[]>();
    for (const s of shifts) {
        if (s.is_training === true) continue; // training exempt
        const day = shiftStartDate(s);
        if (!day) continue;
        const list = perDay.get(day) || [];
        list.push(s);
        perDay.set(day, list);
    }

    const hits: V8Hit[] = [];

    for (const [day, dayShifts] of perDay.entries()) {
        if (dayShifts.length <= CASUAL_MAX_DAILY_ENGAGEMENTS) continue;

        // Never re-flag a day made up entirely of committed history — only when
        // the current operation adds/changes at least one of that day's shifts.
        const touchesCandidate = dayShifts.some(s => s.is_candidate !== false);
        if (!touchesCandidate) continue;

        hits.push({
            rule_id: 'V8_MAX_DAILY_ENGAGEMENTS',
            rule_name: 'Maximum Daily Engagements (Casual)',
            status: 'BLOCKING',
            summary: `Casual exceeds 2 engagements on ${day} (${dayShifts.length})`,
            details:
                `A casual Team Member may work no more than ${CASUAL_MAX_DAILY_ENGAGEMENTS} separate ` +
                `engagements on any one day (ICC EBA cl. 35.4(f)). This roster places ${dayShifts.length} ` +
                `non-training shifts on ${day}. Training shifts are exempt and not counted.`,
            affected_shifts: dayShifts.map(s => s.id),
            blocking: true,
            calculation: {
                engagement_count: dayShifts.length,
                max_engagements: CASUAL_MAX_DAILY_ENGAGEMENTS,
                date: day,
            },
        });
    }

    return hits;
};
