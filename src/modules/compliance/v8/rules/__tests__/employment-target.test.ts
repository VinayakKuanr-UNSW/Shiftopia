import { describe, it, expect } from 'vitest';
import { employmentTargetRule } from '../employment-target';
import type { V8RuleContext, V8Employee, V8Shift } from '../../types';

/**
 * V8_EMPLOYMENT_TARGET — the app-layer half of the hard employment-target match.
 *
 * The rule is what gives a planner (or a bidding/swap flow) a readable reason
 * BEFORE the write; `trg_shift_employment_target_2_enforce` is the guarantee
 * after it. These tests pin the two properties that make that split safe:
 *   - it never blocks someone the DB would have accepted (errs open), and
 *   - it stays silent on un-hydrated input rather than blocking on missing data.
 */

const baseEmployee: V8Employee = {
    id: 'e1',
    name: 'Test',
    contract_type: 'CASUAL',
    contracted_weekly_hours: 38,
};

function shift(over: Partial<V8Shift> = {}): V8Shift {
    return {
        id: 's1',
        date: '2026-06-01',
        start_time: '09:00',
        end_time: '17:00',
        is_ordinary_hours: true,
        ...over,
    };
}

function ctx(employee: Partial<V8Employee>, shifts: V8Shift[]): V8RuleContext {
    return {
        employee: { ...baseEmployee, ...employee },
        shifts,
        config: {} as any,
        reference_date: '2026-06-01',
    };
}

describe('employmentTargetRule — blocking behaviour', () => {
    it('blocks a Casual on a Full-Time shift', () => {
        const hits = employmentTargetRule(
            ctx({ employment_statuses: ['Casual'] }, [shift({ target_employment_type: 'FT' })]),
        );
        expect(hits).toHaveLength(1);
        expect(hits[0].rule_id).toBe('V8_EMPLOYMENT_TARGET');
        expect(hits[0].blocking).toBe(true);
        expect(hits[0].status).toBe('BLOCKING');
    });

    it('passes a Full-Time employee on a Full-Time shift', () => {
        const hits = employmentTargetRule(
            ctx({ employment_statuses: ['Full-Time'] }, [shift({ target_employment_type: 'FT' })]),
        );
        expect(hits).toEqual([]);
    });

    it('names both the target and what the employee actually holds', () => {
        // The message is the whole point of having this rule in front of the
        // trigger — it has to be actionable.
        const [hit] = employmentTargetRule(
            ctx({ employment_statuses: ['Casual'] }, [shift({ target_employment_type: 'PT' })]),
        );
        expect(hit.details).toContain('Part-Time');
        expect(hit.details).toContain('Casual');
    });
});

describe('employmentTargetRule — the flexible second axis', () => {
    it('accepts Flexible Part-Time for a plain PT target', () => {
        const hits = employmentTargetRule(
            ctx({ employment_statuses: ['Flexible Part-Time'] }, [
                shift({ target_employment_type: 'PT' }),
            ]),
        );
        expect(hits).toEqual([]);
    });

    it('blocks a plain part-timer when the shift requires Flexible', () => {
        // Both statuses normalize to 'PT', so only target_requires_flexible
        // separates them — the reason a fourth token could not express this.
        const hits = employmentTargetRule(
            ctx({ employment_statuses: ['Part-Time'] }, [
                shift({ target_employment_type: 'PT', target_requires_flexible: true }),
            ]),
        );
        expect(hits).toHaveLength(1);
        expect(hits[0].summary).toContain('Flexible Part-Time');
    });

    it('accepts Flexible Part-Time when the shift requires Flexible', () => {
        const hits = employmentTargetRule(
            ctx({ employment_statuses: ['Flexible Part-Time'] }, [
                shift({ target_employment_type: 'PT', target_requires_flexible: true }),
            ]),
        );
        expect(hits).toEqual([]);
    });

    it('ignores the flexible flag on a non-PT target', () => {
        // Mirrors shifts_target_flexible_requires_pt_check: the flag can only
        // ever narrow a PT target, never affect FT/Casual.
        const hits = employmentTargetRule(
            ctx({ employment_statuses: ['Casual'] }, [
                shift({ target_employment_type: 'Casual', target_requires_flexible: true }),
            ]),
        );
        expect(hits).toEqual([]);
    });
});

describe('employmentTargetRule — silence on un-hydrated input', () => {
    it('is silent when employment_statuses is absent', () => {
        // Callers that have not plumbed contracts must not have every assignment
        // blocked; the DB trigger still guards the write.
        expect(
            employmentTargetRule(ctx({}, [shift({ target_employment_type: 'FT' })])),
        ).toEqual([]);
        expect(
            employmentTargetRule(ctx({ employment_statuses: [] }, [
                shift({ target_employment_type: 'FT' }),
            ])),
        ).toEqual([]);
    });

    it('is silent when the shift carries no target', () => {
        expect(
            employmentTargetRule(ctx({ employment_statuses: ['Casual'] }, [shift()])),
        ).toEqual([]);
    });
});

describe('employmentTargetRule — scoping', () => {
    it('never re-validates history (is_candidate === false)', () => {
        // A past shift whose target no longer matches must not block a new
        // operation — the per-shift rule convention in this engine.
        const hits = employmentTargetRule(
            ctx({ employment_statuses: ['Casual'] }, [
                shift({ id: 'old', target_employment_type: 'FT', is_candidate: false }),
                shift({ id: 'new', target_employment_type: 'Casual', is_candidate: true }),
            ]),
        );
        expect(hits).toEqual([]);
    });

    it('errs OPEN when any active contract matches', () => {
        // The engine cannot see which sub-department the candidate shift belongs
        // to, so it accepts a match on ANY active contract. That keeps it from
        // ever blocking an assignment the sub-department-scoped DB trigger would
        // have allowed; the rarer opposite case is caught server-side.
        const hits = employmentTargetRule(
            ctx({ employment_statuses: ['Casual', 'Full-Time'] }, [
                shift({ target_employment_type: 'FT' }),
            ]),
        );
        expect(hits).toEqual([]);
    });

    it('reports one hit per offending candidate shift', () => {
        const hits = employmentTargetRule(
            ctx({ employment_statuses: ['Casual'] }, [
                shift({ id: 'a', target_employment_type: 'FT' }),
                shift({ id: 'b', target_employment_type: 'PT' }),
            ]),
        );
        expect(hits).toHaveLength(2);
        expect(hits.flatMap(h => h.affected_shifts)).toEqual(['a', 'b']);
    });
});
