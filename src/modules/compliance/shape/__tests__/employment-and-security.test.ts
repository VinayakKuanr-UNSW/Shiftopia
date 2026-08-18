import { describe, it, expect } from 'vitest';
import { evaluateShiftShape, requiredMinEngagementMinutes } from '../evaluate';
import type { ShapeInput, ShapeResult } from '../types';

/**
 * Phase 4: the shape layer learns the second employment axis, and Schedule 3.
 *
 * Two corrections, both of the same kind — the layer was applying one rule to
 * populations the agreement treats differently.
 *
 *   1. cl 12.3(e) gives PLAIN part-time a flat three hours with no exceptions.
 *      The 2h training and 4h Sunday concessions are cl 12.4(c) (flexible
 *      part-time) and cl 12.5(c) (casual) only. Because `ShapeEmploymentTarget`
 *      is three-valued, the layer could not tell PT from FPT and granted PT
 *      concessions it is not owed.
 *
 *   2. Security meal breaks are PAID (Sch 3 §3.2(a), §5.3(a),(c)), and Sch 3
 *      §1.1 makes the schedule prevail. Subtracting a paid break from working
 *      time understates the shift.
 *
 * FPT is expressed as `'PT'` + `target_requires_flexible`, matching the column,
 * the DB CHECK and the solver's collapse table — not a fourth enum member.
 */

const PH = '2026-12-25';   // Christmas Day
const SUN = '2026-08-16';  // a Sunday
const MON = '2026-08-17';

function shift(over: Partial<ShapeInput> = {}): ShapeInput {
    return {
        shift_date: MON,
        start_time: '09:00',
        end_time: '12:00',
        unpaid_break_minutes: 0,
        paid_break_minutes: 0,
        target_employment_type: 'Casual',
        ...over,
    };
}

const has = (r: ShapeResult, id: string) => r.hits.some(h => h.rule_id === id);

describe('minimum engagement is scoped to the employment type', () => {
    it('gives plain part-time a flat 3h with no training concession', () => {
        // cl 12.3(e) has no exceptions of any kind.
        expect(requiredMinEngagementMinutes({ target: 'PT', isTraining: true }).requiredMins).toBe(180);
        expect(requiredMinEngagementMinutes({ target: 'PT', isSunday: true }).requiredMins).toBe(180);
    });

    it('gives flexible part-time the cl 12.4(c) concessions', () => {
        const flex = { target: 'PT' as const, isFlexible: true };
        expect(requiredMinEngagementMinutes({ ...flex, isTraining: true }).requiredMins).toBe(120);
        expect(requiredMinEngagementMinutes({ ...flex, isSunday: true }).requiredMins).toBe(240);
        expect(requiredMinEngagementMinutes(flex).requiredMins).toBe(180);
    });

    it('gives casual the cl 12.5(c) concessions', () => {
        expect(requiredMinEngagementMinutes({ target: 'Casual', isTraining: true }).requiredMins).toBe(120);
        expect(requiredMinEngagementMinutes({ target: 'Casual', isSunday: true }).requiredMins).toBe(240);
    });

    it('blocks a 2h part-time training shift that used to be accepted', () => {
        const pt = evaluateShiftShape(shift({
            target_employment_type: 'PT', is_training: true, end_time: '11:00',
        }));
        expect(has(pt, 'SHAPE_MIN_ENGAGEMENT')).toBe(true);

        // The same shift for a flexible part-timer is lawful at 2h.
        const fpt = evaluateShiftShape(shift({
            target_employment_type: 'PT', target_requires_flexible: true,
            is_training: true, end_time: '11:00',
        }));
        expect(has(fpt, 'SHAPE_MIN_ENGAGEMENT')).toBe(false);
    });

    it('accepts a 3h part-time Sunday shift that used to be blocked', () => {
        // cl 12.3(e) grants PT no Sunday uplift, so 3h is lawful. The old table
        // applied the casual 4h tier to everyone and refused this.
        const r = evaluateShiftShape(shift({ shift_date: SUN, target_employment_type: 'PT' }));
        expect(has(r, 'SHAPE_MIN_ENGAGEMENT')).toBe(false);
        expect(r.passed).toBe(true);
    });
});

describe('the public holiday floor is universal (cl 56.2)', () => {
    it('requires 4h of every non-full-time type', () => {
        for (const target of ['PT', 'Casual'] as const) {
            const r = evaluateShiftShape(shift({ shift_date: PH, target_employment_type: target }));
            expect(has(r, 'SHAPE_MIN_ENGAGEMENT_PH'), `${target} on a public holiday`).toBe(true);
        }
    });

    it('overrides the training concession', () => {
        // The old tier table let training win over the public-holiday uplift and
        // accepted 2h. cl 56.2 is unqualified — four hours, training or not.
        const r = evaluateShiftShape(shift({
            shift_date: PH, target_employment_type: 'Casual',
            is_training: true, end_time: '11:00',
        }));
        expect(has(r, 'SHAPE_MIN_ENGAGEMENT_PH')).toBe(true);
        expect(r.passed).toBe(false);
    });

    it('passes a 4h public holiday shift', () => {
        const r = evaluateShiftShape(shift({ shift_date: PH, end_time: '13:00' }));
        expect(has(r, 'SHAPE_MIN_ENGAGEMENT_PH')).toBe(false);
    });

    it('stays silent for full-time, whose 7.6h floor is already higher', () => {
        const r = evaluateShiftShape(shift({
            shift_date: PH, target_employment_type: 'FT',
            start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 24,
        }));
        expect(has(r, 'SHAPE_MIN_ENGAGEMENT_PH')).toBe(false);
    });
});

describe('security meal breaks are paid (EBA Schedule 3)', () => {
    it('does not deduct a paid break from working time', () => {
        // 09:00–17:00 with a 30m break. For non-security that is 7.5h net; for
        // security the break is paid, so the shift is 8h of working time.
        const civilian = evaluateShiftShape(shift({
            end_time: '17:00', unpaid_break_minutes: 30,
        }));
        expect(civilian.net_minutes).toBe(450);

        const security = evaluateShiftShape(shift({
            end_time: '17:00', paid_break_minutes: 30, is_security: true,
        }));
        expect(security.net_minutes).toBe(480);
    });

    it('satisfies the meal-break requirement from the paid field', () => {
        const r = evaluateShiftShape(shift({
            end_time: '17:00', paid_break_minutes: 30, is_security: true,
        }));
        expect(has(r, 'SHAPE_MEAL_BREAK')).toBe(false);
    });

    it('still requires one when no paid break is allotted', () => {
        const r = evaluateShiftShape(shift({ end_time: '17:00', is_security: true }));
        const hit = r.hits.find(h => h.rule_id === 'SHAPE_MEAL_BREAK')!;
        expect(hit.field).toBe('paid_break_minutes');
        expect(hit.details).toContain('paid meal break');
    });

    it('rejects an unpaid break on a security shift', () => {
        // Schedule 3 makes the break paid, so an unpaid one is both a breach and
        // a silent mis-measurement — net ignores it.
        const r = evaluateShiftShape(shift({
            end_time: '17:00', unpaid_break_minutes: 30, paid_break_minutes: 30,
            is_security: true,
        }));
        expect(has(r, 'SHAPE_SECURITY_PAID_BREAK')).toBe(true);
        expect(r.passed).toBe(false);
    });

    it('counts rest pauses on top of the paid meal break, not inside it', () => {
        // A 9h security shift owes 30m meal (Sch 3) plus 30m of rest pauses
        // (cl 37.1 + 37.2) — 60 paid minutes in total, not 30.
        const short = evaluateShiftShape(shift({
            start_time: '08:00', end_time: '17:00', paid_break_minutes: 30, is_security: true,
        }));
        expect(has(short, 'SHAPE_REST_PAUSE_2')).toBe(true);

        const full = evaluateShiftShape(shift({
            start_time: '08:00', end_time: '17:00', paid_break_minutes: 60, is_security: true,
        }));
        expect(has(full, 'SHAPE_REST_PAUSE_2')).toBe(false);
        expect(has(full, 'SHAPE_MEAL_BREAK')).toBe(false);
    });

    it('reserves nothing for a meal on a shift too short to owe one', () => {
        // 4h net is under the cl 36.1 threshold, so the whole 15m is the
        // cl 37.1 rest pause. Reserving a meal allowance here would leave 0m
        // for the pause and fail a compliant shift.
        const r = evaluateShiftShape(shift({
            start_time: '08:00', end_time: '12:00', paid_break_minutes: 15, is_security: true,
        }));
        expect(has(r, 'SHAPE_MEAL_BREAK')).toBe(false);
        expect(has(r, 'SHAPE_REST_PAUSE_1')).toBe(false);
        expect(r.passed).toBe(true);
    });
});
