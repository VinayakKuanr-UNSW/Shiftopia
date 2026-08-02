import { describe, it, expect } from 'vitest';
import {
  LEAVE_POLICIES,
  projectBalance,
  isCertificateRequired,
  computeCertificateAdjacency,
} from '../domain/leave-policy';
import type { LeaveBalance, LeaveRequest } from '../model/leave.types';

describe('leave policy domain', () => {
  it('defines correct accrual rates for NES mandates', () => {
    expect(LEAVE_POLICIES.annual.accrualRateHoursPerYear).toBe(152); // 4 weeks
    expect(LEAVE_POLICIES.personal.accrualRateHoursPerYear).toBe(76); // 10 days
    expect(LEAVE_POLICIES.fdv.accrualRateHoursPerYear).toBe(76);
  });

  it('defines correct caps', () => {
    expect(LEAVE_POLICIES.annual.maxBalanceHours).toBeNull();
    expect(LEAVE_POLICIES.personal.maxBalanceHours).toBeNull();
    expect(LEAVE_POLICIES.fdv.maxBalanceHours).toBe(76);
  });
});

describe('projectBalance', () => {
  const baseBal: LeaveBalance = {
    id: 'b1',
    employeeId: 'e1',
    leaveType: 'annual',
    balanceHours: 100,
    accruedHours: 100,
    usedHours: 0,
    asOfDate: '2026-01-01',
  };

  it('projects forward correctly with no requests', () => {
    // 365 days later = 1 full year = 152 hours accrued
    const proj = projectBalance(baseBal, [], '2027-01-01', '2020-01-01');
    expect(proj).toBeCloseTo(252, 1);
  });

  it('deducts only pending requests in the projection window', () => {
    const reqs: LeaveRequest[] = [
      {
        id: 'r1', employeeId: 'e1', leaveType: 'annual', status: 'approved',
        startDate: '2026-06-01', endDate: '2026-06-05', requestedHours: 38,
        reason: null, certificateUrl: null, approvedBy: null, approvalDate: null,
        createdAt: '', updatedAt: null, rejectionReason: null,
      },
      {
        id: 'r2', employeeId: 'e1', leaveType: 'annual', status: 'pending',
        startDate: '2026-08-01', endDate: '2026-08-02', requestedHours: 15.2,
        reason: null, certificateUrl: null, approvedBy: null, approvalDate: null,
        createdAt: '', updatedAt: null, rejectionReason: null,
      },
      {
        id: 'r3', employeeId: 'e1', leaveType: 'annual', status: 'rejected', // should be ignored
        startDate: '2026-07-01', endDate: '2026-07-01', requestedHours: 7.6,
        reason: null, certificateUrl: null, approvedBy: null, approvalDate: null,
        createdAt: '', updatedAt: null, rejectionReason: null,
      },
    ];

    const proj = projectBalance(baseBal, reqs, '2027-01-01', '2020-01-01');
    // 252 expected - 15.2 (pending only) = 236.8
    expect(proj).toBeCloseTo(236.8, 1);
  });

  it('applies max balance caps', () => {
    const fdvBal: LeaveBalance = { ...baseBal, leaveType: 'fdv', balanceHours: 70 };
    // FDV cap is 76 but it's upfront, so it shouldn't accrue further than current balance.
    const proj = projectBalance(fdvBal, [], '2027-01-01', '2020-01-01');
    expect(proj).toBe(70);
  });

  it('does not accrue for per-occasion or one-off types', () => {
    const parentalBal: LeaveBalance = { ...baseBal, leaveType: 'parental', balanceHours: 380 };
    const proj = projectBalance(parentalBal, [], '2027-01-01', '2020-01-01');
    expect(proj).toBe(380);
  });
});

describe('isCertificateRequired', () => {
  it('requires cert for personal leave > 2 days', () => {
    expect(isCertificateRequired('personal', 1)).toBe(false);
    expect(isCertificateRequired('personal', 2)).toBe(false);
    expect(isCertificateRequired('personal', 3)).toBe(true);
  });

  it('always requires cert for jury duty', () => {
    expect(isCertificateRequired('jury_duty', 1)).toBe(true);
  });

  it('never requires cert for annual leave', () => {
    expect(isCertificateRequired('annual', 10)).toBe(false);
  });

  // Audit M-12: a single day adjacent to a weekend/PH is treated like exceeding
  // the day-count threshold — the classic "long weekend" pattern.
  it('requires cert for a single personal-leave day adjacent to a weekend, even under the day-count threshold', () => {
    expect(isCertificateRequired('personal', 1, { adjacentToWeekend: true })).toBe(true);
  });

  it('requires cert for a single personal-leave day adjacent to a public holiday', () => {
    expect(isCertificateRequired('personal', 1, { adjacentToPublicHoliday: true })).toBe(true);
  });

  it('does not require cert when there is no adjacency and the day-count is under threshold', () => {
    expect(isCertificateRequired('personal', 1, {})).toBe(false);
  });

  it('is backward compatible: omitting adjacency behaves exactly as before', () => {
    expect(isCertificateRequired('personal', 1)).toBe(false);
    expect(isCertificateRequired('personal', 3)).toBe(true);
  });
});

describe('computeCertificateAdjacency', () => {
  it('flags a single Friday as adjacent to the following weekend', () => {
    const adj = computeCertificateAdjacency('2026-07-31', '2026-07-31'); // Friday
    expect(adj.adjacentToWeekend).toBe(true);
  });

  it('flags a single Monday as adjacent to the preceding weekend', () => {
    const adj = computeCertificateAdjacency('2026-08-03', '2026-08-03'); // Monday
    expect(adj.adjacentToWeekend).toBe(true);
  });

  it('does not flag a mid-week day with no adjacent weekend', () => {
    const adj = computeCertificateAdjacency('2026-07-29', '2026-07-29'); // Wednesday
    expect(adj.adjacentToWeekend).toBe(false);
  });

  it('flags adjacency to New Year\'s Day (a certain public holiday)', () => {
    const adj = computeCertificateAdjacency('2025-12-31', '2025-12-31');
    expect(adj.adjacentToPublicHoliday).toBe(true);
  });

  it('handles malformed dates without throwing', () => {
    expect(computeCertificateAdjacency('not-a-date', 'also-not-a-date')).toEqual({});
  });
});
