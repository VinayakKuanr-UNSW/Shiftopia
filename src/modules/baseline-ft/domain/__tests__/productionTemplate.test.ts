/**
 * The pattern gate, run against the ACTUAL production template.
 *
 * These rows were read out of `srfozdlphoempdattvtx` on 2026-08-28 from the
 * template named "Baseline FT" — the one a manager would reach for first. They
 * are pinned here as a fixture because the design's central claim was
 * theoretical until this: two of its four full-time shifts are 08:00–16:30 with
 * a 30-minute unpaid break, which is 8.0h net, 40h a week, 160h against a 152h
 * ceiling.
 *
 * Every row also has `day_of_week = NULL`, which is why the feature refuses to
 * run against this template today rather than generating a month of shifts on
 * every day of the week.
 *
 * If someone fixes the template, these tests SHOULD fail — that is the signal
 * to re-read them, not to delete them.
 */
import { describe, expect, it } from 'vitest';
import { validatePattern } from '../patternValidator';
import type { BaselinePattern, IsoWeekday, PatternSlot } from '../types';

/** Roles differ across the four rows; these are the real ids. */
const ROLE_AV = '581595e3-04eb-46ce-a2a7-f84894a9f059';
const ROLE_B = 'bb725bc6-3a19-4ab2-957f-6b57bcb18a9d';
const ROLE_C = '85ed465b-5e44-4cfb-b61b-05264c2e2f66';

/**
 * The four FT rows of "Baseline FT", verbatim except for `dayOfWeek`, which is
 * NULL in production and is supplied per test so the volume rule can be
 * exercised independently of the weekday rule.
 */
const PROD_ROWS = [
    { id: '2e706227-1a8a-4907-9301-bb52022fead7', start: '05:45', end: '14:00', unpaid: 30, paid: 15, net: 465, role: ROLE_AV, sort: 0 },
    { id: '956e6033-049f-47fb-971f-bd182a7b8199', start: '13:15', end: '21:30', unpaid: 30, paid: 15, net: 465, role: ROLE_AV, sort: 0 },
    { id: 'f910235d-785f-4542-a0b5-5333c96dab3f', start: '08:00', end: '16:30', unpaid: 30, paid: 30, net: 480, role: ROLE_B, sort: 0 },
    { id: '86e18859-4c40-4412-a9d3-95b66f1060d6', start: '08:00', end: '16:30', unpaid: 30, paid: 30, net: 480, role: ROLE_C, sort: 1 },
] as const;

function slotFrom(row: typeof PROD_ROWS[number], day: IsoWeekday | null): PatternSlot {
    return {
        sourceSlotId: row.id,
        dayOfWeek: day as IsoWeekday,
        startTime: row.start,
        endTime: row.end,
        unpaidBreakMinutes: row.unpaid,
        paidBreakMinutes: row.paid,
        netMinutes: row.net,
        roleId: row.role,
        sortOrder: row.sort,
    };
}

function pattern(slots: PatternSlot[]): BaselinePattern {
    return {
        employeeId: 'emp-1', userContractId: 'uc-1',
        subDepartmentId: '6fefad95-9cf9-468c-8724-424cc2f7b640',
        slots,
    };
}

const FT_38H = { contractedWeeklyHours: 38, cycleWeeks: 4 as const, roleId: ROLE_AV };

describe('the real "Baseline FT" template', () => {
    it('is REFUSED as-is, because every row has no day of the week', () => {
        // The state of production on 2026-08-28. Without this gate the apply
        // RPC reads a null weekday as "every day" and the generator would
        // propose a month of shifts on all seven.
        const asStored = pattern(PROD_ROWS.map(r => slotFrom(r, null)));

        const findings = validatePattern(asStored, FT_38H);

        expect(findings).toHaveLength(1);
        expect(findings[0].code).toBe('BFT_PATTERN_NO_WEEKDAY');
        expect(findings[0].severity).toBe('BLOCKING');
        expect(findings[0].calculation).toMatchObject({ total_shifts: 4 });
    });

    it('the two 08:00–16:30 rows really are the 40h week', () => {
        // Not a theoretical example: these two rows exist, and 08:00-16:30 less
        // a 30-minute unpaid break is 8.0h net exactly.
        const eightHour = PROD_ROWS.filter(r => r.net === 480);
        expect(eightHour).toHaveLength(2);
        expect(eightHour.every(r => r.start === '08:00' && r.end === '16:30')).toBe(true);

        // Five of them would be 40h/week -> 160h/cycle against 152h.
        const fiveDay = pattern(
            ([1, 2, 3, 4, 5] as IsoWeekday[]).map(d => ({
                ...slotFrom(eightHour[0], d),
                sourceSlotId: `prod-8h-${d}`,
                roleId: ROLE_AV,          // isolate the volume rule from role mismatch
                sortOrder: d,
            })),
        );

        const breach = validatePattern(fiveDay, FT_38H)
            .find(f => f.code === 'BFT_PATTERN_EXCEEDS_CONTRACT');

        expect(breach).toBeDefined();
        expect(breach!.severity).toBe('BLOCKING');
        expect(breach!.calculation).toMatchObject({
            pattern_weekly_hours: 40,
            cycle_ceiling_hours: 152,
            pattern_cycle_hours: 160,
            overrun_hours: 8,
        });
    });

    it('the 7.75h rows are lawful individually but still overrun across five days', () => {
        // 05:45-14:00 is 7.75h net -- above cl 35.1(c)'s 7.6h floor, so the
        // shape passes. Five of them is 38.75h/week, which still exceeds 38.
        // The margin is only 9 minutes a day, which is exactly why this needs
        // to be checked by arithmetic rather than by eye.
        const early = PROD_ROWS[0];
        const fiveDay = pattern(
            ([1, 2, 3, 4, 5] as IsoWeekday[]).map(d => ({
                ...slotFrom(early, d),
                sourceSlotId: `prod-775-${d}`,
                sortOrder: d,
            })),
        );

        const findings = validatePattern(fiveDay, FT_38H);

        // Shape is fine: no FT_MIN_DAY, no meal-break or rest-pause complaint.
        expect(findings.some(f => f.code === 'SHAPE_FT_MIN_DAY')).toBe(false);
        expect(findings.some(f => f.code === 'SHAPE_MEAL_BREAK')).toBe(false);

        const breach = findings.find(f => f.code === 'BFT_PATTERN_EXCEEDS_CONTRACT');
        expect(breach).toBeDefined();
        expect(breach!.calculation).toMatchObject({ pattern_weekly_hours: 38.75 });
    });

    it('flags the template mixing three roles against a single contracted role', () => {
        // The four rows carry three different role_ids. A pattern DECLARES the
        // role; the contract AUTHORISES it, and a mismatch is never silently
        // resolved by substituting the contract's own role.
        const monToThu = pattern(
            PROD_ROWS.map((r, i) => slotFrom(r, (i + 1) as IsoWeekday)),
        );

        const mismatches = validatePattern(monToThu, FT_38H)
            .filter(f => f.code === 'BFT_PATTERN_ROLE_MISMATCH');

        // Two foreign roles (ROLE_B, ROLE_C) against a ROLE_AV contract.
        expect(mismatches).toHaveLength(2);
        expect(mismatches.every(f => f.severity === 'BLOCKING')).toBe(true);
    });

    it('would accept a corrected four-day week at 9.5h', () => {
        // The constructive answer: 38h over four days is 9.5h each, which is
        // under cl 35.1(d)'s twelve-hour ceiling and over cl 35.1(c)'s floor.
        // 08:00-18:00 less 30m unpaid = 9.5h net, with both cl 37 rest pauses.
        const fourDay = pattern(
            ([1, 2, 3, 4] as IsoWeekday[]).map(d => ({
                sourceSlotId: `fixed-${d}`,
                dayOfWeek: d,
                startTime: '08:00',
                endTime: '18:00',
                unpaidBreakMinutes: 30,
                paidBreakMinutes: 30,
                netMinutes: 570,
                roleId: ROLE_AV,
                sortOrder: d,
            })),
        );

        const findings = validatePattern(fourDay, FT_38H);

        expect(findings.filter(f => f.severity === 'BLOCKING')).toEqual([]);
        expect(findings.find(f => f.code === 'BFT_PATTERN_EXCEEDS_CONTRACT')).toBeUndefined();
        expect(findings.find(f => f.code === 'BFT_PATTERN_BELOW_CONTRACT')).toBeUndefined();
    });
});
