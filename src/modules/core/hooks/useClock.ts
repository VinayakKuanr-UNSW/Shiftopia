import * as React from 'react';
import { getNowInTimezone, SYDNEY_TZ } from '@/modules/core/lib/date.utils';

/**
 * A single app-wide wall clock, ticking once a minute.
 *
 * Components that compare "now" against a shift time used to capture it inside a
 * `useMemo` keyed on the shift — so `MyRosterShift#isPast` was evaluated once at
 * mount and then frozen. A shift that ended while you were looking at the roster
 * never went grey, because nothing re-rendered the card.
 *
 * Two things make this cheap enough to put on every card:
 *
 *  1. **Sydney wall-clock is resolved once per TICK, not once per card.**
 *     `getNowInTimezone()` builds an `Intl` formatter and `format()` re-parses
 *     its pattern; doing that per card per render is what made the frozen
 *     `useMemo` attractive in the first place. Here it happens once a minute for
 *     the whole app, and cards compare a `YYYY-MM-DD` string and an integer.
 *
 *  2. **Each subscriber's snapshot is its own derived value.** `useClockValue`
 *     passes the selector straight to `useSyncExternalStore`, which compares
 *     with `Object.is` and skips the re-render when the value is unchanged. A
 *     tick therefore re-renders only the handful of cards whose answer actually
 *     changed, not every card on screen.
 *
 * The selector receives the snapshot rather than reading the clock itself, so it
 * is deterministic between ticks. That matters: `useSyncExternalStore` warns (and
 * can loop) if `getSnapshot` returns a different value on two calls within one
 * render, which a bare `Date.now()` would eventually do at the moment of flip.
 */
export interface ClockSnapshot {
  /** Sydney date as `YYYY-MM-DD`, for direct comparison against `shift_date`. */
  readonly todayStr: string;
  /** Minutes since Sydney midnight, for direct comparison against `HH:mm`. */
  readonly minutesSinceMidnight: number;
  /** Epoch ms at the tick, for anything needing a real instant. */
  readonly epochMs: number;
}

function computeSnapshot(): ClockSnapshot {
  // Zoned Date: its LOCAL fields are Sydney's wall-clock fields. Never
  // `.getTime()` on this — see the timezone note in date.utils.
  const syd = getNowInTimezone(SYDNEY_TZ);
  const y = syd.getFullYear();
  const m = `${syd.getMonth() + 1}`.padStart(2, '0');
  const d = `${syd.getDate()}`.padStart(2, '0');
  return {
    todayStr: `${y}-${m}-${d}`,
    minutesSinceMidnight: syd.getHours() * 60 + syd.getMinutes(),
    epochMs: Date.now(),
  };
}

const subscribers = new Set<() => void>();
/**
 * Indirection so tests can pin the clock. Production never reassigns it; the
 * alternative was a test-only branch inside `subscribe`, which would have
 * disabled the wake-from-background refresh below in exactly the code path the
 * tests are meant to exercise.
 */
let source: () => ClockSnapshot = computeSnapshot;
let snapshot: ClockSnapshot = source();
let timer: ReturnType<typeof setTimeout> | null = null;

function tick() {
  snapshot = source();
  for (const cb of [...subscribers]) cb();
  scheduleNext();
}

/**
 * Align to the next wall-clock minute rather than `setInterval(60_000)`, so a
 * shift ending at 17:00 goes grey at 17:00, not up to a minute late depending on
 * when the first subscriber happened to mount.
 */
function scheduleNext() {
  if (subscribers.size === 0) return;
  const msToNextMinute = 60_000 - (Date.now() % 60_000);
  timer = setTimeout(tick, msToNextMinute + 50); // +50ms: land just inside the minute
}

function subscribe(onStoreChange: () => void): () => void {
  if (subscribers.size === 0) {
    // A tab can sit backgrounded for hours; refresh on the first new subscriber
    // so the first render after waking is not working from a stale snapshot.
    snapshot = source();
  }
  subscribers.add(onStoreChange);
  if (timer === null) scheduleNext();

  return () => {
    subscribers.delete(onStoreChange);
    if (subscribers.size === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

function getSnapshot(): ClockSnapshot {
  return snapshot;
}

/**
 * Subscribe to the shared clock, re-rendering only when `select` changes value.
 *
 * `select` must be pure and derive solely from the snapshot it is handed.
 */
export function useClockValue<T>(select: (now: ClockSnapshot) => T): T {
  const read = React.useCallback(() => select(snapshot), [select]);
  return React.useSyncExternalStore(subscribe, read, read);
}

/** Test seam: reset the module store, optionally pinning the clock. */
export function __resetClockForTests(next?: ClockSnapshot) {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  subscribers.clear();
  source = next ? () => next : computeSnapshot;
  snapshot = source();
}

/** Test seam: move the pinned clock forward and notify subscribers. */
export function __advanceClockForTests(next: ClockSnapshot) {
  source = () => next;
  snapshot = next;
  for (const cb of [...subscribers]) cb();
}

/**
 * Has this shift's end time passed, in Sydney wall-clock terms?
 *
 * Consolidates two rival implementations that disagreed:
 *
 *   - `MyRosterShift` compared wall-clock fields and special-cased a `00:00`
 *     end as midnight at the END of the day.
 *   - `ShiftDetailsDialog` used `parseZonedDateTime(date, end).getTime() < now`,
 *     which resolves `00:00` to the START of that day — so a shift finishing at
 *     midnight read as "past" from 00:01 onward, and the same shift was greyed
 *     out in the dialog while still live on the chip behind it.
 *
 * Neither handled overnight shifts: both resolved the end time against
 * `shift_date`, so a 22:00–06:00 shift counted as finished at 06:00 on the day
 * it STARTED — i.e. past for the whole of its own shift. `startTime` closes that.
 *
 * The crossing rule matches `doesShiftTrulyCrossMidnight` exactly: an end time
 * strictly before the start rolls to the next day, but an end of `00:00` is the
 * end of the starting day, not the start of it.
 */
export function isShiftPast(
  shiftDate: string | null | undefined,
  endTime: string | null | undefined,
  now: ClockSnapshot,
  startTime?: string | null,
): boolean {
  if (!shiftDate || !endTime) return false;

  const [endH, endM] = endTime.split(':').map(Number);
  if (!Number.isFinite(endH) || !Number.isFinite(endM)) return false;

  const endsAtMidnight = endH === 0 && endM === 0;
  const crossesMidnight = Boolean(startTime) && !endsAtMidnight && endTime < startTime!;

  let endDate = shiftDate;
  let endMinutes = endH * 60 + endM;

  if (crossesMidnight) {
    const [y, m, d] = shiftDate.split('-').map(Number);
    if (!y || !m || !d) return false;
    const next = new Date(y, m - 1, d + 1);
    endDate = `${next.getFullYear()}-${`${next.getMonth() + 1}`.padStart(2, '0')}-${`${next.getDate()}`.padStart(2, '0')}`;
  } else if (endsAtMidnight) {
    // Midnight is the END of this day. Without this every shift finishing at
    // 00:00 reads as already past the moment the day begins.
    endMinutes = 24 * 60;
  }

  if (endDate > now.todayStr) return false;
  if (endDate < now.todayStr) return true;
  return now.minutesSinceMidnight > endMinutes;
}
