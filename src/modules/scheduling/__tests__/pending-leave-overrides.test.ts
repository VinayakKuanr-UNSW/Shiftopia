/**
 * Pending leave as a SOFT availability override.
 *
 * Only APPROVED leave was ever read, so a request sitting in someone's inbox
 * was invisible to the solver: autopilot runs on Monday, the employee has
 * leave pending for next week, the solver rosters them into it, the leave is
 * approved on Wednesday — and the only remedy left is the manual
 * post-approval unassign flow.
 *
 * It is deliberately NOT hard-excluded. A request is not a decision, and
 * treating it as binding would let anyone remove themselves from the roster by
 * asking. SOFT (5000c) means the solver routes around it when it cheaply can
 * and still covers the shift when nobody else exists.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/scheduling/validation', async (importOriginal) => {
    const original = await importOriginal() as any;
    return { ...original, assignmentValidator: { simulate: vi.fn() } };
});
vi.mock('@/modules/scheduling/validation/engine/assignment-committer', async (importOriginal) => {
    const original = await importOriginal() as any;
    return { ...original, assignmentCommitter: { commitAtomic: vi.fn(), commit: vi.fn() } };
});
vi.mock('@/modules/scheduling/optimizer/optimizer.client', () => ({
    optimizerClient: { optimize: vi.fn(), healthCheck: vi.fn() },
    OptimizerError: class OptimizerError extends Error {},
}));
vi.mock('@/modules/scheduling/data/roster-fetcher', () => ({
    rosterFetcher: { fetchExistingRoster: vi.fn(), fetchAvailability: vi.fn() },
    durationMinutes: (start: string, end: string) => {
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        let mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins <= 0) mins += 1440;
        return mins;
    },
}));
vi.mock('@/modules/scheduling/audit/auditor', () => ({ auditor: { audit: vi.fn() } }));

import { buildPendingLeaveOverrides } from '../auto-scheduler.controller';
import type { AvailabilityOverrideRef } from '../types';

describe('buildPendingLeaveOverrides', () => {
    it('emits one whole-day SOFT window per pending-leave date', () => {
        expect(buildPendingLeaveOverrides(['2026-03-02', '2026-03-03'])).toEqual([
            { start_time: '00:00', end_time: '23:59', severity: 'SOFT', date: '2026-03-02' },
            { start_time: '00:00', end_time: '23:59', severity: 'SOFT', date: '2026-03-03' },
        ]);
    });

    it('never emits HARD — a request is not a decision', () => {
        // Hard-excluding pending leave would let anyone take themselves off the
        // roster by asking for it.
        const overrides = buildPendingLeaveOverrides(['2026-03-02']);
        expect(overrides.every(o => o.severity === 'SOFT')).toBe(true);
    });

    it('ends the window at 23:59, not 24:00', () => {
        // A 00:00-24:00 window normalises to a zero-length span the solver reads
        // as crossing midnight, which would penalise the FOLLOWING day too.
        expect(buildPendingLeaveOverrides(['2026-03-02'])[0].end_time).toBe('23:59');
    });

    it('always carries the date — an undated override means EVERY day', () => {
        // The bug this shape exists to avoid: without a date the solver applies
        // the window across the whole horizon, so one pending leave day would
        // penalise the employee out of every shift in the run.
        for (const o of buildPendingLeaveOverrides(['2026-03-02', '2026-03-05'])) {
            expect(o.date).toBeTruthy();
        }
    });

    it('returns nothing when there is no pending leave', () => {
        expect(buildPendingLeaveOverrides([])).toEqual([]);
    });

    it('deduplicates repeated dates', () => {
        expect(buildPendingLeaveOverrides(['2026-03-02', '2026-03-02'])).toHaveLength(1);
    });

    it('preserves overrides the caller already supplied', () => {
        // `employeeDetails` may carry real exceptions; this must add to them.
        const existing: AvailabilityOverrideRef[] = [
            { start_time: '14:00', end_time: '16:00', severity: 'HARD', date: '2026-03-09' },
        ];
        const result = buildPendingLeaveOverrides(['2026-03-02'], existing);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(existing[0]);
    });

    it('does not double-penalise a date the caller already flagged SOFT', () => {
        const existing: AvailabilityOverrideRef[] = [
            { start_time: '00:00', end_time: '23:59', severity: 'SOFT', date: '2026-03-02' },
        ];
        expect(buildPendingLeaveOverrides(['2026-03-02'], existing)).toHaveLength(1);
    });

    it('still adds its own window when the caller flagged the date HARD', () => {
        // A HARD entry is a different statement (a block, not a preference) and
        // is not evidence that pending leave has already been accounted for.
        const existing: AvailabilityOverrideRef[] = [
            { start_time: '09:00', end_time: '12:00', severity: 'HARD', date: '2026-03-02' },
        ];
        expect(buildPendingLeaveOverrides(['2026-03-02'], existing)).toHaveLength(2);
    });

    it('does not mutate the caller\'s array', () => {
        const existing: AvailabilityOverrideRef[] = [];
        buildPendingLeaveOverrides(['2026-03-02'], existing);
        expect(existing).toHaveLength(0);
    });
});
