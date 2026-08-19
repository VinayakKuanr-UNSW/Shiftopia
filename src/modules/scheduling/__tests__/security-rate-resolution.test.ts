/**
 * `deriveSecurityRoleIds` / `resolveSecurityAnnualisedRate` — compliance audit
 * finding (2026-08-02): the AutoScheduler's optimizer-employee rate builder
 * never consulted the Schedule 2 §2 Security annualised rate table at all,
 * pricing full-time Security Level 3-6 staff off the generic Schedule 2 §1
 * wage table instead (~15-20% understated).
 *
 * Mocking strategy mirrors auto-scheduler-commit.test.ts: these modules drag
 * in Supabase/optimizer internals at import time and must be stubbed so the
 * controller module (which the two functions under test live in) can load.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/scheduling/validation', async (importOriginal) => {
    const original = await importOriginal() as any;
    return { ...original, assignmentValidator: { simulate: vi.fn() } };
});
vi.mock('@/modules/scheduling/validation/engine/assignment-committer', async (importOriginal) => {
    const original = await importOriginal() as any;
    return { ...original, assignmentCommitter: { commitAtomic: vi.fn(), commit: vi.fn() } };
});
vi.mock('@/modules/scheduling/optimizer/optimizer.client', () => ({
    optimizerClient: { optimize: vi.fn(), healthCheck: vi.fn() },
    OptimizerError: class OptimizerError extends Error {},
}));
vi.mock('@/modules/scheduling/data/roster-fetcher', () => ({
    rosterFetcher: { fetchExistingRoster: vi.fn(), fetchAvailability: vi.fn() },
    durationMinutes: vi.fn().mockReturnValue(480),
}));
vi.mock('@/modules/scheduling/audit/auditor', () => ({
    auditor: { audit: vi.fn() },
}));

import { deriveSecurityRoleIds, resolveSecurityAnnualisedRate, mergeEmployeeDetails } from '../auto-scheduler.controller';
import { resolveRateSet } from '@/modules/rosters/domain/projections/utils/cost/rate-schedule';

describe('deriveSecurityRoleIds', () => {
  it('collects role_ids from Security-named shifts only, case-insensitively', () => {
    const ids = deriveSecurityRoleIds([
      { role_id: 'sec-1', roleName: 'Security Officer' },
      { role_id: 'sec-2', roleName: 'SECURITY TEAM LEADER' },
      { role_id: 'usher-1', roleName: 'Usher' },
      { role_id: 'no-name' },
    ]);
    expect(ids).toEqual(new Set(['sec-1', 'sec-2']));
  });

  it('returns an empty set when no shift is Security-named', () => {
    expect(deriveSecurityRoleIds([{ role_id: 'a', roleName: 'Bar Attendant' }]).size).toBe(0);
  });
});

describe('resolveSecurityAnnualisedRate', () => {
  const rateSet = resolveRateSet('2026-06-29'); // EA 2025 baseline period

  it('resolves the Schedule 2 §2 annualised rate for full-time Security Level 3-6', () => {
    expect(resolveSecurityAnnualisedRate(rateSet, { isFullTime: true, isSecurityEmployee: true, level: 4 }))
      .toBe(rateSet.security.annualisedHourly.level4);
    expect(resolveSecurityAnnualisedRate(rateSet, { isFullTime: true, isSecurityEmployee: true, level: 4 }))
      .toBeGreaterThan(rateSet.wageRates.LEVEL_4.permanent); // materially higher than the generic table
  });

  it('does not apply to Part-Time/Casual Security, even at Level 3-6', () => {
    expect(resolveSecurityAnnualisedRate(rateSet, { isFullTime: false, isSecurityEmployee: true, level: 4 })).toBeNull();
  });

  it('does not apply to a non-Security full-time employee', () => {
    expect(resolveSecurityAnnualisedRate(rateSet, { isFullTime: true, isSecurityEmployee: false, level: 4 })).toBeNull();
  });

  it('does not apply outside Level 3-6 (Security Levels 1-2 don\'t exist; use the generic table)', () => {
    expect(resolveSecurityAnnualisedRate(rateSet, { isFullTime: true, isSecurityEmployee: true, level: 2 })).toBeNull();
    expect(resolveSecurityAnnualisedRate(rateSet, { isFullTime: true, isSecurityEmployee: true, level: undefined })).toBeNull();
  });
});

describe('mergeEmployeeDetails', () => {
  it('returns contractDetails as-is when callerSupplied is undefined', () => {
    const contracts = new Map([['e1', { level: 3, is_security_role: true }]]);
    expect(mergeEmployeeDetails(contracts, undefined)).toBe(contracts);
  });

  it('returns contractDetails as-is when callerSupplied is empty', () => {
    const contracts = new Map([['e1', { level: 3 }]]);
    expect(mergeEmployeeDetails(contracts, new Map())).toBe(contracts);
  });

  it('caller-supplied fields override contract-derived fields per employee', () => {
    const contracts = new Map([['e1', { level: 3, is_security_role: false }]]);
    const caller = new Map([['e1', { level: 5 }]]);
    const merged = mergeEmployeeDetails(contracts, caller);
    // caller's level wins
    expect(merged.get('e1')!.level).toBe(5);
    // contract's is_security_role still present (not overwritten)
    expect(merged.get('e1')!.is_security_role).toBe(false);
  });

  it('unions employees from both maps', () => {
    const contracts = new Map([['e1', { level: 2 }]]);
    const caller = new Map([['e2', { level: 4 }]]);
    const merged = mergeEmployeeDetails(contracts, caller);
    expect(merged.size).toBe(2);
    expect(merged.get('e1')!.level).toBe(2);
    expect(merged.get('e2')!.level).toBe(4);
  });

  it('caller can explicitly override a contract boolean to true', () => {
    const contracts = new Map([['e1', { is_security_role: false, level: 3 }]]);
    const caller = new Map([['e1', { is_security_role: true }]]);
    const merged = mergeEmployeeDetails(contracts, caller);
    expect(merged.get('e1')!.is_security_role).toBe(true);
    // level from contract preserved
    expect(merged.get('e1')!.level).toBe(3);
  });
});
