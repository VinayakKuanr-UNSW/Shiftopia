/**
 * Compliance Rule Registry — the table.
 *
 * 33 rules: 12 shape, 21 labour. See `./types.ts` for why this exists and which
 * fields are machine-verified.
 *
 * REGISTERED AS IMPLEMENTED, NOT AS PROPOSED. Several rules diverge from the
 * agreement — the tier on the rest pauses, the per-day limb of the meal break.
 * Those are recorded in `knownGap` and left alone. A registry describing an
 * intended future state cannot be checked against the code, which would make it
 * the fifth stale copy rather than the one source of truth.
 *
 * CLAUSES DELIBERATELY NOT MODELLED
 * ---------------------------------
 * The same principle forbids registering a rule nothing emits — `registry-parity`
 * would report it as a phantom, which is precisely the failure this table exists
 * to stop. So the obligations below have no entry, and are listed here instead so
 * that "absent from the registry" never has to mean "nobody noticed".
 *
 *   cl 12.4(c)(b), cl 12.5(c)(b) — ONLINE TRAINING is "paid on the basis of the
 *     time it would reasonably take ... as nominated by the Employer": no fixed
 *     minimum at all. `is_training` cannot tell an online block from an on-site
 *     one, so the layer applies the 2-hour on-site floor to both. Strict in the
 *     employee's favour, and one shift flag away from being right.
 *
 *   cl 13.1(e) — MULTI-HIRE minimum engagement is 3h, or 2h where the separate
 *     engagement starts within one hour of the Team Member's usual rostered
 *     finish. `shift_type: 'MULTI_HIRE'` exists and reaches the rest-gap rules
 *     (cl 13.1(f) / cl 40.3's 8h), but not the minimum-engagement tiers.
 *
 *   cl 12.4(a), cl 35.3(a) — FLEXIBLE PART-TIME must be engaged for a minimum of
 *     624 and a maximum of 1,976 ordinary hours PER ANNUM. An annual envelope
 *     needs a year of history; nothing here holds one, and the longest window any
 *     rule looks at is 56 days.
 *
 *   Sch 3 §3.1(b) — full-time Security work an "even time" roster: equal days on
 *     and days off across the 8-week cycle. Structural, and only checkable across
 *     a whole cycle. V8_FT_DAYS_OFF exempts them rather than testing it.
 */

import type { RuleSpec } from './types';

const eba = (...clauses: string[]) => ({ source: 'eba' as const, clauses });

export const RULE_REGISTRY: Readonly<Record<string, RuleSpec>> = Object.freeze({

    // =========================================================================
    // LAYER 1 — SHIFT SHAPE
    // Decidable from one shift alone. Runs at create/edit.
    // =========================================================================

    SHAPE_VALID_RANGE: {
        id: 'SHAPE_VALID_RANGE',
        name: 'Valid Time Range',
        tier: 'BLOCKING',
        layer: 'SHAPE',
        category: 'STRUCTURE',
        employment: 'ALL',
        authority: { source: 'operational', clauses: [] },
        engines: { shape: true, v8: false, solver: null },
        description: 'A shift must have both a start and an end, and end after it starts.',
    },

    SHAPE_BREAK_EXCEEDS_SHIFT: {
        id: 'SHAPE_BREAK_EXCEEDS_SHIFT',
        name: 'Break Longer Than Shift',
        tier: 'BLOCKING',
        layer: 'SHAPE',
        category: 'STRUCTURE',
        employment: 'ALL',
        authority: { source: 'operational', clauses: [] },
        engines: { shape: true, v8: false, solver: null },
        description: 'The unpaid break must leave some working time in the shift.',
    },

    SHAPE_MAX_DURATION: {
        id: 'SHAPE_MAX_DURATION',
        name: 'Maximum Shift Duration',
        tier: 'BLOCKING',
        layer: 'SHAPE',
        category: 'TIME',
        employment: 'ALL',
        authority: eba('cl 35.1(d)', 'cl 35.2(d)', 'cl 35.3(d)', 'cl 35.4(c)'),
        engines: { shape: true, v8: false, solver: null },
        description: 'A single shift may not exceed 12 net ordinary hours.',
    },

    SHAPE_SPREAD_GUARDRAIL: {
        id: 'SHAPE_SPREAD_GUARDRAIL',
        name: 'Spread of Hours Guardrail',
        tier: 'WARNING',
        layer: 'SHAPE',
        category: 'TIME',
        employment: 'ALL',
        authority: { source: 'policy', clauses: [], instrument: 'ICC Sydney scheduling guideline' },
        engines: { shape: true, v8: false, solver: null },
        description:
            'Gross span from start to finish, breaks included, should not exceed 12 hours. ' +
            'House guideline, advisory.',
    },

    SHAPE_FT_MIN_DAY: {
        id: 'SHAPE_FT_MIN_DAY',
        name: 'Full-Time Minimum Ordinary Day',
        tier: 'BLOCKING',
        layer: 'SHAPE',
        category: 'TIME',
        employment: ['FT'],
        authority: eba('cl 35.1(c)'),
        engines: { shape: true, v8: false, solver: null },
        description: 'A full-time shift must provide at least 7.6 net ordinary hours.',
        knownGap:
            'cl 35.1(c) lets a full-timer "voluntarily agree to work less than 7.6 ordinary hours ' +
            'per day when such hours are designed to provide … additional leisure time". No such ' +
            'agreement is recorded anywhere, so the rule is enforced unconditionally. Blocking is ' +
            'the safe default, but the waiver needs a named, audited override or it will be ' +
            'worked around.',
    },

    SHAPE_MIN_ENGAGEMENT: {
        id: 'SHAPE_MIN_ENGAGEMENT',
        name: 'Minimum Engagement',
        tier: 'BLOCKING',
        layer: 'SHAPE',
        category: 'TIME',
        employment: ['PT', 'FPT', 'CASUAL'],
        authority: eba('cl 12.3(e)', 'cl 12.4(c)', 'cl 12.5(c)', 'cl 35.2(e)'),
        engines: { shape: true, v8: false, solver: null },
        description:
            'Plain part-time is a flat 3h net with no exceptions. Flexible part-time and casual ' +
            'get 3h, reduced to 2h for training on a non-event day and raised to 4h on a Sunday.',
        knownGap:
            'Two tiers of cl 12 are unreachable. cl 12.4(c)(b)/12.5(c)(b) put NO minimum on ' +
            'online training done at home or off site ("the time it would reasonably take"), and ' +
            '`is_training` cannot tell it from an on-site block, so the 2h on-site floor is ' +
            'applied to both — strict in the Team Member\'s favour. cl 13.1(e) gives multi-hire ' +
            'its own 3h/2h pair, keyed on starting within an hour of the usual rostered finish; ' +
            '`shift_type` carries MULTI_HIRE as far as the rest-gap rules but not to here.',
    },

    SHAPE_MIN_ENGAGEMENT_PH: {
        id: 'SHAPE_MIN_ENGAGEMENT_PH',
        name: 'Public Holiday Minimum Engagement',
        tier: 'BLOCKING',
        layer: 'SHAPE',
        category: 'TIME',
        employment: ['PT', 'FPT', 'CASUAL'],
        authority: eba('cl 56.2'),
        engines: { shape: true, v8: false, solver: null },
        description:
            'A shift on a public holiday must be at least 4 net hours. Full-time is exempt only ' +
            'because SHAPE_FT_MIN_DAY already requires 7.6h.',
    },

    SHAPE_MEAL_BREAK: {
        id: 'SHAPE_MEAL_BREAK',
        name: 'Meal Break Requirement',
        tier: 'BLOCKING',
        layer: 'SHAPE',
        category: 'TIME',
        employment: 'ALL',
        authority: eba('cl 36.1', 'Sch 3 §3.2(a)', 'Sch 3 §5.3(a)'),
        engines: { shape: true, v8: false, solver: null },
        description:
            'More than 5h net requires a meal break of at least 30 minutes — unpaid under ' +
            'cl 36.1, paid for security roles under Schedule 3.',
        knownGap:
            'Enforces the per-SHIFT reading only. cl 36.1 says "more than five (5) hours ON ANY ONE ' +
            'DAY", and a day worked in two parts can cross five hours with neither part doing so. ' +
            'That limb is V8_DAILY_MEAL_BREAK in the labour layer, the only place both engagements ' +
            'are visible; this entry stays recorded so the split is deliberate rather than assumed.',
    },

    SHAPE_MEAL_BREAK_CEILING: {
        id: 'SHAPE_MEAL_BREAK_CEILING',
        name: 'Meal Break Ceiling',
        tier: 'BLOCKING',
        layer: 'SHAPE',
        category: 'TIME',
        employment: 'ALL',
        authority: eba('cl 36.1'),
        engines: { shape: true, v8: false, solver: null },
        description: 'A meal break may not exceed 60 minutes.',
    },

    SHAPE_SECURITY_PAID_BREAK: {
        id: 'SHAPE_SECURITY_PAID_BREAK',
        name: 'Security Meal Break Must Be Paid',
        tier: 'BLOCKING',
        layer: 'SHAPE',
        category: 'CONTRACT',
        employment: 'ALL',
        authority: eba('Sch 3 §3.2(a)', 'Sch 3 §5.3(a)', 'Sch 3 §5.3(c)'),
        engines: { shape: true, v8: false, solver: null },
        description:
            'A security shift may not carry an unpaid meal break — Schedule 3 makes it paid, on ' +
            'the basis the member stays available to respond.',
    },

    SHAPE_REST_PAUSE_1: {
        id: 'SHAPE_REST_PAUSE_1',
        name: 'First Rest Pause',
        tier: 'BLOCKING',
        layer: 'SHAPE',
        category: 'TIME',
        employment: 'ALL',
        authority: eba('cl 37.1'),
        engines: { shape: true, v8: false, solver: null },
        description: 'A paid 15-minute rest pause is due after 4 consecutive ordinary hours.',
        knownGap:
            'Raised as BLOCKING. cl 37.1 creates a paid entitlement taken "at times to suit the ' +
            'convenience of the Employer" (cl 37.4), which is weaker ground for refusing to save a ' +
            'shift than cl 36.1 gives the meal break. Recorded as implemented; retiering is a ' +
            'deliberate decision, not a cleanup.',
    },

    SHAPE_REST_PAUSE_2: {
        id: 'SHAPE_REST_PAUSE_2',
        name: 'Second Rest Pause',
        tier: 'BLOCKING',
        layer: 'SHAPE',
        category: 'TIME',
        employment: 'ALL',
        authority: eba('cl 37.2', 'cl 37.3'),
        engines: { shape: true, v8: false, solver: null },
        description:
            'A second paid 15-minute rest pause is due after 8 consecutive ordinary hours, ' +
            'excluding the meal break.',
        knownGap: 'Raised as BLOCKING — same reasoning as SHAPE_REST_PAUSE_1.',
    },

    // =========================================================================
    // LAYER 2 — LABOUR COMPLIANCE
    // Needs a person, or more than one shift. Runs at assignment/bid/swap/solve.
    // =========================================================================

    V8_NO_OVERLAP: {
        id: 'V8_NO_OVERLAP',
        name: 'No Overlap',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'TIME',
        employment: 'ALL',
        authority: { source: 'operational', clauses: [] },
        engines: { shape: false, v8: true, solver: 'HC-2' },
        description: 'No two shifts assigned to one employee may overlap in time.',
    },

    V8_LEAVE_CONFLICT: {
        id: 'V8_LEAVE_CONFLICT',
        name: 'Approved Leave',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'TIME',
        employment: 'ALL',
        authority: eba('Part E'),
        engines: { shape: false, v8: true, solver: 'HC-5 (eligibility)' },
        description: 'A shift may not fall on a date the employee has approved leave.',
    },

    V8_QUALIFICATIONS: {
        id: 'V8_QUALIFICATIONS',
        name: 'Qualifications',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'SKILL',
        employment: 'ALL',
        authority: eba('cl 66', 'cl 67'),
        engines: { shape: false, v8: true, solver: 'HC-5' },
        description: 'The employee must hold every qualification the shift requires.',
    },

    V8_QUALIFICATION_EXPIRED: {
        id: 'V8_QUALIFICATION_EXPIRED',
        name: 'Expired Qualification',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'SKILL',
        employment: 'ALL',
        authority: eba('cl 66', 'cl 67'),
        engines: { shape: false, v8: true, solver: 'HC-5' },
        description: 'A required qualification must not have expired by the shift date.',
    },

    V8_EMPLOYMENT_TARGET: {
        id: 'V8_EMPLOYMENT_TARGET',
        name: 'Employment Target',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'CONTRACT',
        employment: 'ALL',
        authority: { source: 'operational', clauses: [], instrument: 'shifts.target_employment_type' },
        engines: { shape: false, v8: true, solver: 'HC-5c' },
        description:
            "Only staff whose contract matches the shift's target employment type may be " +
            'assigned, including the flexible-part-time narrowing.',
    },

    V8_MIN_REST_GAP: {
        id: 'V8_MIN_REST_GAP',
        name: 'Minimum Rest Gap',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'TIME',
        employment: 'ALL',
        authority: eba('cl 40.1', 'cl 40.2', 'cl 40.3', 'cl 13.1(f)'),
        engines: { shape: false, v8: true, solver: 'HC-3' },
        description:
            'At least 10 hours between shifts; 8 by written agreement, and 8 after a multi-hire ' +
            'engagement.',
    },

    V8_MAX_DAILY_HOURS: {
        id: 'V8_MAX_DAILY_HOURS',
        name: 'Maximum Daily Hours',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'TIME',
        employment: 'ALL',
        authority: eba('cl 35.1(d)', 'cl 35.2(d)', 'cl 35.3(d)', 'cl 35.4(c)'),
        engines: { shape: false, v8: true, solver: 'HC-4' },
        description: 'Total hours worked on any one calendar day may not exceed 12.',
    },

    V8_SPLIT_SHIFT_SPREAD: {
        id: 'V8_SPLIT_SHIFT_SPREAD',
        name: 'Split-Shift Spread',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'TIME',
        // cl 39.1 and cl 7.14 confine split shifts to PT and FPT; cl 28.4
        // excludes casuals from the structure entirely.
        employment: ['PT', 'FPT'],
        authority: eba('cl 39.2', 'cl 39.1', 'cl 7.14'),
        engines: { shape: false, v8: true, solver: 'HC-9' },
        description:
            'Where a split shift is worked, first start to last end less meal and rest breaks may ' +
            'not exceed 12 hours.',
    },

    V8_CASUAL_SECURITY_SPREAD: {
        id: 'V8_CASUAL_SECURITY_SPREAD',
        name: 'Casual Security Daily Spread',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'TIME',
        // Sch 3 §5.3 covers casual EVENT security specifically.
        employment: ['CASUAL'],
        authority: eba('Sch 3 §5.3(g)', 'Sch 3 §1.1'),
        engines: { shape: false, v8: true, solver: 'HC-9' },
        description:
            'A casual Event Security Team Member working two shifts in one day may span no more ' +
            'than 12 hours, measured GROSS — the schedule states no exclusion for breaks, and ' +
            'Sch 3 §5.3(a) already makes the meal break paid.',
    },

    V8_CASUAL_SECURITY_ENGAGEMENT: {
        id: 'V8_CASUAL_SECURITY_ENGAGEMENT',
        name: 'Casual Security Two-Shift Engagement',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'TIME',
        employment: ['CASUAL'],
        authority: eba('Sch 3 §5.3(g)'),
        engines: { shape: false, v8: true, solver: 'HC-13' },
        description:
            'Where a casual Event Security Team Member works two shifts in one day, each engagement ' +
            'must be at least 3 hours — a flat floor that displaces the 2-hour training concession ' +
            'in Sch 3 §5.3(e).',
    },

    V8_SPLIT_SHIFT: {
        id: 'V8_SPLIT_SHIFT',
        name: 'Split Shift',
        tier: 'WARNING',
        layer: 'LABOUR',
        category: 'TIME',
        employment: ['PT', 'FPT'],
        authority: eba('cl 39.4'),
        engines: { shape: false, v8: true, solver: null },
        description:
            'Where a day is worked in two parts, the gap between them may not exceed 3 hours. ' +
            'Does not apply to a multi-hire engagement.',
    },

    V8_MULTI_HIRE_ELIGIBILITY: {
        id: 'V8_MULTI_HIRE_ELIGIBILITY',
        name: 'Multi-Hire Eligibility',
        tier: 'WARNING',
        layer: 'LABOUR',
        category: 'CONTRACT',
        employment: 'ALL',
        authority: eba('cl 13.1(e)', 'cl 13.1(f)', 'cl 40.3'),
        engines: { shape: false, v8: true, solver: null },
        description:
            'A separate multi-hire engagement runs at least 3 hours, or 2 if it starts within an ' +
            'hour of the usual rostered finish, and is followed by an 8-hour break.',
    },

    V8_MAX_DAILY_ENGAGEMENTS: {
        id: 'V8_MAX_DAILY_ENGAGEMENTS',
        name: 'Maximum Daily Engagements (Casual)',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'LEGAL',
        employment: ['CASUAL'],
        authority: eba('cl 35.4(f)'),
        engines: { shape: false, v8: true, solver: 'HC-4c' },
        description:
            'A casual may work at most 2 engagements in one day, totalling no more than 12 hours.',
    },

    V8_DAILY_MEAL_BREAK: {
        id: 'V8_DAILY_MEAL_BREAK',
        name: 'Daily Meal Break',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'TIME',
        employment: 'ALL',
        authority: eba('cl 36.1', 'Sch 3 §3.2(a)', 'Sch 3 §5.3(a)'),
        engines: { shape: false, v8: true, solver: 'HC-13' },
        description:
            'A day worked in more than one part must still offer a meal break of at least 30 ' +
            'minutes once more than 5 hours are worked. The gap between engagements counts.',
        knownGap:
            'HC-13 models this PAIRWISE, which is exact for two engagements and misses a breach ' +
            'that emerges only from three or more — 2h+2h+2h at fifteen-minute gaps is six hours ' +
            'worked with no qualifying break while no pair exceeds five. cl 35.4(f) caps casuals ' +
            'at two engagements and permanents effectively never hold three in a day, so this is ' +
            'out of reach in practice; the labour layer catches it at commit either way.',
    },

    V8_20_IN_28: {
        id: 'V8_20_IN_28',
        name: '20 Days in 28 Limit',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'TIME',
        employment: 'ALL',
        authority: eba('cl 35.1(e)', 'cl 35.2(f)', 'cl 35.3(h)', 'cl 35.4(e)'),
        engines: { shape: false, v8: true, solver: 'HC-4b' },
        description: 'No more than 20 worked days in any rolling 28-day window.',
    },

    V8_STREAK_LIMIT: {
        id: 'V8_STREAK_LIMIT',
        name: 'Maximum Consecutive Days',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'TIME',
        employment: ['FPT'],
        authority: eba('cl 35.3(g)'),
        engines: { shape: false, v8: true, solver: 'HC-4 (streak)' },
        description:
            'A flexible part-timer may work at most 10 consecutive days without a day off.',
    },

    V8_STUDENT_VISA_LIMIT: {
        id: 'V8_STUDENT_VISA_LIMIT',
        name: 'Student Visa 48h Limit',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'LEGAL',
        employment: 'ALL',
        authority: { source: 'statute', clauses: [], instrument: 'Migration Act 1958 (Cth), visa condition 8105' },
        engines: { shape: false, v8: true, solver: 'HC-12' },
        description: 'A student visa holder may not exceed 48 hours per fortnight.',
    },

    V8_ORD_HOURS_AVG: {
        id: 'V8_ORD_HOURS_AVG',
        name: 'Ordinary Hours Averaging',
        tier: 'BLOCKING',
        layer: 'LABOUR',
        category: 'CONTRACT',
        employment: ['FT', 'PT', 'FPT'],
        authority: eba('cl 35.1(a)', 'cl 35.2(b)', 'cl 35.3(b)', 'Sch 3 §3.1(d)'),
        engines: { shape: false, v8: true, solver: 'HC-4' },
        description:
            'Average ordinary hours must not exceed 38/week over a cycle of up to 4 weeks — or ' +
            '42/week over 8 weeks for full-time security under Schedule 3.',
    },

    V8_ORD_HOURS_CONTRACTED: {
        id: 'V8_ORD_HOURS_CONTRACTED',
        name: 'Above Contracted Hours',
        tier: 'WARNING',
        layer: 'LABOUR',
        category: 'CONTRACT',
        employment: ['PT', 'FPT'],
        authority: eba('cl 12.3(d)'),
        engines: { shape: false, v8: true, solver: null },
        description:
            'Hours above a part-timer’s agreed pattern require their written consent, which may ' +
            'be withdrawn at any time.',
    },

    V8_ORD_HOURS_PEAK: {
        id: 'V8_ORD_HOURS_PEAK',
        name: 'Ordinary Hours Peak',
        tier: 'WARNING',
        layer: 'LABOUR',
        category: 'CONTRACT',
        employment: ['FT', 'PT', 'FPT'],
        authority: eba('cl 35.1(a)'),
        engines: { shape: false, v8: true, solver: null },
        description:
            'Flags a single week running well above the contracted rate even where the multi-week ' +
            'average still complies.',
    },

    V8_FT_DAYS_OFF: {
        id: 'V8_FT_DAYS_OFF',
        name: 'Full-Time Paired Days Off',
        tier: 'WARNING',
        layer: 'LABOUR',
        category: 'TIME',
        employment: ['FT'],
        authority: eba('cl 35.1(e)'),
        engines: { shape: false, v8: true, solver: null },
        description:
            'A full-timer should average two consecutive days off each week of the work cycle.',
        knownGap:
            'Advisory by design: cl 35.1(e) ends "unless otherwise mutually agreed", so this is ' +
            'waivable and cannot block. Exempt for full-time security, whose Sch 3 §3.1(b) ' +
            '"even time" roster is a different pattern entirely.',
    },

    V8_AVAILABILITY_CONFLICT: {
        id: 'V8_AVAILABILITY_CONFLICT',
        name: 'Availability Match',
        tier: 'WARNING',
        layer: 'LABOUR',
        category: 'AVAILABILITY',
        employment: 'ALL',
        authority: { source: 'policy', clauses: [], instrument: 'Roster preferences' },
        engines: { shape: false, v8: true, solver: 'HC-5d/5e' },
        description:
            'A shift should fall inside the employee’s declared availability and clear of any ' +
            'stated unavailability.',
    },
});
