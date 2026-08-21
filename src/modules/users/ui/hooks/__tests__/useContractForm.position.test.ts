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
                    return Promise.resolve({ error: h.error });
                },
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
    h.error = null;
    h.toasts = [];
});

describe('useContractForm — a position with several roles', () => {
    it('writes one row per role, all sharing a single position_id', async () => {
        const result = setup();
        act(() => {
            result.current.toggleRole(TM, 'Casual');
            result.current.toggleRole(TM3, 'Casual');
            result.current.toggleRole(LEAD, 'Casual');
        });
        await act(async () => { await result.current.submit(LEVELS); });

        const rows = h.inserted[0];
        expect(rows).toHaveLength(3);
        expect(new Set(rows.map((r: any) => r.position_id)).size).toBe(1);
        expect(rows[0].position_id).toBeTruthy();
        expect(rows.map((r: any) => r.role_id)).toEqual([TM, TM3, LEAD]);
    });

    it('gives each row the level of its OWN role', async () => {
        const result = setup();
        act(() => {
            result.current.toggleRole(TM, 'Casual');
            result.current.toggleRole(TM3, 'Casual');
            result.current.toggleRole(LEAD, 'Casual');
        });
        await act(async () => { await result.current.submit(LEVELS); });

        expect(h.inserted[0].map((r: any) => r.remuneration_level)).toEqual([2, 3, 4]);
    });

    it('writes the same employment status to every row', async () => {
        const result = setup();
        act(() => {
            result.current.toggleRole(TM, 'Casual');
            result.current.toggleRole(LEAD, 'Casual');
        });
        await act(async () => { await result.current.submit(LEVELS); });

        expect(h.inserted[0].every((r: any) => r.employment_status === 'Casual')).toBe(true);
    });

    // Atomicity: the whole appointment lands, or none of it does.
    it('issues a single insert rather than one per role', async () => {
        const result = setup();
        act(() => {
            result.current.toggleRole(TM, 'Casual');
            result.current.toggleRole(TM3, 'Casual');
        });
        await act(async () => { await result.current.submit(LEVELS); });

        expect(h.insertCalls).toBe(1);
    });

    it('gives a two-role position a different id from the next one', async () => {
        const result = setup();
        act(() => { result.current.toggleRole(TM, 'Casual'); });
        await act(async () => { await result.current.submit(LEVELS); });
        act(() => { result.current.toggleRole(TM3, 'Casual'); });
        await act(async () => { await result.current.submit(LEVELS); });

        expect(h.inserted[0][0].position_id).not.toBe(h.inserted[1][0].position_id);
    });

    it('toggles a role back off', async () => {
        const result = setup();
        act(() => {
            result.current.toggleRole(TM, 'Casual');
            result.current.toggleRole(TM3, 'Casual');
            result.current.toggleRole(TM, 'Casual');
        });
        expect(result.current.formData.role_ids).toEqual([TM3]);
    });

    // The first pick seeds the status; it is a hint, and it must never
    // overwrite a choice the person has already made.
    it('seeds employment status from the first role only', async () => {
        const result = setup();
        act(() => { result.current.toggleRole(TM, 'Casual'); });
        expect(result.current.formData.employment_status).toBe('Casual');

        act(() => { result.current.updateField('employment_status', 'Part-Time'); });
        act(() => { result.current.toggleRole(LEAD, 'Full-Time'); });
        expect(result.current.formData.employment_status).toBe('Part-Time');
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
        act(() => {
            result.current.toggleRole(TM, 'Casual');
            result.current.toggleRole(TM3, 'Casual');
        });
        act(() => { result.current.updateField('sub_department_id', 'other-subdept'); });
        expect(result.current.formData.role_ids).toEqual([]);
    });

    it('refuses to write a role that has no remuneration level', async () => {
        const result = setup();
        act(() => { result.current.toggleRole('role-unlevelled', 'Casual'); });
        await act(async () => { await result.current.submit({}); });

        expect(h.insertCalls).toBe(0);
        expect(h.toasts.some((t) => t.title === 'Missing Remuneration Level')).toBe(true);
    });
});
