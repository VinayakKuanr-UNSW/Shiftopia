/**
 * MODE_CASUAL — End-to-End Controller, V8 Hard Gate & Casual Parity Suite
 *
 * Grounded in ICC Sydney Enterprise Agreement 2025:
 *   - cl 12.5 (pp. 11–12) & cl 35.4 (p. 31): Casual Team Members
 *     * Engaged by the hour; paid a 25% casual loading on top of ordinary classification rate.
 *     * No contracted weekly hours (weeklyContractMinutes = 0, HC-7 exempt).
 *     * Minimum engagement tiers (cl 12.5(c), cl 35.4(c)):
 *       - 2.0 consecutive hours (120m) for training / meeting on non-event day (cl 12.5(c)(i));
 *       - 4.0 consecutive hours (240m) on Sunday (cl 12.5(c)(ii));
 *       - 4.0 consecutive hours (240m) on Public Holiday (cl 56.2);
 *       - 3.0 consecutive hours (180m) on standard weekdays (cl 12.5(c)(iii)).
 *     * Maximum 12 ordinary hours on any one day (720m, cl 35.4(c)).
 *     * Maximum of two (2) separate engagements that start on any one calendar day (cl 35.4(f)).
 *     * Maximum 20 worked days in any 28-day window (cl 35.4(e), V8_20_IN_28).
 *   - Schedule 3 §5.3: Casual Event Security:
 *     * Paid 30-minute meal break on the clock (gross duration = net worked minutes, Sch 3 §5.3(a)).
 *     * Minimum engagement of 4 consecutive hours (240m) on ANY day (Sch 3 §5.3(e)).
 *     * Where working 2 shifts in a day, each engagement must be at least 3 hours (180m) and gross spread <= 12 hours (720m) (Sch 3 §5.3(g)).
 *   - Casual Fairness Ledger (cl 12.5(e)):
 *     * Unlike permanent modes, the Casual Fairness Ledger IS ACTIVE in CASUAL mode!
 *     * `fairnessLedgerService.getStandingsWithStatus` is queried for the organisation.
 *     * Fairness debts are provided to CP-SAT solver and greedy fallback.
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
    CASUAL_MIN_ENGAGEMENT_MINUTES,
    CASUAL_TRAINING_MIN_ENGAGEMENT_MINUTES,
    CASUAL_SUNDAY_PH_MIN_ENGAGEMENT_MINUTES,
    CASUAL_EVENT_SECURITY_MIN_ENGAGEMENT_MINUTES,
    CASUAL_MAX_DAILY_NET_MINUTES,
    CASUAL_MAX_DAILY_ENGAGEMENTS,
    baselineWeeklyContractMinutes,
    isCasualEmployee,
    isCasualShift,
    shiftNetMinutes,
} from '../auto-scheduler.controller';
import type { EmployeeMeta, ShiftMeta } from '../optimizer/solution-parser';
import { optimizerClient } from '@/modules/scheduling/optimizer/optimizer.client';
import { fairnessLedgerService } from '@/modules/rosters/services/fairnessLedger.service';
import { evaluateShiftShape } from '@/modules/compliance/shape';
import { v8Engine } from '@/modules/compliance/v8/engine';
import type { V8Employee, V8Shift } from '@/modules/compliance/v8/types';

const mockOptimize = optimizerClient.optimize as ReturnType<typeof vi.fn>;
const mockReadLedger = fairnessLedgerService.getStandingsWithStatus as ReturnType<typeof vi.fn>;

function casualEmp(id: string, over: Partial<EmployeeMeta> = {}): EmployeeMeta {
    return {
        id,
        name: `Casual ${id}`,
        contract_type: 'CASUAL',
        employment_status: 'Casual',
        is_flexible: false,
        contracted_weekly_hours: 0,
        contracted_role_ids: ['role-casual'],
        ...over,
    };
}

function casualShift(id: string, date: string, over: Partial<ShiftMeta> = {}): ShiftMeta {
    return {
        id,
        shift_date: date,
        start_time: '09:00',
        end_time: '13:00',
        unpaid_break_minutes: 0,
        paid_break_minutes: 0,
        target_employment_type: 'Casual',
        target_requires_flexible: false,
        version: 1,
        ...over,
    };
}

describe('Casual Layer 1 predicates & contract baselines', () => {
    it('pins the EBA cl 12.5(c), cl 35.4(c)-(f) & Sch 3 §5.3 constants', () => {
        expect(CASUAL_MIN_ENGAGEMENT_MINUTES).toBe(180);
        expect(CASUAL_TRAINING_MIN_ENGAGEMENT_MINUTES).toBe(120);
        expect(CASUAL_SUNDAY_PH_MIN_ENGAGEMENT_MINUTES).toBe(240);
        expect(CASUAL_EVENT_SECURITY_MIN_ENGAGEMENT_MINUTES).toBe(240);
        expect(CASUAL_MAX_DAILY_NET_MINUTES).toBe(720);
        expect(CASUAL_MAX_DAILY_ENGAGEMENTS).toBe(2);
        // Casuals have 0 baseline contract minutes (HC-7 exempt)
        expect(baselineWeeklyContractMinutes('Casual')).toBe(0);
        expect(baselineWeeklyContractMinutes(null)).toBe(0);
    });

    it('isCasualShift accepts Casual and untargeted, rejects FT/PT/Flexible targets', () => {
        expect(isCasualShift({ target_employment_type: 'Casual', target_requires_flexible: false })).toBe(true);
        expect(isCasualShift({ target_employment_type: null, target_requires_flexible: false })).toBe(true);
        expect(isCasualShift({ target_employment_type: undefined, target_requires_flexible: false })).toBe(true);

        expect(isCasualShift({ target_employment_type: 'FT', target_requires_flexible: false })).toBe(false);
        expect(isCasualShift({ target_employment_type: 'PT', target_requires_flexible: false })).toBe(false);
        expect(isCasualShift({ target_employment_type: 'Casual', target_requires_flexible: true })).toBe(false);
        expect(isCasualShift({ target_employment_type: null, target_requires_flexible: true })).toBe(false);
    });

    it('isCasualEmployee accepts casuals, strictly rejects FT, PT, and Flexible PT', () => {
        expect(isCasualEmployee(casualEmp('cas1'))).toBe(true);
        expect(isCasualEmployee(casualEmp('cas2', { employment_status: 'CASUAL' }))).toBe(true);

        expect(isCasualEmployee({ id: 'ft1', name: 'FT', contract_type: 'FT', employment_status: 'Full-Time' })).toBe(false);
        expect(isCasualEmployee({ id: 'pt1', name: 'PT', contract_type: 'PT', employment_status: 'Part-Time' })).toBe(false);
        expect(isCasualEmployee({ id: 'fpt1', name: 'FPT', contract_type: 'PT', employment_status: 'Flexible Part-Time', is_flexible: true })).toBe(false);
    });

    it('shiftNetMinutes calculates net for standard casual and paid for security', () => {
        const s = { start_time: '09:00', end_time: '15:00', unpaid_break_minutes: 30 }; // 6h gross
        // General casual: 360 - 30 = 330 net minutes
        expect(shiftNetMinutes(s, false)).toBe(330);
        // Security casual: 360 full gross minutes (paid meal break Sch 3 §5.3(a))
        expect(shiftNetMinutes(s, true)).toBe(360);
    });
});

describe('AutoSchedulerController in CASUAL mode', () => {
    let controller: AutoSchedulerController;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.setSystemTime(new Date('2026-11-08T00:00:00Z'));
        controller = new AutoSchedulerController();
        mockOptimize.mockResolvedValue({
            status: 'OPTIMAL',
            assignments: [],
            unassigned_shift_ids: [],
            objective_value: 0,
            debug: { coverage_rate: 1 },
        });
        mockReadLedger.mockResolvedValue({
            status: 'fresh',
            standings: [
                { employeeId: 'cas1', currentDebtHours: 8.5 },
                { employeeId: 'cas2', currentDebtHours: 2.0 },
            ],
            windowEnd: '2026-11-08',
            ageDays: 1,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('throws error when no casual shifts exist in the window', async () => {
        await expect(controller.run({
            shifts: [
                casualShift('s_ft', '2026-11-09', { target_employment_type: 'FT' }),
            ],
            employees: [casualEmp('cas1')],
            mode: 'CASUAL',
        })).rejects.toThrow(/No Casual shifts to schedule in this range/);
    });

    it('activates Casual Fairness Ledger and supplies debts to optimizer', async () => {
        const shifts = [
            casualShift('s1', '2026-11-09', { start_time: '09:00', end_time: '13:00' }),
        ];
        const employees = [
            casualEmp('cas1'),
            casualEmp('cas2'),
        ];

        mockOptimize.mockResolvedValueOnce({
            status: 'OPTIMAL',
            assignments: [
                { shift_id: 's1', employee_id: 'cas1', employment_type: 'Casual', cost: 14000 },
            ],
            unassigned_shift_ids: [],
            objective_value: 100,
            debug: { coverage_rate: 1 },
        });

        const res = await controller.run({
            shifts,
            employees,
            organizationId: 'org-test-123',
            mode: 'CASUAL',
        });

        // Verifies ledger was fetched for the org
        expect(mockReadLedger).toHaveBeenCalledWith('org-test-123', null);

        // Verifies optimizer payload received casual employees with OPT_IN availability
        expect(mockOptimize).toHaveBeenCalledTimes(1);
        const req = mockOptimize.mock.calls[0][0];
        expect(req.constraints.scheduler_mode).toBe('CASUAL');
        expect(req.employees[0].availability_mode).toBe('OPT_IN');
        expect(req.employees[0].contract_weekly_minutes).toBe(0);

        expect(res.proposals.length).toBe(1);
        expect(res.proposals[0].employeeId).toBe('cas1');
    });

    it('enforces cl 35.4(f) max 2 daily engagements in greedy fallback', async () => {
        // Trigger greedy fallback via INFEASIBLE solver status
        mockOptimize.mockResolvedValueOnce({
            status: 'INFEASIBLE',
            assignments: [],
            unassigned_shift_ids: ['s1', 's2', 's3'],
        });

        const date = '2026-11-09';
        const shifts = [
            casualShift('s1', date, { start_time: '06:00', end_time: '09:00' }),
            casualShift('s2', date, { start_time: '10:00', end_time: '13:00' }),
            casualShift('s3', date, { start_time: '14:00', end_time: '17:00' }),
        ];
        const employees = [casualEmp('cas1')];

        const res = await controller.run({
            shifts,
            employees,
            mode: 'CASUAL',
        });

        const assigned = res.proposals.filter(p => p.passing && p.employeeId === 'cas1');
        // cl 35.4(f): at most 2 engagements on the same calendar day
        expect(assigned.length).toBe(2);
        expect(res.uncoveredV8ShiftIds.length).toBe(1);
    });

    it('enforces casual minimum engagement tiers in greedy fallback', async () => {
        mockOptimize.mockResolvedValueOnce({
            status: 'INFEASIBLE',
            assignments: [],
            unassigned_shift_ids: ['s_short_std', 's_train'],
        });

        const shifts = [
            // Standard weekday: 3.0h (180m) min -> 2.0h rejected
            casualShift('s_short_std', '2026-11-09', { start_time: '09:00', end_time: '11:00' }),
            // Training on weekday: 2.0h (120m) min -> 2.0h accepted
            casualShift('s_train', '2026-11-09', { start_time: '13:00', end_time: '15:00', is_training: true } as any),
        ];
        const employees = [casualEmp('cas1')];

        const res = await controller.run({
            shifts,
            employees,
            mode: 'CASUAL',
        });

        expect(res.uncoveredV8ShiftIds).toContain('s_short_std');
        const reasonShort = res.bindingConstraints?.find(b => b.shift_id === 's_short_std');
        expect(reasonShort?.reason).toMatch(/below the minimum engagement/i);

        const pTrain = res.proposals.find(p => p.shiftId === 's_train');
        expect(pTrain?.passing).toBe(true);
        expect(pTrain?.employeeId).toBe('cas1');
    });

    it('enforces Event Security Casual 4h minimum engagement', async () => {
        mockOptimize.mockResolvedValueOnce({
            status: 'INFEASIBLE',
            assignments: [],
            unassigned_shift_ids: ['s_sec_3h'],
        });

        // 3.0h standard weekday shift: valid for general casual (180m), invalid for Event Security casual (needs 240m)
        const shifts = [
            casualShift('s_sec_3h', '2026-11-09', { start_time: '09:00', end_time: '12:00', role_id: 'role-sec' }),
        ];
        const secEmployee = casualEmp('sec1', {
            contracted_role_ids: ['role-sec'],
        });
        (secEmployee as any).is_security_role = true;

        const res = await controller.run({
            shifts,
            employees: [secEmployee],
            mode: 'CASUAL',
        });

        expect(res.uncoveredV8ShiftIds).toContain('s_sec_3h');
        expect(res.proposals.length).toBe(0);
        const reasonSec = res.bindingConstraints?.find(b => b.shift_id === 's_sec_3h');
        expect(reasonSec?.reason).toMatch(/below the minimum engagement/i);
    });
});

describe('Casual V8 and Shape Compliance Parity', () => {
    it('validates casual shape rules against evaluateShiftShape', () => {
        // Standard weekday 3h shift passes shape
        const stdEval = evaluateShiftShape({
            shift_date: '2026-11-09',
            start_time: '09:00',
            end_time: '12:00',
            unpaid_break_minutes: 0,
            paid_break_minutes: 0,
            target_employment_type: 'Casual',
        });
        expect(stdEval.hits.filter(v => v.rule_id === 'SHAPE_MIN_ENGAGEMENT')).toHaveLength(0);

        // Sub-3h standard weekday shift (2.5h) fails SHAPE_MIN_ENGAGEMENT
        const shortEval = evaluateShiftShape({
            shift_date: '2026-11-09',
            start_time: '09:00',
            end_time: '11:30',
            unpaid_break_minutes: 0,
            paid_break_minutes: 0,
            target_employment_type: 'Casual',
        });
        expect(shortEval.hits.some(v => v.rule_id === 'SHAPE_MIN_ENGAGEMENT')).toBe(true);
    });

    it('evaluates casual EBA rules in V8 Engine', () => {
        const emp: V8Employee = {
            id: 'cas_v8',
            name: 'Casual V8 Worker',
            contract_type: 'CASUAL',
            contracted_weekly_hours: 0,
        };

        const shifts: V8Shift[] = [
            {
                id: 's1',
                shift_date: '2026-11-09',
                date: '2026-11-09',
                start_time: '09:00',
                end_time: '13:00',
                unpaid_break_minutes: 0,
                paid_break_minutes: 15,
                is_candidate: true,
            },
        ];

        const report = v8Engine.evaluate(emp, shifts);
        expect(report.hits.filter(h => h.status === 'BLOCKING')).toHaveLength(0);
    });
});
