/**
 * The casual fairness ledger reaches both engines, for casuals only.
 *
 * Fairness is casual-only: the ledger is read for casual employees, each
 * casual's debts are weighted by confidence before they steer anything, and a
 * Full-Time employee carries no debts even if a row came back for them. The
 * greedy fallback must price the same debts the solver does, or a fallback run
 * (exactly when nobody is watching) silently ignores fairness.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FairnessStanding } from '@/modules/rosters/domain/fairness-ledger';

vi.mock('@/modules/scheduling/validation', async (importOriginal) => {
    const original = await importOriginal() as Record<string, unknown>;
    return {
        ...original,
        assignmentValidator: {
            simulate: vi.fn(async (ids: string[]) => ({
                results: ids.map(shiftId => ({ shiftId, passing: true, violations: [] })),
            })),
        },
    };
});
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
    fairnessLedgerService: { getStandingsWithStatus: vi.fn() },
}));

import { AutoSchedulerController } from '../auto-scheduler.controller';
import { optimizerClient } from '@/modules/scheduling/optimizer/optimizer.client';
import { fairnessLedgerService } from '@/modules/rosters/services/fairnessLedger.service';

const mockOptimize = optimizerClient.optimize as ReturnType<typeof vi.fn>;
const mockRead = fairnessLedgerService.getStandingsWithStatus as ReturnType<typeof vi.fn>;

const SUNDAY = '2027-05-16';

const row = (employeeId: string, metric: FairnessStanding['metric'], debtHours: number, confidence: number): FairnessStanding => ({
    employeeId, metric, debtHours, confidence,
    actualHours: 0, expectedHours: 0, opportunityCount: 1,
    windowStart: '2026-11-07', windowEnd: '2027-01-04',
});

const casual = (id: string) => ({
    id, name: id, contract_type: 'CASUAL', employment_status: 'Casual', contracted_role_ids: ['role-A'],
});
const fullTime = (id: string) => ({
    id, name: id, contract_type: 'FT', employment_status: 'Full-Time', contracted_role_ids: ['role-A'],
});

const sundayShift = {
    id: 'sun', shift_date: SUNDAY, start_time: '09:00', end_time: '17:00',
    role_id: 'role-A', roleName: 'Attendant', demand_source: 'baseline' as const,
    level: 1, unpaid_break_minutes: 0, target_employment_type: 'Casual',
};

async function run(
    organizationId?: string,
    employees = [casual('e-over'), casual('e-owed'), fullTime('e-ft')],
) {
    return new AutoSchedulerController().run({ shifts: [sundayShift], employees, organizationId } as never);
}

function employeesSent(): Map<string, { fairness_debts?: Record<string, number> }> {
    const request = mockOptimize.mock.calls[0][0] as { employees: Array<{ id: string; fairness_debts?: Record<string, number> }> };
    return new Map(request.employees.map(e => [e.id, e]));
}

describe('casual fairness ledger → optimizer payload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2027-01-05T00:00:00Z'));
        mockOptimize.mockResolvedValue({
            status: 'OPTIMAL', assignments: [], unassigned_shift_ids: [],
            solve_time_ms: 1, objective_value: 0, metrics: {},
        });
        mockRead.mockResolvedValue({
            standings: [
                row('e-over', 'sunday_hours', 8, 1),
                row('e-owed', 'sunday_hours', -8, 0.5),
                row('e-owed', 'total_hours', -2, 1),
                row('e-ft', 'sunday_hours', 100, 1),
            ],
            status: 'ok', windowEnd: '2027-01-04', ageDays: 1,
        });
    });
    afterEach(() => { vi.useRealTimers(); });

    // Org-wide, filtered client-side: ~300 casual ids in an `.in()` filter
    // overrun the request URL.
    it('reads the whole organization ledger, never an id list', async () => {
        await run('org-1');
        expect(mockRead).toHaveBeenCalledTimes(1);
        expect(mockRead.mock.calls[0].slice(0, 2)).toEqual(['org-1', null]);
    });

    it('reports the ledger as not applied when no casual is in the run', async () => {
        const result = await run('org-1', [fullTime('e-ft')]);
        expect(mockRead).not.toHaveBeenCalled();
        expect(result.fairnessLedger).toMatchObject({ applied: false, reason: 'no_data', employeesWithDebts: 0 });
    });

    it('sends confidence-weighted debts for casuals and none for Full-Time', async () => {
        const result = await run('org-1');
        const sent = employeesSent();
        expect(sent.get('e-over')?.fairness_debts).toEqual({ sunday_hours: 8 });
        expect(sent.get('e-owed')?.fairness_debts).toEqual({ sunday_hours: -4, total_hours: -2 });
        expect(sent.get('e-ft')?.fairness_debts).toEqual({});
        expect(result.fairnessLedger).toEqual({
            applied: true, reason: 'ok', employeesWithDebts: 2, windowEnd: '2027-01-04', ageDays: 1,
        });
    });

    it('a failed read is reported, and the run continues without debts', async () => {
        mockRead.mockRejectedValue(new Error('boom'));
        const result = await run('org-1');
        expect(result.fairnessLedger?.reason).toBe('fetch_failed');
        expect([...employeesSent().values()].every(e => Object.keys(e.fairness_debts ?? {}).length === 0)).toBe(true);
    });

    // The solver splits hours into public-holiday minutes per calendar day, the
    // way the ledger does, so it must know whether the day AFTER is a holiday.
    it('flags a shift whose next day is a public holiday', async () => {
        await run('org-1');
        const shifts = (mockOptimize.mock.calls[0][0] as { shifts: Array<{ is_public_holiday_next_day?: boolean }> }).shifts;
        expect(shifts[0].is_public_holiday_next_day).toBe(false);

        mockOptimize.mockClear();
        const eve = { ...sundayShift, id: 'eve', shift_date: '2027-12-24', start_time: '22:00', end_time: '06:00' };
        await new AutoSchedulerController().run({ shifts: [eve], employees: [casual('e-over')], organizationId: 'org-1' } as never);
        const sent = (mockOptimize.mock.calls[0][0] as { shifts: Array<{ is_public_holiday: boolean; is_public_holiday_next_day: boolean }> }).shifts[0];
        expect(sent).toMatchObject({ is_public_holiday: false, is_public_holiday_next_day: true });
    });

    it('skips the ledger without an organization', async () => {
        const result = await run(undefined);
        expect(mockRead).not.toHaveBeenCalled();
        expect(result.fairnessLedger?.reason).toBe('no_org_scope');
    });
});

describe('greedy fallback prices the same debts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2027-01-05T00:00:00Z'));
        mockOptimize.mockResolvedValue({
            status: 'INFEASIBLE', assignments: [], unassigned_shift_ids: ['sun'],
            solve_time_ms: 1, objective_value: 0, metrics: {},
        });
        mockRead.mockResolvedValue({
            standings: [row('e-over', 'sunday_hours', 8, 1), row('e-owed', 'sunday_hours', -8, 1)],
            status: 'ok', windowEnd: '2027-01-04', ageDays: 1,
        });
    });
    afterEach(() => { vi.useRealTimers(); });

    // Casuals only: the fallback's utilization term deliberately prefers an
    // under-loaded permanent, which would confound the comparison.
    const casuals = [casual('e-over'), casual('e-owed')];
    const assignee = (result: Awaited<ReturnType<typeof run>>) =>
        result.proposals.find(p => p.shiftId === 'sun' && p.passing)?.employeeId;

    it('without a ledger, ties go to the first candidate', async () => {
        const result = await run(undefined, casuals);
        expect(result.usedFallback).toBe(true);
        expect(assignee(result)).toBe('e-over');
    });

    it('with the ledger, the Sunday goes to the casual who is owed Sunday work', async () => {
        const result = await run('org-1', casuals);
        expect(result.usedFallback).toBe(true);
        expect(assignee(result)).toBe('e-owed');
    });
});
