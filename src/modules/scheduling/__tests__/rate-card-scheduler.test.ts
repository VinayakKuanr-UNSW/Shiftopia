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
            ordinary_daily_cap_hours: 12, security_ordinary_cap_hours: 12,
            min_engagement_minutes: 180, min_engagement_sunday_minutes: 240,
            min_engagement_public_holiday_minutes: 240, min_engagement_training_minutes: 120,
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

describe('operational thresholds and holiday jurisdiction flow end-to-end', () => {
    it('a card\'s 10h daily cap blocks an 11h shift in V8 validation and greedy fallback', async () => {
        const cap10: PricedCard = {
            ...CUSTOM,
            loadings: { ...CUSTOM.loadings, ordinaryDailyCapHours: 10 },
        };
        const shift11h: ShiftMeta = {
            ...shift('s11', '2027-05-03'),
            start_time: '07:00', end_time: '18:30', unpaid_break_minutes: 30,
        };
        const proposed11h = {
            status: 'OPTIMAL',
            assignments: [{ shift_id: 's11', employee_id: 'emp-ft', cost: 440, employment_type: 'FT' }],
            unassigned_shift_ids: [], solve_time_ms: 1, objective_value: 0, metrics: {},
        };

        // Under the 12h card, the 11h proposal passes V8 validation.
        h.fetchCards.mockResolvedValue(new Map([['org-b', [CUSTOM]]]));
        mockOptimize.mockResolvedValueOnce(proposed11h);
        const passRes = await new AutoSchedulerController().run({
            shifts: [shift11h], employees: [emp], mode: 'FT_STANDARD', organizationId: 'org-b',
        });
        expect(passRes.passing).toBe(1);
        expect(passRes.proposals).toHaveLength(1);

        // Under the 10h card, V8 blocks the 11h proposal and the hard gate moves it to uncovered.
        h.fetchCards.mockResolvedValue(new Map([['org-b', [cap10]]]));
        mockOptimize
            .mockResolvedValueOnce(proposed11h)
            .mockResolvedValueOnce({ status: 'OPTIMAL', assignments: [], unassigned_shift_ids: ['s11'], solve_time_ms: 1, objective_value: 0, metrics: {} });
        const failRes = await new AutoSchedulerController().run({
            shifts: [shift11h], employees: [emp], mode: 'FT_STANDARD', organizationId: 'org-b',
        });
        expect(failRes.passing).toBe(0);
        expect(failRes.proposals).toHaveLength(0);
        expect(failRes.uncoveredV8ShiftIds).toContain('s11');

        // Greedy fallback (INFEASIBLE) also rejects the 11h shift under the 10h card (and accepts under 12h).
        mockOptimize.mockResolvedValue({
            status: 'INFEASIBLE', assignments: [], unassigned_shift_ids: ['s11'], solve_time_ms: 1, objective_value: 0, metrics: {},
        });
        const fbFail = await new AutoSchedulerController().run({
            shifts: [shift11h], employees: [emp], mode: 'FT_STANDARD', organizationId: 'org-b',
        });
        expect(fbFail.usedFallback).toBe(true);
        expect(fbFail.passing).toBe(0);
        expect(fbFail.uncoveredV8ShiftIds).toContain('s11');

        h.fetchCards.mockResolvedValue(new Map([['org-b', [CUSTOM]]]));
        const fbPass = await new AutoSchedulerController().run({
            shifts: [shift11h], employees: [emp], mode: 'FT_STANDARD', organizationId: 'org-b',
        });
        expect(fbPass.usedFallback).toBe(true);
        expect(fbPass.passing).toBe(1);
    });

    it('optimizer shift holiday flags follow the organization\'s jurisdiction (Ekka in Brisbane, not Sydney)', async () => {
        vi.setSystemTime(new Date('2026-08-01T00:00:00Z'));
        const bneCard: PricedCard = { ...CUSTOM, validFrom: '2026-01-01', jurisdiction: 'AU-QLD-BNE' };
        const nswCard: PricedCard = { ...ICC_TEST_CARDS[1], jurisdiction: 'AU-NSW' };

        h.fetchCards.mockResolvedValue(new Map([['org-bne', [bneCard]]]));
        await run('org-bne', ['2026-08-12']);
        expect(mockOptimize.mock.calls[0][0].shifts[0].is_public_holiday).toBe(true);

        mockOptimize.mockClear();
        h.fetchCards.mockResolvedValue(new Map([['org-nsw', [nswCard]]]));
        await run('org-nsw', ['2026-08-12']);
        expect(mockOptimize.mock.calls[0][0].shifts[0].is_public_holiday).toBe(false);
    });
});
