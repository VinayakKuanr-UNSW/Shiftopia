import { describe, it, expect } from 'vitest';
import {
  LEAVE_POLICIES,
  computeCertificateAdjacency,
  certificateReasons,
} from '../domain/leave-policy';

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

describe('certificate rule — cl 45.5(b)(iii) rostered day off and (iv) other leave', () => {
    // Wed 7 Oct 2026, one day of personal leave.
    const day = '2026-10-07';

    it('flags a neighbouring ROSTERED day off on a 7-day roster, not only weekends', () => {
        // Rostered Sat–Tue and Fri–Mon; Thu 8 Oct is their day off.
        const rostered = new Set(['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06',
            '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
        const adj = computeCertificateAdjacency(day, day, { rosteredDates: rostered });
        expect(adj.adjacentToRosteredDayOff).toBe(true);
        expect(certificateReasons('personal', 1, adj)).toContain('Next to a rostered day off');
    });

    it('does not call an unpublished roster a day off', () => {
        // Nothing rostered after the leave: the future is unknown, not "off".
        const rostered = new Set(['2026-10-05', '2026-10-06']);
        expect(computeCertificateAdjacency(day, day, { rosteredDates: rostered }).adjacentToRosteredDayOff).toBe(false);
    });

    it('flags leave that runs straight on from other leave', () => {
        const adj = computeCertificateAdjacency(day, day, { otherLeave: [{ startDate: '2026-10-05', endDate: '2026-10-06' }] });
        expect(adj.adjacentToOtherLeave).toBe(true);
        expect(certificateReasons('personal', 1, adj)).toEqual(['Next to other leave']);
    });

    it('names each reason, and none for a plain mid-week day', () => {
        expect(certificateReasons('personal', 1, computeCertificateAdjacency(day, day))).toEqual([]);
        expect(certificateReasons('personal', 3, {})).toEqual(['More than 2 working days']);
        expect(certificateReasons('annual', 5, { adjacentToWeekend: true })).toEqual([]);
    });
});
