/**
 * The AutoScheduler prices from the organization's published rate card
 * (Phase 4): each candidate's hourly rate, the split-shift allowance and the
 * solver's pricing policy (the card's loadings) come from the card in force at
 * the window's start — and an organization with no card covering the window
 * is refused, never priced at ICC Sydney's rates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ fetchCards: vi.fn() }));

vi.mock('@/modules/payroll/data/ebaRates.read.api', () => ({ fetchPublishedRateCardSchedules: h.fetchCards }));
vi.mock('@/modules/scheduling/validation/engine/assignment-committer', () => ({
    assignmentCommitter: { commitAtomic: vi.fn(), commit: vi.fn() },
}));
vi.mock('@/modules/scheduling/audit/auditor', () => ({ auditor: { audit: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/modules/scheduling/optimizer/optimizer.client', () => ({
    optimizerClient: { optimize: vi.fn(), healthCheck: vi.fn() },
    OptimizerError: class OptimizerError extends Error {},
}));
vi.mock('@/modules/scheduling/data/roster-fetcher', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/modules/scheduling/data/roster-fetcher')>();
    return {
        ...original,
        rosterFetcher: {
            fetchExistingRoster: vi.fn().mockResolvedValue(new Map()),
            fetchAvailability: vi.fn().mockResolvedValue(new Map()),
            fetchApprovedLeave: vi.fn().mockResolvedValue(new Map()),
            fetchPendingLeave: vi.fn().mockResolvedValue(new Map()),
            fetchAvailabilityExceptions: vi.fn().mockResolvedValue(new Map()),
            fetchEmployeeContractDetails: vi.fn().mockResolvedValue(new Map([['emp-ft', { is_security_role: false, level: 2 }]])),
            fetchOrdinaryHoursEnvelopes: vi.fn().mockResolvedValue(new Map()),
            fetchOrdinaryHoursCycles: vi.fn().mockResolvedValue(new Map()),
        },
    };
});
vi.mock('@/modules/rosters/services/fairnessLedger.service', () => ({
    fairnessLedgerService: { getStandingsWithStatus: vi.fn() },
}));

import { AutoSchedulerController, solverPricingPolicy } from '../auto-scheduler.controller';
import type { EmployeeMeta, ShiftMeta } from '../optimizer/solution-parser';
import { optimizerClient } from '@/modules/scheduling/optimizer/optimizer.client';
import { ICC_SYDNEY_EA_LOADINGS } from '@/modules/rosters/domain/projections/utils/cost/loadings';
import { toPricedCard, type PricedCard } from '@/modules/rosters/domain/projections/utils/cost/rate-card-resolver';
import { ICC_TEST_CARDS } from './fixtures/iccRateCards';

const mockOptimize = optimizerClient.optimize as ReturnType<typeof vi.fn>;

/** Another organization's card: Level 2 at $40, a $15 split-shift allowance, 30% Saturday. */
const CUSTOM: PricedCard = toPricedCard({
    code: 'BCEC-EA', validFrom: '2027-01-01', validTo: null,
    rates: [
        { classification: 'LEVEL_1', employmentBasis: 'permanent', ordinaryHourlyRate: 36, paidHourlyRate: 36 },
        { classification: 'LEVEL_1', employmentBasis: 'casual', ordinaryHourlyRate: 36, paidHourlyRate: 45 },
        { classification: 'LEVEL_2', employmentBasis: 'permanent', ordinaryHourlyRate: 40, paidHourlyRate: 40 },
        { classification: 'LEVEL_2', employmentBasis: 'casual', ordinaryHourlyRate: 40, paidHourlyRate: 50 },
    ],
    allowances: [{ code: 'split_shift', amount: 15 }],
    loadings: { ...ICC_SYDNEY_EA_LOADINGS, saturdayLoading: 0.3 },
    trainee: null,
})!;

const emp: EmployeeMeta = {
    id: 'emp-ft', name: 'FT', contract_type: 'FT', employment_status: 'Full-Time',
    contracted_weekly_hours: 38, contracted_role_ids: ['role-ush'],
};
const shift = (id: string, date: string): ShiftMeta => ({
    id, shift_date: date, start_time: '09:00', end_time: '17:06', unpaid_break_minutes: 30, paid_break_minutes: 15,
    role_id: 'role-ush', roleName: 'Customer Service Attendant (L2)', target_employment_type: 'FT',
    target_requires_flexible: false, demand_source: 'baseline', level: 2,
});

const run = (organizationId: string | undefined, dates = ['2027-05-03']) =>
    new AutoSchedulerController().run({
        shifts: dates.map((d, i) => shift('s' + i, d)), employees: [emp], mode: 'FT_STANDARD', organizationId,
    });

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-05-01T00:00:00Z'));
    mockOptimize.mockResolvedValue({ status: 'OPTIMAL', assignments: [], unassigned_shift_ids: [], solve_time_ms: 1, objective_value: 0, metrics: {} });
});
afterEach(() => vi.useRealTimers());

describe('the solver prices from the organization\'s card', () => {
    it('rate, split-shift allowance and pricing policy all come from the card', async () => {
        h.fetchCards.mockResolvedValue(new Map([['org-b', [CUSTOM]]]));
        await run('org-b');
        expect(h.fetchCards).toHaveBeenCalledWith(['org-b']);
        const req = mockOptimize.mock.calls[0][0];
        expect(req.employees[0].hourly_rate).toBe(40);
        expect(req.constraints.split_shift_allowance_cents).toBe(1500);
        expect(req.constraints.pricing_policy).toEqual(solverPricingPolicy(CUSTOM.loadings));
        expect(req.constraints.pricing_policy.saturday_loading).toBe(0.3);
    });

    it('ICC Sydney\'s cards send ICC\'s figures — unchanged from the embedded schedule', async () => {
        h.fetchCards.mockResolvedValue(new Map([['org-icc', ICC_TEST_CARDS]]));
        await run('org-icc');
        const req = mockOptimize.mock.calls[0][0];
        expect(req.employees[0].hourly_rate).toBe(27.71);           // Level 2 permanent, FY2026/27
        expect(req.constraints.split_shift_allowance_cents).toBe(1170);
        expect(req.constraints.pricing_policy).toEqual({
            casual_loading: 0.25, saturday_loading: 0.25, sunday_loading: 0.5, public_holiday_loading: 1.5,
            night_loading_mon_thu: 0.2, night_loading_fri: 0.25, night_loading_sat_sun: 0.5,
            overtime_first_hours: 3, overtime_first_multiplier: 1.5, overtime_after_multiplier: 2,
        });
    });

    it('a window that starts before a 6 July increase is priced on the card in force at its start', async () => {
        h.fetchCards.mockResolvedValue(new Map([['org-icc', ICC_TEST_CARDS]]));
        vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
        await run('org-icc', ['2026-07-03', '2026-07-07']);
        const req = mockOptimize.mock.calls[0][0];
        expect(req.employees[0].hourly_rate).toBe(26.37);            // Level 2 permanent, EA 2025
        expect(req.constraints.split_shift_allowance_cents).toBe(1113);
    });

    it('an organization with no card covering the window is refused, not priced at ICC\'s rates', async () => {
        h.fetchCards.mockResolvedValue(new Map([['org-b', []]]));
        await expect(run('org-b')).rejects.toThrow(/No published pay rate card covers 2027-05-03/);
        expect(mockOptimize).not.toHaveBeenCalled();
    });

    it('without an organization the embedded schedule still applies and no policy is sent', async () => {
        await run(undefined);
        expect(h.fetchCards).not.toHaveBeenCalled();
        const req = mockOptimize.mock.calls[0][0];
        expect(req.constraints.pricing_policy).toBeUndefined();
        expect(req.employees[0].hourly_rate).toBe(27.71);
    });
});

describe('a card without the employee\'s level', () => {
    it('stops the run with an actionable message instead of crashing or sending NaN', async () => {
        const noLevel2 = { ...CUSTOM, rateSet: { ...CUSTOM.rateSet, wageRates: { LEVEL_1: CUSTOM.rateSet.wageRates.LEVEL_1 } as typeof CUSTOM.rateSet.wageRates, defaultRate: Number.NaN } };
        h.fetchCards.mockResolvedValue(new Map([['org-b', [noLevel2]]]));
        await expect(run('org-b')).rejects.toThrow(/BCEC-EA has no rate for FT's classification \(Level 2\)/);
        expect(mockOptimize).not.toHaveBeenCalled();
    });
});
