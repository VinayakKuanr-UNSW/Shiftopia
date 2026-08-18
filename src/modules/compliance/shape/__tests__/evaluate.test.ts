import { describe, it, expect } from 'vitest';
import { evaluateShiftShape, requiredMinEngagementMinutes } from '../evaluate';
import type { ShapeInput } from '../types';

/**
 * A plain weekday in 2026 (Wednesday) — not a Sunday, not a NSW public holiday.
 * Used everywhere the day type must not influence the result.
 */
const WEEKDAY = '2026-08-12';
const SUNDAY = '2026-08-16';

function shift(overrides: Partial<ShapeInput> = {}): ShapeInput {
    return {
        shift_date: WEEKDAY,
        start_time: '09:00',
        end_time: '13:00',
        target_employment_type: 'Casual',
        ...overrides,
    };
}

const ids = (r: ReturnType<typeof evaluateShiftShape>) => r.hits.map(h => h.rule_id).sort();
const has = (r: ReturnType<typeof evaluateShiftShape>, id: string) => r.hits.some(h => h.rule_id === id);

describe('requiredMinEngagementMinutes', () => {
    it('applies the standard weekday tier', () => {
        expect(requiredMinEngagementMinutes({}).requiredMins).toBe(180);
    });

    it('uplifts Sundays and public holidays to 4h', () => {
        expect(requiredMinEngagementMinutes({ isSunday: true }).requiredMins).toBe(240);
        expect(requiredMinEngagementMinutes({ isPublicHoliday: true }).requiredMins).toBe(240);
    });

    it('lets the training exemption win over the Sunday/PH uplift', () => {
        expect(requiredMinEngagementMinutes({ isTraining: true, isSunday: true }).requiredMins).toBe(120);
        expect(requiredMinEngagementMinutes({ isTraining: true, isPublicHoliday: true }).requiredMins).toBe(120);
    });
});

describe('net length is the measure', () => {
    it('subtracts the unpaid break before testing the minimum', () => {
        // 09:00-12:00 is 3h gross — exactly the weekday minimum — but a 30m
        // unpaid break leaves only 2.5h of actual engagement. This is the exact
        // case where the old form (net) and the old V8 rule (gross) disagreed.
        const r = evaluateShiftShape(shift({ end_time: '12:00', unpaid_break_minutes: 30 }));
        expect(has(r, 'SHAPE_MIN_ENGAGEMENT')).toBe(true);
        expect(r.net_minutes).toBe(150);
        expect(r.passed).toBe(false);
    });

    it('passes once the gross span covers the break', () => {
        const r = evaluateShiftShape(shift({ end_time: '12:30', unpaid_break_minutes: 30 }));
        expect(has(r, 'SHAPE_MIN_ENGAGEMENT')).toBe(false);
        expect(r.net_minutes).toBe(180);
    });

    it('measures the 12h maximum on net, not gross', () => {
        // 12.5h gross with a 30m unpaid break is exactly 12h net — lawful.
        const r = evaluateShiftShape(shift({ start_time: '08:00', end_time: '20:30', unpaid_break_minutes: 30 }));
        expect(has(r, 'SHAPE_MAX_DURATION')).toBe(false);
        expect(r.net_minutes).toBe(720);
    });

    it('blocks a net length over 12h', () => {
        const r = evaluateShiftShape(shift({ start_time: '08:00', end_time: '20:31' }));
        expect(has(r, 'SHAPE_MAX_DURATION')).toBe(true);
        expect(r.passed).toBe(false);
    });
});

describe('minimum length by employment target', () => {
    it('blocks a 3h full-time shift under the 7.6h floor', () => {
        const r = evaluateShiftShape(shift({ target_employment_type: 'FT', end_time: '12:00' }));
        expect(has(r, 'SHAPE_FT_MIN_DAY')).toBe(true);
        expect(r.passed).toBe(false);
    });

    it('blocks the exact production pattern: 08:30-16:30 with a 30m break', () => {
        // The entire FT roster was this shape — 7.5h net, six minutes under the
        // cl 35.1(c) floor, and invisible because the rule had no caller.
        const r = evaluateShiftShape(shift({
            target_employment_type: 'FT',
            start_time: '08:30',
            end_time: '16:30',
            unpaid_break_minutes: 30,
        }));
        expect(r.net_minutes).toBe(450);
        expect(has(r, 'SHAPE_FT_MIN_DAY')).toBe(true);
        const hit = r.hits.find(h => h.rule_id === 'SHAPE_FT_MIN_DAY')!;
        expect(hit.calculation?.shortfall_minutes).toBe(6);
    });

    it('passes that pattern once six minutes are added', () => {
        const r = evaluateShiftShape(shift({
            target_employment_type: 'FT',
            start_time: '08:30',
            end_time: '16:36',
            unpaid_break_minutes: 30,
        }));
        expect(r.net_minutes).toBe(456);
        expect(has(r, 'SHAPE_FT_MIN_DAY')).toBe(false);
    });

    it('never applies the cl 12 engagement tiers to a full-time target', () => {
        const r = evaluateShiftShape(shift({ target_employment_type: 'FT', end_time: '12:00' }));
        expect(has(r, 'SHAPE_MIN_ENGAGEMENT')).toBe(false);
    });

    it('never applies the full-time floor to PT or casual targets', () => {
        for (const target of ['PT', 'Casual'] as const) {
            const r = evaluateShiftShape(shift({ target_employment_type: target, end_time: '12:00' }));
            expect(has(r, 'SHAPE_FT_MIN_DAY')).toBe(false);
            expect(has(r, 'SHAPE_MIN_ENGAGEMENT')).toBe(false);
        }
    });

    it('requires 4h on a Sunday for a casual target', () => {
        const r = evaluateShiftShape(shift({ shift_date: SUNDAY, end_time: '12:30' }));
        expect(has(r, 'SHAPE_MIN_ENGAGEMENT')).toBe(true);
    });

    it('accepts a 2h training shift on a Sunday', () => {
        const r = evaluateShiftShape(shift({ shift_date: SUNDAY, end_time: '11:00', is_training: true }));
        expect(has(r, 'SHAPE_MIN_ENGAGEMENT')).toBe(false);
    });
});

describe('meal break (cl 36.1)', () => {
    // "not less than thirty (30) minutes and not more than sixty (60) minutes"
    // — one flat rule with a range. No second break, no longer-shift tier.
    it('BLOCKS when a shift over 5h net has no meal break', () => {
        const r = evaluateShiftShape(shift({ end_time: '15:00' }));
        expect(has(r, 'SHAPE_MEAL_BREAK')).toBe(true);
        expect(r.passed).toBe(false);
        expect(r.status).toBe('BLOCKING');
    });

    it('does not fire at exactly 5h net', () => {
        const r = evaluateShiftShape(shift({ end_time: '14:00' }));
        expect(has(r, 'SHAPE_MEAL_BREAK')).toBe(false);
    });

    it('is satisfied by the 30m minimum at ANY shift length', () => {
        // Regression: a 10h+ shift used to demand 60m, which cl 36.1 does not say.
        for (const end of ['15:30', '18:00', '20:00']) {
            const r = evaluateShiftShape(shift({ start_time: '06:00', end_time: end, unpaid_break_minutes: 30, paid_break_minutes: 30 }));
            expect(has(r, 'SHAPE_MEAL_BREAK'), `end=${end}`).toBe(false);
        }
    });

    it('accepts any value across the lawful 30-60 range', () => {
        for (const mins of [30, 45, 60]) {
            const r = evaluateShiftShape(shift({ start_time: '06:00', end_time: '18:00', unpaid_break_minutes: mins, paid_break_minutes: 30 }));
            expect(has(r, 'SHAPE_MEAL_BREAK'), `${mins}m`).toBe(false);
            expect(has(r, 'SHAPE_MEAL_BREAK_CEILING'), `${mins}m`).toBe(false);
        }
    });

    it('offers the whole lawful range as fixes, not just the floor', () => {
        const r = evaluateShiftShape(shift({ end_time: '15:00' }));
        const fix = r.hits.find(h => h.rule_id === 'SHAPE_MEAL_BREAK')!.fix!;
        expect(fix.value).toBe(30);
        expect(fix.options?.map(o => o.value)).toEqual([30, 45, 60]);
    });

    it('BLOCKS a meal break over 60m at any shift length', () => {
        for (const end of ['16:00', '20:00']) {
            const r = evaluateShiftShape(shift({ start_time: '06:00', end_time: end, unpaid_break_minutes: 90 }));
            expect(has(r, 'SHAPE_MEAL_BREAK_CEILING'), `end=${end}`).toBe(true);
            expect(r.passed).toBe(false);
        }
    });
});

describe('rest pauses (cl 37)', () => {
    it('flags the first pause at 4h net', () => {
        const r = evaluateShiftShape(shift({ end_time: '13:00' }));
        expect(has(r, 'SHAPE_REST_PAUSE_1')).toBe(true);
        expect(has(r, 'SHAPE_REST_PAUSE_2')).toBe(false);
    });

    it('flags the second pause at 8h net', () => {
        const r = evaluateShiftShape(shift({ end_time: '17:00', unpaid_break_minutes: 0, paid_break_minutes: 15 }));
        expect(has(r, 'SHAPE_REST_PAUSE_1')).toBe(false);
        expect(has(r, 'SHAPE_REST_PAUSE_2')).toBe(true);
    });

    it('never reports both tiers at once', () => {
        // Past 8h the requirement IS 30m. Raising cl 37.1's "15m required"
        // alongside cl 37.2's "30m required" gave two numbers for one obligation.
        const r = evaluateShiftShape(shift({ end_time: '17:00', paid_break_minutes: 0 }));
        expect(has(r, 'SHAPE_REST_PAUSE_1')).toBe(false);
        expect(has(r, 'SHAPE_REST_PAUSE_2')).toBe(true);
        expect(r.hits.filter(h => h.rule_id.startsWith('SHAPE_REST_PAUSE'))).toHaveLength(1);
    });

    it('reports only the 15m tier below 8h', () => {
        const r = evaluateShiftShape(shift({ end_time: '13:00', paid_break_minutes: 0 }));
        expect(has(r, 'SHAPE_REST_PAUSE_1')).toBe(true);
        expect(has(r, 'SHAPE_REST_PAUSE_2')).toBe(false);
    });

    it('is silent once both pauses are scheduled', () => {
        const r = evaluateShiftShape(shift({ end_time: '17:00', paid_break_minutes: 30 }));
        expect(has(r, 'SHAPE_REST_PAUSE_1')).toBe(false);
        expect(has(r, 'SHAPE_REST_PAUSE_2')).toBe(false);
    });

    it('BLOCKS — shift-shape breaches are not advisory', () => {
        const r = evaluateShiftShape(shift({ end_time: '17:00' }));
        expect(r.hits.filter(h => h.rule_id.startsWith('SHAPE_REST_PAUSE')).every(h => h.blocking)).toBe(true);
        expect(r.passed).toBe(false);
    });

    it('reports the required paid minutes so the form can offer a one-click fix', () => {
        const r = evaluateShiftShape(shift({ end_time: '13:00' }));
        expect(r.hits.find(h => h.rule_id === 'SHAPE_REST_PAUSE_1')!.calculation?.required_paid_minutes).toBe(15);
    });
});

describe('one-click remedies', () => {
    it('offers every blocking finding a fix that actually resolves it', () => {
        const cases: ShapeInput[] = [
            shift({ end_time: '10:00' }),                                              // under min engagement
            shift({ target_employment_type: 'FT', end_time: '12:00' }),                // under FT floor
            shift({ start_time: '06:00', end_time: '19:00' }),                         // over spread
            shift({ start_time: '06:00', end_time: '18:00' }),                         // meal + rest pauses
            shift({ end_time: '16:00', unpaid_break_minutes: 90 }),                    // over break ceiling
        ];

        for (const c of cases) {
            let current = { ...c };
            // Applying each suggested fix in turn must reach a passing shape —
            // a remedy that does not resolve its own finding is worse than none.
            for (let i = 0; i < 6; i++) {
                const r = evaluateShiftShape(current);
                if (r.passed) break;
                const withFix = r.hits.find(h => h.blocking && h.fix);
                expect(withFix, `no fix offered for ${r.hits.map(h => h.rule_id).join()}`).toBeTruthy();
                current = { ...current, [withFix!.fix!.field]: withFix!.fix!.value } as ShapeInput;
            }
            expect(evaluateShiftShape(current).passed, `unresolved: ${JSON.stringify(current)}`).toBe(true);
        }
    });

    it('extends a full-time shift to exactly the 7.6h floor', () => {
        const r = evaluateShiftShape(shift({
            target_employment_type: 'FT', start_time: '08:30', end_time: '16:30', unpaid_break_minutes: 30,
        }));
        expect(r.hits.find(h => h.rule_id === 'SHAPE_FT_MIN_DAY')!.fix).toMatchObject({
            field: 'end_time', value: '16:36', label: 'Extend to 16:36',
        });
    });

    it('offers a trim on an over-spread shift, without blocking it', () => {
        const r = evaluateShiftShape(shift({ start_time: '06:00', end_time: '19:00' }));
        const hit = r.hits.find(h => h.rule_id === 'SHAPE_SPREAD_GUARDRAIL')!;
        expect(hit.fix).toMatchObject({ field: 'end_time', value: '18:00' });
        expect(hit.blocking).toBe(false);
    });
});

describe('incomplete input raises nothing', () => {
    // Regression: `parseTimeToMinutes('')` returns 0, which is a legitimate time
    // (midnight). An empty end time therefore looked like a cross-midnight shift
    // and reported an 18h spread, a missing meal break and two rest pauses —
    // all about fields the user had not typed yet.
    it('is INCOMPLETE with no hits when nothing is entered', () => {
        const r = evaluateShiftShape(shift({ start_time: '', end_time: '' }));
        expect(r.status).toBe('INCOMPLETE');
        expect(r.hits).toEqual([]);
        expect(r.blocking).toBe(false);
        expect(r.passed).toBe(false);
    });

    it('is INCOMPLETE with no hits when only the start is entered', () => {
        const r = evaluateShiftShape(shift({ start_time: '06:00', end_time: '' }));
        expect(r.status).toBe('INCOMPLETE');
        expect(r.hits).toEqual([]);
        // The 18h phantom spread specifically.
        expect(r.net_minutes).toBe(0);
    });

    it('is INCOMPLETE while a time is still half-typed', () => {
        for (const partial of ['0', '06', '06:', '06:0', '6:00', '25:00', '06:99']) {
            const r = evaluateShiftShape(shift({ start_time: '06:00', end_time: partial }));
            expect(r.status, `end_time=${partial}`).toBe('INCOMPLETE');
            expect(r.hits, `end_time=${partial}`).toEqual([]);
        }
    });

    it('starts evaluating the moment both times are complete', () => {
        const r = evaluateShiftShape(shift({ start_time: '06:00', end_time: '18:00' }));
        expect(r.status).toBe('BLOCKING');
        expect(r.hits.length).toBeGreaterThan(0);
    });

    it('accepts HH:mm:ss from the database', () => {
        const r = evaluateShiftShape(shift({ start_time: '09:00:00', end_time: '13:00:00', paid_break_minutes: 15 }));
        expect(r.status).toBe('PASS');
    });
});

describe('degenerate input', () => {
    it('blocks a zero-length shift and reports nothing else', () => {
        const r = evaluateShiftShape(shift({ start_time: '09:00', end_time: '09:00' }));
        expect(ids(r)).toEqual(['SHAPE_VALID_RANGE']);
        expect(r.passed).toBe(false);
    });

    it('blocks a break longer than the shift', () => {
        const r = evaluateShiftShape(shift({ end_time: '13:00', unpaid_break_minutes: 300 }));
        expect(has(r, 'SHAPE_BREAK_EXCEEDS_SHIFT')).toBe(true);
        expect(r.passed).toBe(false);
    });

    it('handles a shift crossing midnight', () => {
        const r = evaluateShiftShape(shift({ start_time: '22:00', end_time: '06:00' }));
        expect(r.net_minutes).toBe(480);
        expect(has(r, 'SHAPE_MAX_DURATION')).toBe(false);
    });
});

describe('result contract', () => {
    it('reports PASS with no hits for a clean 4h casual weekday shift', () => {
        const r = evaluateShiftShape(shift({ end_time: '13:00', paid_break_minutes: 15 }));
        expect(r.hits).toEqual([]);
        expect(r.status).toBe('PASS');
        expect(r.passed).toBe(true);
        expect(r.blocking).toBe(false);
    });

    it('blocks the screenshot case: 06:00-18:00, no breaks', () => {
        // 12h net, zero breaks — this was advancing through the wizard with a
        // dismissible nudge. Two breaches, both blocking: the 60m meal break and
        // the 30m rest pause. Only the applicable rest-pause tier is reported.
        const r = evaluateShiftShape(shift({ start_time: '06:00', end_time: '18:00' }));
        expect(ids(r)).toEqual(['SHAPE_MEAL_BREAK', 'SHAPE_REST_PAUSE_2']);
        expect(r.passed).toBe(false);
    });

    it('warns on a 13h SPAN but does not block a lawful 12h net', () => {
        // 06:00-19:00 = 13h gross; a 60m unpaid break makes it 12h net, which
        // cl 35.1(d) expressly permits ("may work up to twelve (12) ordinary
        // hours on any one day"). This used to BLOCK, citing cl 39.2 — a clause
        // that governs split shifts and is measured EXCLUDING breaks. Refusing
        // a lawful roster is a worse failure than flagging one, so the house
        // guardrail warns and the shift saves.
        const r = evaluateShiftShape(shift({ start_time: '06:00', end_time: '19:00', unpaid_break_minutes: 60, paid_break_minutes: 30 }));
        expect(r.net_minutes).toBe(720);
        expect(has(r, 'SHAPE_MAX_DURATION')).toBe(false);
        expect(has(r, 'SHAPE_SPREAD_GUARDRAIL')).toBe(true);
        expect(r.status).toBe('WARNING');
        expect(r.passed).toBe(true);
    });

    it('allows an exactly-12h span', () => {
        const r = evaluateShiftShape(shift({ start_time: '06:00', end_time: '18:00', unpaid_break_minutes: 60, paid_break_minutes: 30 }));
        expect(has(r, 'SHAPE_SPREAD_GUARDRAIL')).toBe(false);
        expect(r.passed).toBe(true);
    });

    it('keeps passed and blocking as exact inverses', () => {
        const cases = [
            shift(),
            shift({ end_time: '09:00' }),
            shift({ target_employment_type: 'FT' }),
            shift({ end_time: '23:00' }),
        ];
        for (const c of cases) {
            const r = evaluateShiftShape(c);
            expect(r.passed).toBe(!r.blocking);
        }
    });
});
