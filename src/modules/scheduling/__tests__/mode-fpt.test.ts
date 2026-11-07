/**
 * MODE_FPT — End-to-End Controller, V8 Hard Gate & Flexible Part-Time Parity Suite
 *
 * Grounded in ICC Sydney Enterprise Agreement 2025:
 *   - cl 12.4 (pp. 10–11) & cl 35.3 (pp. 29–30): Flexible Part-Time Team Members
 *     * Guaranteed minimum of 624 hours per annum (12h/week = 720m baseline),
 *       up to maximum 1,976 ordinary hours per annum (average <= 38h/wk over <= 4 weeks).
 *     * No guaranteed minimum weekly hours; scheduled according to operational need.
 *     * Minimum engagement tiers (cl 12.4(c), cl 35.3(f)):
 *       - 2.0 consecutive hours (120m) for training / meeting on non-event day;
 *       - 4.0 consecutive hours (240m) on Sunday or Public Holiday (cl 56.2);
 *       - 3.0 consecutive hours (180m) on standard weekdays.
 *     * Max 12 ordinary hours on any one day (720m, cl 35.3(d)).
 *     * Maximum of ten (10) consecutive days without having a day off (cl 35.3(g), V8_STREAK_LIMIT).
 *     * Maximum 20 worked days in 28 days (cl 35.3(h), V8_20_IN_28).
 *     * Split shifts permitted; spread <= 12h net, gap <= 3h, split shift allowance (SC-12).
 *   - cl 36.1 & Schedule 3 §5.3(a): Unpaid meal break (30–60m) when working > 5h
 *     (or PAID 30m meal break on the clock for Part-Time Event Security).
 *   - cl 41, cl 43.1, Schedule 2 §1: Permanent wage rates + Sat (+25%), Sun (+50%),
 *     PH (+150%) loadings + cl 43.1 night allowances (20%/25%/50%).
 *   - Casual fairness ledger is BYPASSED (reason: 'not_applicable'); UI scorecard
 *     displays 'Workload Balance'.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    FPT_MIN_ENGAGEMENT_MINUTES,
    FPT_TRAINING_MIN_ENGAGEMENT_MINUTES,
    FPT_SUNDAY_PH_MIN_ENGAGEMENT_MINUTES,
    FPT_MAX_DAILY_NET_MINUTES,
    FPT_MAX_CONSECUTIVE_DAYS,
    FPT_WEEKLY_CONTRACT_MINUTES,
    baselineWeeklyContractMinutes,
    resolveFptWeeklyContractMinutes,
    isFptEmployee,
    isFptShift,
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

function fptEmp(id: string, over: Partial<EmployeeMeta> = {}): EmployeeMeta {
    return {
        id,
        name: `Flexi PT ${id}`,
        contract_type: 'PT',
        employment_status: 'Flexible Part-Time',
        is_flexible: true,
        contracted_weekly_hours: 12, // 624h/52w = 12h/wk baseline
        contracted_role_ids: ['role-fpt'],
        ...over,
    };
}

function fptShift(id: string, date: string, over: Partial<ShiftMeta> = {}): ShiftMeta {
    return {
        id,
        shift_date: date,
        start_time: '09:00',
        end_time: '13:00',
        unpaid_break_minutes: 0,
        paid_break_minutes: 0,
        target_employment_type: 'PT',
        target_requires_flexible: true,
        version: 1,
        ...over,
    };
}

describe('FPT Layer 1 predicates & contract baselines', () => {
    it('pins the EBA cl 12.4(a), cl 12.4(c), cl 35.3(a)-(g) constants', () => {
        expect(FPT_MIN_ENGAGEMENT_MINUTES).toBe(180);
        expect(FPT_TRAINING_MIN_ENGAGEMENT_MINUTES).toBe(120);
        expect(FPT_SUNDAY_PH_MIN_ENGAGEMENT_MINUTES).toBe(240);
        expect(FPT_MAX_DAILY_NET_MINUTES).toBe(720);
        expect(FPT_MAX_CONSECUTIVE_DAYS).toBe(10);
        expect(FPT_WEEKLY_CONTRACT_MINUTES).toBe(720); // 12h/wk baseline
        expect(baselineWeeklyContractMinutes('FLEXI_PART_TIME')).toBe(720);
        expect(baselineWeeklyContractMinutes('PT', { isFlexible: true })).toBe(720);
    });

    it('resolves weekly contract minutes honouring 624h baseline (12h/wk) and contract hours', () => {
        // Unset / 0 contracted weekly hours falls back to 720m (12h/wk)
        expect(resolveFptWeeklyContractMinutes({})).toBe(720);
        expect(resolveFptWeeklyContractMinutes({ contracted_weekly_hours: 0 })).toBe(720);
        // Explicit contract hours within statutory range [1..38]
        expect(resolveFptWeeklyContractMinutes({ contracted_weekly_hours: 15 })).toBe(900);
        expect(resolveFptWeeklyContractMinutes({ contracted_weekly_hours: 24 })).toBe(1440);
        expect(resolveFptWeeklyContractMinutes({ contracted_weekly_hours: 38 })).toBe(2280);
        // Explicit caller override
        expect(resolveFptWeeklyContractMinutes({}, 840)).toBe(840);
    });

    it('filters FPT shifts accepting untargeted & flexible targets, rejecting regular PT, FT, and Casual', () => {
        expect(isFptShift(fptShift('s1', '2027-06-07'))).toBe(true);
        expect(isFptShift(fptShift('s2', '2027-06-07', { target_employment_type: null, target_requires_flexible: false }))).toBe(true);
        expect(isFptShift(fptShift('s3', '2027-06-07', { target_employment_type: 'PT', target_requires_flexible: true }))).toBe(true);
        // Shift explicitly targeted at regular PT (Mode #3)
        expect(isFptShift(fptShift('s4', '2027-06-07', { target_employment_type: 'PT', target_requires_flexible: false }))).toBe(false);
        // Shift targeted at FT or Casual
        expect(isFptShift(fptShift('s5', '2027-06-07', { target_employment_type: 'FT' }))).toBe(false);
        expect(isFptShift(fptShift('s6', '2027-06-07', { target_employment_type: 'Casual' }))).toBe(false);
    });

    it('filters FPT employees accepting Standard FPT & Event Security FPT, rejecting regular PT, FT, and Casual', () => {
        const stdFpt = fptEmp('std_fpt');
        const secFpt = fptEmp('sec_fpt', { contracted_role_ids: ['role-sec'] });
        const flexStatus = fptEmp('flex_stat', { is_flexible: false, employment_status: 'Flexible Part-Time' });
        const regPt = fptEmp('reg_pt', { is_flexible: false, employment_status: 'Part-Time' });
        const ftEmp = fptEmp('ft', { contract_type: 'FT', employment_status: 'Full-Time', is_flexible: false });
        const casEmp = fptEmp('cas', { contract_type: 'CASUAL', employment_status: 'Casual', is_flexible: false });

        expect(isFptEmployee(stdFpt)).toBe(true);
        expect(isFptEmployee(secFpt)).toBe(true);
        expect(isFptEmployee(flexStatus)).toBe(true);
        expect(isFptEmployee(regPt)).toBe(false);
        expect(isFptEmployee(ftEmp)).toBe(false);
        expect(isFptEmployee(casEmp)).toBe(false);
    });
});

describe('AutoSchedulerController.run({ mode: "FPT" })', () => {
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

    it('routes requests through Mode FPT with strict pool isolation and skips casual fairness', async () => {
        const fp1 = fptEmp('fpt1', { contracted_weekly_hours: 12 });
        const fp2 = fptEmp('fpt2', { contracted_weekly_hours: 20 });
        const regPt = fptEmp('pt1', { is_flexible: false, employment_status: 'Part-Time' });
        const ft = fptEmp('ft1', { contract_type: 'FT', employment_status: 'Full-Time', is_flexible: false });
        const cas = fptEmp('cas1', { contract_type: 'CASUAL', employment_status: 'Casual', is_flexible: false });

        const s1 = fptShift('s1', '2027-06-07', { start_time: '08:00', end_time: '12:00' });
        const s2 = fptShift('s2', '2027-06-07', { start_time: '13:00', end_time: '17:00' });
        const sRegPt = fptShift('s_reg_pt', '2027-06-07', { target_employment_type: 'PT', target_requires_flexible: false });

        mockOptimize.mockResolvedValueOnce({
            status: 'OPTIMAL',
            solve_time_ms: 110,
            assignments: [
                { shift_id: 's1', employee_id: 'fpt1', cost: 118.96 },
                { shift_id: 's2', employee_id: 'fpt1', cost: 130.66 }, // split shift with allowance
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
            shifts: [s1, s2, sRegPt],
            employees: [fp1, fp2, regPt, ft, cas],
            mode: 'FPT',
            organizationId: 'org-test',
        });

        expect(result.mode).toBe('FPT');
        expect(mockReadLedger).not.toHaveBeenCalled();
        expect(result.fairnessLedger?.reason).toBe('not_applicable');

        const optimizeReq = mockOptimize.mock.calls[0][0];
        expect(optimizeReq.constraints.scheduler_mode).toBe('FPT');
        expect(optimizeReq.shifts.map((s: any) => s.id)).toEqual(['s1', 's2']);
        expect(optimizeReq.employees.map((e: any) => e.id)).toEqual(['fpt1', 'fpt2']);

        // Check FPT wire parameters
        const emp1Wire = optimizeReq.employees.find((e: any) => e.id === 'fpt1');
        const emp2Wire = optimizeReq.employees.find((e: any) => e.id === 'fpt2');
        expect(emp1Wire.contract_weekly_minutes).toBe(720); // 12h baseline
        expect(emp2Wire.contract_weekly_minutes).toBe(1200); // 20h
        expect(emp1Wire.is_flexible).toBe(true);
        expect(emp1Wire.availability_mode).toBe('OPT_OUT');

        expect(result.passing).toBe(2);
        expect(result.proposals.map(p => p.shiftId)).toEqual(['s1', 's2']);
    });

    it('enforces cl 35.3(g) 10-consecutive-day cap: 10 days pass, 11th consecutive day triggers V8_STREAK_LIMIT', () => {
        const emp: V8Employee = {
            id: 'fpt_streak_emp',
            name: 'FPT Streak Worker',
            contract_type: 'FLEXI_PART_TIME',
            contracted_weekly_hours: 12,
        };

        const anchor = '2027-06-01'; // Tuesday
        // Build 10 consecutive days of 4h shifts
        const tenDaysShifts: V8Shift[] = [];
        for (let i = 0; i < 10; i++) {
            tenDaysShifts.push({
                id: `shift_d${i}`,
                date: addDaysISO(anchor, i),
                shift_date: addDaysISO(anchor, i),
                start_time: '09:00',
                end_time: '13:00',
                unpaid_break_minutes: 0,
                paid_break_minutes: 0,
                is_candidate: i === 9,
            });
        }

        // 10 consecutive days MUST PASS
        const res10 = v8Engine.evaluate(emp, tenDaysShifts);
        const streakHits10 = res10.hits.filter(h => h.rule_id === 'V8_STREAK_LIMIT');
        expect(streakHits10).toHaveLength(0);

        // Add 11th consecutive day without a day off -> MUST BLOCK under cl 35.3(g)
        const elevenDaysShifts: V8Shift[] = [
            ...tenDaysShifts.map(s => ({ ...s, is_candidate: false })),
            {
                id: 'shift_d10',
                date: addDaysISO(anchor, 10),
                shift_date: addDaysISO(anchor, 10),
                start_time: '09:00',
                end_time: '13:00',
                unpaid_break_minutes: 0,
                paid_break_minutes: 0,
                is_candidate: true,
            },
        ];

        const res11 = v8Engine.evaluate(emp, elevenDaysShifts);
        const streakHits11 = res11.hits.filter(h => h.rule_id === 'V8_STREAK_LIMIT');
        expect(streakHits11.length).toBeGreaterThan(0);
        expect(streakHits11[0].status).toBe('BLOCKING');
    });

    it('enforces cl 12.4(c) minimum engagement tiers on shift shape', () => {
        // Training shift on non-event day: 2.0h is valid (cl 12.4(c)(i), cl 35.3(f)(i))
        const train2h = evaluateShiftShape({
            shift_date: '2027-06-07',
            start_time: '09:00',
            end_time: '11:00',
            is_training: true,
            unpaid_break_minutes: 0,
            paid_break_minutes: 0,
            target_employment_type: 'PT',
            target_requires_flexible: true,
        });
        expect(train2h.hits.filter(v => v.status === 'BLOCKING')).toHaveLength(0);

        // Training shift under 2.0h (1.5h) fails minimum engagement
        const train1_5h = evaluateShiftShape({
            shift_date: '2027-06-07',
            start_time: '09:00',
            end_time: '10:30',
            is_training: true,
            unpaid_break_minutes: 0,
            paid_break_minutes: 0,
            target_employment_type: 'PT',
            target_requires_flexible: true,
        });
        expect(train1_5h.hits.some(v => v.rule_id === 'SHAPE_MIN_ENGAGEMENT')).toBe(true);

        // Standard weekday (2027-06-07 is Monday): 3.0h minimum
        const weekday3h = evaluateShiftShape({
            shift_date: '2027-06-07',
            start_time: '09:00',
            end_time: '12:00',
            unpaid_break_minutes: 0,
            paid_break_minutes: 0,
            target_employment_type: 'PT',
            target_requires_flexible: true,
        });
        expect(weekday3h.hits.filter(v => v.status === 'BLOCKING')).toHaveLength(0);

        // Standard weekday: 2.0h violates 3.0h minimum
        const weekday2h = evaluateShiftShape({
            shift_date: '2027-06-07',
            start_time: '09:00',
            end_time: '11:00',
            unpaid_break_minutes: 0,
            paid_break_minutes: 0,
            target_employment_type: 'PT',
            target_requires_flexible: true,
        });
        expect(weekday2h.hits.some(v => v.rule_id === 'SHAPE_MIN_ENGAGEMENT')).toBe(true);

        // Sunday (2027-06-13): 4.0h minimum (cl 12.4(c)(iii), cl 35.3(f)(iii))
        const sunday4h = evaluateShiftShape({
            shift_date: '2027-06-13',
            start_time: '09:00',
            end_time: '13:00',
            is_sunday: true,
            unpaid_break_minutes: 0,
            paid_break_minutes: 15,
            target_employment_type: 'PT',
            target_requires_flexible: true,
        });
        expect(sunday4h.hits.filter(v => v.rule_id === 'SHAPE_MIN_ENGAGEMENT')).toHaveLength(0);

        // Sunday: 3.0h violates 4.0h Sunday minimum
        const sunday3h = evaluateShiftShape({
            shift_date: '2027-06-13',
            start_time: '09:00',
            end_time: '12:00',
            is_sunday: true,
            unpaid_break_minutes: 0,
            paid_break_minutes: 0,
            target_employment_type: 'PT',
            target_requires_flexible: true,
        });
        expect(sunday3h.hits.some(v => v.rule_id === 'SHAPE_MIN_ENGAGEMENT')).toBe(true);
    });

    it('validates 4-week ordinary hours cycle cap (152h) under cl 35.3(e)', () => {
        const emp: V8Employee = {
            id: 'fpt_cycle_emp',
            name: 'FPT Cycle Employee',
            contract_type: 'FLEXI_PART_TIME',
            contracted_weekly_hours: 12,
            ordinary_hours_cycle_weeks: 4,
            ordinary_hours_cycle_anchor: '2027-06-07',
        };

        // 19 days of 8h = 152h within 4 weeks (152h cap)
        const shifts152: V8Shift[] = [];
        for (let i = 0; i < 19; i++) {
            const dayOffset = Math.floor(i * 1.4);
            shifts152.push({
                id: `s_cyc_${i}`,
                date: addDaysISO('2027-06-07', dayOffset),
                shift_date: addDaysISO('2027-06-07', dayOffset),
                start_time: '09:00',
                end_time: '17:30',
                unpaid_break_minutes: 30, // 8h net
                paid_break_minutes: 0,
                is_candidate: i === 18,
            });
        }

        const res152 = v8Engine.evaluate(emp, shifts152);
        const avgHits152 = res152.hits.filter(h => h.rule_id === 'V8_ORD_HOURS_AVG');
        expect(avgHits152).toHaveLength(0);

        // Add 1 extra 8h shift -> 160h > 152h cap -> MUST BLOCK under V8_ORD_HOURS_AVG
        const shifts160: V8Shift[] = [
            ...shifts152.map(s => ({ ...s, is_candidate: false })),
            {
                id: 's_cyc_extra',
                date: addDaysISO('2027-06-07', 27),
                shift_date: addDaysISO('2027-06-07', 27),
                start_time: '09:00',
                end_time: '17:30',
                unpaid_break_minutes: 30,
                paid_break_minutes: 0,
                is_candidate: true,
            },
        ];

        const res160 = v8Engine.evaluate(emp, shifts160);
        const avgHits160 = res160.hits.filter(h => h.rule_id === 'V8_ORD_HOURS_AVG');
        expect(avgHits160.length).toBeGreaterThan(0);
        expect(avgHits160[0].status).toBe('BLOCKING');
    });

    it('falls back gracefully to greedy fallback in FPT mode with correct daily and streak rules', async () => {
        const p1 = fptEmp('fpt_greedy1');
        const s1 = fptShift('s1', '2027-06-07', { start_time: '09:00', end_time: '13:00' });

        mockOptimize.mockResolvedValueOnce({
            status: 'INFEASIBLE',
            solve_time_ms: 50,
            assignments: [],
            unassigned_shift_ids: ['s1'],
        });

        const result = await controller.run({
            shifts: [s1],
            employees: [p1],
            mode: 'FPT',
        });

        expect(result.mode).toBe('FPT');
        expect(result.totalProposals).toBe(1);
        expect(result.passing).toBe(1);
        expect(result.proposals[0].employeeId).toBe('fpt_greedy1');
        expect(result.proposals[0].employmentType).toBe('Part-Time');
    });
});
