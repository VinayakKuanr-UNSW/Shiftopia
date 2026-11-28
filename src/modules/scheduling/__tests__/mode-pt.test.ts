/**
 * MODE_PT — End-to-End Controller, V8 Hard Gate & Regular Part-Time Parity Suite
 *
 * Grounded in ICC Sydney Enterprise Agreement 2025:
 *   - cl 12.3 (pp. 9–10): Predetermined < 38h/wk contract over a 1..4-week cycle,
 *     regular agreed pattern, additional hours by agreement, flat 3h minimum
 *     engagement on ANY day worked (NO 2h training exception and NO 4h Sunday uplift).
 *   - cl 35.2 (pp. 28–29): Anchored 1..4w work cycle (38h / 76h / 114h / 152h),
 *     Mon–Sun ordinary hours, max 12h/day, min 3h/shift, max 20 workdays in 28d,
 *     split shifts permitted.
 *   - cl 36.1 & cl 39 (pp. 30–32): Unpaid meal break (30–60m) when working > 5h;
 *     split shift spread <= 12h excluding meal AND rest breaks; split shift
 *     allowance (SC-12) applies once per day when gap <= 180m.
 *   - cl 56.2 (p. 45): Public holiday minimum engagement of 4 consecutive hours.
 *   - cl 40–43: 10h cross-day rest (8h multi-hire); Sat 125%, Sun 150%, PH 250%;
 *     OT 150%/200% above contracted hours; cl 43.1 night allowances.
 *   - Schedule 3 §5.2, §5.3, §6 (pp. 71, 73–75): Part-Time Event Security is
 *     governed by the same 1..4w cycle, <= 12h/day, 3h min (4h PH), split shifts,
 *     and Schedule 2 §1 hourly rates + cl 41/42/43 loadings, with PAID meal breaks.
 *   - Strict separation from Flexible Part-Time (Mode #4 FPT).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The organization's published rate cards (Phase 4): ICC Sydney's.
vi.mock('@/modules/payroll/data/ebaRates.read.api', async () => (await import('./fixtures/iccRateCards')).iccRateCardsModule);
vi.mock('@/modules/scheduling/validation/engine/assignment-committer', () => ({
    assignmentCommitter: { commitAtomic: vi.fn(), commit: vi.fn() },
}));
vi.mock('@/modules/scheduling/audit/auditor', () => ({
    auditor: { audit: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/modules/scheduling/optimizer/optimizer.client', () => ({
    optimizerClient: { optimize: vi.fn(), healthCheck: vi.fn() },
    OptimizerError: class OptimizerError extends Error { },
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
            fetchEmployeeContractDetails: vi.fn().mockResolvedValue(new Map()),
            fetchOrdinaryHoursEnvelopes: vi.fn().mockResolvedValue(new Map()),
            fetchOrdinaryHoursCycles: vi.fn().mockResolvedValue(new Map()),
        },
    };
});
vi.mock('@/modules/rosters/services/fairnessLedger.service', () => ({
    fairnessLedgerService: { getStandingsWithStatus: vi.fn() },
}));

import {
    AutoSchedulerController,
    PT_MIN_ENGAGEMENT_MINUTES,
    PT_PH_MIN_ENGAGEMENT_MINUTES,
    PT_MAX_DAILY_NET_MINUTES,
    baselineWeeklyContractMinutes,
    resolvePtWeeklyContractMinutes,
    isPtEmployee,
    isPtShift,
} from '../auto-scheduler.controller';
import type { EmployeeMeta, ShiftMeta } from '../optimizer/solution-parser';
import { optimizerClient } from '@/modules/scheduling/optimizer/optimizer.client';
import { rosterFetcher } from '@/modules/scheduling/data/roster-fetcher';
import { fairnessLedgerService } from '@/modules/rosters/services/fairnessLedger.service';
import { evaluateShiftShape } from '@/modules/compliance/shape';
import { v8Engine } from '@/modules/compliance/v8/engine';
import type { V8Employee, V8Shift } from '@/modules/compliance/v8/types';

const mockOptimize = optimizerClient.optimize as ReturnType<typeof vi.fn>;
const mockReadLedger = fairnessLedgerService.getStandingsWithStatus as ReturnType<typeof vi.fn>;
const mockContractDetails = rosterFetcher.fetchEmployeeContractDetails as ReturnType<typeof vi.fn>;
const mockExistingRoster = rosterFetcher.fetchExistingRoster as ReturnType<typeof vi.fn>;
const mockApprovedLeave = rosterFetcher.fetchApprovedLeave as ReturnType<typeof vi.fn>;
const mockCycles = rosterFetcher.fetchOrdinaryHoursCycles as ReturnType<typeof vi.fn>;

function addDaysISO(anchor: string, offsetDays: number): string {
    const d = new Date(`${anchor}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

function ptEmp(id: string, over: Partial<EmployeeMeta> = {}): EmployeeMeta {
    return {
        id,
        name: `Part-Time ${id}`,
        contract_type: 'PT',
        employment_status: 'Part-Time',
        contracted_weekly_hours: 20,
        contracted_role_ids: ['role-pt'],
        ...over,
    };
}

function ptShift(id: string, date: string, over: Partial<ShiftMeta> = {}): ShiftMeta {
    return {
        id,
        shift_date: date,
        start_time: '09:00',
        end_time: '13:00',
        unpaid_break_minutes: 0,
        paid_break_minutes: 0,
        target_employment_type: 'PT',
        target_requires_flexible: false,
        version: 1,
        ...over,
    };
}

describe('PT Layer 1 predicates & contract baselines', () => {
    it('pins the EBA cl 12.3(e), cl 35.2(e), cl 56.2 constants', () => {
        expect(PT_MIN_ENGAGEMENT_MINUTES).toBe(180);
        expect(PT_PH_MIN_ENGAGEMENT_MINUTES).toBe(240);
        expect(PT_MAX_DAILY_NET_MINUTES).toBe(720);
        expect(baselineWeeklyContractMinutes('PT')).toBe(1200);
    });

    it('resolves predetermined weekly contract minutes honouring < 38h contracts', () => {
        expect(resolvePtWeeklyContractMinutes({ contracted_weekly_hours: 24 })).toBe(1440);
        expect(resolvePtWeeklyContractMinutes({ contracted_weekly_hours: 30 })).toBe(1800);
        // Default unset / 38 fallback (from EligibilityService) defaults cleanly to 1200m (20h)
        expect(resolvePtWeeklyContractMinutes({ contracted_weekly_hours: 38 })).toBe(1200);
        expect(resolvePtWeeklyContractMinutes({ contracted_weekly_hours: 0 })).toBe(1200);
        expect(resolvePtWeeklyContractMinutes({}, 1500)).toBe(1500);
    });

    it('filters PT shifts isolating from FT, Casual and Flexible targets', () => {
        expect(isPtShift(ptShift('s1', '2027-06-07'))).toBe(true);
        expect(isPtShift(ptShift('s2', '2027-06-07', { target_employment_type: null }))).toBe(true);
        expect(isPtShift(ptShift('s3', '2027-06-07', { target_employment_type: 'FT' }))).toBe(false);
        expect(isPtShift(ptShift('s4', '2027-06-07', { target_employment_type: 'Casual' }))).toBe(false);
        expect(isPtShift(ptShift('s5', '2027-06-07', { target_requires_flexible: true }))).toBe(false);
    });

    it('filters PT employees accepting Standard PT & Event Security PT, rejecting FPT, FT, and Casual', () => {
        const stdPt = ptEmp('std_pt');
        const secPt = ptEmp('sec_pt', { contracted_role_ids: ['role-sec'] });
        const fptFlag = ptEmp('fpt_flag', { is_flexible: true });
        const fptStatus = ptEmp('fpt_stat', { employment_status: 'Flexible Part-Time' });
        const ftEmp = ptEmp('ft', { contract_type: 'FT', employment_status: 'Full-Time' });
        const casEmp = ptEmp('cas', { contract_type: 'CASUAL', employment_status: 'Casual' });

        expect(isPtEmployee(stdPt)).toBe(true);
        expect(isPtEmployee(secPt)).toBe(true);
        expect(isPtEmployee(fptFlag)).toBe(false);
        expect(isPtEmployee(fptStatus)).toBe(false);
        expect(isPtEmployee(ftEmp)).toBe(false);
        expect(isPtEmployee(casEmp)).toBe(false);
    });
});

describe('AutoSchedulerController.run({ mode: "PT" })', () => {
    let controller: AutoSchedulerController;

    beforeEach(() => {
        vi.clearAllMocks();
        controller = new AutoSchedulerController();
        mockContractDetails.mockResolvedValue(new Map());
        mockExistingRoster.mockResolvedValue(new Map());
        mockApprovedLeave.mockResolvedValue(new Map());
        mockCycles.mockResolvedValue(new Map());
        mockReadLedger.mockResolvedValue({ status: 'active', standings: [], windowEnd: '2027-06-07', ageDays: 1 });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('routes requests through Mode PT with strict pool isolation and skips casual fairness', async () => {
        const p1 = ptEmp('pt1', { contracted_weekly_hours: 24 });
        const p2 = ptEmp('pt2', { contracted_weekly_hours: 30 });
        const ft = ptEmp('ft1', { contract_type: 'FT', employment_status: 'Full-Time' });
        const cas = ptEmp('cas1', { contract_type: 'CASUAL', employment_status: 'Casual' });

        const s1 = ptShift('s1', '2027-06-07', { start_time: '08:00', end_time: '12:00' });
        const s2 = ptShift('s2', '2027-06-07', { start_time: '13:00', end_time: '17:00' });
        const sFt = ptShift('s_ft', '2027-06-07', { target_employment_type: 'FT' });

        mockOptimize.mockResolvedValueOnce({
            status: 'OPTIMAL',
            solve_time_ms: 120,
            assignments: [
                { shift_id: 's1', employee_id: 'pt1', cost: 118.96 },
                { shift_id: 's2', employee_id: 'pt1', cost: 130.66 }, // split shift with allowance
            ],
            unassigned_shift_ids: [],
            pillars: {
                coverage: { score: 100, covered: 2, total: 2 },
                fairness: { score: 95, spread_minutes: 0, employees_used: 1 },
                fatigue: { score: 98, critical: 0, amber: 0, over_cap_staff: 0 },
                cost: { total: 249.62, avg_per_shift: 124.81 },
            },
        });

        const result = await controller.run({
            shifts: [s1, s2, sFt],
            employees: [p1, p2, ft, cas],
            mode: 'PT',
            organizationId: 'org-test',
        });

        expect(result.mode).toBe('PT');
        expect(mockReadLedger).not.toHaveBeenCalled();
        expect(result.fairnessLedger?.reason).toBe('not_applicable');

        const optimizeReq = mockOptimize.mock.calls[0][0];
        expect(optimizeReq.constraints.scheduler_mode).toBe('PT');
        expect(optimizeReq.shifts.map((s: any) => s.id)).toEqual(['s1', 's2']);
        expect(optimizeReq.employees.map((e: any) => e.id)).toEqual(['pt1', 'pt2']);

        // Check predetermined contract minutes sent to solver
        const emp1Wire = optimizeReq.employees.find((e: any) => e.id === 'pt1');
        const emp2Wire = optimizeReq.employees.find((e: any) => e.id === 'pt2');
        expect(emp1Wire.contract_weekly_minutes).toBe(1440); // 24h
        expect(emp2Wire.contract_weekly_minutes).toBe(1800); // 30h
        expect(emp1Wire.availability_mode).toBe('OPT_OUT');

        // Both split shifts booked on pt1
        expect(result.passing).toBe(2);
        expect(result.proposals.map(p => p.shiftId)).toEqual(['s1', 's2']);
    });

    it('validates lawful split shifts pass V8 while spread > 12h net is caught and blocked', async () => {
        const emp = ptEmp('pt1');
        // Lawful split shift: 08:00-12:00 + 14:00-18:00 (10h spread, 2h gap <= 3h, 8h worked)
        const sAm = ptShift('s_am', '2027-06-07', { start_time: '08:00', end_time: '12:00' });
        const sPm = ptShift('s_pm', '2027-06-07', { start_time: '14:00', end_time: '18:00' });

        mockOptimize.mockResolvedValueOnce({
            status: 'OPTIMAL',
            solve_time_ms: 100,
            assignments: [
                { shift_id: 's_am', employee_id: 'pt1', cost: 118.96 },
                { shift_id: 's_pm', employee_id: 'pt1', cost: 130.66 },
            ],
            unassigned_shift_ids: [],
        });

        const resLawful = await controller.run({
            shifts: [sAm, sPm],
            employees: [emp],
            mode: 'PT',
        });
        expect(resLawful.passing).toBe(2);
        expect(resLawful.failing).toBe(0);

        // Unlawful spread: 06:00-10:00 + 17:00-21:00 (15h spread > 12h net)
        const sTooEarly = ptShift('s_early', '2027-06-08', { start_time: '06:00', end_time: '10:00' });
        const sTooLate = ptShift('s_late', '2027-06-08', { start_time: '17:00', end_time: '21:00' });

        mockOptimize
            .mockResolvedValueOnce({
                status: 'OPTIMAL',
                solve_time_ms: 100,
                assignments: [
                    { shift_id: 's_early', employee_id: 'pt1', cost: 118.96 },
                    { shift_id: 's_late', employee_id: 'pt1', cost: 118.96 },
                ],
                unassigned_shift_ids: [],
            })
            .mockResolvedValueOnce({
                status: 'OPTIMAL',
                solve_time_ms: 10,
                assignments: [
                    { shift_id: 's_early', employee_id: 'pt1', cost: 118.96 },
                ],
                unassigned_shift_ids: ['s_late'],
            });

        const resUnlawful = await controller.run({
            shifts: [sTooEarly, sTooLate],
            employees: [emp],
            mode: 'PT',
        });
        // One is dropped by compliance repair / gate to maintain 100% lawful roster!
        expect(resUnlawful.passing).toBeLessThan(2);
        expect(resUnlawful.uncoveredV8ShiftIds.length).toBeGreaterThan(0);
    });

    it('blocks abutting same-day shifts over 5h without 30m meal break per cl 36.1', async () => {
        const emp = ptEmp('pt1');
        // Two 3h shifts with only 15m gap = 6h worked (>5h) and longest break 15m (<30m)
        const s1 = ptShift('s_m1', '2027-06-07', { start_time: '08:00', end_time: '11:00' });
        const s2 = ptShift('s_m2', '2027-06-07', { start_time: '11:15', end_time: '14:15' });

        mockOptimize
            .mockResolvedValueOnce({
                status: 'OPTIMAL',
                solve_time_ms: 100,
                assignments: [
                    { shift_id: 's_m1', employee_id: 'pt1', cost: 89.22 },
                    { shift_id: 's_m2', employee_id: 'pt1', cost: 89.22 },
                ],
                unassigned_shift_ids: [],
            })
            .mockResolvedValueOnce({
                status: 'OPTIMAL',
                solve_time_ms: 10,
                assignments: [
                    { shift_id: 's_m1', employee_id: 'pt1', cost: 89.22 },
                ],
                unassigned_shift_ids: ['s_m2'],
            });

        const res = await controller.run({
            shifts: [s1, s2],
            employees: [emp],
            mode: 'PT',
        });
        expect(res.passing).toBeLessThan(2);
        expect(res.uncoveredV8ShiftIds.length).toBeGreaterThan(0);
    });

    it('greedy fallback assigns lawful split shifts and rejects below 3h (4h on PH)', async () => {
        mockOptimize.mockResolvedValueOnce({
            status: 'INFEASIBLE',
            assignments: [],
            unassigned_shift_ids: ['s_ok', 's_short', 's_ph'],
            solve_time_ms: 5,
        });

        const emp = ptEmp('pt1');
        const sOk = ptShift('s_ok', '2027-06-07', { start_time: '09:00', end_time: '12:00' }); // 3.0h
        const sShort = ptShift('s_short', '2027-06-08', { start_time: '09:00', end_time: '11:00' }); // 2.0h -> fails
        const sPhShort = ptShift('s_ph', '2027-06-14', {
            start_time: '09:00', end_time: '12:00',
        }); // 3.0h PH (King's Birthday) -> fails cl 56.2 (needs 4h)

        const res = await controller.run({
            shifts: [sOk, sShort, sPhShort],
            employees: [emp],
            mode: 'PT',
        });

        expect(res.usedFallback).toBe(true);
        expect(res.passing).toBe(1);
        expect(res.proposals.find(p => p.shiftId === 's_ok')?.complianceStatus).toBe('PASS');
        expect(res.uncoveredV8ShiftIds).toContain('s_short');
        expect(res.uncoveredV8ShiftIds).toContain('s_ph');
    });
});

describe('evaluateShiftShape & v8Engine Parity for Standard PT and Event Security PT', () => {
    it('evaluates shift shape bounds: flat 3h min (no 2h training), 4h PH, 12h daily cap', () => {
        // Plain PT (isFlexible: false): 3.0h is valid, 2.0h training is NOT valid
        const shape3h = evaluateShiftShape({
            shift_date: '2027-06-07',
            start_time: '09:00',
            end_time: '12:00',
            target_employment_type: 'PT',
            target_requires_flexible: false,
        });
        expect(shape3h.hits.filter(v => v.status === 'BLOCKING')).toHaveLength(0);

        const shape2hTrain = evaluateShiftShape({
            shift_date: '2027-06-07',
            start_time: '09:00',
            end_time: '11:00',
            is_training: true,
            target_employment_type: 'PT',
            target_requires_flexible: false,
        });
        expect(shape2hTrain.hits.some(v => v.rule_id === 'SHAPE_MIN_ENGAGEMENT')).toBe(true);

        // 3h Sunday is valid for plain PT (unlike FPT / Casual which require 4h)
        const shape3hSun = evaluateShiftShape({
            shift_date: '2027-06-13',
            start_time: '09:00',
            end_time: '12:00',
            is_sunday: true,
            target_employment_type: 'PT',
            target_requires_flexible: false,
        });
        expect(shape3hSun.hits.filter(v => v.status === 'BLOCKING')).toHaveLength(0);

        // 3h Public Holiday fails cl 56.2 (needs 4h)
        const shape3hPh = evaluateShiftShape({
            shift_date: '2027-06-14',
            start_time: '09:00',
            end_time: '12:00',
            is_public_holiday: true,
            target_employment_type: 'PT',
            target_requires_flexible: false,
        });
        expect(shape3hPh.hits.some(v => v.rule_id === 'SHAPE_MIN_ENGAGEMENT_PH')).toBe(true);

        const shape4hPh = evaluateShiftShape({
            shift_date: '2027-06-14',
            start_time: '09:00',
            end_time: '13:00',
            paid_break_minutes: 15,
            is_public_holiday: true,
            target_employment_type: 'PT',
            target_requires_flexible: false,
        });
        expect(shape4hPh.hits.filter(v => v.rule_id === 'SHAPE_MIN_ENGAGEMENT_PH')).toHaveLength(0);
    });

    it('v8Engine enforces 152h 4-week cycle cap on both Standard PT and Event Security PT', () => {
        const stdPt: V8Employee = {
            id: 'pt_std',
            name: 'Standard PT',
            contract_type: 'PART_TIME',
            contracted_weekly_hours: 30,
            ordinary_hours_cycle_weeks: 4,
            ordinary_hours_cycle_anchor: '2027-06-07',
            is_security_role: false,
        };

        const secPt: V8Employee = {
            id: 'pt_sec',
            name: 'Event Security PT',
            contract_type: 'PART_TIME',
            contracted_weekly_hours: 30,
            ordinary_hours_cycle_weeks: 4,
            ordinary_hours_cycle_anchor: '2027-06-07',
            is_security_role: true,
        };

        // 13 x 12h = 156h (> 152h cap)
        const heavyShifts: V8Shift[] = Array.from({ length: 13 }, (_, i) => ({
            id: `sh_${i}`,
            date: addDaysISO('2027-06-07', i * 2),
            start_time: '06:00',
            end_time: '18:00',
            unpaid_break_minutes: 0,
            paid_break_minutes: 30,
            is_candidate: i === 12,
        }));

        for (const emp of [stdPt, secPt]) {
            const res = v8Engine.evaluate(emp, heavyShifts);
            const ordAvgHit = res.hits.find(h => h.rule_id === 'V8_ORD_HOURS_AVG');
            expect(ordAvgHit).toBeDefined();
            expect(ordAvgHit?.status).toBe('BLOCKING');
        }
    });
});