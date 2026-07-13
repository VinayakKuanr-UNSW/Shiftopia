/**
 * TTS (Time-To-Start) urgency unit tests
 *
 * Covers: computeShiftUrgency, computeTTS, isOnBidding, isBiddingUrgent
 * Three urgency windows:
 *   TTS > 24h         → 'normal'
 *   4h < TTS ≤ 24h    → 'urgent'
 *   TTS ≤ 4h          → 'emergent'  (all exchange ops blocked)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  computeShiftUrgency,
  computeTTS,
  isOnBidding,
  isBiddingUrgent,
  ShiftUrgency,
} from '../bidding-urgency';
import { parseZonedDateTime } from '@/modules/core/lib/date.utils';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mock Date.now to `offsetMs` milliseconds before the given shift date+time.
 *
 * The shift start is resolved as a Sydney wall-clock instant (same as
 * computeTTS), so the offset math stays correct regardless of the process
 * timezone. Using a local-tz `new Date()` here would drift by the tz offset on
 * non-Sydney machines and desync from computeTTS's Sydney parsing.
 */
function mockNowBefore(dateIso: string, timeStr: string, offsetMs: number) {
  const start = parseZonedDateTime(dateIso, timeStr).getTime(); // Sydney instant
  vi.spyOn(Date, 'now').mockReturnValue(start - offsetMs);
}

const SHIFT_DATE = '2030-06-15';
const START_TIME = '09:00';

afterEach(() => vi.restoreAllMocks());

// ── computeTTS ────────────────────────────────────────────────────────────────

describe('computeTTS', () => {
  it('returns positive ms when shift is in the future', () => {
    mockNowBefore(SHIFT_DATE, START_TIME, 5 * 60 * 60 * 1000); // 5h before
    const tts = computeTTS(SHIFT_DATE, START_TIME);
    expect(tts).toBeGreaterThan(0);
    expect(tts).toBeCloseTo(5 * 60 * 60 * 1000, -3);
  });

  it('returns negative ms when shift has already started', () => {
    mockNowBefore(SHIFT_DATE, START_TIME, -1 * 60 * 60 * 1000); // 1h AFTER
    const tts = computeTTS(SHIFT_DATE, START_TIME);
    expect(tts).toBeLessThan(0);
  });

  it('returns NaN on invalid date input (does not throw)', () => {
    // parseZonedDateTime('invalid','bad') yields an Invalid Date, getTime() = NaN —
    // no exception thrown, so the try/catch does not convert this to Infinity.
    const tts = computeTTS('invalid', 'bad');
    expect(Number.isNaN(tts)).toBe(true);
  });

  it('interprets the shift start in Sydney tz, independent of the process/browser tz', () => {
    // Pin an ABSOLUTE instant for "now": the exact UTC moment 3h before
    // 2030-06-15 09:00 Sydney time. June = AEST (+10:00), so 09:00 Sydney is
    // 2030-06-14T23:00:00Z, and 3h before that is 2030-06-14T20:00:00Z.
    const nowUtc = Date.parse('2030-06-14T20:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(nowUtc);

    // A correct Sydney interpretation gives ~3h TTS. A naive local-tz parse would
    // instead drift by the machine's UTC offset — this asserts we do NOT do that.
    const tts = computeTTS(SHIFT_DATE, START_TIME);
    expect(tts).toBeCloseTo(3 * 60 * 60 * 1000, -3);
  });
});

// ── computeShiftUrgency — boundary tests ─────────────────────────────────────

describe('computeShiftUrgency — TTS boundary', () => {
  it('returns normal when TTS > 24h (25h before)', () => {
    mockNowBefore(SHIFT_DATE, START_TIME, 25 * 60 * 60 * 1000);
    expect(computeShiftUrgency(SHIFT_DATE, START_TIME)).toBe('normal');
  });

  it('returns normal at exactly 24h + 1ms', () => {
    mockNowBefore(SHIFT_DATE, START_TIME, 24 * 60 * 60 * 1000 + 1);
    expect(computeShiftUrgency(SHIFT_DATE, START_TIME)).toBe('normal');
  });

  it('returns urgent at exactly 24h', () => {
    mockNowBefore(SHIFT_DATE, START_TIME, 24 * 60 * 60 * 1000);
    expect(computeShiftUrgency(SHIFT_DATE, START_TIME)).toBe('urgent');
  });

  it('returns urgent at 12h', () => {
    mockNowBefore(SHIFT_DATE, START_TIME, 12 * 60 * 60 * 1000);
    expect(computeShiftUrgency(SHIFT_DATE, START_TIME)).toBe('urgent');
  });

  it('returns urgent at exactly 4h + 1ms', () => {
    mockNowBefore(SHIFT_DATE, START_TIME, 4 * 60 * 60 * 1000 + 1);
    expect(computeShiftUrgency(SHIFT_DATE, START_TIME)).toBe('urgent');
  });

  it('returns locked at exactly 4h (NOT ALLOWED boundary)', () => {
    mockNowBefore(SHIFT_DATE, START_TIME, 4 * 60 * 60 * 1000);
    expect(computeShiftUrgency(SHIFT_DATE, START_TIME)).toBe('emergent');
  });

  it('returns locked at 2h', () => {
    mockNowBefore(SHIFT_DATE, START_TIME, 2 * 60 * 60 * 1000);
    expect(computeShiftUrgency(SHIFT_DATE, START_TIME)).toBe('emergent');
  });

  it('returns locked when shift has already started', () => {
    mockNowBefore(SHIFT_DATE, START_TIME, -30 * 60 * 1000); // 30 min after start
    expect(computeShiftUrgency(SHIFT_DATE, START_TIME)).toBe('emergent');
  });
});

// ── computeShiftUrgency — startAtIso param ───────────────────────────────────

describe('computeShiftUrgency — startAtIso overload', () => {
  it('uses startAtIso when provided (normal)', () => {
    const startAt = new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();
    expect(computeShiftUrgency('', '', startAt)).toBe('normal');
  });

  it('uses startAtIso when provided (urgent)', () => {
    const startAt = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();
    expect(computeShiftUrgency('', '', startAt)).toBe('urgent');
  });

  it('uses startAtIso when provided (locked)', () => {
    const startAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    expect(computeShiftUrgency('', '', startAt)).toBe('emergent');
  });
});

// ── isOnBidding ───────────────────────────────────────────────────────────────

describe('isOnBidding', () => {
  it('returns true for on_bidding_normal', () => {
    expect(isOnBidding('on_bidding_normal')).toBe(true);
  });

  it('returns true for on_bidding_urgent', () => {
    expect(isOnBidding('on_bidding_urgent')).toBe(true);
  });

  it('returns true for on_bidding (unified)', () => {
    expect(isOnBidding('on_bidding')).toBe(true);
  });

  it('returns false for not_on_bidding', () => {
    expect(isOnBidding('not_on_bidding')).toBe(false);
  });

  it('returns false for bidding_closed_no_winner', () => {
    expect(isOnBidding('bidding_closed_no_winner')).toBe(false);
  });
});

// ── isBiddingUrgent ───────────────────────────────────────────────────────────

describe('isBiddingUrgent', () => {
  it('returns true when TTS is in urgent window', () => {
    mockNowBefore(SHIFT_DATE, START_TIME, 12 * 60 * 60 * 1000);
    expect(isBiddingUrgent(SHIFT_DATE, START_TIME)).toBe(true);
  });

  it('returns false in normal window', () => {
    mockNowBefore(SHIFT_DATE, START_TIME, 25 * 60 * 60 * 1000);
    expect(isBiddingUrgent(SHIFT_DATE, START_TIME)).toBe(false);
  });

  it('returns false in locked window (TTS ≤ 4h)', () => {
    mockNowBefore(SHIFT_DATE, START_TIME, 2 * 60 * 60 * 1000);
    expect(isBiddingUrgent(SHIFT_DATE, START_TIME)).toBe(false);
  });
});
