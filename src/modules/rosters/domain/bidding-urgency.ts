/**
 * Client-side shift urgency derivation — shared across bidding, swapping, and offers.
 *
 * Rules:
 *   TTS > 24h          → 'normal'
 *   4h < TTS ≤ 24h     → 'urgent'
 *   TTS ≤ 4h           → 'emergent'  (all exchange operations blocked server-side too)
 *
 * "On bidding" is any bidding_status other than 'not_on_bidding' and 'bidding_closed_no_winner'.
 */

export type ShiftUrgency = 'normal' | 'urgent' | 'emergent';
/** @deprecated use ShiftUrgency */
export type BiddingUrgency = ShiftUrgency;

const FOUR_HOURS_MS    = 4  * 60 * 60 * 1000;
const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000;

/**
 * Returns milliseconds until shift start. Negative if shift has already started.
 */
export function computeTTS(shiftDate: string, startTime: string): number {
  try {
    const start = new Date(`${shiftDate}T${startTime}`);
    return start.getTime() - Date.now();
  } catch {
    return Infinity; // treat parse errors as far-future
  }
}

/**
 * Compute display urgency from shift time fields.
 * Accepts either (shiftDate, startTime) or an ISO datetime via startAtIso.
 */
export function computeShiftUrgency(
  shiftDate: string,
  startTime: string,
  startAtIso?: string,
): ShiftUrgency {
  const tts = startAtIso
    ? new Date(startAtIso).getTime() - Date.now()
    : computeTTS(shiftDate, startTime);
  if (tts <= FOUR_HOURS_MS)    return 'emergent';
  if (tts <= TWENTY_FOUR_H_MS) return 'urgent';
  return 'normal';
}

/** @deprecated use computeShiftUrgency */
export function computeBiddingUrgency(shiftDate: string, startTime: string): ShiftUrgency {
  return computeShiftUrgency(shiftDate, startTime);
}

/**
 * Returns true if a shift row is currently in an active bidding state.
 */
export function isOnBidding(biddingStatus: string): boolean {
  return biddingStatus !== 'not_on_bidding' && biddingStatus !== 'bidding_closed_no_winner';
}

/**
 * Convenience: returns true if urgency is 'urgent' (TTS 4–24h).
 */
export function isBiddingUrgent(shiftDate: string, startTime: string): boolean {
  return computeShiftUrgency(shiftDate, startTime) === 'urgent';
}
