import { describe, expect, it } from 'vitest';
import {
    dailyAccrualMinutes,
    describeEntry,
    fmtToil,
    isPartialDayToil,
    isToilEligibleContract,
    payoutCheck,
    rosteredSpanMinutes,
    toilApprovalCheck,
    toilPayoutHourlyRate,
    toilRequestCheck,
    weeklyTopupMinutes,
} from '../domain/toil-rules';
import type { ToilLedgerEntry, ToilPosition } from '../model/toil.types';

const position = (over: Partial<ToilPosition> = {}): ToilPosition => {
    const balance = over.balanceMinutes ?? 300;
    const held = over.heldMinutes ?? 0;
    return {
        employeeId: 'e1', eligible: true, balanceMinutes: balance, heldMinutes: held,
        availableMinutes: balance - held, earnedMinutes: balance, takenMinutes: 0, paidOutMinutes: 0,
        nextExpiry: null, hasHistory: true, ...over,
    };
};

describe('who earns TOIL — salaried class-1 contracts only', () => {
    it.each([
        ['Full-Time', 'salary', true],
        ['Part-Time', 'salary', true],
        ['Flexible Part-Time', 'salary', true],
        ['full_time', 'salary', true],
        // EBA overtime is PAID (cl 42.2 / 42.4) — never TOIL.
        ['Full-Time', 'eba_level', false],
        ['Full-Time', 'eba_security_annualised', false],
        ['Part-Time', 'eba_level', false],
        // Class 2 never earns it.
        ['Casual', 'salary', false],
        ['Casual', 'eba_level', false],
        [null, 'salary', false],
    ] as const)('%s on %s → %s', (employmentStatus, payBasis, expected) => {
        expect(isToilEligibleContract({ employmentStatus, payBasis })).toBe(expected);
    });
});

describe('daily rule — billable net over 7.6h', () => {
    it('banks nothing up to 7.6h', () => {
        expect(dailyAccrualMinutes([456])).toBe(0);
        expect(dailyAccrualMinutes([300])).toBe(0);
    });
    it('banks the excess of a long day', () => {
        expect(dailyAccrualMinutes([510])).toBe(54);
    });
    it('adds a split day together before the threshold (5h + 5h = one 10h day)', () => {
        expect(dailyAccrualMinutes([300, 300])).toBe(dailyAccrualMinutes([600]));
        expect(dailyAccrualMinutes([300, 300])).toBe(144);
    });
    it('treats an unresolved timesheet (missing punch) as no hours', () => {
        expect(dailyAccrualMinutes([600, null])).toBe(144);
    });
});

describe('weekly rule — beyond contracted hours, less the daily TOIL', () => {
    it('catches a sixth-day shift the daily rule cannot see', () => {
        // 5 × 7.6h + a 6h Saturday = 44h; no day is over 7.6h.
        expect(weeklyTopupMinutes({ workedMinutes: 2640, contractedMinutes: 2280, absenceCreditMinutes: 0, dailyAccruedMinutes: 0 })).toBe(360);
    });
    it('does not pay the same hours twice', () => {
        // 5 × 8h = 40h: the daily rule already banked 5 × 0.4h = 2h.
        expect(weeklyTopupMinutes({ workedMinutes: 2400, contractedMinutes: 2280, absenceCreditMinutes: 0, dailyAccruedMinutes: 120 })).toBe(0);
    });
    it('lowers the week by approved leave and public holidays', () => {
        // Mon–Thu on leave (30.4h); worked Fri 8h + Sat 7h = 15h against 7.6h required.
        expect(weeklyTopupMinutes({ workedMinutes: 900, contractedMinutes: 2280, absenceCreditMinutes: 1824, dailyAccruedMinutes: 24 })).toBe(420);
    });
    it('never goes below zero', () => {
        expect(weeklyTopupMinutes({ workedMinutes: 1000, contractedMinutes: 2280, absenceCreditMinutes: 0, dailyAccruedMinutes: 0 })).toBe(0);
    });
});

describe('taking TOIL — it cannot be taken before it is earned', () => {
    it('allows a request within what is available', () => {
        const c = toilRequestCheck(2, position({ balanceMinutes: 300 }));
        expect(c.blockedReason).toBeNull();
        expect(c.afterMinutes).toBe(180);
    });
    it('blocks a request past what is available (unlike annual leave, no negative balance)', () => {
        expect(toilRequestCheck(6, position({ balanceMinutes: 300 })).blockedReason).toMatch(/cannot be taken before it is earned/);
    });
    it('measures against available — other pending requests hold their hours', () => {
        expect(toilRequestCheck(4, position({ balanceMinutes: 300, heldMinutes: 120 })).blockedReason).not.toBeNull();
        expect(toilRequestCheck(3, position({ balanceMinutes: 300, heldMinutes: 120 })).blockedReason).toBeNull();
    });
    it('blocks anyone without a salaried contract', () => {
        expect(toilRequestCheck(1, position({ eligible: false })).blockedReason).toMatch(/salaried/);
        expect(toilRequestCheck(1, null).blockedReason).toMatch(/salaried/);
    });
    it('approval is measured against the balance (its own hold is released)', () => {
        const p = position({ balanceMinutes: 300, heldMinutes: 300 });
        expect(toilApprovalCheck(5, p).blockedReason).toBeNull();
        expect(toilApprovalCheck(5.5, p).blockedReason).toMatch(/cannot be approved/);
    });
});

describe('payout', () => {
    it('allows up to what is available', () => {
        expect(payoutCheck(300, position({ balanceMinutes: 300 }))).toBeNull();
        expect(payoutCheck(301, position({ balanceMinutes: 300 }))).toMatch(/Only 5h/);
    });
    it('keeps pending requests held', () => {
        expect(payoutCheck(300, position({ balanceMinutes: 300, heldMinutes: 60 }))).toMatch(/held by pending requests/);
    });
    it('rejects nothing / negative', () => {
        expect(payoutCheck(0, position())).toMatch(/Enter/);
    });
    it('prices at the salary hourly equivalent — full-time on 38h', () => {
        expect(toilPayoutHourlyRate({ payBasis: 'salary', annualSalary: 95000, employmentStatus: 'Full-Time' }))
            .toBeCloseTo(95000 / 52 / 38, 4);
    });
    it('part-time on its contracted hours', () => {
        expect(toilPayoutHourlyRate({ payBasis: 'salary', annualSalary: 50000, contractedWeeklyHours: 20, employmentStatus: 'Part-Time' }))
            .toBeCloseTo(50000 / 52 / 20, 4);
    });
    it('a contract no longer salaried falls back to its permanent level rate', () => {
        expect(toilPayoutHourlyRate({ payBasis: 'eba_level', permanentLevelRate: 30.82 })).toBe(30.82);
        expect(toilPayoutHourlyRate({ payBasis: 'eba_level' })).toBeNull();
    });
});

describe('part-day TOIL keeps the shift', () => {
    it('measures the rostered span, overnight included', () => {
        expect(rosteredSpanMinutes([{ startTime: '08:00', endTime: '16:30' }])).toBe(510);
        expect(rosteredSpanMinutes([{ startTime: '22:00', endTime: '06:00' }])).toBe(480);
        expect(rosteredSpanMinutes([{ startTime: null, endTime: '06:00' }])).toBe(0);
    });
    it('is partial when the hours are less than the rostered day', () => {
        expect(isPartialDayToil(2, 510)).toBe(true);
        expect(isPartialDayToil(8.5, 510)).toBe(false);
        expect(isPartialDayToil(2, 0)).toBe(false);
    });
});

describe('history in words', () => {
    const base: ToilLedgerEntry = {
        id: 'x', employeeId: 'e1', userContractId: 'c1', entryType: 'accrual', minutes: 54,
        effectiveDate: '2026-09-25', leaveRequestId: null, sourceTimesheetIds: [], workedMinutes: 510,
        thresholdMinutes: 456, reason: null, createdBy: null, createdAt: '2026-09-26T00:00:00Z',
    };
    it('explains a long day', () => {
        const d = describeEntry(base);
        expect(d.title).toBe('Earned — day over 7.6h');
        expect(d.detail).toContain('8.5h billable against 7.6h');
    });
    it('marks a recalculation', () => {
        expect(describeEntry({ ...base, minutes: -54, reason: 'Recalculated after a timesheet change' }).title).toBe('Day recalculated');
    });
    it('explains a weekly top-up against the reduced week', () => {
        const d = describeEntry({ ...base, entryType: 'weekly_topup', minutes: 390, workedMinutes: 900, thresholdMinutes: 456, effectiveDate: '2026-09-27' });
        expect(d.detail).toContain('15h worked against 7.6h required');
    });
    it('carries the reason on a payout or adjustment', () => {
        expect(describeEntry({ ...base, entryType: 'adjustment', minutes: 15, reason: 'Paper timesheet' }).detail).toContain('Paper timesheet');
        expect(describeEntry({ ...base, entryType: 'expiry_payout', minutes: -30 }).title).toMatch(/6 months/);
    });
    it('formats hours to two decimals', () => {
        expect(fmtToil(15)).toBe('0.25h');
        expect(fmtToil(144)).toBe('2.4h');
        expect(fmtToil(-60)).toBe('-1h');
    });
});
