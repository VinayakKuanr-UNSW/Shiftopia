/**
 * MODE_FT_SECURITY — End-to-End Controller, V8 Hard Gate & Schedule 3 Parity Suite
 *
 * Grounded in ICC Sydney Enterprise Agreement 2025 — Schedule 3 (Security
 * Arrangements, pp. 69–75) & Schedule 2 §2 (Annualised Wage Rates, p. 68):
 *   - Sch 3 §1.1: Schedule 3 prevails over the general Agreement to the extent of inconsistency
 *   - Sch 3 §3.1(a),(d): 8-week (56-day) even-time cycle averaging 42h/week
 *     (38h ordinary + 4h reasonable additional = 336h / 20,160 paid min per cycle)
 *   - Sch 3 §3.1(b): Even-time roster exempts FT Security from cl 35.1(e) paired RDOs
 *   - Sch 3 §3.1(c) & cl 40.1: Rotating day/night 12h shifts with >= 10h rest gap
 *   - Sch 3 §3.2(a): 30-minute meal break is PAID and counts as time worked
 *     (`unpaid_break_minutes === 0`, meal break cap `30m`, `paid_mins === gross_mins`)
 *   - Sch 3 §4.1(b) & Sch 2 §2: All-in annualised hourly rate ($32.20..$39.48 EA_2025;
 *     $33.84..$41.49 EA_2026 from 6 Jul 2026) absorbs Sat/Sun/PH (cl 41) & night (cl 43)
 *   - Sch 3 §5.2–5.3: Part-Time & Casual Event Security are EXCLUDED from FT_SECURITY
 *   - Casual Fairness Module: strictly disabled in FT_SECURITY
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
    FT_SECURITY_WEEKLY_CONTRACT_MINUTES,
    baselineWeeklyContractMinutes,
    isFtSecurityEmployee,
    isFtSecurityShift,
    shiftNetMinutes,
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

function secFtEmp(id: string, over: Partial<EmployeeMeta> = {}): EmployeeMeta {
    return {
        id,
        name: `FT Security ${id}`,
        contract_type: 'FT',
        employment_status: 'Full-Time',
        contracted_weekly_hours: 42,
        contracted_role_ids: ['role-sec-l3'],
        ...over,
    };
}

function secFtShift(id: string, date: string, over: Partial<ShiftMeta> = {}): ShiftMeta {
    // Canonical Sch 3 §3.1(a) / §3.2(a): 06:00–18:00 (720m paid, 30m paid meal break, 2×15m rest pauses)
    return {
        id,
        shift_date: date,
        start_time: '06:00',
        end_time: '18:00',
        unpaid_break_minutes: 0,
        paid_break_minutes: 30,
        role_id: 'role-sec-l3',
        roleName: 'Security Officer (L3)',
        target_employment_type: 'FT',
        target_requires_flexible: false,
        demand_source: 'baseline',
        level: 3,
        ...over,
    };
}

describe('FT_SECURITY Layer 1 predicates & 42h/wk contract baseline', () => {
    it('returns 2520m (42h/wk, Sch 3 §3.1(d)) for FT Security and preserves 2280m (38h/wk) for Standard FT', () => {
        expect(FT_SECURITY_WEEKLY_CONTRACT_MINUTES).toBe(2520);
        expect(baselineWeeklyContractMinutes('FT')).toBe(2280);
        expect(baselineWeeklyContractMinutes('FT', { isSecurityRole: false })).toBe(2280);
        expect(baselineWeeklyContractMinutes('FT', { isSecurityRole: true })).toBe(2520);
        expect(baselineWeeklyContractMinutes('PT', { isSecurityRole: true })).toBe(1200);
        expect(baselineWeeklyContractMinutes('CASUAL', { isSecurityRole: true })).toBe(0);
        // Sch 3 §3.2(a): paid meal break -> full clock span counts as paid minutes
        expect(shiftNetMinutes({ start_time: '06:00', end_time: '18:00', unpaid_break_minutes: 30 }, true)).toBe(720);
    });

    it('accepts only Full-Time Security shifts in isFtSecurityShift', () => {
        expect(isFtSecurityShift(secFtShift('s1', '2027-05-10'))).toBe(true);
        expect(isFtSecurityShift(secFtShift('s2', '2027-05-10', { target_employment_type: null }))).toBe(true);
        expect(isFtSecurityShift(secFtShift('s3', '2027-05-10', { roleName: 'Customer Service Attendant (L2)' }))).toBe(false);
        expect(isFtSecurityShift(secFtShift('s4', '2027-05-10', { target_employment_type: 'PT' }))).toBe(false);
        expect(isFtSecurityShift(secFtShift('s5', '2027-05-10', { target_employment_type: 'Casual' }))).toBe(false);
        expect(isFtSecurityShift(secFtShift('s6', '2027-05-10', { target_requires_flexible: true }))).toBe(false);
    });

    it('accepts only Full-Time Security employees in isFtSecurityEmployee (excluding Standard FT, PT Security, Casual Security)', () => {
        expect(isFtSecurityEmployee(secFtEmp('sec1'), { isSecurityRole: true })).toBe(true);
        expect(isFtSecurityEmployee(secFtEmp('std1'), { isSecurityRole: false })).toBe(false);
        expect(isFtSecurityEmployee(secFtEmp('std2'))).toBe(false);
        expect(isFtSecurityEmployee(secFtEmp('flex1', { is_flexible: true }), { isSecurityRole: true })).toBe(false);
        // Sch 3 §5.2 Part-Time Event Security & §5.3 Casual Event Security excluded
        expect(isFtSecurityEmployee({
            id: 'pt-sec', name: 'PT Sec', contract_type: 'PT', employment_status: 'Part-Time',
        }, { isSecurityRole: true })).toBe(false);
        expect(isFtSecurityEmployee({
            id: 'cas-sec', name: 'Cas Sec', contract_type: 'CASUAL', employment_status: 'Casual',
        }, { isSecurityRole: true })).toBe(false);
    });
});

describe('AutoSchedulerController.run({ mode: "FT_SECURITY" })', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2027-05-01T00:00:00Z'));
        mockContractDetails.mockResolvedValue(new Map());
        mockExistingRoster.mockResolvedValue(new Map());
        mockApprovedLeave.mockResolvedValue(new Map());
        mockCycles.mockResolvedValue(new Map());
        mockOptimize.mockResolvedValue({
            status: 'OPTIMAL',
            assignments: [],
            unassigned_shift_ids: [],
            solve_time_ms: 10,
            objective_value: 0,
            metrics: {},
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('isolates FT Security shifts & staff (including DB-resolved Security FT, excluding Standard FT & Event Security PT/Casual), skips Casual Fairness Ledger, and wires 42h/wk + Sch 2 §2 annualised rate', async () => {
        // `sec-db-only` has no Security role in contracted_role_ids initially,
        // proving `candidateEmployees` preserves FT candidates until DB `user_contracts` resolves `is_security_role`!
        mockContractDetails.mockResolvedValue(new Map([
            ['sec-ft-1', { is_security_role: true, level: 3 }],
            ['sec-db-only', { is_security_role: true, level: 4 }],
            ['std-ft', { is_security_role: false, level: 3 }],
            ['pt-sec', { is_security_role: true, level: 3 }],
            ['cas-sec', { is_security_role: true, level: 3 }],
        ]));

        // 7-day window (2027-05-03 .. 2027-05-09 -> weekScale = 1.0) with 7 x 12h shifts = 5040m demand
        const shifts: ShiftMeta[] = [
            secFtShift('d1', '2027-05-03'),
            secFtShift('d2', '2027-05-04'),
            secFtShift('d3', '2027-05-05'),
            secFtShift('d4', '2027-05-06'),
            secFtShift('d5', '2027-05-07'),
            secFtShift('d6', '2027-05-08'),
            secFtShift('d7', '2027-05-09'),
            // Partitioned out: Standard FT, PT Security (§5.2), Casual Security (§5.3)
            secFtShift('std-ft-shift', '2027-05-03', { role_id: 'role-ush', roleName: 'Customer Service Attendant (L2)' }),
            secFtShift('pt-sec-shift', '2027-05-04', { target_employment_type: 'PT' }),
            secFtShift('cas-sec-shift', '2027-05-05', { target_employment_type: 'Casual' }),
        ];

        const employees: EmployeeMeta[] = [
            secFtEmp('sec-ft-1', { contracted_weekly_hours: 38 }), // stale 38 on profile — baseline must still give 2520m (42h)
            secFtEmp('sec-db-only', { contracted_role_ids: ['role-generic'] }),
            secFtEmp('std-ft', { contracted_role_ids: ['role-ush'] }),
            { id: 'pt-sec', name: 'PT Event Security', contract_type: 'PT', employment_status: 'Part-Time', contracted_role_ids: ['role-sec-l3'] },
            { id: 'cas-sec', name: 'Casual Event Security', contract_type: 'CASUAL', employment_status: 'Casual', contracted_role_ids: ['role-sec-l3'] },
        ];

        mockOptimize.mockResolvedValueOnce({
            status: 'OPTIMAL',
            assignments: [
                { shift_id: 'd1', employee_id: 'sec-ft-1', cost: 406.08 },
                { shift_id: 'd2', employee_id: 'sec-ft-1', cost: 406.08 },
                { shift_id: 'd3', employee_id: 'sec-ft-1', cost: 406.08 },
                { shift_id: 'd4', employee_id: 'sec-ft-1', cost: 406.08 },
            ],
            unassigned_shift_ids: ['d5', 'd6', 'd7'],
            solve_time_ms: 14,
            objective_value: 0,
            metrics: {},
        });

        const result = await new AutoSchedulerController().run({
            shifts,
            employees,
            mode: 'FT_SECURITY',
            organizationId: 'org-icc',
        });

        expect(mockReadLedger).not.toHaveBeenCalled();
        expect(result.fairnessLedger).toEqual({
            applied: false,
            reason: 'not_applicable',
            employeesWithDebts: 0,
            windowEnd: null,
            ageDays: null,
        });
        expect(result.mode).toBe('FT_SECURITY');

        expect(mockOptimize).toHaveBeenCalledTimes(1);
        const req = mockOptimize.mock.calls[0][0];
        expect(req.constraints.scheduler_mode).toBe('FT_SECURITY');
        expect(req.shifts.map((s: { id: string }) => s.id)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']);
        expect(req.employees.map((e: { id: string }) => e.id)).toEqual(['sec-ft-1', 'sec-db-only']);

        // EA_2026 (from 6 Jul 2026) Sch 2 §2 annualised FT Security hourly rates: L3 = $33.84, L4 = $36.39
        const empL3 = req.employees.find((e: { id: string }) => e.id === 'sec-ft-1');
        const empL4 = req.employees.find((e: { id: string }) => e.id === 'sec-db-only');
        expect(empL3.hourly_rate).toBe(33.84);
        expect(empL4.hourly_rate).toBe(36.39);

        // Sch 3 §3.1(d) 42h/wk = 2,520m on 1-week window (demand = 5,040m, fairShareCap = 3,024m >= 2,520m)
        expect(empL3.min_contract_minutes).toBe(2520);
        expect(empL3.max_weekly_minutes).toBe(2520);
        expect(result.passing).toBe(4);
    });

    it('throws a clear mode-specific error when no Full-Time Security shifts exist in the batch', async () => {
        const nonFtSecurityShifts: ShiftMeta[] = [
            secFtShift('std-ft', '2027-05-03', { roleName: 'Customer Service Attendant (L2)' }),
            secFtShift('cas-sec', '2027-05-04', { target_employment_type: 'Casual' }),
        ];

        await expect(
            new AutoSchedulerController().run({
                shifts: nonFtSecurityShifts,
                employees: [secFtEmp('sec-1')],
                mode: 'FT_SECURITY',
            }),
        ).rejects.toThrow(/No Full-Time Security shifts to schedule/i);
        expect(mockOptimize).not.toHaveBeenCalled();
    });

    it('passes real V8 validation on 14×12h = 168h over 4 weeks (Sch 3 §3.1 8-week cycle) and blocks a 29th 12h shift (348h > 336h) in the same 8-week cycle', async () => {
        // Anchor 2024-01-01 + 22 * 56 days = 2027-05-17 (exact 8-week cycle start in future > 2027-05-01)
        const anchor = '2024-01-01';
        const cycleStart = addDaysISO(anchor, 22 * 56); // 2027-05-17
        mockContractDetails.mockResolvedValue(new Map([
            ['sec-ft', { is_security_role: true, level: 3 }],
        ]));
        // Even if the general cycle table carried 4 weeks, `is_security_role: true`
        // forces Schedule 3 §3.1's fixed 8-week (336h) cycle (`Sch 3 §1.1`).
        mockCycles.mockResolvedValue(new Map([
            ['sec-ft', { ordinary_hours_cycle_weeks: 4, ordinary_hours_cycle_anchor: anchor }],
        ]));

        // Part A: 14 x 12h = 168h in 4 weeks (4-on / 4-off pattern) -> LAWFUL in FT_SECURITY (Standard FT would fail >152h)
        const offsets4w = [0, 1, 2, 3, 8, 9, 10, 11, 16, 17, 18, 19, 24, 27]; // 28-day span (0..27 -> weekScale = 4.0)
        const shifts4w = offsets4w.map(d => secFtShift(`w1_${d}`, addDaysISO(cycleStart, d)));

        mockOptimize.mockResolvedValueOnce({
            status: 'OPTIMAL',
            assignments: shifts4w.map(s => ({ shift_id: s.id, employee_id: 'sec-ft', cost: 406.08 })),
            unassigned_shift_ids: [],
            solve_time_ms: 12,
            objective_value: 0,
            metrics: {},
        });

        const res4w = await new AutoSchedulerController().run({
            shifts: shifts4w,
            employees: [secFtEmp('sec-ft')],
            mode: 'FT_SECURITY',
        });
        expect(res4w.passing).toBe(14);
        expect(res4w.uncoveredV8ShiftIds).toEqual([]);
        expect(res4w.capacityCheck?.sufficient).toBe(true);
        // 14 x 720m = 10,080m paid / (4 * 2520m = 10,080m obligation) = 100% utilization
        expect(res4w.proposals[0].utilization).toBe(100);

        // Part B: Seed those 14 x 12h (168h) shifts as existingRoster in weeks 1-4,
        // then propose 15 x 12h (180h) shifts in weeks 5-8 of the SAME 56-day cycle (total = 348h > 336h).
        mockExistingRoster.mockResolvedValueOnce(new Map([
            ['sec-ft', shifts4w.map(s => ({
                id: s.id,
                shift_date: s.shift_date,
                start_time: s.start_time,
                end_time: s.end_time,
                duration_minutes: 720,
                unpaid_break_minutes: 0,
                paid_break_minutes: 30,
            }))],
        ]));

        const offsetsWeeks5to8 = [28, 29, 30, 31, 35, 36, 37, 38, 42, 43, 44, 45, 49, 50, 51];
        const shiftsWeeks5to8 = offsetsWeeks5to8.map(d => secFtShift(`w2_${d}`, addDaysISO(cycleStart, d)));

        // Suppose solver proposed all 15 (348h) and repair couldn't re-home the 15th
        mockOptimize
            .mockResolvedValueOnce({
                status: 'OPTIMAL',
                assignments: shiftsWeeks5to8.map(s => ({ shift_id: s.id, employee_id: 'sec-ft', cost: 406.08 })),
                unassigned_shift_ids: [],
                solve_time_ms: 12,
                objective_value: 0,
                metrics: {},
            })
            .mockResolvedValueOnce({
                status: 'OPTIMAL',
                assignments: [],
                unassigned_shift_ids: [shiftsWeeks5to8[14].id],
                solve_time_ms: 5,
                objective_value: 0,
                metrics: {},
            });

        const res8w = await new AutoSchedulerController().run({
            shifts: shiftsWeeks5to8,
            employees: [secFtEmp('sec-ft')],
            mode: 'FT_SECURITY',
        });
        expect(res8w.passing).toBe(14);
        expect(res8w.uncoveredV8ShiftIds).toContain(shiftsWeeks5to8[14].id);
    });

    it('enforces paid-span 7.6h..12.0h bounds, strict 1-shift/day, and flat Sch 2 §2 annualised Sunday/Night pricing in greedyFallback', async () => {
        mockContractDetails.mockResolvedValue(new Map([
            ['sec-ft', { is_security_role: true, level: 3 }],
        ]));
        mockOptimize.mockResolvedValueOnce({
            status: 'INFEASIBLE',
            assignments: [],
            unassigned_shift_ids: ['short-paid', 'long-paid-with-fake-unpaid', 'sun-night-ok', 'sun-second-same-day'],
            solve_time_ms: 4,
            objective_value: 0,
            metrics: {},
        });

        const shifts: ShiftMeta[] = [
            // 7.5h paid (450m < 456m) -> rejected
            secFtShift('short-paid', '2027-05-03', { start_time: '09:00', end_time: '16:30' }),
            // 12.5h gross (750m > 720m) EVEN IF unpaid_break_minutes=30 was passed -> rejected in FT_SECURITY!
            secFtShift('long-paid-with-fake-unpaid', '2027-05-04', {
                start_time: '06:00', end_time: '18:30', unpaid_break_minutes: 30,
            }),
            // Sunday 2027-05-09 18:00–06:00 (12h night shift on a Sunday!) -> valid, 1st shift on Sunday
            secFtShift('sun-night-ok', '2027-05-09', { start_time: '18:00', end_time: '06:00' }),
            // Second shift starting on 2027-05-09 -> blocked by 1-shift/day
            secFtShift('sun-second-same-day', '2027-05-09', { start_time: '06:00', end_time: '14:00' }),
        ];

        const result = await new AutoSchedulerController().run({
            shifts,
            employees: [secFtEmp('sec-ft')],
            mode: 'FT_SECURITY',
        });

        expect(result.usedFallback).toBe(true);
        expect(result.passing).toBe(1);
        expect(result.proposals.map(p => p.shiftId)).toEqual(['sun-night-ok']);
        expect(result.uncoveredV8ShiftIds).toEqual(
            expect.arrayContaining(['short-paid', 'long-paid-with-fake-unpaid', 'sun-second-same-day']),
        );
        // Sch 3 §4.1(b) / Sch 2 §2: Sunday 12h night shift costs flat 12 * $33.84 = $406.08 (no 1.5x Sunday or night loading!)
        expect(result.proposals[0].optimizerCost).toBeCloseTo(12 * 33.84, 2);
    });
});

describe('CP-SAT ↔ ShiftShape ↔ V8 Engine Parity for Schedule 3 FT Security', () => {
    const secFtV8Employee: V8Employee = {
        id: 'sec-ft-v8',
        name: 'FT Security Officer',
        contract_type: 'FULL_TIME',
        contracted_weekly_hours: 42,
        ordinary_hours_cycle_anchor: '2024-01-01',
        employment_statuses: ['Full-Time'],
        is_security_role: true,
    };

    it('passes evaluateShiftShape (0 blocking hits) and v8Engine (0 hits, incl. no V8_FT_DAYS_OFF) on an even-time 14×12h (168h) 4-week Security roster', () => {
        const cycleStart = addDaysISO('2024-01-01', 22 * 56); // 2027-05-17
        const evenTimeOffsets = [0, 1, 2, 3, 8, 9, 10, 11, 16, 17, 18, 19, 24, 25];
        const v8Shifts: V8Shift[] = [];

        for (const d of evenTimeOffsets) {
            const isoDate = addDaysISO(cycleStart, d);
            const shape = evaluateShiftShape({
                shift_date: isoDate,
                start_time: '06:00',
                end_time: '18:00',
                break_start: '10:30',
                break_end: '11:00',
                unpaid_break_minutes: 0,
                paid_break_minutes: 30,
                target_employment_type: 'FT',
                is_security: true,
            });
            expect(shape.passed).toBe(true);
            expect(shape.blocking).toBe(false);

            v8Shifts.push({
                id: `sec-${isoDate}`,
                date: isoDate,
                shift_date: isoDate,
                start_time: '06:00',
                end_time: '18:00',
                break_start: '10:30',
                break_end: '11:00',
                unpaid_break_minutes: 0,
                paid_break_minutes: 30,
                target_employment_type: 'FT',
                is_candidate: true,
            });
        }

        const v8 = v8Engine.evaluate(secFtV8Employee, v8Shifts, addDaysISO(cycleStart, 27));
        expect(v8.passed).toBe(true);
        expect(v8.hits.filter(h => h.blocking)).toEqual([]);
        // Sch 3 §3.1(b) exempts FT Security from cl 35.1(e) paired RDOs, and 168h <= 336h cycle cap:
        expect(v8.hits.map(h => h.rule_id)).not.toContain('V8_FT_DAYS_OFF');
        expect(v8.hits.map(h => h.rule_id)).not.toContain('V8_ORD_HOURS_AVG');
        // Only the non-blocking short-window peak advisory (4x12h = 48h > 42h in 7d) is noted:
        expect(v8.hits.every(h => h.rule_id === 'V8_ORD_HOURS_PEAK' && !h.blocking)).toBe(true);
    });

    it('blocks unpaid meal breaks (SHAPE_SECURITY_PAID_BREAK) and >30m meal breaks (SHAPE_MEAL_BREAK_CEILING) on Security shifts (Sch 3 §3.2(a))', () => {
        const unpaidBreakHit = evaluateShiftShape({
            shift_date: '2027-05-17',
            start_time: '06:00',
            end_time: '18:00',
            break_start: '11:00',
            break_end: '11:30',
            unpaid_break_minutes: 30,
            paid_break_minutes: 30,
            target_employment_type: 'FT',
            is_security: true,
        });
        expect(unpaidBreakHit.blocking).toBe(true);
        expect(unpaidBreakHit.hits.map(h => h.rule_id)).toContain('SHAPE_SECURITY_PAID_BREAK');

        const overCeilingHit = evaluateShiftShape({
            shift_date: '2027-05-17',
            start_time: '06:00',
            end_time: '18:00',
            break_start: '11:00',
            break_end: '11:45', // 45m > 30m Sch 3 §3.2(a) ceiling
            unpaid_break_minutes: 0,
            paid_break_minutes: 30,
            target_employment_type: 'FT',
            is_security: true,
        });
        expect(overCeilingHit.blocking).toBe(true);
        expect(overCeilingHit.hits.map(h => h.rule_id)).toContain('SHAPE_MEAL_BREAK_CEILING');
    });

    it('counts full paid clock minutes in V8 maxDailyHoursRule & studentVisaRule for Security even if a legacy shift carries unpaid_break_minutes', () => {
        // 06:00–18:30 (750m gross) with legacy `unpaid_break_minutes: 30` -> MUST still block V8_MAX_DAILY_HOURS for Security!
        const overDailyShift: V8Shift = {
            id: 'legacy-750',
            date: '2027-05-17',
            shift_date: '2027-05-17',
            start_time: '06:00',
            end_time: '18:30',
            unpaid_break_minutes: 30,
            paid_break_minutes: 30,
            target_employment_type: 'FT',
            is_candidate: true,
        };
        const dailyEval = v8Engine.evaluate(secFtV8Employee, [overDailyShift], '2027-05-17');
        expect(dailyEval.hits.map(h => h.rule_id)).toContain('V8_MAX_DAILY_HOURS');

        // Student visa Security officer: 4 x 12h + 1 x 1h? Or 5 x 10h (3,000 paid min > 2,880m) with legacy unpaid_break_minutes=30
        const studentSec: V8Employee = { ...secFtV8Employee, is_student_visa: true };
        const fiveTenHourShifts: V8Shift[] = [0, 2, 4, 6, 8].map(d => {
            const iso = addDaysISO('2027-05-17', d);
            return {
                id: `stu-${iso}`,
                date: iso,
                shift_date: iso,
                start_time: '08:00',
                end_time: '18:00', // 600m paid (5 x 600 = 3000m > 2880m; if 30m break were deducted, 5 x 570 = 2850m would falsely pass!)
                unpaid_break_minutes: 30,
                paid_break_minutes: 30,
                target_employment_type: 'FT',
                is_candidate: true,
            };
        });
        const visaEval = v8Engine.evaluate(studentSec, fiveTenHourShifts, '2027-05-26');
        expect(visaEval.hits.map(h => h.rule_id)).toContain('V8_STUDENT_VISA_LIMIT');
    });
});
