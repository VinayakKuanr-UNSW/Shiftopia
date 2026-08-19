import { describe, it, expect } from 'vitest';
import {
    validateTemplateShapes,
    evaluateTemplateShiftShape,
    describeTemplateShapeFailures,
    planTemplateApplication,
    validateTemplateApplication,
    TemplateRangeTooLongError,
    type PlacedTemplateShift,
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
     * The authoring gate still cannot see a public holiday, and that remains
     * correct: cl 56.2's four hours cannot be derived from a day-of-week, and
     * asserting it here would refuse a lawful three-hour weekday template on
     * the grounds that someone might one day apply it to Christmas.
     *
     * What changed is that the residual is no longer open — the same shift is
     * caught at APPLICATION time, when the dates exist. See the block below.
     */
    it('does not assert the public-holiday minimum against a day-of-week', () => {
        const r = evaluateTemplateShiftShape(shift({
            dayOfWeek: null, endTime: '12:00', unpaidBreakDuration: 0, paidBreakDuration: 15,
        }));
        expect(r.hits.map(h => h.rule_id)).not.toContain('SHAPE_MIN_ENGAGEMENT_PH');
    });
});

/**
 * The other half: what a template becomes once it meets a calendar.
 *
 * Christmas Day 2026 is a Friday; Boxing Day the Saturday after. 2026-06-07 is
 * an ordinary Sunday, and 2026-06-08 is the King's Birthday holiday (a Monday).
 */
describe('template application is validated against the real dates', () => {
    const place = (over: Partial<TemplateShift> = {}): PlacedTemplateShift[] => [{
        groupName: 'Convention',
        subGroupName: 'Level 2',
        shift: shift({ dayOfWeek: null, ...over }),
    }];

    /** A three-hour casual engagement: lawful on a weekday, not on a PH. */
    const THREE_HOURS = { startTime: '09:00', endTime: '12:00', unpaidBreakDuration: 0, paidBreakDuration: 0 };

    it('mirrors the RPC: a null day-of-week lands on EVERY day', () => {
        // `day_of_week IS NULL OR day_of_week = <dow>`. Null is every day, not
        // no day — which is how a template reaches a holiday nobody chose.
        const plan = planTemplateApplication(place(), '2026-06-01', '2026-06-07');
        expect(plan).toHaveLength(7);
    });

    it('mirrors the RPC: a stated day-of-week lands only on that weekday', () => {
        const plan = planTemplateApplication(place({ dayOfWeek: 1 }), '2026-06-01', '2026-06-14');
        expect(plan.map(p => p.date)).toEqual(['2026-06-01', '2026-06-08']);
    });

    it('blocks a three-hour casual shift landing on Christmas Day', () => {
        const failures = validateTemplateApplication(place(THREE_HOURS), '2026-12-24', '2026-12-26');
        expect(failures.length).toBeGreaterThan(0);
        const xmas = failures.find(f => f.date === '2026-12-25');
        expect(xmas).toBeDefined();
        expect(xmas!.dayType).toBe('public holiday');
        expect(xmas!.hits.map(h => h.rule_id)).toContain('SHAPE_MIN_ENGAGEMENT_PH');
    });

    it('blocks the same shift landing on a Sunday', () => {
        const failures = validateTemplateApplication(place(THREE_HOURS), '2026-06-07', '2026-06-07');
        expect(failures).toHaveLength(1);
        expect(failures[0].dayType).toBe('Sunday');
    });

    it('says nothing about the weekdays in the same range', () => {
        // Ordinary days were already cleared at authoring time. Re-reporting
        // them here would hand the manager one message per matching day.
        const failures = validateTemplateApplication(place(THREE_HOURS), '2026-06-01', '2026-06-06');
        expect(failures).toEqual([]);
    });

    it('accepts a four-hour engagement on the same public holiday', () => {
        // The 15m paid pause is cl 37.1, which bites at exactly four hours —
        // an authoring-time rule, but the apply gate runs the full shape
        // evaluation, so the fixture has to be a lawful shift outright.
        const four = { startTime: '09:00', endTime: '13:00', unpaidBreakDuration: 0, paidBreakDuration: 15 };
        expect(validateTemplateApplication(place(four), '2026-12-25', '2026-12-25')).toEqual([]);
    });

    it('reports every offending date, not just the first', () => {
        // A manager who discovers a fortnight of breaches one apply at a time
        // narrows the date range instead of fixing the template.
        const failures = validateTemplateApplication(place(THREE_HOURS), '2026-12-24', '2027-01-02');
        expect(failures.length).toBeGreaterThan(1);
        expect(new Set(failures.map(f => f.date)).size).toBe(failures.length);
    });

    it('returns nothing for an inverted range rather than looping', () => {
        expect(validateTemplateApplication(place(THREE_HOURS), '2026-12-25', '2026-12-01')).toEqual([]);
    });

    it('THROWS on a range longer than a year instead of silently truncating it', () => {
        // `apply_template_to_date_range_v2` has no range cap of its own, so the
        // old `out.length <= 366` guard validated the first 367 days and let
        // the RPC stamp all of them. A guard that changes the answer is not a
        // guard — and the days it dropped were the ones furthest from where a
        // manager would look.
        expect(() => validateTemplateApplication(place(THREE_HOURS), '2026-01-01', '2027-06-30'))
            .toThrow(TemplateRangeTooLongError);
    });

    it('accepts a range of exactly the maximum', () => {
        // 2026-01-01 to 2026-12-31 inclusive is 365 days; the cap is 366 so a
        // full leap year still applies in one go.
        expect(() => validateTemplateApplication(place(THREE_HOURS), '2026-01-01', '2026-12-31'))
            .not.toThrow();
    });

    it('lets the whole production library through on a public holiday', () => {
        // All 22 rows as read from production on 2026-08-18: every one carries
        // day_of_week = NULL, so every one is stamped on every day of any range
        // — public holidays included. The shortest is five net hours, so cl
        // 56.2's four-hour floor is met and the gate locks nobody out of the
        // library they already have. If a future template shortens below four
        // hours, this is where it surfaces.
        const production: PlacedTemplateShift[] = ([
            ['05:30', '16:30', 30, 30], ['05:30', '16:30', 30, 30], ['05:30', '16:30', 30, 30],
            ['05:30', '16:30', 30, 30], ['05:30', '16:30', 30, 30], ['05:30', '16:30', 30, 30],
            ['05:45', '14:00', 30, 15], ['06:15', '14:00', 30, 15], ['06:30', '14:00', 30, 15],
            ['06:30', '14:00', 30, 15], ['06:30', '14:00', 30, 15], ['06:30', '14:00', 30, 15],
            ['11:30', '16:30', 0, 15],  ['11:30', '16:30', 0, 15],  ['13:15', '21:30', 30, 15],
            ['13:45', '21:30', 30, 15], ['14:00', '21:30', 30, 15], ['14:00', '21:30', 30, 15],
            ['14:00', '21:30', 30, 15], ['14:00', '21:30', 30, 15], ['16:30', '21:30', 0, 15],
            ['16:30', '21:30', 0, 15],
        ] as Array<[string, string, number, number]>).map(([startTime, endTime, unpaid, paid], i) => ({
            groupName: 'Convention',
            subGroupName: 'Level 2',
            shift: shift({
                id: i + 1, startTime, endTime,
                unpaidBreakDuration: unpaid, paidBreakDuration: paid,
                dayOfWeek: null, targetEmploymentType: 'Casual',
            }),
        }));

        expect(production).toHaveLength(22);
        // Christmas, Boxing Day and the Sunday between.
        expect(validateTemplateApplication(production, '2026-12-24', '2026-12-28')).toEqual([]);
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
