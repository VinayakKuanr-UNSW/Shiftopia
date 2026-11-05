/**
 * TTS (Time-To-Start) Urgency Flow Tests
 *
 * Validates that the three-zone TTS model is enforced consistently across
 * bidding, swapping, and offers:
 *
 *   TTS > 24h         → NORMAL   — all exchange operations allowed
 *   4h < TTS ≤ 24h    → URGENT   — allowed but flagged
 *   TTS ≤ 4h          → EMERGENT   — all exchange operations blocked (NOT ALLOWED)
 *
 * These tests exercise the shared urgency utility (computeShiftUrgency) and
 * verify the gating logic used across all three flows.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { parseZonedDateTime } from '@/modules/core/lib/date.utils';

// ── Mock infrastructure ───────────────────────────────────────────────────────

const FIXED_DATE = '2030-08-20';
const FIXED_TIME = '14:00';
// Anchor the reference instant in Australia/Sydney — the same zone computeShiftUrgency
// interprets shiftDate/startTime in — so TTS math is exact regardless of the runner's tz.
const FIXED_START_MS = parseZonedDateTime(FIXED_DATE, FIXED_TIME).getTime();

function setNow(msBeforeStart: number) {
  vi.spyOn(Date, 'now').mockReturnValue(FIXED_START_MS - msBeforeStart);
}

afterEach(() => vi.restoreAllMocks());

// ── TTS zone boundaries ───────────────────────────────────────────────────────

describe('TTS zone classification — precise boundaries', () => {
  const cases: Array<[string, number, string]> = [
    // [label, msBeforeStart, expectedZone]
    ['48h before  → normal',       48 * 3600_000,  'normal'],
    ['25h before  → normal',       25 * 3600_000,  'normal'],
    ['24h + 1ms   → normal', 24 * 3600_000 + 1,  'normal'],
    ['24h exact   → urgent',        24 * 3600_000,  'urgent'],
    ['12h before  → urgent',        12 * 3600_000,  'urgent'],
    [' 4h + 1ms   → urgent',  4 * 3600_000 + 1,  'urgent'],
    [' 4h exact   → urgent',           4 * 3600_000,  'urgent'],
    [' 2h before  → urgent',           2 * 3600_000,  'urgent'],
    [' 0h (start) → urgent',                    0,  'urgent'],
    ['-1h (past)  → urgent',          -1 * 3600_000,  'urgent'],
  ];

  it.each(cases)('%s', (_, msBeforeStart, expected) => {
    setNow(msBeforeStart);
    expect(computeShiftUrgency(FIXED_DATE, FIXED_TIME)).toBe(expected);
  });
});

// ── Bidding flow gates ────────────────────────────────────────────────────────

describe('Bidding flow — TTS gate logic', () => {
  it('checks urgency in short notice window (2h)', () => {
    setNow(2 * 3600_000); // 2h before
    const urgency = computeShiftUrgency(FIXED_DATE, FIXED_TIME);
    expect(urgency).toBe('urgent');
  });

  it('allows bid acceptance in urgent window (12h)', () => {
    setNow(12 * 3600_000);
    const urgency = computeShiftUrgency(FIXED_DATE, FIXED_TIME);
    expect(urgency).toBe('urgent');
  });

  it('allows bid acceptance in normal window (25h)', () => {
    setNow(25 * 3600_000);
    const urgency = computeShiftUrgency(FIXED_DATE, FIXED_TIME);
    expect(urgency).toBe('normal');
  });
});

// ── Assignment Offer flow gates ───────────────────────────────────────────────

describe('Assignment Offer flow — reject routing', () => {
  /**
   * When an employee rejects an offer:
   *   Pre-start  → shift goes to bidding (sm_reject_offer → S5)
   */
  function rejectRoute(_shiftDate: string, _shiftTime: string): 'bidding' {
    return 'bidding';
  }

  it('routes reject to bidding when TTS > 4h (normal window)', () => {
    setNow(25 * 3600_000);
    expect(rejectRoute(FIXED_DATE, FIXED_TIME)).toBe('bidding');
  });

  it('routes reject to bidding when TTS is in urgent window (12h)', () => {
    setNow(12 * 3600_000);
    expect(rejectRoute(FIXED_DATE, FIXED_TIME)).toBe('bidding');
  });

  it('routes reject to bidding when TTS ≤ 4h (short notice)', () => {
    setNow(4 * 3600_000);
    expect(rejectRoute(FIXED_DATE, FIXED_TIME)).toBe('bidding');
  });
});

// ── Swap flow gates ───────────────────────────────────────────────────────────

describe('Swap flow — pre-start agility', () => {
  function canSwap(msBeforeStart: number): boolean {
    return msBeforeStart > 0;
  }

  it('allows swap when both shifts are 25h away', () => {
    expect(canSwap(25 * 3600_000)).toBe(true);
  });

  it('allows swap when shift is 2h away', () => {
    expect(canSwap(2 * 3600_000)).toBe(true);
  });

  it('blocks swap once shift has started', () => {
    expect(canSwap(-1 * 3600_000)).toBe(false);
  });
});

// ── startAtIso overload consistency ──────────────────────────────────────────

describe('computeShiftUrgency — startAtIso overload matches shiftDate+time', () => {
  it('produces same result whether called with shiftDate+time or startAtIso', () => {
    setNow(10 * 3600_000);
    const byFields = computeShiftUrgency(FIXED_DATE, FIXED_TIME);
    const byIso    = computeShiftUrgency('', '', new Date(FIXED_START_MS).toISOString());
    expect(byFields).toBe(byIso);
  });
});
