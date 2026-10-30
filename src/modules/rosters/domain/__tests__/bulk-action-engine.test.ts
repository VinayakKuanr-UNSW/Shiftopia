import { describe, it, expect } from 'vitest';
import {
    planPublishRoster,
    processInChunks,
    processInBatches,
    DEFAULT_CHUNK_CONCURRENCY,
    DEFAULT_BATCH_PAYLOAD_SIZE,
} from '../bulk-action-engine';
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
        fullTimeIds: [],
        fullTimeUnassignedIds: [],
        onLeaveIds: [],
        pastIds: [],
        noPermissionIds: [],
        alreadyPublishedCount: 0,
    };

    it('routes a future assigned draft to assignedIds (→ offers)', () => {
        const plan = planPublishRoster([mk('a', { assigned_employee_id: 'emp-1' })]);
        expect(plan).toEqual({ ...empty, assignedIds: ['a'] });
    });

    it('routes a FULL-TIME assigned draft to fullTimeIds (→ confirmed, never offered) — even inside 4h', () => {
        const plan = planPublishRoster([
            mk('ft', { assigned_employee_id: 'emp-1', target_employment_type: 'FT' } as Partial<Shift>),
            mk('ft-soon', { assigned_employee_id: 'emp-1', target_employment_type: 'FT', start_at: iso(+2 * HOUR), end_at: iso(+10 * HOUR) } as Partial<Shift>),
        ]);
        expect(plan).toEqual({ ...empty, fullTimeIds: ['ft', 'ft-soon'] });
    });

    it('skips a FULL-TIME draft with nobody on it (an FT shift never goes to bidding)', () => {
        const plan = planPublishRoster([mk('ft-u', { assigned_employee_id: null, target_employment_type: 'FT' } as Partial<Shift>)]);
        expect(plan).toEqual({ ...empty, fullTimeUnassignedIds: ['ft-u'] });
    });

    it('skips an assigned draft on a day the assignee has approved leave — any type, any time-to-start', () => {
        // The database refuses these (trg_shift_not_on_approved_leave); the dialog says so first.
        const onLeave = (emp: string, date: string) => emp === 'emp-1' && date === '2099-03-10';
        const plan = planPublishRoster([
            mk('casual', { assigned_employee_id: 'emp-1', shift_date: '2099-03-10' } as Partial<Shift>),
            mk('ft', { assigned_employee_id: 'emp-1', shift_date: '2099-03-10', target_employment_type: 'FT' } as Partial<Shift>),
            mk('soon', { assigned_employee_id: 'emp-1', shift_date: '2099-03-10', start_at: iso(+2 * HOUR), end_at: iso(+10 * HOUR) } as Partial<Shift>),
            mk('other-day', { assigned_employee_id: 'emp-1', shift_date: '2099-03-11' } as Partial<Shift>),
            mk('other-person', { assigned_employee_id: 'emp-2', shift_date: '2099-03-10' } as Partial<Shift>),
            mk('nobody', { assigned_employee_id: null, shift_date: '2099-03-10' } as Partial<Shift>),
        ], onLeave);
        expect(plan).toEqual({
            ...empty,
            onLeaveIds: ['casual', 'ft', 'soon'],
            assignedIds: ['other-day', 'other-person'],
            unassignedIds: ['nobody'],
        });
    });

    it('treats nobody as on leave when no leave lookup is given', () => {
        const plan = planPublishRoster([mk('a', { assigned_employee_id: 'emp-1', shift_date: '2099-03-10' } as Partial<Shift>)]);
        expect(plan.onLeaveIds).toEqual([]);
    });

    it('routes a future unassigned draft to unassignedIds (→ bidding)', () => {
        const plan = planPublishRoster([mk('u', { assigned_employee_id: null })]);
        expect(plan).toEqual({ ...empty, unassignedIds: ['u'] });
    });

    it('flags an unassigned draft whose window is already LIVE as dead (→ skipped, never deleted)', () => {
        const plan = planPublishRoster([
            mk('d', { assigned_employee_id: null, start_at: iso(-1 * HOUR), end_at: iso(+2 * HOUR) }),
        ]);
        expect(plan).toEqual({ ...empty, deadIds: ['d'] });
    });

    it('does NOT treat an ASSIGNED live draft as dead (only unassigned drafts are dead)', () => {
        const plan = planPublishRoster([
            mk('al', { assigned_employee_id: 'emp-1', start_at: iso(-1 * HOUR), end_at: iso(+2 * HOUR) }),
        ]);
        // Past-start assigned draft: not dead, not publishable → reported as too late.
        expect(plan).toEqual({ ...empty, pastIds: ['al'] });
    });

    it('reports an unassigned draft whose window has fully ended as too late (Closed, not Live)', () => {
        const plan = planPublishRoster([
            mk('closed', { assigned_employee_id: null, start_at: iso(-9 * HOUR), end_at: iso(-1 * HOUR) }),
        ]);
        // It used to fall into no bucket at all, so a view of only past drafts
        // claimed there were "No draft shifts in the current view".
        expect(plan).toEqual({ ...empty, pastIds: ['closed'] });
    });

    it('reports drafts the manager may not publish there, before any other bucket', () => {
        const mayPublish = (s: Shift) => (s as any).sub_department_id === 'mine';
        const plan = planPublishRoster([
            mk('mine-a', { assigned_employee_id: 'e1', sub_department_id: 'mine' } as Partial<Shift>),
            mk('theirs-a', { assigned_employee_id: 'e1', sub_department_id: 'theirs' } as Partial<Shift>),
            mk('theirs-past', { assigned_employee_id: null, sub_department_id: 'theirs', start_at: iso(-9 * HOUR), end_at: iso(-1 * HOUR) } as Partial<Shift>),
            mk('theirs-pub', { lifecycle_status: 'Published', sub_department_id: 'theirs' } as Partial<Shift>),
        ], undefined, mayPublish);
        expect(plan).toEqual({
            ...empty,
            assignedIds: ['mine-a'],
            noPermissionIds: ['theirs-a', 'theirs-past'],
            alreadyPublishedCount: 1,
        });
    });

    it('treats every shift as publishable when no permission check is given', () => {
        const plan = planPublishRoster([mk('a', { assigned_employee_id: 'e1' })]);
        expect(plan.noPermissionIds).toEqual([]);
        expect(plan.assignedIds).toEqual(['a']);
    });

    it('leaves published and cancelled shifts untouched (published counted only)', () => {
        const plan = planPublishRoster([
            mk('pub', { lifecycle_status: 'Published', assigned_employee_id: 'emp-1' }),
            mk('inprog', { lifecycle_status: 'InProgress' }),
            mk('done', { lifecycle_status: 'Completed' }),
            mk('canc', { lifecycle_status: 'Cancelled' }),
            mk('canc2', { is_cancelled: true }),
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

// ─── processInChunks & processInBatches — async concurrency control ───────────

describe('bulk-action-engine concurrency controls (F-06)', () => {
    it('exports safe default concurrency and batch payload constants', () => {
        expect(DEFAULT_CHUNK_CONCURRENCY).toBe(5);
        expect(DEFAULT_BATCH_PAYLOAD_SIZE).toBe(200);
    });

    describe('processInChunks', () => {
        it('processes all items with default concurrency = 5 and bounds in-flight executions', async () => {
            const ids = Array.from({ length: 23 }, (_, i) => `id-${i}`);
            let inFlight = 0;
            let maxInFlight = 0;

            const results = await processInChunks(ids, async (id) => {
                inFlight++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await new Promise((r) => setTimeout(r, 10));
                inFlight--;
                return `res-${id}`;
            });

            expect(results).toHaveLength(23);
            expect(maxInFlight).toBeLessThanOrEqual(DEFAULT_CHUNK_CONCURRENCY);
            expect(results.every((r) => r.ok && r.value.startsWith('res-'))).toBe(true);
        });

        it('handles custom chunk sizes properly', async () => {
            const ids = ['a', 'b', 'c', 'd', 'e'];
            let inFlight = 0;
            let maxInFlight = 0;

            const results = await processInChunks(
                ids,
                async (id) => {
                    inFlight++;
                    maxInFlight = Math.max(maxInFlight, inFlight);
                    await new Promise((r) => setTimeout(r, 5));
                    inFlight--;
                    return id.toUpperCase();
                },
                2,
            );

            expect(maxInFlight).toBeLessThanOrEqual(2);
            expect(results.map((r) => (r.ok ? r.value : null))).toEqual(['A', 'B', 'C', 'D', 'E']);
        });

        it('isolates failures and captures errors without aborting other items', async () => {
            const ids = ['ok-1', 'err-1', 'ok-2'];

            const results = await processInChunks(ids, async (id) => {
                if (id.startsWith('err')) {
                    throw new Error(`Failed for ${id}`);
                }
                return `success-${id}`;
            });

            expect(results).toHaveLength(3);
            expect(results[0]).toEqual({ id: 'ok-1', ok: true, value: 'success-ok-1' });
            expect(results[1]).toEqual({ id: 'err-1', ok: false, error: 'Failed for err-1' });
            expect(results[2]).toEqual({ id: 'ok-2', ok: true, value: 'success-ok-2' });
        });

        it('returns empty array when given empty input', async () => {
            const results = await processInChunks([], async () => 'foo');
            expect(results).toEqual([]);
        });
    });

    describe('processInBatches', () => {
        it('batches items into chunks of batchSize and bounds batch concurrency', async () => {
            const items = Array.from({ length: 450 }, (_, i) => i);
            const batchSizesReceived: number[] = [];
            let inFlightBatches = 0;
            let maxInFlightBatches = 0;

            const results = await processInBatches(
                items,
                async (batch) => {
                    batchSizesReceived.push(batch.length);
                    inFlightBatches++;
                    maxInFlightBatches = Math.max(maxInFlightBatches, inFlightBatches);
                    await new Promise((r) => setTimeout(r, 10));
                    inFlightBatches--;
                    return batch.map((n) => n * 2);
                },
                200,
                2,
            );

            expect(results).toHaveLength(450);
            expect(results[0]).toBe(0);
            expect(results[449]).toBe(898);
            // 450 items with batchSize 200 => 3 batches of 200, 200, 50
            expect(batchSizesReceived).toEqual([200, 200, 50]);
            expect(maxInFlightBatches).toBeLessThanOrEqual(2);
        });

        it('returns empty array when given empty items', async () => {
            const results = await processInBatches([], async (b) => b);
            expect(results).toEqual([]);
        });
    });
});
