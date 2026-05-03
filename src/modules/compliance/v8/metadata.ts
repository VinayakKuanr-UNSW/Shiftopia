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
    V8_NO_OVERLAP: {
        id: 'V8_NO_OVERLAP',
        name: 'No Overlap',
        category: 'TIME',
        description: 'No two shifts may overlap in time.'
    },
    V8_MIN_SHIFT_LENGTH: {
        id: 'V8_MIN_SHIFT_LENGTH',
        name: 'Minimum Shift Length',
        category: 'TIME',
        description: 'Shift duration must be within limits.'
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
    V8_STUDENT_VISA_LIMIT: {
        id: 'V8_STUDENT_VISA_LIMIT',
        name: 'Student Visa 48h Limit',
        category: 'LEGAL',
        description: 'Student visa holders must not exceed 48 hours per fortnight.'
    },
    V8_MEAL_BREAK: {
        id: 'V8_MEAL_BREAK',
        name: 'Meal Break',
        category: 'TIME',
        description: 'Mandatory meal break required for shifts over 5 hours.'
    },
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
