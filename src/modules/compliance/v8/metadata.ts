/**
 * V8 Compliance Engine — Rule Metadata
 * 
 * Central registry for rule descriptions and categories.
 */

export interface V8RuleMeta {
    id:          string;
    name:        string;
    category:    'TIME' | 'LEGAL' | 'CONTRACT' | 'SKILL' | 'AVAILABILITY';
    description: string;
}

export const V8_RULE_METADATA: Record<string, V8RuleMeta> = {
    V8_LEAVE_CONFLICT: {
        id: 'V8_LEAVE_CONFLICT',
        name: 'Approved Leave',
        category: 'TIME',
        description: 'A shift must not fall on a date the employee has approved leave.'
    },
    V8_NO_OVERLAP: {
        id: 'V8_NO_OVERLAP',
        name: 'No Overlap',
        category: 'TIME',
        description: 'No two shifts may overlap in time.'
    },
    // Minimum engagement and the full-time 7.6h ordinary-day floor are no longer
    // V8 rules — they depend only on the shift, so they moved to
    // `@/modules/compliance/shape` (SHAPE_MIN_ENGAGEMENT / SHAPE_FT_MIN_DAY) and
    // run at shift creation rather than at assignment. See v8/engine.ts.
    V8_FT_DAYS_OFF: {
        id: 'V8_FT_DAYS_OFF',
        name: 'Full-Time Paired Days Off',
        category: 'TIME',
        description: 'Full-time employees must have, on average, two consecutive days off each week during the work cycle (cl 35.1(e)). Waivable by mutual agreement, so advisory.'
    },
    V8_MAX_DAILY_HOURS: {
        id: 'V8_MAX_DAILY_HOURS',
        name: 'Maximum Daily Hours',
        category: 'TIME',
        description: 'Total worked hours on any calendar day must not exceed the maximum.'
    },
    V8_MIN_REST_GAP: {
        id: 'V8_MIN_REST_GAP',
        name: 'Minimum Rest Gap',
        category: 'TIME',
        description: 'Minimum rest gap required between any two consecutive shifts.'
    },
    V8_SPLIT_SHIFT: {
        id: 'V8_SPLIT_SHIFT',
        name: 'Split Shift',
        category: 'TIME',
        description: 'Same-day two-part shift (PT/flexi): the gap between engagements must not exceed 3h (clause 39.4).'
    },
    V8_MAX_CONSECUTIVE_DAYS: {
        id: 'V8_MAX_CONSECUTIVE_DAYS',
        name: 'Maximum Consecutive Days',
        category: 'TIME',
        description: 'Maximum number of consecutive working days allowed in a streak.'
    },
    V8_ORD_HOURS_AVG: {
        id: 'V8_ORD_HOURS_AVG',
        name: 'Ordinary Hours Averaging',
        category: 'CONTRACT',
        description: 'Average ordinary hours over 4 weeks must not exceed contracted weekly rate.'
    },
    V8_EMPLOYMENT_TARGET: {
        id: 'V8_EMPLOYMENT_TARGET',
        name: 'Employment Target',
        category: 'CONTRACT',
        description: 'Only staff whose contract matches the shift\'s target employment type may be assigned.'
    },
    V8_STUDENT_VISA_LIMIT: {
        id: 'V8_STUDENT_VISA_LIMIT',
        name: 'Student Visa 48h Limit',
        category: 'LEGAL',
        description: 'Student visa holders must not exceed 48 hours per fortnight.'
    },
    // Meal break and rest pauses likewise moved to the shape layer
    // (SHAPE_MEAL_BREAK / SHAPE_MEAL_BREAK_CEILING / SHAPE_REST_PAUSE_1 / _2).
    V8_QUALIFICATIONS: {
        id: 'V8_QUALIFICATIONS',
        name: 'Qualifications',
        category: 'SKILL',
        description: 'Employee must hold all required and valid qualifications.'
    },
    V8_AVAILABILITY_CONFLICT: {
        id: 'V8_AVAILABILITY_CONFLICT',
        name: 'Availability Match',
        category: 'AVAILABILITY',
        description: 'Shift must not overlap with unavailabilities or pre-assigned shifts.'
    }
};
