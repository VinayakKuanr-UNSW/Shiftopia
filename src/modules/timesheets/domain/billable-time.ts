/**
 * Canonical billable-time resolution — the ONE place that implements the
 * three-tier rule (manager edit → snapped actual → scheduled fallback) used
 * by both the timesheet display/edit path and the payroll pricing path.
 *
 * Previously this logic was hand-copied in two places (timesheets.supabase.api.ts
 * and payroll/data/grossPay.read.api.ts) and had drifted: the payroll copy
 * silently defaulted a missing clock-out to the SCHEDULED end time even for a
 * finished shift, and OR'd in the stale shift-level `is_overnight` flag on top
 * of the sign check, which could double-count 24h on a manually-corrected
 * non-overnight timesheet. Both bugs are closed by resolving each side
 * independently through resolveBillableSide() and computing the overnight
 * rollover purely from the RESOLVED (tier-appropriate) times' sign, never a
 * stored schedule-level flag.
 */

import { parseZonedDateTime, formatInTimezone, SYDNEY_TZ } from '@/modules/core/lib/date.utils';

export type BillableSideSource = 'manual' | 'snapped' | 'missing';

export interface BillableSide {
  /** 'HH:MM' Sydney wall-clock, or null if not yet resolvable / genuinely missing. */
  hhmm: string | null;
  /**
   * 'manual'  — a manager-entered timesheet value won this side.
   * 'snapped' — no manual edit; the shift is finished and the raw actual clock
   *             snapped to the nearest 15 minutes.
   * 'missing' — the shift is finished, there is no manager edit, AND there is
   *             no actual clock time either (e.g. forgot to clock out). This
   *             is a genuine data gap, not a fallback — callers must NOT
   *             treat it as if the shift were priced from real attendance.
   * null      — the shift simply hasn't finished yet; nothing to resolve.
   */
  source: BillableSideSource | null;
}

/**
 * Snap an HH:MM[:SS] or ISO datetime string to the nearest 15-minute boundary.
 * e.g. "09:07:00" → "09:00", "09:08" → "09:15", "09:52" → "09:45"
 * Seconds participate in the rounding ("09:07:59" is nearer 09:15 than 09:00).
 * ISO timestamps are read as VENUE wall-clock time (Australia/Sydney), not the
 * browser's, so every viewer snaps to the same billable time.
 * Returns null if value is falsy or unparseable.
 *
 * NOTE: the returned string carries no date/day component — if snapping rolls
 * past 23:52+ it wraps to "00:00" of the FOLLOWING day with no marker of that
 * crossing. That is safe only because every consumer re-derives any midnight
 * crossing from the sign of (end − start) on the resolved times (see
 * calculateNetMinutes below) rather than trusting a separately-stored flag.
 */
export function snapToQuarterHour(value: string | null | undefined): string | null {
  if (!value) return null;

  let h: number;
  let m: number;
  let s: number;

  if (value.includes('T') || (value.length > 8 && value.includes('-'))) {
    // ISO datetime → extract Sydney wall-clock components
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    const [hh, mm, ss] = formatInTimezone(d, SYDNEY_TZ, 'HH:mm:ss').split(':').map(Number);
    h = hh; m = mm; s = ss;
  } else {
    // Plain HH:MM or HH:MM:SS string
    const parts = value.split(':').map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
    h = parts[0];
    m = parts[1];
    s = parts.length > 2 && !isNaN(parts[2]) ? parts[2] : 0;
  }

  const snapped = Math.round((m + s / 60) / 15) * 15;
  if (snapped === 60) {
    const nextH = (h + 1) % 24;
    return `${nextH.toString().padStart(2, '0')}:00`;
  }
  return `${h.toString().padStart(2, '0')}:${snapped.toString().padStart(2, '0')}`;
}

/**
 * Robust check to determine if a shift is physically over.
 * Accounts for date, time, and overnight status. A recorded actual_end always
 * means "finished" (whichever comes first — an early clock-out ends the
 * shift), otherwise it's finished once the scheduled end instant has passed.
 */
export function isShiftFinished(
  date: string | Date,
  scheduledStart: string,
  scheduledEnd: string,
  actualEnd?: string | null,
): boolean {
  if (actualEnd && actualEnd !== '-' && actualEnd !== '—') return true;

  if (!scheduledEnd || scheduledEnd === '-') return false;

  try {
    const dateStr = typeof date === 'string'
      ? date
      : formatInTimezone(date, SYDNEY_TZ, 'yyyy-MM-dd');

    const startInstant = parseZonedDateTime(dateStr, scheduledStart, SYDNEY_TZ);
    let endInstant = parseZonedDateTime(dateStr, scheduledEnd, SYDNEY_TZ);

    if (endInstant.getTime() <= startInstant.getTime()) {
      endInstant = new Date(endInstant.getTime() + 24 * 60 * 60 * 1000);
    }

    return Date.now() >= endInstant.getTime();
  } catch (e) {
    console.error('Error parsing shift end time for finished check', e);
    return true;
  }
}

/** Sentinel "no value" strings used across the timesheet UI/writers. */
function isBlankSentinel(value: string | null | undefined): boolean {
  return !value || value === 'NIL' || value === '-' || value === '—';
}

/**
 * Resolve ONE side (start or end) of the billable window through the
 * three-tier rule. Each side is resolved independently — a manager can edit
 * only one side and the other still falls through its own chain (mirrors the
 * per-side `*` on the Live Rules badges).
 */
export function resolveBillableSide(
  manualValue: string | null | undefined,
  actualValue: string | null | undefined,
  isFinished: boolean,
): BillableSide {
  if (!isBlankSentinel(manualValue)) return { hhmm: manualValue as string, source: 'manual' };
  if (!isFinished) return { hhmm: null, source: null };
  const snapped = snapToQuarterHour(isBlankSentinel(actualValue) ? null : actualValue);
  if (snapped) return { hhmm: snapped, source: 'snapped' };
  return { hhmm: null, source: 'missing' };
}

/**
 * Net billable minutes between two resolved 'HH:MM' sides, minus the unpaid
 * break. Returns null (not 0) when either side isn't resolvable yet — 0 would
 * falsely read as "computed and it's zero".
 *
 * Overnight rollover is a pure sign check on the RESOLVED times: if the end
 * lands at/before the start, the shift crossed midnight, so 24h is added.
 * This deliberately does NOT consult any stored `is_overnight` schedule flag
 * — that flag describes the ORIGINAL roster, not necessarily the times that
 * ended up approved (an early finish or a manual correction can turn a
 * scheduled-overnight shift into a same-day span), and OR-ing it in on top of
 * the sign check double-counts 24h in exactly that case.
 */
export function calculateNetMinutes(
  start: BillableSide,
  end: BillableSide,
  unpaidBreakMinutes: number,
): number | null {
  if (!start.hhmm || !end.hhmm) return null;

  const [startH, startM] = start.hhmm.split(':').map(Number);
  const [endH, endM] = end.hhmm.split(':').map(Number);
  if ([startH, startM, endH, endM].some((n) => Number.isNaN(n))) return null;

  let diffMins = (endH * 60 + endM) - (startH * 60 + startM);
  if (diffMins < 0) diffMins += 24 * 60;

  return Math.max(0, diffMins - (unpaidBreakMinutes || 0));
}
