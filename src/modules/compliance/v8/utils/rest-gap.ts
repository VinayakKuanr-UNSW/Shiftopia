/**
 * V8 Compliance Engine — Shift Pairing & Rest-Gap Helpers
 *
 * Single source of truth for how the engine classifies consecutive shift
 * pairs. Used by BOTH the rest-gap rule (clause 40) and the split-shift rule
 * (clause 39) so they never disagree about what "same day" means.
 *
 * EBA basis:
 *   - Clause 40 (Breaks Between Shifts): the minimum rest gap applies between
 *     "the completion of work on the one day and the commencement of work on
 *     the next day" — i.e. it is a CROSS-DAY provision. Two shifts that START
 *     on the same calendar day are never a rest-gap concern; they are governed
 *     by the split-shift rule (clause 39) and the spread-of-hours cap.
 *   - Clause 40.3 / 13.1(f): a multi-hire engagement only requires an 8h break.
 */

import { V8Shift } from '../types';
import { parseTimeToMinutes } from './time';

const MINUTES_PER_DAY = 1440;

/** 8h — the reduced minimum break that applies to multi-hire engagements. */
export const MULTI_HIRE_MIN_REST_MINUTES = 480;

/** The shift's START calendar day (YYYY-MM-DD), tolerant of `date`/`shift_date`. */
export function shiftStartDate(s: V8Shift): string {
    return s.date || s.shift_date || '';
}

/**
 * Absolute start/end in minutes, anchored to the shift's START calendar day so
 * shifts on different dates compare correctly. Cross-midnight shifts get their
 * end pushed by a day (end > start always). Returns null for malformed shifts.
 */
export function toAbsInterval(s: V8Shift): { startAbs: number; endAbs: number } | null {
    const date = shiftStartDate(s);
    if (!date || !s.start_time || !s.end_time) return null;
    const dayMs = Date.parse(date + 'T00:00:00Z');
    if (Number.isNaN(dayMs)) return null;
    const base = Math.round(dayMs / 86_400_000) * MINUTES_PER_DAY;
    const start = parseTimeToMinutes(s.start_time);
    let end = parseTimeToMinutes(s.end_time);
    if (end <= start) end += MINUTES_PER_DAY; // cross-midnight
    return { startAbs: base + start, endAbs: base + end };
}

/**
 * Two shifts form a SAME-DAY (potential split-shift) pair when they START on
 * the same calendar day. This — not the overnight boundary — is the correct
 * discriminator for clause 40 ("one day … the next day").
 */
export function isSameStartDay(a: V8Shift, b: V8Shift): boolean {
    const da = shiftStartDate(a);
    return da !== '' && da === shiftStartDate(b);
}

/** True when either shift in the pair is a multi-hire engagement (clause 39.4 / 40.3). */
export function pairInvolvesMultiHire(a: V8Shift, b: V8Shift): boolean {
    return a.shift_type === 'MULTI_HIRE' || b.shift_type === 'MULTI_HIRE';
}

export interface ConsecutivePair {
    /** The earlier shift (by absolute start). */
    a: V8Shift;
    /** The later shift (by absolute start). */
    b: V8Shift;
    /** Minutes from a.end to b.start. Negative when the pair overlaps. */
    gapMinutes: number;
    /** True when a and b START on the same calendar day. */
    sameStartDay: boolean;
}

/**
 * Sort shifts by absolute start time and yield every consecutive (a, b) pair
 * with its inter-shift gap. Malformed shifts are dropped. O(n log n).
 */
export function consecutivePairs(shifts: V8Shift[]): ConsecutivePair[] {
    const withAbs = shifts
        .map(s => ({ s, iv: toAbsInterval(s) }))
        .filter((x): x is { s: V8Shift; iv: { startAbs: number; endAbs: number } } => x.iv !== null)
        .sort((x, y) => x.iv.startAbs - y.iv.startAbs);

    const pairs: ConsecutivePair[] = [];
    for (let i = 0; i < withAbs.length - 1; i++) {
        const cur = withAbs[i];
        const nxt = withAbs[i + 1];
        pairs.push({
            a: cur.s,
            b: nxt.s,
            gapMinutes: nxt.iv.startAbs - cur.iv.endAbs,
            sameStartDay: isSameStartDay(cur.s, nxt.s),
        });
    }
    return pairs;
}
