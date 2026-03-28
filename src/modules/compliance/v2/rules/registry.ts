/**
 * Compliance Engine v2 — Rule Metadata Registry
 *
 * Central source of truth for each active rule's metadata:
 *   rule_type:      HARD (structural/legal) | SOFT (policy/contract)
 *   category:       TIME | LEGAL | CONTRACT | SKILL
 *   blocking_stage: ALWAYS | PUBLISH | NEVER
 *   overlaps_with:  rule IDs whose violations may co-occur with this rule
 *
 * Removed rules (files kept for reference, not registered):
 *   R04_MAX_WORKING_DAYS     — removed; R09 (consecutive days) is the authoritative work-pattern limit.
 *   R12_QUAL_EXPIRY          — merged into R11 (presence + expiry in one rule)
 */

import { RuleMeta } from '../types';

export const RULE_METADATA: Record<string, RuleMeta> = {
    R01_NO_OVERLAP: {
        rule_id:        'R01_NO_OVERLAP',
        rule_type:      'HARD',
        category:       'TIME',
        blocking_stage: 'ALWAYS',
        description:    'No two shifts may overlap in time.',
    },
    R02_MIN_SHIFT_LENGTH: {
        rule_id:        'R02_MIN_SHIFT_LENGTH',
        rule_type:      'HARD',
        category:       'TIME',
        blocking_stage: 'ALWAYS',
        description:    'Shift duration must be within limits (min 2h/3h/4h, max 12h).',
    },
    R03_MAX_DAILY_HOURS: {
        rule_id:        'R03_MAX_DAILY_HOURS',
        rule_type:      'HARD',
        category:       'TIME',
        blocking_stage: 'ALWAYS',
        description:    'Total worked hours on any calendar day must not exceed the maximum.',
        overlaps_with:  ['R07_REST_GAP'],
    },
    R05_STUDENT_VISA: {
        rule_id:        'R05_STUDENT_VISA',
        rule_type:      'HARD',
        category:       'LEGAL',
        blocking_stage: 'ALWAYS',
        description:    'Student visa holders must not exceed 48 hours per 14-day (fortnight) period.',
    },
    R06_ORD_HOURS_AVG: {
        rule_id:        'R06_ORD_HOURS_AVG',
        rule_type:      'SOFT',
        category:       'CONTRACT',
        blocking_stage: 'PUBLISH',
        description:    'Average ordinary hours over 4 weeks must not exceed contracted weekly rate.',
    },
    R07_REST_GAP: {
        rule_id:        'R07_REST_GAP',
        rule_type:      'HARD',
        category:       'TIME',
        blocking_stage: 'ALWAYS',
        description:    'Minimum rest gap required between any two consecutive shifts.',
        overlaps_with:  ['R03_MAX_DAILY_HOURS'],
    },
    R08_MEAL_BREAK: {
        rule_id:        'R08_MEAL_BREAK',
        rule_type:      'HARD',
        category:       'TIME',
        blocking_stage: 'ALWAYS',
        description:    'Mandatory meal break required for shifts over a certain duration.',
    },
    R09_MAX_CONSECUTIVE_DAYS: {
        rule_id:        'R09_MAX_CONSECUTIVE_DAYS',
        rule_type:      'SOFT',
        category:       'TIME',
        blocking_stage: 'PUBLISH',
        description:    'Maximum number of consecutive working days allowed in a streak.',
    },
    R10_ROLE_CONTRACT_MATCH: {
        rule_id:        'R10_ROLE_CONTRACT_MATCH',
        rule_type:      'HARD',
        category:       'CONTRACT',
        blocking_stage: 'ALWAYS',
        description:    'Employee must be contracted for the role required by each shift.',
    },
    R11_QUALIFICATIONS: {
        rule_id:        'R11_QUALIFICATIONS',
        rule_type:      'HARD',
        category:       'SKILL',
        blocking_stage: 'ALWAYS',
        description:    'Employee must hold all required and valid qualifications (not missing, not expired).',
    },

    // ── Advisory ─────────────────────────────────────────────────────────────
    R_AVAILABILITY_MATCH: {
        rule_id:        'R_AVAILABILITY_MATCH',
        rule_type:      'SOFT',
        category:       'AVAILABILITY',
        blocking_stage: 'NEVER',
        description:
            'Advisory check: candidate shift must not overlap a locked (assigned) interval '
            + 'and should fall within the employee\'s declared availability. '
            + 'Always WARNING; enforcement is context-dependent (MANUAL/AUTO only).',
    },
};
