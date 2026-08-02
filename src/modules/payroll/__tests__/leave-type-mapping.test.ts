/**
 * Taxonomy bridge guard (audit F11) — the leave module writes CANONICAL
 * `LeaveTypeCode`s into `leave_requests.leave_type`; payroll maps that text to
 * award-engine flags via regex in `leaveTypeToFlags`. A new canonical code
 * without a mapping would silently price as UNPAID — this test makes that a CI
 * failure instead: every member of the `LeaveTypeCode` union must have an
 * explicit expected mapping here.
 */
import { describe, expect, it } from 'vitest';
import { LEAVE_TYPE_LABELS } from '../../leave/model/leave.types';
import type { LeaveTypeCode } from '../../leave/model/leave.types';
import { leaveTypeToFlags, paidDayCapFor, COMPASSIONATE_CAP_DAYS, type LeaveFlags } from '../data/leaveGrossPay';

/** Expected flags per canonical code. `null` = correctly NOT priced as paid leave. */
const EXPECTED: Record<LeaveTypeCode, LeaveFlags | null> = {
  annual: { isAnnualLeave: true },
  personal: { isPersonalLeave: true },
  carer: { isCarerLeave: true },
  compassionate: { isCompassionate: true },   // capped 2 days/occasion, priced as carer
  parental: { isParentalLeave: true },
  long_service: { isLongServiceLeave: true },
  jury_duty: { isJuryDuty: true },
  fdv: { isFdvLeave: true },                  // the ONLY paid-leave flag for casuals
  supporting_carer: { isSupportingCarer: true },
  community_service: null,                    // unpaid (NES ss108-112, except jury)
  unpaid: null,
  religious_cultural: { isAnnualLeave: true }, // cl 55 — "accrued paid annual leave"
  gender_affirmation: { isAnnualLeave: true }, // cl 58 — "accrued paid annual leave"
};

describe('leaveTypeToFlags × canonical LeaveTypeCode taxonomy', () => {
  const codes = Object.keys(LEAVE_TYPE_LABELS) as LeaveTypeCode[];

  it('covers every canonical code (a new code must be added to EXPECTED)', () => {
    expect(new Set(codes)).toEqual(new Set(Object.keys(EXPECTED)));
  });

  it.each(codes)('maps %s exactly as expected', (code) => {
    expect(leaveTypeToFlags(code)).toEqual(EXPECTED[code]);
  });

  it('caps compassionate at 2 paid days per occasion (cl 48)', () => {
    expect(paidDayCapFor({ isCompassionate: true })).toBe(COMPASSIONATE_CAP_DAYS);
    expect(COMPASSIONATE_CAP_DAYS).toBe(2);
  });

  it('leaves FDV uncapped by day count (10-day entitlement is balance-enforced)', () => {
    expect(paidDayCapFor({ isFdvLeave: true })).toBeNull();
  });
});
