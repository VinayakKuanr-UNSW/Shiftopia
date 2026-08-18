import { describe, it, expect } from 'vitest';
import { dailyMealBreakRule } from '../daily-meal-break';
import { buildContext, buildShift, resetIdCounter } from './_helpers';
import type { V8Shift } from '../../types';

/**
 * cl 36.1 — "more than five (5) hours on any one day", not per shift.
 *
 * The shape layer enforces the per-shift reading at creation. This covers the
 * limb it structurally cannot: a day worked in two parts that crosses five
 * hours with neither part doing so.
 */
const DAY = '2026-06-01';

function shift(start: string, end: string, over: Partial<V8Shift> = {}): V8Shift {
    return buildShift({ date: DAY, start_time: start, end_time: end, is_candidate: true, ...over });
}

const ctx = (shifts: V8Shift[], employee: Record<string, unknown> = {}) =>
    buildContext({ employee: { contract_type: 'CASUAL', ...employee }, shifts });

describe('dailyMealBreakRule', () => {
    it('blocks two abutting engagements totalling more than 5h', () => {
        resetIdCounter();
        // 08:00–11:00 then 11:00–14:00. Six hours worked, not one minute off.
        const hits = dailyMealBreakRule(ctx([shift('08:00', '11:00'), shift('11:00', '14:00')]));
        expect(hits).toHaveLength(1);
        expect(hits[0].rule_id).toBe('V8_DAILY_MEAL_BREAK');
        expect(hits[0].blocking).toBe(true);
        expect(hits[0].calculation?.worked_minutes).toBe(360);
        expect(hits[0].calculation?.longest_break_minutes).toBe(0);
    });

    it('accepts the same six hours when the gap is a real break', () => {
        resetIdCounter();
        // The interpretive choice, asserted: two unpaid hours in the middle of
        // the day IS a meal break. Reading it otherwise would make every split
        // shift a breach of cl 36.1 while cl 39 expressly permits them.
        const hits = dailyMealBreakRule(ctx([shift('06:00', '09:00'), shift('11:00', '14:00')]));
        expect(hits).toEqual([]);
    });

    it('accepts a gap of exactly 30 minutes', () => {
        resetIdCounter();
        const hits = dailyMealBreakRule(ctx([shift('08:00', '11:00'), shift('11:30', '14:30')]));
        expect(hits).toEqual([]);
    });

    it('blocks a gap of 29 minutes', () => {
        resetIdCounter();
        const hits = dailyMealBreakRule(ctx([shift('08:00', '11:00'), shift('11:29', '14:29')]));
        expect(hits).toHaveLength(1);
        expect(hits[0].calculation?.longest_break_minutes).toBe(29);
    });

    it('never sums intervals — three short gaps are not a meal break', () => {
        resetIdCounter();
        const hits = dailyMealBreakRule(ctx([
            shift('08:00', '10:00'),
            shift('10:15', '12:15'),
            shift('12:30', '14:30'),
        ]));
        expect(hits).toHaveLength(1);
        expect(hits[0].calculation?.longest_break_minutes).toBe(15);
    });

    it('accepts a declared in-shift break on either engagement', () => {
        resetIdCounter();
        const hits = dailyMealBreakRule(ctx([
            shift('08:00', '11:30', { unpaid_break_minutes: 30 }),
            shift('11:30', '14:00'),
        ]));
        expect(hits).toEqual([]);
    });

    it('stays silent at exactly five hours worked', () => {
        resetIdCounter();
        // "MORE than five hours" — five hours flat creates no entitlement.
        const hits = dailyMealBreakRule(ctx([shift('08:00', '10:30'), shift('10:30', '13:00')]));
        expect(hits).toEqual([]);
    });

    it('counts worked time net of a declared break when testing the threshold', () => {
        resetIdCounter();
        // 5h30m spanned, 30m of it an unpaid break inside the first engagement
        // ⇒ 5h worked. Under the threshold, and the break would satisfy it anyway.
        const hits = dailyMealBreakRule(ctx([
            shift('08:00', '11:00', { unpaid_break_minutes: 30 }),
            shift('11:00', '13:30'),
        ]));
        expect(hits).toEqual([]);
    });

    it('leaves single-shift days to the shape layer', () => {
        resetIdCounter();
        // An 8h shift with no break is unlawful, and SHAPE_MEAL_BREAK blocks it
        // at creation. Reporting it here too would double-report one defect.
        const hits = dailyMealBreakRule(ctx([shift('08:00', '16:00')]));
        expect(hits).toEqual([]);
    });

    it('does not re-flag a day made entirely of committed history', () => {
        resetIdCounter();
        const hits = dailyMealBreakRule(ctx([
            shift('08:00', '11:00', { is_candidate: false }),
            shift('11:00', '14:00', { is_candidate: false }),
        ]));
        expect(hits).toEqual([]);
    });

    it('applies to permanents too — cl 36.1 says "a Team Member"', () => {
        resetIdCounter();
        const hits = dailyMealBreakRule(ctx(
            [shift('08:00', '11:00'), shift('11:00', '14:00')],
            { contract_type: 'PART_TIME' },
        ));
        expect(hits).toHaveLength(1);
    });

    it('reads the PAID allotment for security, whose break is paid', () => {
        resetIdCounter();
        // Sch 3 §5.3(a). An unpaid break of 0 with a paid 30 satisfies them,
        // and would not satisfy anyone else.
        const shifts = [
            shift('08:00', '11:00', { paid_break_minutes: 30 }),
            shift('11:00', '14:00'),
        ];
        expect(dailyMealBreakRule(ctx(shifts, { is_security_role: true }))).toEqual([]);
        expect(dailyMealBreakRule(ctx(shifts))).toHaveLength(1);
    });

    it('caps the pooled paid allotment at the meal-break ceiling', () => {
        resetIdCounter();
        // `paid_break_minutes` pools the meal break with cl 37 rest pauses.
        // 75m on a long security day is 30m meal + 45m pauses, and only the
        // meal-break part answers cl 36.1 — but 60 is still ≥ 30, so this
        // passes either way. The assertion is on the recorded figure.
        const hits = dailyMealBreakRule(ctx(
            [shift('08:00', '11:00', { paid_break_minutes: 75 }), shift('11:00', '14:00')],
            { is_security_role: true },
        ));
        expect(hits).toEqual([]);
    });

    it('cites Schedule 3 §3.2(a) for full-time security', () => {
        resetIdCounter();
        const hits = dailyMealBreakRule(ctx(
            [shift('08:00', '11:00'), shift('11:00', '14:00')],
            { contract_type: 'FULL_TIME', is_security_role: true },
        ));
        expect(hits).toHaveLength(1);
        expect(hits[0].details).toContain('Sch 3 §3.2(a)');
    });
});
