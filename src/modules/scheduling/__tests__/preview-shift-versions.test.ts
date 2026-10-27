/**
 * Apply books only what the preview checked.
 *
 * sm_bulk_assign_atomic refuses a shift whose row version differs from the one
 * the caller sends. That guard is only as good as the versions it is given: they
 * must be the ones the PREVIEW validated, captured at run() time, not whatever a
 * refetched cache holds when Apply is pressed. This pins the capture.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/modules/scheduling/validation', () => ({
    assignmentValidator: { simulate: vi.fn() },
}));
vi.mock('@/modules/scheduling/validation/engine/assignment-committer', () => ({
    assignmentCommitter: { commitAtomic: vi.fn(), commit: vi.fn() },
}));
vi.mock('@/modules/scheduling/audit/auditor', () => ({ auditor: { audit: vi.fn() } }));
vi.mock('@/modules/scheduling/optimizer/optimizer.client', () => ({
    optimizerClient: { optimize: vi.fn(), healthCheck: vi.fn() },
    OptimizerError: class OptimizerError extends Error {},
}));
vi.mock('@/modules/scheduling/data/roster-fetcher', async (importOriginal) => {
    const original = await importOriginal() as Record<string, unknown>;
    return {
        ...original,
        rosterFetcher: {
            fetchExistingRoster:          vi.fn().mockResolvedValue(new Map()),
            fetchAvailability:            vi.fn().mockResolvedValue(new Map()),
            fetchApprovedLeave:           vi.fn().mockResolvedValue(new Map()),
            fetchPendingLeave:            vi.fn().mockResolvedValue(new Map()),
            fetchAvailabilityExceptions:  vi.fn().mockResolvedValue(new Map()),
            fetchEmployeeContractDetails: vi.fn().mockResolvedValue(new Map()),
            fetchOrdinaryHoursEnvelopes:  vi.fn().mockResolvedValue(new Map()),
            fetchOrdinaryHoursCycles:     vi.fn().mockResolvedValue(new Map()),
        },
    };
});
vi.mock('@/modules/rosters/services/fairnessLedger.service', () => ({
    fairnessLedgerService: {
        getEmployeeDebts: vi.fn().mockResolvedValue([]),
        updateAfterCommit: vi.fn().mockResolvedValue(undefined),
        recomputeLedger: vi.fn().mockResolvedValue(undefined),
    },
}));

import { AutoSchedulerController } from '../auto-scheduler.controller';
import { optimizerClient } from '@/modules/scheduling/optimizer/optimizer.client';

const mockOptimize = optimizerClient.optimize as ReturnType<typeof vi.fn>;

function shiftMeta(id: string, version?: number) {
    return {
        id, version,
        shift_date: '2027-05-12', start_time: '09:00', end_time: '17:00',
        role_id: 'role-A', roleName: 'Attendant', level: 1, unpaid_break_minutes: 0,
    };
}

describe('preview captures the shift versions Apply sends back', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2027-01-05T00:00:00Z'));
        mockOptimize.mockResolvedValue({
            status: 'OPTIMAL', assignments: [], unassigned_shift_ids: [],
            solve_time_ms: 1, objective_value: 0, metrics: {},
        });
    });
    afterEach(() => { vi.useRealTimers(); });

    it('records each input shift at the version the preview validated', async () => {
        const result = await new AutoSchedulerController().run({
            shifts: [shiftMeta('s1', 4), shiftMeta('s2', 9), shiftMeta('legacy')],
            employees: [{ id: 'e1', name: 'Emp One', contract_type: 'FT', contracted_role_ids: ['role-A'] }],
        } as never);

        // A shift with no version is omitted; the RPC refuses an absent entry,
        // so it can never be booked on an unchecked snapshot.
        expect(result.shiftVersions).toEqual({ s1: 4, s2: 9 });
    });
});
