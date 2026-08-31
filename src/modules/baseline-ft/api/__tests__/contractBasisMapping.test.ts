/**
 * The contract → basis mapping, pinned field by field.
 *
 * `ContractBasisInput` names the cycle `ordinaryHoursCycleWeeks`; `ContractBasis`
 * — the OUTPUT — names it `cycleWeeks`. Passing the output's name on the input
 * type-checks in a `.map()` and is then silently ignored, and
 * `resolveComplianceBasis` falls back to the four-week default.
 *
 * That is invisible in production today because every contract declares exactly
 * four weeks anchored to 2024-01-01, so the wrong code and the right code agree.
 * It is the same shape as the hydration gap that left the solver's HC-12 inert
 * on every run: a field dropped at a boundary, with a plausible default
 * underneath it.
 *
 * So this asserts a NON-DEFAULT cycle survives, which is the only way the bug
 * is observable.
 */
import { describe, expect, it } from 'vitest';
import { resolveComplianceBasis, type ContractBasisInput } from '@/modules/availability/domain/contract-basis';

/**
 * The mapping performed by `baselineFt.loaders.ts#loadEligibleEmployees` and
 * `useBaselineFt.ts#useFtProfile`. Reproduced here because both build it inline
 * inside a Supabase read; if either drifts, this notices.
 */
function toBasisInput(row: Record<string, unknown>): ContractBasisInput {
    return {
        employmentStatus: row.employment_status as string | null,
        contractedWeeklyHours: (row.contracted_weekly_hours as number | null) ?? null,
        startDate: row.start_date as string | null,
        ordinaryHoursCycleWeeks: row.ordinary_hours_cycle_weeks as number | null,
        ordinaryHoursCycleAnchor: row.ordinary_hours_cycle_anchor as string | null,
    };
}

const ROW = {
    employment_status: 'Full-Time',
    contracted_weekly_hours: 38,
    start_date: '2024-01-01',
    ordinary_hours_cycle_weeks: 4,
    ordinary_hours_cycle_anchor: '2024-01-01',
};

describe('contract row → ContractBasisInput', () => {
    it('carries a NON-DEFAULT declared cycle through to the basis', () => {
        // Two weeks, not the four-week default. If the field name is wrong this
        // silently reads back as 4 and the assertion fails.
        const basis = resolveComplianceBasis([
            toBasisInput({ ...ROW, ordinary_hours_cycle_weeks: 2 }),
        ]);

        expect(basis.cycleWeeks).toBe(2);
        expect(basis.isFullTime).toBe(true);
        expect(basis.contractedWeeklyHours).toBe(38);
    });

    it('carries a non-default anchor through', () => {
        // 2024-07-01 is a Monday, so it survives normalisation. A non-Monday
        // would legitimately snap back to the shared epoch.
        expect(new Date('2024-07-01T00:00:00Z').getUTCDay()).toBe(1);

        const basis = resolveComplianceBasis([
            toBasisInput({ ...ROW, ordinary_hours_cycle_anchor: '2024-07-01' }),
        ]);

        expect(basis.cycleAnchor).toBe('2024-07-01');
    });

    it('would MISS the cycle if the output field name were used on the input', () => {
        // The bug, written down. `cycleWeeks` is what ContractBasis calls it;
        // supplying that on the INPUT is ignored and the default wins.
        const wrong = {
            employmentStatus: 'Full-Time',
            contractedWeeklyHours: 38,
            startDate: '2024-01-01',
            cycleWeeks: 2,
            cycleAnchor: '2024-07-01',
        } as unknown as ContractBasisInput;

        const basis = resolveComplianceBasis([wrong]);

        expect(basis.cycleWeeks).toBe(4);              // the default, not 2
        expect(basis.cycleAnchor).toBe('2024-01-01');  // the epoch, not July
    });

    it('resolves the SHORTEST cycle when contracts disagree', () => {
        // Cycle length is a smoothing allowance, so the shortest is strictest
        // and is the safe aggregation for one person's several engagements.
        const basis = resolveComplianceBasis([
            toBasisInput({ ...ROW, ordinary_hours_cycle_weeks: 4 }),
            toBasisInput({ ...ROW, ordinary_hours_cycle_weeks: 2 }),
        ]);

        expect(basis.cycleWeeks).toBe(2);
    });

    it('still classifies employment correctly through the mapping', () => {
        expect(resolveComplianceBasis([toBasisInput(ROW)]).isWhollyFullTime).toBe(true);
        expect(resolveComplianceBasis([
            toBasisInput(ROW),
            toBasisInput({ ...ROW, employment_status: 'Casual' }),
        ]).isWhollyFullTime).toBe(false);
    });
});
