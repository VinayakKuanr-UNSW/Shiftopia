import { describe, it, expect } from 'vitest';
import { planPublishRoster } from '../bulk-action-engine';
import type { Shift } from '../shift.entity';

// ─── planPublishRoster — one-click Publish partition ─────────────────────────

describe('planPublishRoster', () => {
    const HOUR = 60 * 60 * 1000;
    const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

    /** Minimal Shift factory — only the fields planPublishRoster / getTimeRule read. */
    const mk = (id: string, over: Partial<Shift>): Shift =>
        ({
            id,
            lifecycle_status: 'Draft',
            is_cancelled: false,
            deleted_at: null,
            assigned_employee_id: null,
            start_at: iso(+30 * HOUR),
            end_at: iso(+38 * HOUR),
            ...over,
        }) as unknown as Shift;

    const empty = {
        assignedIds: [],
        unassignedIds: [],
        emergentAssignedIds: [],
        emergentUnassignedIds: [],
        deadIds: [],
        alreadyPublishedCount: 0,
    };

    it('routes a future assigned draft to assignedIds (→ offers)', () => {
        const plan = planPublishRoster([mk('a', { assigned_employee_id: 'emp-1' })]);
        expect(plan).toEqual({ ...empty, assignedIds: ['a'] });
    });

    it('routes a future unassigned draft to unassignedIds (→ bidding)', () => {
        const plan = planPublishRoster([mk('u', { assigned_employee_id: null })]);
        expect(plan).toEqual({ ...empty, unassignedIds: ['u'] });
    });

    it('flags an unassigned draft whose window is already LIVE as dead (→ delete)', () => {
        const plan = planPublishRoster([
            mk('d', { assigned_employee_id: null, start_at: iso(-1 * HOUR), end_at: iso(+2 * HOUR) }),
        ]);
        expect(plan).toEqual({ ...empty, deadIds: ['d'] });
    });

    it('does NOT treat an ASSIGNED live draft as dead (only unassigned drafts are dead)', () => {
        const plan = planPublishRoster([
            mk('al', { assigned_employee_id: 'emp-1', start_at: iso(-1 * HOUR), end_at: iso(+2 * HOUR) }),
        ]);
        // Past-start assigned draft: not dead, not publishable → skipped entirely.
        expect(plan).toEqual(empty);
    });

    it('skips an unassigned draft whose window has fully ended (Closed, not Live)', () => {
        const plan = planPublishRoster([
            mk('closed', { assigned_employee_id: null, start_at: iso(-9 * HOUR), end_at: iso(-1 * HOUR) }),
        ]);
        expect(plan).toEqual(empty);
    });

    it('leaves published, cancelled and deleted shifts untouched (published counted only)', () => {
        const plan = planPublishRoster([
            mk('pub', { lifecycle_status: 'Published', assigned_employee_id: 'emp-1' }),
            mk('inprog', { lifecycle_status: 'InProgress' }),
            mk('done', { lifecycle_status: 'Completed' }),
            mk('canc', { lifecycle_status: 'Cancelled' }),
            mk('canc2', { is_cancelled: true }),
            mk('del', { deleted_at: iso(-HOUR) }),
        ]);
        expect(plan).toEqual({ ...empty, alreadyPublishedCount: 1 });
    });

    it('splits emergent drafts (TTS ≤ 4h) into assigned (→ emergency) vs unassigned (→ manual)', () => {
        const plan = planPublishRoster([
            mk('ea', { assigned_employee_id: 'e1', start_at: iso(+2 * HOUR) }),   // emergent assigned → A
            mk('eu', { assigned_employee_id: null, start_at: iso(+3.5 * HOUR) }), // emergent unassigned → B
            mk('normal', { assigned_employee_id: 'e2', start_at: iso(+5 * HOUR) }), // normal future draft → X
        ]);
        expect(plan).toEqual({
            ...empty,
            assignedIds: ['normal'],
            emergentAssignedIds: ['ea'],
            emergentUnassignedIds: ['eu'],
        });
    });

    it('partitions a mixed roster across every bucket', () => {
        const plan = planPublishRoster([
            mk('a1', { assigned_employee_id: 'e1' }),
            mk('a2', { assigned_employee_id: 'e2' }),
            mk('u1', { assigned_employee_id: null }),
            mk('ea', { assigned_employee_id: 'e3', start_at: iso(+2 * HOUR) }),
            mk('eu', { assigned_employee_id: null, start_at: iso(+1 * HOUR) }),
            mk('dead1', { assigned_employee_id: null, start_at: iso(-1 * HOUR), end_at: iso(+3 * HOUR) }),
            mk('pub', { lifecycle_status: 'Published' }),
        ]);
        expect(plan.assignedIds.sort()).toEqual(['a1', 'a2']);
        expect(plan.unassignedIds).toEqual(['u1']);
        expect(plan.emergentAssignedIds).toEqual(['ea']);
        expect(plan.emergentUnassignedIds).toEqual(['eu']);
        expect(plan.deadIds).toEqual(['dead1']);
        expect(plan.alreadyPublishedCount).toBe(1);
    });
});
