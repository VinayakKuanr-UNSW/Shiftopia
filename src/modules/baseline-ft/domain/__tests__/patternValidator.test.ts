/**
 * The pattern gate is the single most valuable check in Baseline FT, because
 * the obvious full-time week is unlawful and nothing in the product currently
 * says so.
 *
 * Monday–Friday 08:00–16:30 with a 30-minute unpaid break is 8.0h net, 40h a
 * week, 160h over a four-week cycle — against a 152h ceiling. That is the exact
 * breach standing against all four full-time employees in production
 * (160/160/155/155 vs 152). A generator seeded with that pattern would
 * reproduce the breach on every future roster, so this is the regression that
 * matters most here.
 */
import { describe, expect, it } from 'vitest';
import { validatePattern } from '../patternValidator';
import type { BaselinePattern, IsoWeekday, PatternSlot } from '../types';

const ROLE = 'role-supervisor';

/**
 * Build a pattern slot.
 *
 * `paidBreak` defaults to the PAID REST PAUSES cl 37 requires, which a lawful
 * full-time day must carry and which are easy to forget because they do not
 * change net hours: cl 37.1 gives 15 minutes after four consecutive ordinary
 * hours, and cl 37.2 a second 15 after eight. They sit INSIDE paid time, so
 * net = gross − unpaid regardless. Getting this wrong is what makes an
 * otherwise-correct pattern fail the shape gate.
 */
function slot(
    day: IsoWeekday, start: string, end: string, unpaidBreak: number, paidBreak?: number,
): PatternSlot {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const gross = (eh * 60 + em) - (sh * 60 + sm);
    const net = gross - unpaidBreak;
    return {
        sourceSlotId: `ts-${day}`,
        dayOfWeek: day,
        startTime: start,
        endTime: end,
        unpaidBreakMinutes: unpaidBreak,
        paidBreakMinutes: paidBreak ?? (net >= 480 ? 30 : net >= 240 ? 15 : 0),
        netMinutes: net,
        roleId: ROLE,
        sortOrder: day,
    };
}

function pattern(slots: PatternSlot[]): BaselinePattern {
    return { employeeId: 'emp-1', userContractId: 'uc-1', subDepartmentId: 'sub-1', slots };
}

const FT_FACTS = { contractedWeeklyHours: 38, cycleWeeks: 4 as const, roleId: ROLE };

const WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5];

describe('validatePattern — volume against the cycle ceiling', () => {
    it('BLOCKS the 5x8.0h week that produces the 160h production breach', () => {
        // 08:00–16:30 less 30m = 8.0h net. Five of them = 40h/week = 160h/cycle.
        const p = pattern(WEEKDAYS.map(d => slot(d, '08:00', '16:30', 30)));

        const findings = validatePattern(p, FT_FACTS);
        const breach = findings.find(f => f.code === 'BFT_PATTERN_EXCEEDS_CONTRACT');

        expect(breach).toBeDefined();
        expect(breach!.severity).toBe('BLOCKING');
        expect(breach!.overridable).toBe(false);
        expect(breach!.clause).toBe('ICC EBA cl 35.1(a)');
        expect(breach!.calculation).toMatchObject({
            pattern_weekly_hours: 40,
            contracted_weekly_hours: 38,
            cycle_weeks: 4,
            cycle_ceiling_hours: 152,
            pattern_cycle_hours: 160,
        });
        // The remedy is stated in minutes a human can act on: 2h/week over
        // five days is 24 minutes a day.
        expect(breach!.plain).toContain('24 minutes');
    });

    it('ACCEPTS the compliant 5x7.6h week', () => {
        // 38 ÷ 5 = 7.6h exactly, which is also cl 35.1(c)'s daily floor — a
        // five-day full-time week has no slack in either direction.
        // 08:00–16:06 less 30m = 7.6h net.
        const p = pattern(WEEKDAYS.map(d => slot(d, '08:00', '16:06', 30)));

        const findings = validatePattern(p, FT_FACTS);

        expect(findings.filter(f => f.severity === 'BLOCKING')).toEqual([]);
        expect(findings.find(f => f.code === 'BFT_PATTERN_EXCEEDS_CONTRACT')).toBeUndefined();
        expect(findings.find(f => f.code === 'BFT_PATTERN_BELOW_CONTRACT')).toBeUndefined();
    });

    it('WARNS, without blocking, when the pattern is below the contract', () => {
        // Four 7.6h days = 30.4h/week against 38h — legal, but it can never
        // satisfy the contract, so every run will show a variance.
        const p = pattern(([1, 2, 3, 4] as IsoWeekday[]).map(d => slot(d, '08:00', '16:06', 30)));

        const findings = validatePattern(p, FT_FACTS);
        const under = findings.find(f => f.code === 'BFT_PATTERN_BELOW_CONTRACT');

        expect(under).toBeDefined();
        expect(under!.severity).toBe('WARNING');
        expect(under!.overridable).toBe(true);
        expect(findings.filter(f => f.severity === 'BLOCKING')).toEqual([]);
    });

    it('scales the ceiling with the declared cycle length, not a fixed 152h', () => {
        // The same 40h pattern against a ONE-week cycle: ceiling 38h, so still
        // a breach — but the numbers must be the one-week ones, proving the
        // ladder is read as a disjunction over the declared cycle rather than
        // as a hardcoded four weeks.
        const p = pattern(WEEKDAYS.map(d => slot(d, '08:00', '16:30', 30)));

        const findings = validatePattern(p, { ...FT_FACTS, cycleWeeks: 1 });
        const breach = findings.find(f => f.code === 'BFT_PATTERN_EXCEEDS_CONTRACT');

        expect(breach!.calculation).toMatchObject({
            cycle_weeks: 1,
            cycle_ceiling_hours: 38,
            pattern_cycle_hours: 40,
        });
    });

    it('uses the employee\'s own weekly hours as the basis, not the 38h default', () => {
        // A part-time-style 20h basis would make even a modest pattern a breach.
        // 5 x 7.6h = 38h against a 20h basis (80h ceiling over 4 weeks).
        const p = pattern(WEEKDAYS.map(d => slot(d, '08:00', '16:06', 30)));

        const findings = validatePattern(p, { ...FT_FACTS, contractedWeeklyHours: 20 });
        const breach = findings.find(f => f.code === 'BFT_PATTERN_EXCEEDS_CONTRACT');

        expect(breach).toBeDefined();
        expect(breach!.calculation).toMatchObject({
            contracted_weekly_hours: 20,
            cycle_ceiling_hours: 80,
        });
    });
});

describe('validatePattern — shape, delegated to the shape layer', () => {
    it('BLOCKS a day under the 7.6h full-time floor (cl 35.1(c))', () => {
        // 09:00–13:00, no break = 4.0h net. Lawful for a casual, never for FT.
        const p = pattern([slot(1, '09:00', '13:00', 0)]);

        const findings = validatePattern(p, FT_FACTS);
        const floor = findings.find(f => f.code === 'SHAPE_FT_MIN_DAY');

        expect(floor).toBeDefined();
        expect(floor!.severity).toBe('BLOCKING');
        expect(floor!.plain).toContain('Monday 09:00–13:00');
    });

    it('BLOCKS a day over the 12h maximum (cl 35.1(d))', () => {
        // 06:00–19:30 less 30m = 13.0h net.
        const p = pattern([slot(1, '06:00', '19:30', 30)]);

        const findings = validatePattern(p, FT_FACTS);

        expect(findings.some(f => f.code === 'SHAPE_MAX_DURATION' && f.severity === 'BLOCKING'))
            .toBe(true);
    });

    it('BLOCKS a day over five hours with no meal break (cl 36.1)', () => {
        // 08:00–16:00 with NO unpaid break — 8.0h net, no meal break at all.
        const p = pattern([slot(1, '08:00', '16:00', 0)]);

        const findings = validatePattern(p, FT_FACTS);

        expect(findings.some(f => f.code === 'SHAPE_MEAL_BREAK')).toBe(true);
    });
});

describe('validatePattern — structural gates', () => {
    it('BLOCKS a template whose shifts carry no weekday', () => {
        // Every template_shifts row in production has day_of_week = NULL, which
        // the apply RPC reads as "every day". Such a template is a set of shift
        // shapes, not a pattern, and must be rejected before anything else is
        // evaluated against it.
        const undated = { ...slot(1, '08:00', '16:06', 30), dayOfWeek: null as unknown as IsoWeekday };
        const p = pattern([undated, slot(2, '08:00', '16:06', 30)]);

        const findings = validatePattern(p, FT_FACTS);

        expect(findings).toHaveLength(1);
        expect(findings[0].code).toBe('BFT_PATTERN_NO_WEEKDAY');
        expect(findings[0].severity).toBe('BLOCKING');
        expect(findings[0].calculation).toMatchObject({ total_shifts: 2 });
    });

    it('BLOCKS two shifts on one weekday — full-time may not work a split shift', () => {
        const p = pattern([
            { ...slot(1, '06:00', '10:00', 0), sourceSlotId: 'ts-am', sortOrder: 1 },
            { ...slot(1, '16:00', '20:00', 0), sourceSlotId: 'ts-pm', sortOrder: 2 },
        ]);

        const findings = validatePattern(p, FT_FACTS);
        const split = findings.find(f => f.code === 'BFT_PATTERN_SPLIT_SHIFT');

        expect(split).toBeDefined();
        expect(split!.severity).toBe('BLOCKING');
        expect(split!.clause).toBe('ICC EBA cl 39.1');
    });

    it('BLOCKS a pattern rostering a role the contract does not authorise', () => {
        const p = pattern([{ ...slot(1, '08:00', '16:06', 30), roleId: 'role-chef' }]);

        const findings = validatePattern(p, FT_FACTS);
        const mismatch = findings.find(f => f.code === 'BFT_PATTERN_ROLE_MISMATCH');

        expect(mismatch).toBeDefined();
        expect(mismatch!.severity).toBe('BLOCKING');
        expect(mismatch!.calculation).toMatchObject({
            pattern_role_id: 'role-chef',
            contract_role_id: ROLE,
        });
    });

    it('BLOCKS an empty template rather than generating nothing silently', () => {
        const findings = validatePattern(pattern([]), FT_FACTS);

        expect(findings).toHaveLength(1);
        expect(findings[0].code).toBe('BFT_PATTERN_EMPTY');
    });
});
