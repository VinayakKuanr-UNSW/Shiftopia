import { describe, it, expect } from 'vitest';
import { spreadOfHoursRule } from '../spread-of-hours';
import { buildContext, buildShift, resetIdCounter } from './_helpers';

/**
 * cl 39.2 — the split-shift spread ceiling.
 *
 * The rule these tests replace read the clause as a universal daily spread cap:
 * every employment type, measured gross, firing on a lone shift. All three are
 * wrong, and together they made this the largest single source of false blocks
 * in the grid — every long permanent day with a proper meal break failed a
 * split-shift rule for staff who cannot work split shifts.
 *
 * The old suite could not have caught any of it. Its one positive case asserted
 * `expect(hits.length).toBeGreaterThanOrEqual(0)` — true of every array, over a
 * comment conceding the author did not know whether the rule should fire. The
 * other two cases asserted the absence of hits, which a rule that never fires
 * also satisfies. So the rule's entire test suite passed unchanged when its
 * scope and its unit of measure both changed.
 */

const PT = { contract_type: 'PART_TIME' as const };

describe('scope — cl 39.1 and cl 7.14 confine split shifts to PT and FPT', () => {
    /** 06:00–10:00 and 18:00–22:00: a 16h spread, no breaks. */
    const splitDay = () => [
        buildShift({ date: '2026-06-01', start_time: '06:00', end_time: '10:00' }),
        buildShift({ date: '2026-06-01', start_time: '18:00', end_time: '22:00' }),
    ];

    it('fires for a part-timer', () => {
        resetIdCounter();
        const hits = spreadOfHoursRule(buildContext({ employee: PT, shifts: splitDay() }));
        expect(hits).toHaveLength(1);
        expect(hits[0].rule_id).toBe('V8_SPLIT_SHIFT_SPREAD');
        expect(hits[0].blocking).toBe(true);
        expect(hits[0].calculation!.net_spread_minutes).toBe(960);
    });

    it('fires for a flexible part-timer', () => {
        resetIdCounter();
        const hits = spreadOfHoursRule(buildContext({
            employee: { contract_type: 'FLEXI_PART_TIME' }, shifts: splitDay(),
        }));
        expect(hits).toHaveLength(1);
    });

    it('stays silent for a full-timer', () => {
        // cl 39.1 does not reach them. Their day is bounded by cl 35.1(d)'s 12h
        // WORKED ceiling, which V8_MAX_DAILY_HOURS owns.
        resetIdCounter();
        expect(spreadOfHoursRule(buildContext({
            employee: { contract_type: 'FULL_TIME' }, shifts: splitDay(),
        }))).toEqual([]);
    });

    it('stays silent for a casual', () => {
        // cl 28.4 excludes casuals from the split-shift structure entirely.
        // cl 35.4(f) caps them at two engagements a day instead.
        resetIdCounter();
        expect(spreadOfHoursRule(buildContext({
            employee: { contract_type: 'CASUAL' }, shifts: splitDay(),
        }))).toEqual([]);
    });
});

describe('measure — cl 39.2 says "excluding meal and rest breaks"', () => {
    it('subtracts unpaid break time from the spread', () => {
        // 06:00–19:00 across two engagements is a 13h gross span. With an hour
        // of unpaid break that is 12h of spread — the ceiling exactly, not over
        // it. Measured gross, as the rule used to, this was a 13h breach and the
        // roster was refused.
        resetIdCounter();
        const hits = spreadOfHoursRule(buildContext({
            employee: PT,
            shifts: [
                buildShift({ date: '2026-06-01', start_time: '06:00', end_time: '12:00', unpaid_break_minutes: 30 }),
                buildShift({ date: '2026-06-01', start_time: '13:00', end_time: '19:00', unpaid_break_minutes: 30 }),
            ],
        }));
        expect(hits).toEqual([]);
    });

    it('still fires once the NET spread passes 12h', () => {
        resetIdCounter();
        const hits = spreadOfHoursRule(buildContext({
            employee: PT,
            shifts: [
                buildShift({ date: '2026-06-01', start_time: '06:00', end_time: '12:00', unpaid_break_minutes: 30 }),
                buildShift({ date: '2026-06-01', start_time: '13:00', end_time: '19:01', unpaid_break_minutes: 30 }),
            ],
        }));
        expect(hits).toHaveLength(1);
        expect(hits[0].calculation!.net_spread_minutes).toBe(721);
    });

    it('reports gross, break and net so the number can be checked', () => {
        resetIdCounter();
        const [hit] = spreadOfHoursRule(buildContext({
            employee: PT,
            shifts: [
                buildShift({ date: '2026-06-01', start_time: '06:00', end_time: '10:00', unpaid_break_minutes: 30 }),
                buildShift({ date: '2026-06-01', start_time: '18:00', end_time: '22:00', unpaid_break_minutes: 0 }),
            ],
        }));
        expect(hit.calculation).toMatchObject({
            gross_spread_minutes: 960,
            unpaid_break_minutes: 30,
            net_spread_minutes: 930,
            limit_minutes: 720,
            engagements: 2,
        });
    });
});

describe('arity — a spread needs two engagements to span', () => {
    it('stays silent on a single long shift', () => {
        // 06:00–19:00 in ONE engagement is not a split shift at all. The
        // applicable ceiling is the daily ordinary-hours cap, enforced by
        // SHAPE_MAX_DURATION at creation and V8_MAX_DAILY_HOURS at assignment.
        resetIdCounter();
        expect(spreadOfHoursRule(buildContext({
            employee: PT,
            shifts: [buildShift({ date: '2026-06-01', start_time: '06:00', end_time: '19:00' })],
        }))).toEqual([]);
    });

    it('does not flag ordinary back-to-back same-day shifts', () => {
        resetIdCounter();
        expect(spreadOfHoursRule(buildContext({
            employee: PT,
            shifts: [
                buildShift({ date: '2026-06-01', start_time: '09:00', end_time: '12:00' }),
                buildShift({ date: '2026-06-01', start_time: '13:00', end_time: '17:00' }),
            ],
        }))).toEqual([]);
    });

    it('scopes each day separately', () => {
        resetIdCounter();
        const hits = spreadOfHoursRule(buildContext({
            employee: PT,
            shifts: [
                buildShift({ date: '2026-06-01', start_time: '06:00', end_time: '10:00' }),
                buildShift({ date: '2026-06-02', start_time: '18:00', end_time: '22:00' }),
            ],
        }));
        expect(hits).toEqual([]);
    });
});
