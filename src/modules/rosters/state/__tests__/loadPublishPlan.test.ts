/**
 * The toolbar Publish plan acts on the period the dialog names.
 *
 * Month view renders ±3 buffer days for continuity. The user's rule
 * (2026-10-18): those are for viewing only — Publish must not touch them. It
 * did: the plan read the grid's window, so publishing "October 2026" also
 * published 28–30 Sep and 1–3 Nov. Week view had the matching hazard: the grid
 * fetched `selectedDate + 6` while the label said Mon–Sun.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadRosterPublishPlan, type LoadPublishPlanDeps } from '../loadPublishPlan';
import type { Shift } from '@/modules/rosters/domain/shift.entity';

const ORG = '22222222-2222-4222-8222-222222222222';
const HOUR = 3_600_000;

/** A draft starting `hours` from now, with the fields the plan reads. */
const draftAt = (hours: number) => ({
    lifecycle_status: 'Draft' as const,
    shift_date: '2099-01-01',
    start_time: '09:00:00',
    end_time: '15:00:00',
    start_at: new Date(Date.now() + hours * HOUR).toISOString(),
    end_at: new Date(Date.now() + (hours + 6) * HOUR).toISOString(),
});

function deps(shifts: Partial<Shift>[] = []) {
    const fetchShifts = vi.fn(async () => shifts as Shift[]);
    const loadLeave = vi.fn(async () => new Map());
    return { fetchShifts, loadLeave, deps: { fetchShifts, loadLeave } as unknown as LoadPublishPlanDeps };
}

describe('loadRosterPublishPlan — the period', () => {
    it('Month view reads exactly the calendar month, not the ±3-day viewing buffer', async () => {
        const d = deps();
        await loadRosterPublishPlan({ organizationId: ORG, selectedDate: new Date(2026, 9, 1), viewType: 'month' }, d.deps);

        expect(d.fetchShifts).toHaveBeenCalledWith(ORG, '2026-10-01', '2026-10-31', undefined);
    });

    it('Week view reads Monday to Sunday even when the anchor is mid-week', async () => {
        const d = deps();
        // Thursday 1 Oct 2026 — the anchor ghost-cell navigation can leave behind.
        await loadRosterPublishPlan({ organizationId: ORG, selectedDate: new Date(2026, 9, 1), viewType: 'week' }, d.deps);

        expect(d.fetchShifts).toHaveBeenCalledWith(ORG, '2026-09-28', '2026-10-04', undefined);
    });

    it('Day and 3-Day read the days shown', async () => {
        const day = deps();
        await loadRosterPublishPlan({ organizationId: ORG, selectedDate: new Date(2026, 9, 7), viewType: 'day' }, day.deps);
        expect(day.fetchShifts).toHaveBeenCalledWith(ORG, '2026-10-07', '2026-10-07', undefined);

        const three = deps();
        await loadRosterPublishPlan({ organizationId: ORG, selectedDate: new Date(2026, 9, 7), viewType: '3day' }, three.deps);
        expect(three.fetchShifts).toHaveBeenCalledWith(ORG, '2026-10-07', '2026-10-09', undefined);
    });

    it('passes the scope filters through and reads leave for the same period', async () => {
        const d = deps([{ id: 'a', ...draftAt(48), assigned_employee_id: 'emp-1' } as Partial<Shift>]);
        const filters = { departmentIds: ['dept-1'] };
        await loadRosterPublishPlan({ organizationId: ORG, selectedDate: new Date(2026, 9, 1), viewType: 'month', filters }, d.deps);

        expect(d.fetchShifts).toHaveBeenCalledWith(ORG, '2026-10-01', '2026-10-31', filters);
        expect(d.loadLeave).toHaveBeenCalledWith(['emp-1'], '2026-10-01', '2026-10-31');
    });
});

describe('loadRosterPublishPlan — failures and permissions', () => {
    it('lets a failed read throw — it never plans from an empty or partial list', async () => {
        const fetchShifts = vi.fn(async () => { throw new Error('Could not load every shift in this view (timeout).'); });
        const d = { fetchShifts, loadLeave: vi.fn() } as unknown as LoadPublishPlanDeps;

        await expect(loadRosterPublishPlan({ organizationId: ORG, selectedDate: new Date(2026, 9, 1), viewType: 'week' }, d))
            .rejects.toThrow(/Could not load every shift/);
    });

    it('reports drafts the manager may not publish instead of sending them', async () => {
        const d = deps([
            { id: 'mine', ...draftAt(48), assigned_employee_id: null, sub_department_id: 'sub-a' },
            { id: 'theirs', ...draftAt(48), assigned_employee_id: null, sub_department_id: 'sub-b' },
        ] as Partial<Shift>[]);

        const plan = await loadRosterPublishPlan({
            organizationId: ORG, selectedDate: new Date(), viewType: 'week',
            canPublishShift: (s) => s.sub_department_id === 'sub-a',
        }, d.deps);

        expect(plan.unassignedIds).toEqual(['mine']);
        expect(plan.noPermissionIds).toEqual(['theirs']);
    });
});
