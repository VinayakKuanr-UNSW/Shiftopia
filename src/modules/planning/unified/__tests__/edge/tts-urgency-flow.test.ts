/**
 * TTS (Time-To-Start) Urgency Flow Tests
 *
 * Validates that the three-zone TTS model is enforced consistently across
 * bidding, swapping, and offers:
 *
 *   TTS > 24h         → NORMAL   — all exchange operations allowed
 *   4h < TTS ≤ 24h    → URGENT   — allowed but flagged
 *   TTS ≤ 4h          → LOCKED   — all exchange operations blocked (NOT ALLOWED)
 *
 * These tests exercise the shared urgency utility (computeShiftUrgency) and
 * verify the gating logic used across all three flows.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';

// ── Mock infrastructure ───────────────────────────────────────────────────────

const FIXED_DATE = '2030-08-20';
const FIXED_TIME = '14:00';
const FIXED_START_MS = new Date(`${FIXED_DATE}T${FIXED_TIME}`).getTime();

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
    [' 4h exact   → locked',         4 * 3600_000,  'locked'],
    [' 2h before  → locked',         2 * 3600_000,  'locked'],
    [' 0h (start) → locked',                  0,  'locked'],
    ['-1h (past)  → locked',        -1 * 3600_000,  'locked'],
  ];

  it.each(cases)('%s', (_, msBeforeStart, expected) => {
    setNow(msBeforeStart);
    expect(computeShiftUrgency(FIXED_DATE, FIXED_TIME)).toBe(expected);
  });
});

// ── Bidding flow gates ────────────────────────────────────────────────────────

describe('Bidding flow — TTS gate logic', () => {
  /**
   * Gate: manager cannot accept a bid when TTS ≤ 4h.
   * The client-side guard in bidding.api.ts checks TTS before calling sm_select_bid.
   */
  it('denies bid acceptance when shift is locked (TTS ≤ 4h)', () => {
    setNow(2 * 3600_000); // 2h before
    const urgency = computeShiftUrgency(FIXED_DATE, FIXED_TIME);
    expect(urgency).toBe('locked');
    // Simulate the gate check
    const gateBlocked = urgency === 'locked';
    expect(gateBlocked).toBe(true);
  });

  it('allows bid acceptance in urgent window (12h)', () => {
    setNow(12 * 3600_000);
    const urgency = computeShiftUrgency(FIXED_DATE, FIXED_TIME);
    expect(urgency).toBe('urgent');
    const gateBlocked = urgency === 'locked';
    expect(gateBlocked).toBe(false);
  });

  it('allows bid acceptance in normal window (25h)', () => {
    setNow(25 * 3600_000);
    const urgency = computeShiftUrgency(FIXED_DATE, FIXED_TIME);
    expect(urgency).toBe('normal');
    const gateBlocked = urgency === 'locked';
    expect(gateBlocked).toBe(false);
  });
});

// ── Assignment Offer flow gates ───────────────────────────────────────────────

describe('Assignment Offer flow — reject routing', () => {
  /**
   * When an employee rejects an offer:
   *   TTS > 4h  → shift goes to bidding (sm_reject_offer → S5)
   *   TTS ≤ 4h  → shift goes to draft+unassigned (sm_expire_offer_now → S1)
   *
   * This routing prevents the shift from entering a locked bidding window.
   */
  function rejectRoute(shiftDate: string, shiftTime: string): 'bidding' | 'draft' {
    const urgency = computeShiftUrgency(shiftDate, shiftTime);
    return urgency === 'locked' ? 'draft' : 'bidding';
  }

  it('routes reject to bidding when TTS > 4h (normal window)', () => {
    setNow(25 * 3600_000);
    expect(rejectRoute(FIXED_DATE, FIXED_TIME)).toBe('bidding');
  });

  it('routes reject to bidding when TTS is in urgent window (12h)', () => {
    setNow(12 * 3600_000);
    expect(rejectRoute(FIXED_DATE, FIXED_TIME)).toBe('bidding');
  });

  it('routes reject to draft+unassigned when TTS ≤ 4h (locked)', () => {
    setNow(4 * 3600_000); // exactly 4h — boundary must be locked
    expect(rejectRoute(FIXED_DATE, FIXED_TIME)).toBe('draft');
  });

  it('routes reject to draft+unassigned at 2h', () => {
    setNow(2 * 3600_000);
    expect(rejectRoute(FIXED_DATE, FIXED_TIME)).toBe('draft');
  });

  it('routes reject to draft+unassigned when shift has already started', () => {
    setNow(-30 * 60_000); // 30min past start
    expect(rejectRoute(FIXED_DATE, FIXED_TIME)).toBe('draft');
  });
});

// ── Swap flow gates ───────────────────────────────────────────────────────────

describe('Swap flow — TTS gate logic', () => {
  /**
   * OPEN / MANAGER_PENDING swaps are blocked when either linked shift is locked.
   * Both the requester's shift AND the offered shift must be TTS > 4h.
   */
  function swapGateBlocked(
    requesterDate: string, requesterTime: string,
    offeredDate: string,  offeredTime: string,
  ): boolean {
    const u1 = computeShiftUrgency(requesterDate, requesterTime);
    const u2 = computeShiftUrgency(offeredDate, offeredTime);
    return u1 === 'locked' || u2 === 'locked';
  }

  it('allows swap when both shifts are 25h away', () => {
    setNow(25 * 3600_000);
    // Both shifts at same time for simplicity
    expect(swapGateBlocked(FIXED_DATE, FIXED_TIME, FIXED_DATE, FIXED_TIME)).toBe(false);
  });

  it('blocks swap when requester shift is locked', () => {
    setNow(2 * 3600_000);
    expect(swapGateBlocked(FIXED_DATE, FIXED_TIME, '2030-08-21', '14:00')).toBe(true);
  });

  it('blocks swap when offered shift is locked even if requester shift is normal', () => {
    // Real date.now is used for offered shift — mock to 2h before FIXED_DATE
    setNow(2 * 3600_000);
    // offered shift is ALSO at FIXED_DATE, FIXED_TIME → locked
    // requester shift is far future → normal
    const u1 = computeShiftUrgency('2030-12-31', '23:00'); // far future → normal
    const u2 = computeShiftUrgency(FIXED_DATE, FIXED_TIME); // 2h away → locked
    expect(u1).toBe('normal');
    expect(u2).toBe('locked');
    expect(u1 === 'locked' || u2 === 'locked').toBe(true);
  });
});

// ── Emergency Assignment (bypass) ─────────────────────────────────────────────

describe('Emergency Assignment — TTS < 4h bypass', () => {
  /**
   * Emergency assignment is the ONLY operation allowed when TTS ≤ 4h.
   * Regular bidding/swap flows are blocked; emergency assignment bypasses them.
   * This is enforced server-side and signalled to the employee via notification.
   */
  it('identifies emergency window correctly', () => {
    setNow(2 * 3600_000);
    const urgency = computeShiftUrgency(FIXED_DATE, FIXED_TIME);
    const isEmergencyWindow = urgency === 'locked';
    expect(isEmergencyWindow).toBe(true);
  });

  it('confirms non-emergency at 5h', () => {
    setNow(5 * 3600_000);
    const urgency = computeShiftUrgency(FIXED_DATE, FIXED_TIME);
    const isEmergencyWindow = urgency === 'locked';
    expect(isEmergencyWindow).toBe(false);
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
