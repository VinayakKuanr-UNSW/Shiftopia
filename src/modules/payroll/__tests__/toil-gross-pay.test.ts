/**
 * Time off in lieu in Gross Pay — taken (leave_type 'toil') and paid out
 * (ledger payouts). Salaried contracts earn TOIL instead of overtime pay, so:
 *   • taking it costs nothing extra — it is paid within the salary;
 *   • paying it out is an extra line at the salary's hourly equivalent;
 *   • a payout never opens a period salary line on its own (a termination
 *     payout lands after the person has stopped working).
 */
import { describe, expect, it } from 'vitest';
import { computeShiftGrossPay, type GrossPayShiftInput } from '../domain/computeShiftGrossPay';
import { computeEmployeePeriodGrossPay } from '../domain/aggregatePeriodGrossPay';
import { leaveTypeToFlags, pickLeaveContracts, toilLeaveDayMinutes } from '../data/leaveGrossPay';
import { payoutInputFromEntry } from '../data/toilGrossPay';

const SALARY = 95000;
const HOURLY = SALARY / 52 / 38; // 48.0769…
const EMP = 'emp-toil';
const bounds = { periodStart: '2026-07-06', periodEnd: '2026-07-12' };

const salaried = (over: Partial<GrossPayShiftInput>): GrossPayShiftInput => ({
    shiftId: 's', employeeId: EMP, shiftDate: '2026-07-06', netMinutes: 456,
    payBasis: 'salary', annualSalary: SALARY, contractedWeeklyHours: 38, rate: HOURLY,
    ...over,
});

describe('TOIL taken', () => {
    it('maps leave_type "toil" to its own flag', () => {
        expect(leaveTypeToFlags('toil')).toEqual({ isToilLeave: true });
        expect(leaveTypeToFlags('Time in lieu')).toEqual({ isToilLeave: true });
    });

    it('is a "Time in lieu taken" line at the salary hourly equivalent', () => {
        const r = computeShiftGrossPay(salaried({ shiftId: 'leave:t:2026-07-06', netMinutes: 120, isToilLeave: true }));
        expect(r.isLeave).toBe(true);
        expect(r.lines).toEqual([{ code: 'toil_taken', description: 'Time in lieu taken', hours: 2, amount: 96.15 }]);
    });

    it('costs nothing extra in the period — the salary already pays it', () => {
        const worked = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'].map((d, i) => salaried({
            shiftId: `w${i}`, shiftDate: d, startTime: '09:00', endTime: '17:00', rate: null,
        }));
        const toilDay = salaried({ shiftId: 'leave:t:2026-07-10', shiftDate: '2026-07-10', isToilLeave: true });
        const period = computeEmployeePeriodGrossPay(EMP, [...worked, toilDay], bounds);
        expect(period.grossPay).toBe(1826.92); // one week's salary, unchanged
        expect(period.lines.map(l => l.code)).toEqual(['ordinary', 'toil_taken']);
        expect(period.lines.find(l => l.code === 'toil_taken')?.hours).toBe(7.6);
    });

    it('a contract no longer salaried prices it as a flat ordinary absence, still reported as TOIL', () => {
        const r = computeShiftGrossPay({
            shiftId: 'leave:t:2026-07-06', employeeId: EMP, shiftDate: '2026-07-06', netMinutes: 456,
            rate: null, classificationLevel: 'LEVEL_3', employmentType: 'Full-Time', isToilLeave: true,
        });
        expect(r.isLeave).toBe(true);
        expect(r.lines).toHaveLength(1);
        expect(r.lines[0].code).toBe('toil_taken');
        expect(r.lines[0].amount).toBeGreaterThan(0);
    });

    describe('spreads the request hours over its days', () => {
        it('part of one day', () => {
            expect([...toilLeaveDayMinutes('2026-07-08', '2026-07-08', 2, '2026-07-06', '2026-07-12')]).toEqual([['2026-07-08', 120]]);
        });
        it('evenly over weekdays, remainder to the earliest — the parts add up', () => {
            const m = toilLeaveDayMinutes('2026-07-08', '2026-07-10', 100 / 60, '2026-07-06', '2026-07-12');
            expect([...m.values()]).toEqual([34, 33, 33]);
        });
        it('skips weekends and public holidays when the request has weekdays', () => {
            const m = toilLeaveDayMinutes('2026-07-10', '2026-07-13', 15.2, '2026-07-06', '2026-07-19');
            expect([...m.keys()]).toEqual(['2026-07-10', '2026-07-13']);
            expect([...m.values()]).toEqual([456, 456]);
        });
        it('uses every day of a weekend-only request (TOIL on a rostered Saturday)', () => {
            expect([...toilLeaveDayMinutes('2026-07-11', '2026-07-11', 3, '2026-07-06', '2026-07-12')]).toEqual([['2026-07-11', 180]]);
        });
        it('returns only the days inside the pay period', () => {
            const m = toilLeaveDayMinutes('2026-07-09', '2026-07-14', 30.4, '2026-07-06', '2026-07-12');
            expect([...m.keys()]).toEqual(['2026-07-09', '2026-07-10']);
        });
    });
});

describe('TOIL paid out', () => {
    const entry = { id: 'p1', employee_id: EMP, entry_type: 'payout', minutes: -150, effective_date: '2026-07-08' };
    const contract = { pay_basis: 'salary', annual_salary: SALARY, contracted_weekly_hours: 38, employment_status: 'Full-Time' };

    it('builds an input priced at the salary hourly equivalent, hour for hour', () => {
        const input = payoutInputFromEntry(entry, contract);
        expect(input.isToilPayout).toBe(true);
        expect(input.netMinutes).toBe(150);
        expect(input.rate).toBeCloseTo(HOURLY, 4);
        // Never a salaried shift: it must not open a salary line of its own.
        expect(input.payBasis).toBeUndefined();
    });

    it('is a toil_payout line, not leave and not worked time', () => {
        const r = computeShiftGrossPay(payoutInputFromEntry(entry, contract));
        expect(r.isLeave).toBe(false);
        expect(r.ordinaryHours).toBe(0);
        expect(r.lines).toEqual([{ code: 'toil_payout', description: 'Time in lieu paid out (on request)', hours: 2.5, amount: 120.19 }]);
    });

    it('words expiry and termination payouts', () => {
        expect(computeShiftGrossPay(payoutInputFromEntry({ ...entry, entry_type: 'expiry_payout' }, contract)).lines[0].description)
            .toMatch(/6 months/);
        expect(computeShiftGrossPay(payoutInputFromEntry({ ...entry, entry_type: 'termination_payout' }, contract)).lines[0].description)
            .toMatch(/contract ended/);
    });

    it('is added on top of the salary in a working week', () => {
        const worked = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'].map((d, i) => salaried({
            shiftId: `w${i}`, shiftDate: d, startTime: '09:00', endTime: '17:00', rate: null,
        }));
        const period = computeEmployeePeriodGrossPay(EMP, [...worked, payoutInputFromEntry(entry, contract)], bounds);
        expect(period.grossPay).toBe(1947.11);
        expect(period.lines.map(l => l.code)).toEqual(['ordinary', 'toil_payout']);
    });

    it('alone in a period (termination) pays only the payout — no salary line appears', () => {
        const period = computeEmployeePeriodGrossPay(EMP, [payoutInputFromEntry({ ...entry, entry_type: 'termination_payout' }, contract)], bounds);
        expect(period.lines.map(l => l.code)).toEqual(['toil_payout']);
        expect(period.grossPay).toBe(120.19);
    });
});

describe('the contract leave is priced on', () => {
    it('is the permanent one when the person also holds a casual job started the same day', () => {
        const casual = { user_id: 'k', employment_status: 'Casual', start_date: '2026-10-09', end_date: null };
        const ft = { user_id: 'k', employment_status: 'Full-Time', start_date: '2026-10-09', end_date: null };
        // Either order — it used to depend on which row the database returned first.
        expect(pickLeaveContracts([casual, ft], '2026-10-12').get('k')).toBe(ft);
        expect(pickLeaveContracts([ft, casual], '2026-10-12').get('k')).toBe(ft);
    });
    it('is the latest-starting among permanents, ignoring contracts ended before the period', () => {
        const old = { user_id: 'a', employment_status: 'Part-Time', start_date: '2025-01-01', end_date: '2026-06-30' };
        const now = { user_id: 'a', employment_status: 'Full-Time', start_date: '2026-07-01', end_date: null };
        expect(pickLeaveContracts([now, old], '2026-07-06').get('a')).toBe(now);
        expect(pickLeaveContracts([old], '2026-07-06').has('a')).toBe(false);
    });
});
