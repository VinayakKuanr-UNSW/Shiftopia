import { describe, it, expect } from 'vitest';
import { ftDaysOffRule } from '../ft-days-off';
import { buildContext, buildShift, buildConsecutiveShifts, resetIdCounter } from './_helpers';
import { DEFAULT_V8_CONFIG, type V8Shift } from '../../types';

/**
 * ICC EBA cl 35.1(e), p.28 — "Each full-time Team Member shall have, on
 * average, two (2) consecutive days off each week during each work cycle unless
 * otherwise mutually agreed between the Employer and Team Member."
 *
 * `maxWorkdayLimitsRule` owns the other half of cl 35.1(e) (20-in-28).
 */

/** Build shifts on the given weekday offsets from a Monday, for `weeks` weeks. */
function buildWeeklyPattern(mondayStart: string, weeks: number, weekdayOffsets: number[]): V8Shift[] {
    const shifts: V8Shift[] = [];
    const base = new Date(`${mondayStart}T00:00:00Z`);
    for (let w = 0; w < weeks; w++) {
        for (const offset of weekdayOffsets) {
            const d = new Date(base);
            d.setUTCDate(d.getUTCDate() + w * 7 + offset);
            shifts.push(buildShift({ date: d.toISOString().slice(0, 10) }));
        }
    }
    return shifts;
}

describe('ftDaysOffRule (cl 35.1(e))', () => {
    describe('opt-in gate', () => {
        it('is OFF by default — existing bid/swap/assignment callers are unaffected', () => {
            resetIdCounter();
            const ctx = buildContext({
                shifts: buildWeeklyPattern('2026-06-01', 4, [0, 1, 3, 4, 6]),
            });
            expect(ctx.config.enforce_ft_days_off).toBe(false);
            expect(ftDaysOffRule(ctx)).toEqual([]);
        });

        it('an opted-in config turns it on', () => {
            resetIdCounter();
            const ctx = buildContext({
                config: { ...DEFAULT_V8_CONFIG, enforce_ft_days_off: true },
                shifts: buildWeeklyPattern('2026-06-01', 4, [0, 1, 3, 4, 6]),
            });
            expect(ftDaysOffRule(ctx)).toHaveLength(1);
        });
    });

    it('passes a standard Mon–Fri pattern over 4 weeks (Sat+Sun is the pair)', () => {
        resetIdCounter();
        const ctx = buildContext({
            config: { enforce_ft_days_off: true },
            shifts: buildWeeklyPattern('2026-06-01', 4, [0, 1, 2, 3, 4]),
        });
        expect(ftDaysOffRule(ctx)).toEqual([]);
    });

    it('warns when days off are scattered singly and never paired', () => {
        resetIdCounter();
        // Work Mon,Tue,Thu,Fri,Sun — every day off (Wed, Sat) is isolated.
        const ctx = buildContext({
            config: { enforce_ft_days_off: true },
            shifts: buildWeeklyPattern('2026-06-01', 4, [0, 1, 3, 4, 6]),
        });
        const hits = ftDaysOffRule(ctx);
        expect(hits).toHaveLength(1);
        expect(hits[0].rule_id).toBe('V8_FT_DAYS_OFF');
        expect(hits[0].calculation?.eba_clause).toBe('cl 35.1(e)');
        expect(hits[0].calculation?.pairs_found).toBe(0);
    });

    it('is a WARNING, never BLOCKING — cl 35.1(e) is "on average" and waivable', () => {
        resetIdCounter();
        const ctx = buildContext({
            config: { enforce_ft_days_off: true },
            shifts: buildWeeklyPattern('2026-06-01', 4, [0, 1, 3, 4, 6]),
        });
        const hits = ftDaysOffRule(ctx);
        expect(hits[0].status).toBe('WARNING');
        expect(hits[0].blocking).toBe(false);
    });

    it('accepts an averaged pattern — one 4-day break covers two weeks', () => {
        resetIdCounter();
        // Week 1+2: work 10 straight days, then 4 days off, then resume.
        const shifts = [
            ...buildConsecutiveShifts(10, '2026-06-01'),
            ...buildConsecutiveShifts(10, '2026-06-15'),
        ];
        const hits = ftDaysOffRule(buildContext({ config: { enforce_ft_days_off: true }, shifts }));
        // 2026-06-11..14 is a 4-day run ⇒ 2 pairs; window is 24 days ⇒ 3 weeks.
        // Trailing edge is a working day, so no generous trailing credit.
        expect(hits[0]?.calculation?.pairs_found).toBe(2);
        expect(hits[0]?.calculation?.pairs_required).toBe(3);
    });

    it('stays silent on a window shorter than 14 days — an average is not evaluable', () => {
        resetIdCounter();
        const ctx = buildContext({ config: { enforce_ft_days_off: true }, shifts: buildConsecutiveShifts(10, '2026-06-01') });
        expect(ftDaysOffRule(ctx)).toEqual([]);
    });

    it('stays silent for a single shift (the common assignment-check case)', () => {
        resetIdCounter();
        expect(ftDaysOffRule(buildContext({ config: { enforce_ft_days_off: true }, shifts: [buildShift()] }))).toEqual([]);
    });

    it('does not apply to PART_TIME', () => {
        resetIdCounter();
        const ctx = buildContext({
            config: { enforce_ft_days_off: true },
            employee: { contract_type: 'PART_TIME' },
            shifts: buildWeeklyPattern('2026-06-01', 4, [0, 1, 3, 4, 6]),
        });
        expect(ftDaysOffRule(ctx)).toEqual([]);
    });

    it.each(['CASUAL', 'FLEXI_PART_TIME'] as const)('does not apply to %s', (contract_type) => {
        resetIdCounter();
        const ctx = buildContext({
            config: { enforce_ft_days_off: true },
            employee: { contract_type },
            shifts: buildWeeklyPattern('2026-06-01', 4, [0, 1, 3, 4, 6]),
        });
        expect(ftDaysOffRule(ctx)).toEqual([]);
    });

    it('does not apply to Full-Time Security (Sch 3 §3.1(b) even-time roster)', () => {
        resetIdCounter();
        const ctx = buildContext({
            config: { enforce_ft_days_off: true },
            employee: { contract_type: 'FULL_TIME', is_security_role: true },
            shifts: buildWeeklyPattern('2026-06-01', 4, [0, 1, 3, 4, 6]),
        });
        expect(ftDaysOffRule(ctx)).toEqual([]);
    });

    it('credits a trailing run generously so a boundary-straddling pair is not a false positive', () => {
        resetIdCounter();
        // 3 weeks of Mon–Fri, but the window ends on the Saturday — the Sunday
        // that completes the final pair falls outside the observed window.
        const shifts = [
            ...buildWeeklyPattern('2026-06-01', 2, [0, 1, 2, 3, 4]),
            ...buildWeeklyPattern('2026-06-15', 1, [0, 1, 2, 3, 4]),
        ];
        // Window: 2026-06-01 .. 2026-06-19 = 19 days ⇒ 2 whole weeks.
        // Pairs: 06-06/07 and 06-13/14 ⇒ 2. Satisfied.
        expect(ftDaysOffRule(buildContext({ config: { enforce_ft_days_off: true }, shifts }))).toEqual([]);
    });

    it('counts a cross-midnight shift as occupying the following day too', () => {
        resetIdCounter();
        // Mon–Fri for 3 weeks, but each Friday shift runs 22:00→06:00, spilling
        // onto Saturday and destroying the Sat+Sun pair.
        const shifts: V8Shift[] = [];
        const base = new Date('2026-06-01T00:00:00Z');
        for (let w = 0; w < 3; w++) {
            for (const offset of [0, 1, 2, 3]) {
                const d = new Date(base);
                d.setUTCDate(d.getUTCDate() + w * 7 + offset);
                shifts.push(buildShift({ date: d.toISOString().slice(0, 10) }));
            }
            const fri = new Date(base);
            fri.setUTCDate(fri.getUTCDate() + w * 7 + 4);
            shifts.push(buildShift({
                date: fri.toISOString().slice(0, 10),
                start_time: '22:00',
                end_time: '06:00',
            }));
        }
        const hits = ftDaysOffRule(buildContext({ config: { enforce_ft_days_off: true }, shifts }));
        // Every Saturday is consumed by the Friday spill, leaving only isolated Sundays.
        expect(hits).toHaveLength(1);
        expect(hits[0].calculation?.pairs_found).toBe(0);
    });

    it('skips malformed shifts rather than crashing', () => {
        resetIdCounter();
        const ctx = buildContext({
            config: { enforce_ft_days_off: true },
            shifts: [
                buildShift({ date: '', start_time: '09:00', end_time: '17:00' }),
                buildShift({ date: '2026-06-01', start_time: '', end_time: '' }),
            ],
        });
        expect(ftDaysOffRule(ctx)).toEqual([]);
    });

    it('is silent when there are no shifts', () => {
        resetIdCounter();
        expect(ftDaysOffRule(buildContext({ config: { enforce_ft_days_off: true } }))).toEqual([]);
    });
});
