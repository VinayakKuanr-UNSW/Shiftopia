import { describe, it, expect } from 'vitest';
import { resolvePaymentMinEngagementMinutes } from '../../projections/utils/cost/min-engagement-floor';

describe('resolvePaymentMinEngagementMinutes', () => {
  it('returns null (no floor) for Full-Time, regardless of day type or training', () => {
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Full-Time' })).toBeNull();
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Full-Time', isSunday: true, isTraining: true })).toBeNull();
  });

  it('training wins over every other tier for a non-Full-Time employee', () => {
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Casual', isTraining: true, isSunday: true })).toBe(120);
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Casual', isTraining: true, isPublicHoliday: true })).toBe(120);
  });

  it('multi-hire floors at 2h ONLY when it starts within 1h of the usual finish (cl 13.1(e))', () => {
    // Audit fix (2026-08-02): the precondition was previously unchecked, so
    // every multi-hire engagement got the reduced floor unconditionally.
    expect(resolvePaymentMinEngagementMinutes({
      employmentType: 'Casual', isMultiHire: true, multiHireStartsWithinUsualFinishWindow: true,
    })).toBe(120);
    // Precondition absent/false -> falls through to the STANDARD 3h floor, not 2h.
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Casual', isMultiHire: true })).toBe(180);
    expect(resolvePaymentMinEngagementMinutes({
      employmentType: 'Casual', isMultiHire: true, multiHireStartsWithinUsualFinishWindow: false,
    })).toBe(180);
    // Security is never eligible for the general-award multi-hire floor, precondition or not.
    expect(resolvePaymentMinEngagementMinutes({
      employmentType: 'Casual', isSecurityRole: true, isMultiHire: true, multiHireStartsWithinUsualFinishWindow: true,
    })).toBe(180);
  });

  it('general award: plain Part-Time has no Sunday exception (flat 3h); Flexible/Casual get 4h', () => {
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Part-Time', isSunday: true })).toBe(180);
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Flexible Part-Time', isSunday: true })).toBe(240);
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Casual', isSunday: true })).toBe(240);
  });

  it('public holiday floors at 4h for EVERYONE, unlike Sunday (cl 56.2 is a separate, unqualified rule)', () => {
    // cl 56.2 ("A Team Member working on a public holiday...") has no
    // employment-type carve-out at all, unlike the Sunday exception (which
    // comes from cl 12.4(c)/12.5(c)'s own employment-type-scoped wording) —
    // so plain Part-Time still gets 4h on a PH even though it does NOT on a
    // Sunday. This is intentionally asymmetric, not a bug.
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Part-Time', isPublicHoliday: true })).toBe(240);
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Flexible Part-Time', isPublicHoliday: true })).toBe(240);
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Casual', isPublicHoliday: true })).toBe(240);
  });

  it('security: only Casual gets the Sunday exception; Part-Time (incl. Flexible) does not — but PH still floors at 4h for all (cl 56.2)', () => {
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Part-Time', isSecurityRole: true, isSunday: true })).toBe(180);
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Flexible Part-Time', isSecurityRole: true, isSunday: true })).toBe(180);
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Casual', isSecurityRole: true, isSunday: true })).toBe(240);
    // cl 56.2 applies "in conjunction with" Schedule 3 too — unconditional for PH.
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Part-Time', isSecurityRole: true, isPublicHoliday: true })).toBe(240);
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Casual', isSecurityRole: true, isPublicHoliday: true })).toBe(240);
  });

  it('defaults to the standard 3h floor on a normal weekday', () => {
    expect(resolvePaymentMinEngagementMinutes({ employmentType: 'Casual' })).toBe(180);
  });
});
