import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * One position, many roles, one write.
 *
 * The reported problem: appointing someone to ICC Sydney → Event Delivery →
 * Event Setups as a Team Member, a TM3 and a Team Leader meant filling the
 * form three times, producing three rows that agreed on everything except
 * which role they named — with nothing in the schema recording that they were
 * one appointment.
 *
 * What these pin, and why each fails silently if it breaks:
 *
 *   * the rows share ONE `position_id`. The column defaults to
 *     `gen_random_uuid()`, so forgetting to set it does not error — it quietly
 *     gives every role its own position and restores exactly the state this
 *     work removes;
 *   * each row takes ITS OWN remuneration level. L2 Team Member and L4 Team
 *     Leader are different levels, which is why the level belongs to the role;
 *     writing one level across the position would misprice two of the three;
 *   * employment status is written once for the whole position. Measured
 *     across production it never varies between the roles of one appointment;
 *   * it is a SINGLE insert, so a partial position is not a reachable state.
 *     A loop could leave someone holding two of the three roles they were
 *     appointed to, with nothing on the record to show it.
 */

const h = vi.hoisted(() => ({
    inserted: [] as any[],
    insertCalls: 0,
    updated: [] as Array<{ id: string; row: any }>,
    deletedIds: [] as string[],
    /** Order the three statement kinds actually ran in. */
    ops: [] as string[],
    error: null as unknown,
    toasts: [] as Array<{ title?: string; variant?: string }>,
}));

vi.mock('@/platform/supabase/client', () => ({
    supabase: {
        schema: () => ({
            from: () => ({
                insert: (rows: any) => {
                    h.insertCalls += 1;
                    h.inserted.push(rows);
                    h.ops.push('insert');
                    return Promise.resolve({ error: h.error });
                },
                update: (row: any) => ({
                    eq: (_col: string, id: string) => {
                        h.updated.push({ id, row });
                        h.ops.push('update');
                        return Promise.resolve({ error: h.error });
                    },
                }),
                delete: () => ({
                    in: (_col: string, ids: string[]) => {
                        h.deletedIds.push(...ids);
                        h.ops.push('delete');
                        return Promise.resolve({ error: h.error });
                    },
                }),
            }),
        }),
    },
}));

vi.mock('@/modules/core/ui/primitives/use-toast', () => ({
    useToast: () => ({ toast: (t: any) => { h.toasts.push(t); } }),
}));

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const { useContractForm } = await import('../useContractForm');

const ORG = '00000000-0000-0000-0000-0000000000o1'.replace(/o/g, '0');
const DEPT = 'd0000000-0000-0000-0000-000000000001';
const SUBDEPT = '50000000-0000-0000-0000-000000000002';
const TM = 'role-team-member';
const TM3 = 'role-tm3';
const LEAD = 'role-team-leader';

/** The example from the report: L2 Team Member, L3 TM3, L4 Team Leader. */
const LEVELS = { [TM]: 2, [TM3]: 3, [LEAD]: 4 };

/**
 * Pick a role AND state its terms — the two steps the form now asks for
 * separately. Roles no longer arrive pre-typed from the role catalogue:
 * that column cannot express Part-Time or Flexible Part-Time, and it fired
 * only on the first pick, so one row filled itself in and the rest did not.
 */
function pick(result: any, roleId: string, status: string) {
    act(() => { result.current.toggleRole(roleId); });
    act(() => { result.current.setRoleTerm(roleId, { employment_status: status }); });
}

function setup() {
    const { result } = renderHook(() => useContractForm('emp-1'));
    act(() => {
        result.current.updateField('organization_id', ORG);
        result.current.updateField('department_id', DEPT);
        result.current.updateField('sub_department_id', SUBDEPT);
    });
    return result;
}

beforeEach(() => {
    h.inserted = [];
    h.insertCalls = 0;
    h.updated = [];
    h.deletedIds = [];
    h.ops = [];
    h.error = null;
    h.toasts = [];
});

describe('useContractForm — a position with several roles', () => {
    it('writes one row per role, all sharing a single position_id', async () => {
        const result = setup();
        pick(result, TM, 'Casual');
        pick(result, TM3, 'Casual');
        pick(result, LEAD, 'Casual');
        await act(async () => { await result.current.submit(LEVELS); });

        const rows = h.inserted[0];
        expect(rows).toHaveLength(3);
        expect(new Set(rows.map((r: any) => r.position_id)).size).toBe(1);
        expect(rows[0].position_id).toBeTruthy();
        expect(rows.map((r: any) => r.role_id)).toEqual([TM, TM3, LEAD]);
    });

    it('gives each row the level of its OWN role', async () => {
        const result = setup();
        pick(result, TM, 'Casual');
        pick(result, TM3, 'Casual');
        pick(result, LEAD, 'Casual');
        await act(async () => { await result.current.submit(LEVELS); });

        expect(h.inserted[0].map((r: any) => r.remuneration_level)).toEqual([2, 3, 4]);
    });

    it('writes the same employment status to every row', async () => {
        const result = setup();
        pick(result, TM, 'Casual');
        pick(result, LEAD, 'Casual');
        await act(async () => { await result.current.submit(LEVELS); });

        expect(h.inserted[0].every((r: any) => r.employment_status === 'Casual')).toBe(true);
    });

    // Atomicity: the whole appointment lands, or none of it does.
    it('issues a single insert rather than one per role', async () => {
        const result = setup();
        pick(result, TM, 'Casual');
        pick(result, TM3, 'Casual');
        await act(async () => { await result.current.submit(LEVELS); });

        expect(h.insertCalls).toBe(1);
    });

    it('gives a two-role position a different id from the next one', async () => {
        const result = setup();
        pick(result, TM, 'Casual');
        await act(async () => { await result.current.submit(LEVELS); });
        pick(result, TM3, 'Casual');
        await act(async () => { await result.current.submit(LEVELS); });

        expect(h.inserted[0][0].position_id).not.toBe(h.inserted[1][0].position_id);
    });

    it('toggles a role back off', async () => {
        const result = setup();
        pick(result, TM, 'Casual');
        pick(result, TM3, 'Casual');
        pick(result, TM, 'Casual');
        expect(result.current.formData.role_ids).toEqual([TM3]);
    });

    // The first pick seeds the status; it is a hint, and it must never
    // overwrite a choice the person has already made.
    // No role arrives pre-typed. `roles.employment_type` knows only 'Casual'
    // and 'Full-Time' in production, disagreed with the contract actually
    // written in 8 of 122 cases, and fired only on the FIRST pick — so one row
    // filled itself in and every row after it did not.
    it('adds a role with no employment type, whatever the catalogue says', () => {
        const result = setup();
        act(() => { result.current.toggleRole(TM); });

        expect(result.current.formData.role_ids).toEqual([TM]);
        expect(result.current.formData.role_terms[TM].employment_status).toBe('');
        expect(result.current.formData.role_terms[TM].contracted_weekly_hours).toBe(0);
    });

    it('refuses to write with no roles selected', async () => {
        const result = setup();
        act(() => { result.current.updateField('employment_status', 'Casual'); });
        await act(async () => { await result.current.submit(LEVELS); });

        expect(h.insertCalls).toBe(0);
        expect(h.toasts.some((t) => t.variant === 'destructive')).toBe(true);
    });

    // Moving up the tree invalidates the whole selection: roles belong to a
    // sub-department, so keeping them would write roles from the old one.
    it('clears the roles when the sub-department changes', () => {
        const result = setup();
        pick(result, TM, 'Casual');
        pick(result, TM3, 'Casual');
        act(() => { result.current.updateField('sub_department_id', 'other-subdept'); });
        expect(result.current.formData.role_ids).toEqual([]);
    });

    it('refuses to write a role that has no remuneration level', async () => {
        const result = setup();
        pick(result, 'role-unlevelled', 'Casual');
        await act(async () => { await result.current.submit({}); });

        expect(h.insertCalls).toBe(0);
        expect(h.toasts.some((t) => t.title === 'Missing Remuneration Level')).toBe(true);
    });
});

/**
 * Per-role terms — one person, several engagements.
 *
 * EBA cl 13 (Multi-Hiring) lets a permanent Team Member ALSO be engaged
 * casually for work outside their usual job description, paid the casual rate
 * for that classification. The form therefore has to hold a different
 * employment type against different roles at the same time, and the failure
 * mode being pinned here is silent in every case: a choice made against one
 * role leaking onto another writes a contract nobody agreed to, and nothing
 * errors.
 */
describe('useContractForm — per-role target type and hours', () => {
    it('does not change one role’s type when another’s is set', () => {
        const result = setup();
        pick(result, TM, 'Casual');
        pick(result, LEAD, 'Casual');
        act(() => { result.current.setRoleTerm(LEAD, { employment_status: 'Full-Time' }); });

        expect(result.current.formData.role_terms[LEAD].employment_status).toBe('Full-Time');
        expect(result.current.formData.role_terms[TM].employment_status).toBe('Casual');
    });

    it('does not change one role’s hours when another’s are set', () => {
        const result = setup();
        pick(result, TM, 'Casual');
        pick(result, LEAD, 'Casual');
        act(() => {
            result.current.setRoleTerm(TM, { employment_status: 'Part-Time' });
            result.current.setRoleTerm(LEAD, { employment_status: 'Part-Time' });
        });
        act(() => { result.current.setRoleTerm(LEAD, { contracted_weekly_hours: 12 }); });

        expect(result.current.formData.role_terms[LEAD].contracted_weekly_hours).toBe(12);
        expect(result.current.formData.role_terms[TM].contracted_weekly_hours).toBe(20);
    });

    // cl 12.5(a): a casual is employed by the hour with no firm advance
    // commitment. Carrying 38h across from a permanent choice would write a
    // contracted-hours floor a casual does not have.
    it('locks a Casual role to 0 hours even if hours are set afterwards', () => {
        const result = setup();
        pick(result, TM, 'Full-Time');
        expect(result.current.formData.role_terms[TM].contracted_weekly_hours).toBe(38);

        act(() => { result.current.setRoleTerm(TM, { employment_status: 'Casual' }); });
        expect(result.current.formData.role_terms[TM].contracted_weekly_hours).toBe(0);

        act(() => { result.current.setRoleTerm(TM, { contracted_weekly_hours: 25 }); });
        expect(result.current.formData.role_terms[TM].contracted_weekly_hours).toBe(0);
    });

    // Each row is independent of every other. There is no form-level default
    // left to leak: the control that used to hold one was removed because it
    // read as governing every role while only ever pre-filling the next.
    it('leaves a configured role alone when another role is added', () => {
        const result = setup();
        pick(result, TM, 'Casual');
        act(() => { result.current.toggleRole(LEAD); });

        expect(result.current.formData.role_terms[TM].employment_status).toBe('Casual');
        expect(result.current.formData.role_terms[LEAD].employment_status).toBe('');
    });

    // A position is roles that agree on their terms. Three Casual roles remain
    // ONE appointment; a Full-Time role beside them is its own.
    it('groups roles sharing terms into one position and splits the rest', async () => {
        const result = setup();
        pick(result, TM, 'Casual');
        pick(result, TM3, 'Casual');
        pick(result, LEAD, 'Casual');
        act(() => { result.current.setRoleTerm(LEAD, { employment_status: 'Full-Time' }); });
        await act(async () => { await result.current.submit(LEVELS); });

        const rows = h.inserted[0];
        const byRole = Object.fromEntries(rows.map((r: any) => [r.role_id, r]));
        expect(byRole[TM].position_id).toBe(byRole[TM3].position_id);
        expect(byRole[LEAD].position_id).not.toBe(byRole[TM].position_id);
        expect(byRole[TM].employment_status).toBe('Casual');
        expect(byRole[LEAD].employment_status).toBe('Full-Time');
        // Still atomic: a partial appointment is not a reachable state.
        expect(h.insertCalls).toBe(1);
    });

    it('writes each role its own hours', async () => {
        const result = setup();
        pick(result, TM, 'Casual');
        pick(result, LEAD, 'Casual');
        act(() => {
            result.current.setRoleTerm(LEAD, { employment_status: 'Part-Time' });
        });
        act(() => {
            result.current.setRoleTerm(LEAD, { contracted_weekly_hours: 16 });
        });
        await act(async () => { await result.current.submit(LEVELS); });

        const byRole = Object.fromEntries(h.inserted[0].map((r: any) => [r.role_id, r]));
        expect(byRole[TM].contracted_weekly_hours).toBe(0);
        expect(byRole[LEAD].contracted_weekly_hours).toBe(16);
    });

    // The arithmetic the 38h ceiling depends on, and the one most likely to be
    // written wrong: a position is counted ONCE however many roles it covers.
    it('totals hours once per position, not once per role', () => {
        const result = setup();
        pick(result, TM, 'Full-Time');
        pick(result, TM3, 'Full-Time');
        pick(result, LEAD, 'Full-Time');

        expect(result.current.formData.role_ids).toHaveLength(3);
        expect(result.current.positions).toHaveLength(1);
        expect(result.current.totalWeeklyHours).toBe(38); // not 114
    });

    it('counts two part-time positions separately', () => {
        const result = setup();
        pick(result, TM, 'Casual');
        pick(result, LEAD, 'Casual');
        act(() => {
            result.current.setRoleTerm(TM, { employment_status: 'Part-Time' });
            result.current.setRoleTerm(LEAD, { employment_status: 'Part-Time' });
        });
        act(() => { result.current.setRoleTerm(LEAD, { contracted_weekly_hours: 10 }); });

        expect(result.current.positions).toHaveLength(2);
        expect(result.current.totalWeeklyHours).toBe(30); // 20 + 10
    });

    it('excludes Casual roles from the weekly total', () => {
        const result = setup();
        pick(result, TM, 'Casual');
        pick(result, TM3, 'Casual');
        expect(result.current.totalWeeklyHours).toBe(0);
    });

    it('converts a flexible part-time annual commitment into the weekly total', () => {
        const result = setup();
        pick(result, TM, 'Casual');
        act(() => { result.current.setRoleTerm(TM, { employment_status: 'Flexible Part-Time' }); });

        // 624h/yr is the cl 12.4 floor -> 12h/wk
        expect(result.current.totalWeeklyHours).toBeCloseTo(624 / 52, 5);
    });

    it('drops a role’s terms when it is deselected', () => {
        const result = setup();
        pick(result, TM, 'Full-Time');
        act(() => { result.current.toggleRole(TM); });

        expect(result.current.formData.role_ids).toEqual([]);
        expect(result.current.formData.role_terms[TM]).toBeUndefined();
    });

    it('refuses to write a role with no target type', async () => {
        const result = setup();
        act(() => { result.current.toggleRole(TM); }); // added, never typed
        await act(async () => { await result.current.submit(LEVELS); });

        expect(h.insertCalls).toBe(0);
        expect(h.toasts.some((t) => t.variant === 'destructive')).toBe(true);
    });
});

/**
 * Editing a whole sub-department engagement.
 *
 * The card edits a PLACE, not a row: every role held in that sub-department is
 * ticked when the dialog opens, and unticking one is how it is removed. So the
 * save is a diff, and the ways it can go wrong are all quiet — a role silently
 * left behind, a retyped role written as a duplicate rather than an update, or
 * an appointment losing its identity because its `position_id` was regenerated
 * for no reason.
 */
describe('useContractForm — editing a sub-department engagement', () => {
    const POS = 'pos-existing';
    const rowsInScope = [
        { id: 'row-tm', role_id: TM, position_id: POS },
        { id: 'row-tm3', role_id: TM3, position_id: POS },
    ];

    /** Open the dialog on those two roles, both Casual, as the card would. */
    function openOnScope() {
        const result = setup();
        act(() => {
            result.current.setFormData((prev: any) => ({
                ...prev,
                role_ids: [TM, TM3],
                role_terms: {
                    [TM]: { employment_status: 'Casual', contracted_weekly_hours: 0, annual_guaranteed_hours: 0 },
                    [TM3]: { employment_status: 'Casual', contracted_weekly_hours: 0, annual_guaranteed_hours: 0 },
                },
            }));
        });
        return result;
    }

    it('deletes a role that was unticked', async () => {
        const result = openOnScope();
        act(() => { result.current.toggleRole(TM3); }); // untick
        await act(async () => { await result.current.submitScopeUpdate(rowsInScope, LEVELS); });

        expect(h.deletedIds).toEqual(['row-tm3']);
        expect(h.insertCalls).toBe(0);
        expect(h.updated.map(u => u.id)).toEqual(['row-tm']);
    });

    it('inserts a role that was newly ticked', async () => {
        const result = openOnScope();
        pick(result, LEAD, 'Casual');
        await act(async () => { await result.current.submitScopeUpdate(rowsInScope, LEVELS); });

        expect(h.inserted[0].map((r: any) => r.role_id)).toEqual([LEAD]);
        expect(h.deletedIds).toEqual([]);
    });

    it('updates a role whose type changed, rather than duplicating it', async () => {
        const result = openOnScope();
        act(() => { result.current.setRoleTerm(TM3, { employment_status: 'Part-Time' }); });
        await act(async () => { await result.current.submitScopeUpdate(rowsInScope, LEVELS); });

        expect(h.insertCalls).toBe(0);
        expect(h.deletedIds).toEqual([]);
        const tm3 = h.updated.find(u => u.id === 'row-tm3')!;
        expect(tm3.row.employment_status).toBe('Part-Time');
        expect(tm3.row.contracted_weekly_hours).toBe(20);
    });

    // Identity: roles still agreeing on their terms stay the same appointment.
    it('keeps the existing position_id when the terms group is unchanged', async () => {
        const result = openOnScope();
        await act(async () => { await result.current.submitScopeUpdate(rowsInScope, LEVELS); });

        expect(h.updated.every(u => u.row.position_id === POS)).toBe(true);
    });

    // ...and a role moved onto different terms is genuinely a different one.
    it('gives a retyped role a position of its own', async () => {
        const result = openOnScope();
        act(() => { result.current.setRoleTerm(TM3, { employment_status: 'Part-Time' }); });
        await act(async () => { await result.current.submitScopeUpdate(rowsInScope, LEVELS); });

        const tm = h.updated.find(u => u.id === 'row-tm')!;
        const tm3 = h.updated.find(u => u.id === 'row-tm3')!;
        expect(tm.row.position_id).toBe(POS);          // the group it stayed in
        expect(tm3.row.position_id).not.toBe(POS);     // the group it moved to
    });

    // Deletes go LAST so an interruption leaves extra roles, never missing ones.
    it('orders the statements insert, update, delete', async () => {
        const result = openOnScope();
        pick(result, LEAD, 'Casual');
        act(() => { result.current.toggleRole(TM3); });
        await act(async () => { await result.current.submitScopeUpdate(rowsInScope, LEVELS); });

        expect(h.ops.indexOf('insert')).toBeLessThan(h.ops.indexOf('update'));
        expect(h.ops.indexOf('update')).toBeLessThan(h.ops.indexOf('delete'));
    });

    it('refuses to save while a role has no employment type', async () => {
        const result = openOnScope();
        act(() => { result.current.toggleRole(LEAD); }); // ticked, never typed
        await act(async () => { await result.current.submitScopeUpdate(rowsInScope, LEVELS); });

        expect(h.ops).toEqual([]);
        expect(h.toasts.some(t => t.variant === 'destructive')).toBe(true);
    });
});
