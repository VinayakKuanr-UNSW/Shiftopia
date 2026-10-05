/**
 * Indexing the week, and the one-per-day rule the database does not enforce.
 *
 * `shifts` has no unique key on (employee, date) — checked against production —
 * so cl 39.1 lives in the app, which makes it exactly the kind of rule that
 * needs a test. The other half is that a day already holding two shifts must
 * SURFACE the second rather than swallow it: dropping a real rostered shift
 * because the model did not expect it is the worse failure.
 */
import { describe, expect, it } from 'vitest';
import { blockedFromCreating, indexOfficeWeek } from '../plannedWeek';
import type { Shift } from '@/modules/rosters/domain/shift.entity';

const MON = '2026-09-28';
const TUE = '2026-09-29';
const NEXT_MON = '2026-10-05';

const WEEK = new Set([
    MON, TUE, '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
]);

/**
 * `indexOfficeWeek` reads three fields. Spelling out all ~60 of the entity's
 * columns to prove that would test the fixture, not the function — the cast is
 * narrow and deliberate, not a way around a type error.
 */
function shift(over: {
    id: string;
    assigned_employee_id: string | null;
    shift_date: string;
    start_time?: string;
}): Shift {
    return { start_time: '08:00', ...over } as unknown as Shift;
}

describe('indexOfficeWeek', () => {
    it('keys cells by employee and date', () => {
        const idx = indexOfficeWeek([
            shift({ id: 's1', assigned_employee_id: 'e1', shift_date: MON }),
            shift({ id: 's2', assigned_employee_id: 'e2', shift_date: TUE }),
        ], WEEK);

        expect(idx.get('e1')?.get(MON)?.shift.id).toBe('s1');
        expect(idx.get('e2')?.get(TUE)?.shift.id).toBe('s2');
        expect(idx.get('e1')?.has(TUE)).toBe(false);
    });

    it('drops shifts outside the visible week', () => {
        // The caller reads a WIDER window on purpose — consumption is counted
        // over whole cycles — so the narrowing has to happen here.
        const idx = indexOfficeWeek([
            shift({ id: 's1', assigned_employee_id: 'e1', shift_date: MON }),
            shift({ id: 's2', assigned_employee_id: 'e1', shift_date: NEXT_MON }),
        ], WEEK);

        expect([...(idx.get('e1')?.keys() ?? [])]).toEqual([MON]);
    });

    it('ignores an unassigned shift', () => {
        // The grid is a row per employee; a shift with no assignee has no row.
        const idx = indexOfficeWeek(
            [shift({ id: 's1', assigned_employee_id: null, shift_date: MON })], WEEK);

        expect(idx.size).toBe(0);
    });

    it('surfaces a second shift on the same day rather than dropping it', () => {
        const idx = indexOfficeWeek([
            shift({ id: 'late', assigned_employee_id: 'e1', shift_date: MON, start_time: '14:00' }),
            shift({ id: 'early', assigned_employee_id: 'e1', shift_date: MON, start_time: '06:00' }),
        ], WEEK);

        const cell = idx.get('e1')?.get(MON);
        // The earliest is the one the cell edits, whatever order they arrived in.
        expect(cell?.shift.id).toBe('early');
        expect(cell?.alsoOnThisDay.map(s => s.id)).toEqual(['late']);
    });

    it('leaves alsoOnThisDay empty for a compliant day', () => {
        const idx = indexOfficeWeek(
            [shift({ id: 's1', assigned_employee_id: 'e1', shift_date: MON })], WEEK);

        expect(idx.get('e1')?.get(MON)?.alsoOnThisDay).toEqual([]);
    });
});

describe('blockedFromCreating', () => {
    it('permits a day with nothing on it', () => {
        const idx = indexOfficeWeek([], WEEK);
        expect(blockedFromCreating(idx.get('e1'), MON)).toBeNull();
    });

    it('refuses a second shift, and cites the clause', () => {
        const idx = indexOfficeWeek(
            [shift({ id: 's1', assigned_employee_id: 'e1', shift_date: MON })], WEEK);

        const reason = blockedFromCreating(idx.get('e1'), MON);
        expect(reason).toContain('cl 39.1');
        // A reason, not a bare boolean — the difference between a disabled
        // control and an explained one.
        expect(reason).toMatch(/already has a shift/i);
    });

    it('still permits the other days of that week', () => {
        const idx = indexOfficeWeek(
            [shift({ id: 's1', assigned_employee_id: 'e1', shift_date: MON })], WEEK);

        expect(blockedFromCreating(idx.get('e1'), TUE)).toBeNull();
    });

    it('permits everything for an employee with no cells at all', () => {
        expect(blockedFromCreating(undefined, MON)).toBeNull();
    });
});
