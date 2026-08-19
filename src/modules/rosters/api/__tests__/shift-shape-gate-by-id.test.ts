import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A shape verdict has an expiry date, and until now nothing noticed.
 *
 * Ten of the twelve shape rules are decidable from the shift alone, so deciding
 * them once at creation is right forever. Two are not: cl 56.2's four-hour
 * public-holiday minimum and the Sunday tier of cl 12.4(c)/12.5(c) are decided
 * by WHICH DAY the shift falls on. That makes them the only two a later change
 * can invalidate without touching the shift at all.
 *
 * Three production paths did exactly that. `shiftsCommands.moveShift` calls
 * `sm_move_shift` directly rather than going through `updateShift`, where the
 * create/edit gate lives. `assignShift.command` does the same for a date move
 * and then writes `start_time`/`end_time` with a raw `.from('shifts').update()`.
 * A lawful three-hour Monday casual dragged onto Christmas Day became unlawful
 * and nothing objected.
 *
 * `assertShapeForShiftId` is the gate for callers that hold a CHANGE rather
 * than a ROW. These tests assert on the merge — evaluating the patch alone
 * would be meaningless, because a new date says nothing about whether the shift
 * is long enough for that date, which is the entire question a re-date raises.
 */

const h = vi.hoisted(() => {
    const state = {
        roles: [
            { id: 'role-sec', name: 'Security Officer' },
            { id: 'role-gen', name: 'Team Member' },
        ],
        /** The stored row `assertShapeForShiftId` will load. */
        shift: null as Record<string, unknown> | null,
        shiftError: null as unknown,
        /** Columns the gate asked for — pinned, because a missing one fails open. */
        selected: '' as string,
        selects: 0,
    };
    const builder = (table: string, columns: string) => ({
        eq: () => ({
            maybeSingle: async () => {
                if (table !== 'shifts') return { data: null, error: null };
                state.selected = columns;
                state.selects++;
                return state.shiftError
                    ? { data: null, error: state.shiftError }
                    : { data: state.shift, error: null };
            },
        }),
    });
    return {
        state,
        supabase: {
            from: (table: string) => ({
                select: (columns?: string) => {
                    // `roles` is awaited directly by the security-role cache;
                    // `shifts` is chained through .eq().maybeSingle().
                    const chain = builder(table, columns ?? '');
                    return Object.assign(
                        Promise.resolve({ data: state.roles, error: null }),
                        chain,
                    );
                },
            }),
        },
    };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: h.supabase }));

import { assertShapeForShiftId, resetSecurityRoleCache } from '../shift-shape-gate';

/** 09:00–12:00, no unpaid break: three hours net. Lawful on a weekday. */
function storedShift(over: Record<string, unknown> = {}) {
    return {
        id: 'shift-1',
        shift_date: '2026-12-29',          // a Tuesday
        start_time: '09:00',
        end_time:   '12:00',
        unpaid_break_minutes: 0,
        paid_break_minutes:   15,
        is_training: false,
        target_employment_type: 'Casual',
        target_requires_flexible: false,
        role_id: 'role-gen',
        roles: { name: 'Team Member' },
        ...over,
    };
}

beforeEach(() => {
    resetSecurityRoleCache();
    h.state.shift = storedShift();
    h.state.shiftError = null;
    h.state.selects = 0;
});

describe('re-dating a stored shift is judged on the RESULT, not the patch', () => {
    it('accepts a move between ordinary weekdays', async () => {
        const r = await assertShapeForShiftId('shift-1', { shift_date: '2026-12-30' });
        expect(r.blocking).toBe(false);
    });

    it('refuses a move onto a public holiday (cl 56.2)', async () => {
        // The headline regression: nothing about the shift changes except the
        // day, and the day is what makes it unlawful.
        await expect(
            assertShapeForShiftId('shift-1', { shift_date: '2026-12-25' }),
        ).rejects.toThrow();
    });

    it('refuses a move onto a Sunday', async () => {
        await expect(
            assertShapeForShiftId('shift-1', { shift_date: '2026-12-27' }),
        ).rejects.toThrow();
    });

    it('accepts a move onto a public holiday when the shift is long enough', async () => {
        h.state.shift = storedShift({ end_time: '13:00' });   // four hours net
        const r = await assertShapeForShiftId('shift-1', { shift_date: '2026-12-25' });
        expect(r.blocking).toBe(false);
    });

    it('refuses a RESIZE that drops a public holiday shift under four hours', async () => {
        // The other half of the same defect: the assign command wrote times
        // straight to the table, so shortening a lawful public-holiday shift
        // was never judged either.
        h.state.shift = storedShift({ shift_date: '2026-12-25', end_time: '13:00' });
        await expect(
            assertShapeForShiftId('shift-1', { end_time: '11:00' }),
        ).rejects.toThrow();
    });
});

describe('the merge keeps the fields the caller did not send', () => {
    it('judges a new date against the STORED length, not a default', () => {
        // If the merge dropped end_time the shift would have no shape at all
        // and the gate would return INCOMPLETE — a silent pass.
        return expect(
            assertShapeForShiftId('shift-1', { shift_date: '2026-12-25' }),
        ).rejects.toThrow(/cl 56\.2/);
    });

    it('does not let a present-but-undefined key blank a stored value', async () => {
        // Object spread copies a key whose value is undefined, so
        // `{ target_employment_type: undefined }` would blank an 'FT' target
        // down to the untargeted 'Casual' default and quietly relax the 7.6h
        // floor to three hours. `!== undefined` cannot be fooled that way.
        // 09:00–17:30 less a 30m meal break = 8h net, with both rest pauses
        // paid. Lawful on every rule, so any failure below is about the merge.
        h.state.shift = storedShift({
            target_employment_type: 'FT', end_time: '17:30',
            unpaid_break_minutes: 30, paid_break_minutes: 30,
        });
        const r = await assertShapeForShiftId('shift-1', {
            shift_date: '2026-12-30',
            target_employment_type: undefined,
        });
        expect(r.blocking).toBe(false);

        // Prove the target really did survive: the same patch on a SHORT shift
        // must trip the full-time floor, which a blanked target would not.
        h.state.shift = storedShift({ target_employment_type: 'FT' });   // 3h
        await expect(
            assertShapeForShiftId('shift-1', {
                shift_date: '2026-12-30',
                target_employment_type: undefined,
            }),
        ).rejects.toThrow();
    });

    it('resolves Schedule 3 from the joined role without a second lookup', async () => {
        // Security meal breaks are PAID (Sch 3 §5.3(a)), so net equals gross
        // and the requirement is met from `paid_break_minutes`. A six-hour
        // security shift with 45m paid (30m meal + a 15m pause) and NO unpaid
        // break is lawful; a gate that deducted an unpaid break, or that read
        // the whole paid pool as the meal break, would refuse it.
        h.state.shift = storedShift({
            end_time: '15:00', unpaid_break_minutes: 0, paid_break_minutes: 45,
            role_id: 'role-sec', roles: { name: 'Security Officer' },
        });
        const r = await assertShapeForShiftId('shift-1', { shift_date: '2026-12-25' });
        expect(r.blocking).toBe(false);
        expect(h.state.selects).toBe(1);
    });

    it('asks for every column a verdict needs', () => {
        // A column missing from the select arrives as undefined, the merge
        // treats it as "unchanged", and the gate silently judges a shift that
        // is not the one in the database.
        return assertShapeForShiftId('shift-1', { shift_date: '2026-12-30' }).then(() => {
            for (const column of [
                'shift_date', 'start_time', 'end_time',
                'unpaid_break_minutes', 'paid_break_minutes', 'is_training',
                'target_employment_type', 'target_requires_flexible', 'role_id',
            ]) {
                expect(h.state.selected, `${column} is missing from the gate's select`)
                    .toContain(column);
            }
        });
    });
});

describe('not knowing is not the same as nothing being wrong', () => {
    it('throws when the row cannot be read', async () => {
        h.state.shiftError = { message: 'network' };
        await expect(
            assertShapeForShiftId('shift-1', { shift_date: '2026-12-25' }),
        ).rejects.toThrow();
    });

    it('throws when the row does not exist', async () => {
        // A gate that opens on a missing row opens on every transient failure
        // that looks like one.
        h.state.shift = null;
        await expect(
            assertShapeForShiftId('shift-1', { shift_date: '2026-12-25' }),
        ).rejects.toThrow(/cannot be read|shape cannot be checked/i);
    });
});
