import { describe, it, expect } from 'vitest';
import {
    validateTemplateShapes,
    evaluateTemplateShiftShape,
    describeTemplateShapeFailures,
} from '../templateShape';
import type { Group, TemplateShift } from '../templates.types';

/**
 * Templates are the one creation path the gate in `shiftsCommands` cannot see.
 *
 * `apply_template_to_date_range_v2` stamps rows server-side, straight from
 * `template_shifts` into `shifts`, one per matching day. A template carrying a
 * 90-minute casual engagement therefore mints one unlawful shift per day across
 * the whole applied range, and nothing in the client ever holds one of them to
 * look at. Validating the mould is what makes checking each casting unnecessary.
 */

function shift(over: Partial<TemplateShift> = {}): TemplateShift {
    return {
        id: 1,
        startTime: '09:00',
        endTime: '17:30',
        paidBreakDuration: 30,
        unpaidBreakDuration: 30,
        skills: [], licenses: [], siteTags: [], eventTags: [],
        sortOrder: 0,
        targetEmploymentType: 'Casual',
        ...over,
    };
}

function groups(shifts: TemplateShift[]): Group[] {
    return [{
        id: 'g1', name: 'Convention', color: '#000', sortOrder: 0,
        subGroups: [{ id: 's1', name: 'Level 2', shifts, sortOrder: 0 }],
    }];
}

describe('template shapes are validated at authoring time', () => {
    it('passes a lawful template', () => {
        expect(validateTemplateShapes(groups([shift()]))).toEqual([]);
    });

    it('catches a shift with no meal break (cl 36.1)', () => {
        const failures = validateTemplateShapes(groups([shift({ unpaidBreakDuration: 0 })]));
        expect(failures).toHaveLength(1);
        expect(failures[0].hits.map(h => h.rule_id)).toContain('SHAPE_MEAL_BREAK');
    });

    it('reports every failing shift, not just the first', () => {
        const failures = validateTemplateShapes(groups([
            shift({ id: 1, name: 'Bad A', unpaidBreakDuration: 0 }),
            shift({ id: 2, name: 'Good' }),
            shift({ id: 3, name: 'Bad B', endTime: '10:00', unpaidBreakDuration: 0, paidBreakDuration: 0 }),
        ]));
        expect(failures.map(f => f.shiftName)).toEqual(['Bad A', 'Bad B']);
    });

    it('locates each failure by group, subgroup and shift', () => {
        const [line] = describeTemplateShapeFailures(
            validateTemplateShapes(groups([shift({ name: 'Door 3', unpaidBreakDuration: 0 })])),
        );
        expect(line).toContain('Convention');
        expect(line).toContain('Level 2');
        expect(line).toContain('Door 3');
        expect(line).toContain('09:00–17:30');
    });

    it('names an unnamed shift by role and position, so it can still be found', () => {
        const [f] = validateTemplateShapes(groups([shift({ roleName: 'Usher', unpaidBreakDuration: 0 })]));
        expect(f.shiftName).toBe('Usher #1');
    });

    it('does not report a half-typed shift as a breach', () => {
        // INCOMPLETE is the editor's prompt to finish, not a violation.
        expect(validateTemplateShapes(groups([shift({ endTime: '' })]))).toEqual([]);
    });

    it('applies the full-time floor to an FT-targeted template shift', () => {
        // 7h net is under the cl 35.1(c) ordinary day.
        const [f] = validateTemplateShapes(groups([
            shift({ targetEmploymentType: 'FT', endTime: '16:30' }),
        ]));
        expect(f.hits.map(h => h.rule_id)).toContain('SHAPE_FT_MIN_DAY');
    });
});

describe('Schedule 3 is read from the role name the template already carries', () => {
    it('accepts a security template shift whose meal break is paid', () => {
        const r = evaluateTemplateShiftShape(shift({
            roleName: 'Security Officer',
            unpaidBreakDuration: 0, paidBreakDuration: 60,
        }));
        expect(r.passed).toBe(true);
    });

    it('refuses the same shape on a general role', () => {
        const r = evaluateTemplateShiftShape(shift({
            roleName: 'Team Member',
            unpaidBreakDuration: 0, paidBreakDuration: 60,
        }));
        expect(r.blocking).toBe(true);
    });
});

describe('the day-typed rules are scoped honestly', () => {
    it('checks a shift stated for Sunday against the Sunday minimum', () => {
        // cl 12.5(c): four hours on a Sunday for a casual.
        const r = evaluateTemplateShiftShape(shift({
            dayOfWeek: 0, endTime: '12:00', unpaidBreakDuration: 0, paidBreakDuration: 15,
        }));
        expect(r.hits.map(h => h.rule_id)).toContain('SHAPE_MIN_ENGAGEMENT');
    });

    it('does not treat "any day" as Sunday', () => {
        // A three-hour weekday template is lawful. Refusing it because it MIGHT
        // one day be applied to a Sunday would block correct rosters on a
        // hypothetical.
        const r = evaluateTemplateShiftShape(shift({
            dayOfWeek: null, endTime: '12:00', unpaidBreakDuration: 0, paidBreakDuration: 15,
        }));
        expect(r.passed).toBe(true);
    });

    /**
     * KNOWN GAP, pinned deliberately.
     *
     * cl 56.2 requires four hours on a PUBLIC HOLIDAY, and a public holiday
     * cannot be derived from a day-of-week. So a three-hour template shift is
     * accepted here and can still be stamped onto Christmas Day by
     * apply_template_to_date_range_v2 in breach of cl 56.2.
     *
     * Closing it needs a check at APPLICATION time, when the dates exist. This
     * asserts the current state so the hole is visible in the suite rather than
     * assumed closed; when the application-time check lands, this should fail
     * and be rewritten.
     */
    it('cannot see public holidays — template application can still breach cl 56.2', () => {
        const r = evaluateTemplateShiftShape(shift({
            dayOfWeek: null, endTime: '12:00', unpaidBreakDuration: 0, paidBreakDuration: 15,
        }));
        expect(r.hits.map(h => h.rule_id)).not.toContain('SHAPE_MIN_ENGAGEMENT_PH');
    });
});

describe('the production template library', () => {
    it('passes every shift currently in template_shifts', () => {
        // All 22 rows as read from production on 2026-08-18. Pinned so the gate
        // is known not to lock managers out of templates they already have —
        // and so a future tightening has to confront the real library, not a
        // fixture chosen to agree with it.
        const production: TemplateShift[] = ([
            ['05:30', '16:30', 30, 30, 'Team Member'],
            ['05:30', '16:30', 30, 30, 'Team Member'],
            ['05:30', '16:30', 30, 30, 'Team Member'],
            ['05:30', '16:30', 30, 30, 'Team Leader'],
            ['05:30', '16:30', 30, 30, 'Team Member'],
            ['05:30', '16:30', 30, 30, 'Team Member'],
            ['05:45', '14:00', 15, 30, 'Team Leader'],
            ['06:15', '14:00', 15, 30, 'TM3'],
            ['06:30', '14:00', 15, 30, 'Team Member'],
            ['06:30', '14:00', 15, 30, 'Team Member'],
            ['06:30', '14:00', 15, 30, 'Team Member'],
            ['06:30', '14:00', 15, 30, 'Team Member'],
            ['11:30', '16:30', 15,  0, 'Team Member'],
            ['11:30', '16:30', 15,  0, 'Team Member'],
            ['13:15', '21:30', 15, 30, 'Team Leader'],
            ['13:45', '21:30', 15, 30, 'TM3'],
            ['14:00', '21:30', 15, 30, 'Team Member'],
            ['14:00', '21:30', 15, 30, 'Team Member'],
            ['14:00', '21:30', 15, 30, 'Team Member'],
            ['14:00', '21:30', 15, 30, 'Team Member'],
            ['16:30', '21:30', 15,  0, 'Team Member'],
            ['16:30', '21:30', 15,  0, 'TM3'],
        ] as Array<[string, string, number, number, string]>).map(
            ([startTime, endTime, paid, unpaid, roleName], i) => shift({
                id: i, startTime, endTime,
                paidBreakDuration: paid, unpaidBreakDuration: unpaid,
                roleName, name: `${roleName} ${startTime}`,
                targetEmploymentType: 'Casual', dayOfWeek: null,
            }),
        );

        expect(production).toHaveLength(22);
        const failures = validateTemplateShapes(groups(production));
        expect(describeTemplateShapeFailures(failures)).toEqual([]);
    });
});
