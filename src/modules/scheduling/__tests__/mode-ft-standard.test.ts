/**
 * MODE_FT_STANDARD — End-to-End Controller, V8 Hard Gate & Shape/V8 Parity Suite
 *
 * Grounded in ICC Sydney Enterprise Agreement 2025:
 *   - cl 12.2 / cl 35.1(a): 38 ordinary hours/week averaged over an anchored 1..4-week cycle (NET)
 *   - cl 35.1(c): minimum 7.6 net ordinary hours per shift (456 min)
 *   - cl 35.1(d): maximum 12.0 net ordinary hours per shift (720 min)
 *   - cl 35.1(e) & cl 39.1: continuous work (1 shift/day), <=20 workdays in 28, paired consecutive RDOs
 *   - cl 36.1: unpaid meal break (30..60m) deducted from ordinary hours worked
 *   - cl 40.1: minimum 10-hour rest gap between cross-day shifts
 *   - Sch 3: Security FT excluded from FT_STANDARD (belongs to FT_SECURITY)
 *   - Casual Fairness Module: strictly disabled in FT_STANDARD
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
    OptimizerError: class OptimizerError extends Error {},
}));
vi.mock('@/modules/scheduling/data/roster-fetcher', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/modules/scheduling/data/roster-fetcher')>();
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

import {
    AutoSchedulerController,
    isStandardFtEmployee,
    isStandardFtShift,
    shiftNetMinutes,
} from '../auto-scheduler.controller';
import type { EmployeeMeta, ShiftMeta } from '../optimizer/solution-parser';
import { optimizerClient } from '@/modules/scheduling/optimizer/optimizer.client';
import { rosterFetcher } from '@/modules/scheduling/data/roster-fetcher';
import { fairnessLedgerService } from '@/modules/rosters/services/fairnessLedger.service';
import { evaluateShiftShape } from '@/modules/compliance/shape';
import { V8Engine, v8Engine } from '@/modules/compliance/v8/engine';
import type { V8Employee, V8Shift } from '@/modules/compliance/v8/types';

const mockOptimize = optimizerClient.optimize as ReturnType<typeof vi.fn>;
const mockReadLedger = fairnessLedgerService.getStandingsWithStatus as ReturnType<typeof vi.fn>;
const mockContractDetails = rosterFetcher.fetchEmployeeContractDetails as ReturnType<typeof vi.fn>;
const mockApprovedLeave = rosterFetcher.fetchApprovedLeave as ReturnType<typeof vi.fn>;
const mockCycles = rosterFetcher.fetchOrdinaryHoursCycles as ReturnType<typeof vi.fn>;

function ftEmp(id: string, over: Partial<EmployeeMeta> = {}): EmployeeMeta {
    return {
        id,
        name: `FT ${id}`,
        contract_type: 'FT',
        employment_status: 'Full-Time',
        contracted_weekly_hours: 38,
        contracted_role_ids: ['role-ush'],
        ...over,
    };
}

function ftShift(id: string, date: string, over: Partial<ShiftMeta> = {}): ShiftMeta {
    // 09:00–17:06 (486m gross) minus 30m unpaid meal break = 456m (7.6h net).
    return {
        id,
        shift_date: date,
        start_time: '09:00',
        end_time: '17:06',
        unpaid_break_minutes: 30,
        paid_break_minutes: 15,
        role_id: 'role-ush',
        roleName: 'Customer Service Attendant (L2)',
        target_employment_type: 'FT',
        target_requires_flexible: false,
        demand_source: 'baseline',
        level: 2,
        ...over,
    };
}

describe('FT_STANDARD Layer 1 predicates & net-minute helper', () => {
    it('computes net paid minutes for general staff and keeps gross paid span for Security', () => {
        // cl 36.1: 09:00–17:06 (486m) - 30m unpaid = 456m (7.6h)
        expect(shiftNetMinutes({ start_time: '09:00', end_time: '17:06', unpaid_break_minutes: 30 })).toBe(456);
        // cl 35.1(d): 06:00–18:30 (750m) - 30m unpaid = 720m (12.0h)
        expect(shiftNetMinutes({ start_time: '06:00', end_time: '18:30', unpaid_break_minutes: 30 })).toBe(720);
        // Sch 3 §3.2(a): Security meal breaks are paid on the clock
        expect(shiftNetMinutes({ start_time: '06:00', end_time: '18:00', unpaid_break_minutes: 30 }, true)).toBe(720);
    });

    it('accepts only Standard Non-Security FT shifts in isStandardFtShift', () => {
        expect(isStandardFtShift(ftShift('s1', '2027-05-10'))).toBe(true);
        expect(isStandardFtShift(ftShift('s2', '2027-05-10', { target_employment_type: null }))).toBe(true);
        expect(isStandardFtShift(ftShift('s3', '2027-05-10', { target_employment_type: 'PT' }))).toBe(false);
        expect(isStandardFtShift(ftShift('s4', '2027-05-10', { target_employment_type: 'Casual' }))).toBe(false);
        expect(isStandardFtShift(ftShift('s5', '2027-05-10', { target_requires_flexible: true }))).toBe(false);
        expect(isStandardFtShift(ftShift('s6', '2027-05-10', { roleName: 'Security Officer (L3)' }))).toBe(false);
    });

    it('accepts only Standard Non-Security FT employees in isStandardFtEmployee', () => {
        expect(isStandardFtEmployee(ftEmp('ft1'))).toBe(true);
        // Contract status overrides stale profile contract_type
        expect(isStandardFtEmployee({
            id: 'ft-override', name: 'Override', contract_type: 'CASUAL', employment_status: 'Full-Time',
        })).toBe(true);
        expect(isStandardFtEmployee({
            id: 'pt1', name: 'PT', contract_type: 'PT', employment_status: 'Part-Time',
        })).toBe(false);
        expect(isStandardFtEmployee({
            id: 'fpt1', name: 'FPT', contract_type: 'PT', employment_status: 'Flexible Part-Time', is_flexible: true,
        })).toBe(false);
        expect(isStandardFtEmployee({
            id: 'cas1', name: 'Casual', contract_type: 'CASUAL', employment_status: 'Casual',
        })).toBe(false);
        expect(isStandardFtEmployee(ftEmp('ft-flex', { is_flexible: true }))).toBe(false);
        expect(isStandardFtEmployee(ftEmp('ft-sec'), { isSecurityRole: true })).toBe(false);
    });
});

describe('AutoSchedulerController.run({ mode: "FT_STANDARD" })', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2027-05-01T00:00:00Z'));
        mockContractDetails.mockResolvedValue(new Map());
        mockApprovedLeave.mockResolvedValue(new Map());
        mockCycles.mockResolvedValue(new Map());
        mockOptimize.mockResolvedValue({
            status: 'OPTIMAL',
            assignments: [],
            unassigned_shift_ids: [],
            solve_time_ms: 12,
            objective_value: 0,
            metrics: {},
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('isolates Standard FT shifts & staff (excluding PT, Casual, FPT, and Security FT) and disables the Casual Fairness Ledger', async () => {
        // Security FT identified via DB contract details even if no Security shift is passed
        mockContractDetails.mockResolvedValue(new Map([
            ['emp-sec-db', { is_security_role: true, level: 3 }],
            ['emp-ft', { is_security_role: false, level: 2 }],
        ]));

        const shifts: ShiftMeta[] = [
            ftShift('mon', '2027-05-03'),
            ftShift('tue', '2027-05-04'),
            ftShift('wed', '2027-05-05'),
            ftShift('thu', '2027-05-06'),
            ftShift('fri', '2027-05-07'),
            // Non-FT / Security shifts that must be partitioned out
            ftShift('pt-shift', '2027-05-03', { target_employment_type: 'PT' }),
            ftShift('cas-shift', '2027-05-04', { target_employment_type: 'Casual' }),
            ftShift('sec-shift', '2027-05-05', { role_id: 'role-sec', roleName: 'Security Officer (L3)' }),
        ];

        const employees: EmployeeMeta[] = [
            ftEmp('emp-ft'),
            ftEmp('emp-sec-shift', { contracted_role_ids: ['role-sec'] }),
            ftEmp('emp-sec-db'),
            { id: 'emp-pt', name: 'PT', contract_type: 'PT', employment_status: 'Part-Time', contracted_role_ids: ['role-ush'] },
            { id: 'emp-fpt', name: 'FPT', contract_type: 'PT', employment_status: 'Flexible Part-Time', is_flexible: true, contracted_role_ids: ['role-ush'] },
            { id: 'emp-cas', name: 'Casual', contract_type: 'CASUAL', employment_status: 'Casual', contracted_role_ids: ['role-ush'] },
        ];

        mockOptimize.mockResolvedValueOnce({
            status: 'OPTIMAL',
            assignments: [
                { shift_id: 'mon', employee_id: 'emp-ft', cost: 240 },
                { shift_id: 'tue', employee_id: 'emp-ft', cost: 240 },
                { shift_id: 'wed', employee_id: 'emp-ft', cost: 240 },
                { shift_id: 'thu', employee_id: 'emp-ft', cost: 240 },
                { shift_id: 'fri', employee_id: 'emp-ft', cost: 240 },
            ],
            unassigned_shift_ids: [],
            solve_time_ms: 15,
            objective_value: 120000,
            metrics: {},
        });

        const result = await new AutoSchedulerController().run({
            shifts,
            employees,
            mode: 'FT_STANDARD',
            organizationId: 'org-icc',
        });

        // Casual Fairness Ledger is completely bypassed (zero DB calls)
        expect(mockReadLedger).not.toHaveBeenCalled();
        expect(result.fairnessLedger).toEqual({
            applied: false,
            reason: 'not_applicable',
            employeesWithDebts: 0,
            windowEnd: null,
            ageDays: null,
        });
        expect(result.mode).toBe('FT_STANDARD');

        // Verify exact payload sent to Python CP-SAT service
        expect(mockOptimize).toHaveBeenCalledTimes(1);
        const req = mockOptimize.mock.calls[0][0];
        expect(req.constraints.scheduler_mode).toBe('FT_STANDARD');
        expect(req.shifts.map((s: { id: string }) => s.id)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
        expect(req.employees.map((e: { id: string }) => e.id)).toEqual(['emp-ft']);
        expect(req.employees[0].fairness_debts).toEqual({});

        // Net-minute demand check: 5 × 456m net = 2280m (38.0h), NOT 5 × 486m gross (2430m)
        // Over a 5-day span (Mon..Fri -> diffDays=5, weekScale=5/7), afterLeave = 2280 * 5/7 = 1628.57 -> 1629m,
        // and fairShareCap = 2280 * 1.2 = 2736m, so min_contract_minutes = round(2280 * 5/7) = 1629.
        expect(req.employees[0].min_contract_minutes).toBe(Math.round(2280 * (5 / 7)));

        // All 5 shifts pass real V8 compliance andutilization is measured on NET minutes (2280 / 1628.57)
        expect(result.passing).toBe(5);
        expect(result.failing).toBe(0);
    });

    it('throws a clear mode-specific error when no Standard FT shifts exist in the batch', async () => {
        const onlyCasualShifts: ShiftMeta[] = [
            ftShift('cas-1', '2027-05-03', { target_employment_type: 'Casual' }),
            ftShift('sec-1', '2027-05-04', { roleName: 'Security Officer (L3)' }),
        ];

        await expect(
            new AutoSchedulerController().run({
                shifts: onlyCasualShifts,
                employees: [ftEmp('emp-ft')],
                mode: 'FT_STANDARD',
            }),
        ).rejects.toThrow(/No Standard Full-Time shifts to schedule/i);
        expect(mockOptimize).not.toHaveBeenCalled();
    });

    it('hydrates real V8 ordinary-hours cycle & leave context in _validateProposals so >38h on a 1-week cycle and leave conflicts are blocked', async () => {
        // Declare a 1-week ordinary-hours cycle (38h hard cap) and approved leave on Sunday
        mockCycles.mockResolvedValue(new Map([
            ['emp-ft', { ordinary_hours_cycle_weeks: 1, ordinary_hours_cycle_anchor: '2027-05-03' }],
        ]));
        mockApprovedLeave.mockResolvedValue(new Map([
            ['emp-ft', ['2027-05-09']],
        ]));

        // 6 shifts × 7.6h net = 45.6h in a 1-week cycle + 1 shift on approved leave day
        const shifts: ShiftMeta[] = [
            ftShift('mon', '2027-05-03'),
            ftShift('tue', '2027-05-04'),
            ftShift('wed', '2027-05-05'),
            ftShift('thu', '2027-05-06'),
            ftShift('fri', '2027-05-07'),
            ftShift('sat-over-cap', '2027-05-08'),
            ftShift('sun-on-leave', '2027-05-09'),
        ];

        // Suppose a buggy solver returned all 7 shifts for emp-ft
        mockOptimize.mockResolvedValueOnce({
            status: 'OPTIMAL',
            assignments: shifts.map(s => ({ shift_id: s.id, employee_id: 'emp-ft', cost: 240 })),
            unassigned_shift_ids: [],
            solve_time_ms: 10,
            objective_value: 0,
            metrics: {},
        });

        const result = await new AutoSchedulerController().run({
            shifts,
            employees: [ftEmp('emp-ft')],
            mode: 'FT_STANDARD',
        });

        // Hard compliance gate keeps Mon..Fri (5 × 7.6h = 38.0h) and drops both
        // sat-over-cap (>38h in 1w cycle, cl 35.1(a)) and sun-on-leave (Part E leave)
        expect(result.passing).toBe(5);
        expect(result.proposals.map(p => p.shiftId)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
        expect(result.uncoveredV8ShiftIds).toContain('sat-over-cap');
        expect(result.uncoveredV8ShiftIds).toContain('sun-on-leave');
    });

    it('enforces 7.6h..12.0h net bounds and strict 1-shift/day in greedyFallback under FT_STANDARD', async () => {
        mockOptimize.mockResolvedValueOnce({
            status: 'INFEASIBLE',
            assignments: [],
            unassigned_shift_ids: ['short', 'long', 'am-ok', 'pm-same-day'],
            solve_time_ms: 5,
            objective_value: 0,
            metrics: {},
        });

        const shifts: ShiftMeta[] = [
            // 6.0h net -> below cl 35.1(c) 7.6h floor
            ftShift('short', '2027-05-03', { start_time: '09:00', end_time: '15:30', unpaid_break_minutes: 30 }),
            // 12.5h net -> above cl 35.1(d) 12.0h ceiling
            ftShift('long', '2027-05-04', { start_time: '06:00', end_time: '19:00', unpaid_break_minutes: 30 }),
            // Two valid 7.6h net shifts on the SAME calendar day (2027-05-05)
            ftShift('am-ok', '2027-05-05', { start_time: '06:00', end_time: '14:06', unpaid_break_minutes: 30 }),
            ftShift('pm-same-day', '2027-05-05', { start_time: '15:00', end_time: '23:06', unpaid_break_minutes: 30 }),
        ];

        const result = await new AutoSchedulerController().run({
            shifts,
            employees: [ftEmp('emp-ft')],
            mode: 'FT_STANDARD',
        });

        expect(result.usedFallback).toBe(true);
        // Only ONE shift on 2027-05-05 is booked; short, long, and the second same-day shift remain uncovered
        expect(result.passing).toBe(1);
        expect(result.proposals.map(p => p.shiftId)).toEqual(['am-ok']);
        expect(result.uncoveredV8ShiftIds).toEqual(expect.arrayContaining(['short', 'long', 'pm-same-day']));
    });
});

describe('CP-SAT ↔ ShiftShape ↔ V8 Engine Parity (ICC Sydney EBA 2025)', () => {
    const stdFtV8Employee: V8Employee = {
        id: 'emp-ft-1',
        name: 'Standard FT Worker',
        contract_type: 'FULL_TIME',
        contracted_weekly_hours: 38,
        ordinary_hours_cycle_weeks: 4,
        ordinary_hours_cycle_anchor: '2027-05-03',
        employment_statuses: ['Full-Time'],
        is_security_role: false,
    };

    it('passes both evaluateShiftShape and v8Engine with 0 hits on a canonical 4-week 20×7.6h (152h) Mon–Fri FT roster', () => {
        const shifts: V8Shift[] = [];
        // 4 weeks starting Monday 2027-05-03: Mon..Fri worked (20 days), Sat..Sun RDOs (4 paired weekends)
        for (let w = 0; w < 4; w++) {
            for (let d = 0; d < 5; d++) {
                const dayNum = 3 + w * 7 + d;
                const isoDate = `2027-05-${String(dayNum).padStart(2, '0')}`;
                const shape = evaluateShiftShape({
                    shift_date: isoDate,
                    start_time: '09:00',
                    end_time: '17:06',
                    break_start: '13:00',
                    break_end: '13:30',
                    unpaid_break_minutes: 30,
                    paid_break_minutes: 15,
                    target_employment_type: 'FT',
                    is_security: false,
                });
                expect(shape.status).toBe('PASS');
                expect(shape.hits).toEqual([]);

                shifts.push({
                    id: `s-${isoDate}`,
                    date: isoDate,
                    shift_date: isoDate,
                    start_time: '09:00',
                    end_time: '17:06',
                    break_start: '13:00',
                    break_end: '13:30',
                    unpaid_break_minutes: 30,
                    paid_break_minutes: 15,
                    target_employment_type: 'FT',
                    is_candidate: true,
                });
            }
        }

        const v8 = v8Engine.evaluate(stdFtV8Employee, shifts, '2027-05-30');
        expect(v8.overall_status).toBe('PASS');
        expect(v8.hits).toEqual([]);
    });

    it('passes both evaluateShiftShape and v8Engine on a 12.0h net shift (cl 35.1(d) ceiling) with dispersed meal breaks (cl 36.2 <=5h continuous work) + 2×15m paid rest pauses and 10h cross-day rest', () => {
        // 06:00–19:00 (780m gross) - 60m unpaid meal breaks (10:00–10:30 & 14:30–15:00,
        // keeping every continuous work stretch <= 4h per cl 36.2) = 720m (12.0h net).
        // Lawful under cl 35.1(d) (shape.passed === true, shape.blocking === false);
        // only the non-blocking SHAPE_SPREAD_GUARDRAIL house guideline (>12h gross span) notes it.
        const shape = evaluateShiftShape({
            shift_date: '2027-05-03',
            start_time: '06:00',
            end_time: '19:00',
            unpaid_breaks: [
                { sno: 1, start: '10:00', end: '10:30' },
                { sno: 2, start: '14:30', end: '15:00' },
            ],
            unpaid_break_minutes: 60,
            paid_break_minutes: 30,
            target_employment_type: 'FT',
            is_security: false,
        });
        expect(shape.passed).toBe(true);
        expect(shape.blocking).toBe(false);
        expect(shape.hits.map(h => h.rule_id)).toEqual(['SHAPE_SPREAD_GUARDRAIL']);

        // Next shift starts 05:00 on 2027-05-04 -> exact 10.0h (600m) cross-day rest gap (cl 40.1)
        const v8 = v8Engine.evaluate(
            stdFtV8Employee,
            [
                {
                    id: 'd1',
                    date: '2027-05-03',
                    shift_date: '2027-05-03',
                    start_time: '06:00',
                    end_time: '19:00',
                    unpaid_breaks: [
                        { sno: 1, start: '10:00', end: '10:30' },
                        { sno: 2, start: '14:30', end: '15:00' },
                    ],
                    unpaid_break_minutes: 60,
                    paid_break_minutes: 30,
                    target_employment_type: 'FT',
                    is_candidate: true,
                },
                {
                    id: 'd2',
                    date: '2027-05-04',
                    shift_date: '2027-05-04',
                    start_time: '05:00',
                    end_time: '13:06',
                    break_start: '09:00',
                    break_end: '09:30',
                    unpaid_break_minutes: 30,
                    paid_break_minutes: 15,
                    target_employment_type: 'FT',
                    is_candidate: true,
                },
            ],
            '2027-05-04',
        );
        expect(v8.overall_status).toBe('PASS');
        expect(v8.hits).toEqual([]);
    });

    it('agrees on daily boundary breaches (<7.6h net cl 35.1(c), >12.0h net cl 35.1(d)) and paired-RDO guardrail (cl 35.1(e))', () => {
        // 7.5h net (09:00–17:00 with 30m unpaid = 450m < 456m) -> blocked by SHAPE_FT_MIN_DAY
        const tooShort = evaluateShiftShape({
            shift_date: '2027-05-03',
            start_time: '09:00',
            end_time: '17:00',
            break_start: '13:00',
            break_end: '13:30',
            unpaid_break_minutes: 30,
            paid_break_minutes: 15,
            target_employment_type: 'FT',
        });
        expect(tooShort.status).toBe('BLOCKING');
        expect(tooShort.hits.map(h => h.rule_id)).toContain('SHAPE_FT_MIN_DAY');

        // 12.25h net (06:00–18:45 with 30m unpaid = 735m > 720m) -> blocked by both Shape and V8
        const tooLongShape = evaluateShiftShape({
            shift_date: '2027-05-03',
            start_time: '06:00',
            end_time: '18:45',
            break_start: '11:00',
            break_end: '11:30',
            unpaid_break_minutes: 30,
            paid_break_minutes: 30,
            target_employment_type: 'FT',
        });
        expect(tooLongShape.status).toBe('BLOCKING');
        expect(tooLongShape.hits.map(h => h.rule_id)).toContain('SHAPE_MAX_DURATION');

        const tooLongV8 = v8Engine.evaluate(stdFtV8Employee, [{
            id: 'long',
            date: '2027-05-03',
            shift_date: '2027-05-03',
            start_time: '06:00',
            end_time: '18:45',
            break_start: '11:00',
            break_end: '11:30',
            unpaid_break_minutes: 30,
            paid_break_minutes: 30,
            target_employment_type: 'FT',
            is_candidate: true,
        }], '2027-05-03');
        expect(tooLongV8.overall_status).toBe('BLOCKING');
        expect(tooLongV8.hits.map(h => h.rule_id)).toContain('V8_MAX_DAILY_HOURS');

        // 3 weeks of Mon..Sat (18 shifts over 20 observed days >= 14d minimum window;
        // only single Sundays off -> 0 pairs of consecutive days off vs 2 required, cl 35.1(e))
        // V8 (with enforce_ft_days_off enabled) emits V8_FT_DAYS_OFF WARNING, matching solver SC-13 guardrail
        const threeSixDayWeeks: V8Shift[] = [
            '03', '04', '05', '06', '07', '08',
            '10', '11', '12', '13', '14', '15',
            '17', '18', '19', '20', '21', '22',
        ].map(dd => ({
            id: `d-${dd}`,
            date: `2027-05-${dd}`,
            shift_date: `2027-05-${dd}`,
            start_time: '09:00',
            end_time: '17:06',
            break_start: '13:00',
            break_end: '13:30',
            unpaid_break_minutes: 30,
            paid_break_minutes: 15,
            target_employment_type: 'FT' as const,
            is_candidate: true,
        }));
        const strictEngine = new V8Engine({ enforce_ft_days_off: true });
        const rdoRes = strictEngine.evaluate(stdFtV8Employee, threeSixDayWeeks, '2027-05-23');
        expect(rdoRes.hits.map(h => h.rule_id)).toContain('V8_FT_DAYS_OFF');
    });
});
