import { describe, it, expect } from 'vitest';
import {
  deriveEpisodes,
  LATE_CANCEL_THRESHOLD_HOURS,
  type ShiftLifecycleEvent,
  type AssignmentEpisode,
} from '../shift-episodes';

// ─── Helpers ────────────────────────────────────────────────────────────────

let eventSeq = 0;
function mkEvent(
  overrides: Partial<ShiftLifecycleEvent> & Pick<ShiftLifecycleEvent, 'event_type' | 'event_time'>,
): ShiftLifecycleEvent {
  eventSeq++;
  return {
    event_id: `evt-${eventSeq}`,
    employee_id: 'alice-uuid',
    employee_name: 'Alice',
    metadata: null,
    ...overrides,
  };
}

/** Returns an ISO timestamp offset by `hoursOffset` hours from a base time. */
function hoursFromBase(hoursOffset: number, baseIso = '2026-06-25T08:00:00Z'): string {
  return new Date(new Date(baseIso).getTime() + hoursOffset * 3600_000).toISOString();
}

// Shift scheduled start for all tests (8am UTC on 2026-06-25)
const SCHEDULED_START = '2026-06-25T08:00:00Z';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('deriveEpisodes', () => {
  beforeEach(() => {
    eventSeq = 0;
  });

  // 1. Single fulfilled episode
  it('derives a single fulfilled episode (ASSIGNED→ACCEPTED→CHECKED_IN, completed)', () => {
    const events: ShiftLifecycleEvent[] = [
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-48) }),
      mkEvent({ event_type: 'ACCEPTED', event_time: hoursFromBase(-47) }),
      mkEvent({ event_type: 'CHECKED_IN', event_time: hoursFromBase(0) }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START, completed: true });

    expect(episodes).toHaveLength(1);
    expect(episodes[0].episodeSeq).toBe(1);
    expect(episodes[0].employeeId).toBe('alice-uuid');
    expect(episodes[0].terminalOutcome).toBe('fulfilled');
    expect(episodes[0].hadAssign).toBe(true);
    expect(episodes[0].hadAccept).toBe(true);
    expect(episodes[0].attended).toBe(true);
    expect(episodes[0].lateIn).toBe(false);
    expect(episodes[0].closedAt).toBeNull(); // fulfilled = no explicit close event
    expect(episodes[0].events).toHaveLength(3);
  });

  // 2. Two-lifecycle case: Alice drops (standard cancel), Bob works with late-in
  it('derives two episodes: Alice cancelled_standard, Bob fulfilled with lateIn', () => {
    const events: ShiftLifecycleEvent[] = [
      // Episode 1: Alice offered, accepted, cancelled >4h before start
      mkEvent({
        event_type: 'OFFERED',
        event_time: hoursFromBase(-72),
        employee_id: 'alice-uuid',
        employee_name: 'Alice',
      }),
      mkEvent({
        event_type: 'ACCEPTED',
        event_time: hoursFromBase(-70),
        employee_id: 'alice-uuid',
        employee_name: 'Alice',
      }),
      mkEvent({
        event_type: 'CANCELLED',
        event_time: hoursFromBase(-24), // 24h before start = standard cancel
        employee_id: 'alice-uuid',
        employee_name: 'Alice',
      }),
      // Episode 2: Bob assigned, late-in
      mkEvent({
        event_type: 'ASSIGNED',
        event_time: hoursFromBase(-20),
        employee_id: 'bob-uuid',
        employee_name: 'Bob',
      }),
      mkEvent({
        event_type: 'LATE_IN',
        event_time: hoursFromBase(0.5), // 30min late
        employee_id: 'bob-uuid',
        employee_name: 'Bob',
      }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START, completed: true });

    expect(episodes).toHaveLength(2);

    // Episode 1: Alice
    const ep1 = episodes[0];
    expect(ep1.episodeSeq).toBe(1);
    expect(ep1.employeeId).toBe('alice-uuid');
    expect(ep1.terminalOutcome).toBe('cancelled_standard');
    expect(ep1.hadOffer).toBe(true);
    expect(ep1.hadAccept).toBe(true);
    expect(ep1.closedAt).toBeTruthy();

    // Episode 2: Bob
    const ep2 = episodes[1];
    expect(ep2.episodeSeq).toBe(2);
    expect(ep2.employeeId).toBe('bob-uuid');
    expect(ep2.employeeName).toBe('Bob');
    expect(ep2.terminalOutcome).toBe('fulfilled');
    expect(ep2.hadAssign).toBe(true);
    expect(ep2.lateIn).toBe(true);
    expect(ep2.attended).toBe(true);

    // Assert different holders
    expect(ep1.employeeId).not.toBe(ep2.employeeId);
  });

  // 3. Offer ignored
  it('derives a single episode with outcome ignored', () => {
    const events: ShiftLifecycleEvent[] = [
      mkEvent({ event_type: 'OFFERED', event_time: hoursFromBase(-48) }),
      mkEvent({ event_type: 'IGNORED', event_time: hoursFromBase(-24) }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START });

    expect(episodes).toHaveLength(1);
    expect(episodes[0].terminalOutcome).toBe('ignored');
    expect(episodes[0].hadOffer).toBe(true);
    expect(episodes[0].hadAccept).toBe(false);
  });

  // 4. Late cancel boundary: CANCELLED exactly <4h before start → cancelled_late
  it('classifies cancellation as late when within 4h threshold', () => {
    const cancelTime = hoursFromBase(-3); // 3h before start = within 4h threshold

    const events: ShiftLifecycleEvent[] = [
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-48) }),
      mkEvent({ event_type: 'ACCEPTED', event_time: hoursFromBase(-47) }),
      mkEvent({ event_type: 'CANCELLED', event_time: cancelTime }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START });

    expect(episodes).toHaveLength(1);
    expect(episodes[0].terminalOutcome).toBe('cancelled_late');
  });

  it('classifies cancellation as standard when outside 4h threshold', () => {
    // Exactly at 4h boundary → still late (<=)
    const cancelTimeAtBoundary = hoursFromBase(-LATE_CANCEL_THRESHOLD_HOURS);

    const eventsAtBoundary: ShiftLifecycleEvent[] = [
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-48) }),
      mkEvent({ event_type: 'CANCELLED', event_time: cancelTimeAtBoundary }),
    ];

    const episodesAtBoundary = deriveEpisodes(eventsAtBoundary, { scheduledStart: SCHEDULED_START });
    expect(episodesAtBoundary[0].terminalOutcome).toBe('cancelled_late');

    // Just outside boundary
    eventSeq = 0;
    const cancelTimeOutside = hoursFromBase(-(LATE_CANCEL_THRESHOLD_HOURS + 0.01));

    const eventsOutside: ShiftLifecycleEvent[] = [
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-48) }),
      mkEvent({ event_type: 'CANCELLED', event_time: cancelTimeOutside }),
    ];

    const episodesOutside = deriveEpisodes(eventsOutside, { scheduledStart: SCHEDULED_START });
    expect(episodesOutside[0].terminalOutcome).toBe('cancelled_standard');
  });

  // 5. Swap: SWAPPED_OUT closes ep, SWAPPED_IN starts new one
  it('derives two episodes from a swap', () => {
    const events: ShiftLifecycleEvent[] = [
      mkEvent({
        event_type: 'ASSIGNED',
        event_time: hoursFromBase(-48),
        employee_id: 'alice-uuid',
        employee_name: 'Alice',
      }),
      mkEvent({
        event_type: 'ACCEPTED',
        event_time: hoursFromBase(-47),
        employee_id: 'alice-uuid',
        employee_name: 'Alice',
      }),
      mkEvent({
        event_type: 'SWAPPED_OUT',
        event_time: hoursFromBase(-24),
        employee_id: 'alice-uuid',
        employee_name: 'Alice',
      }),
      mkEvent({
        event_type: 'SWAPPED_IN',
        event_time: hoursFromBase(-24),
        employee_id: 'bob-uuid',
        employee_name: 'Bob',
      }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START, completed: true });

    expect(episodes).toHaveLength(2);
    expect(episodes[0].terminalOutcome).toBe('swapped_out');
    expect(episodes[0].employeeId).toBe('alice-uuid');
    expect(episodes[1].terminalOutcome).toBe('fulfilled');
    expect(episodes[1].employeeId).toBe('bob-uuid');
    expect(episodes[1].hadSwapIn).toBe(true);
  });

  // 6. Reject re-bid re-assign
  it('derives two episodes from reject then re-assign', () => {
    const events: ShiftLifecycleEvent[] = [
      mkEvent({
        event_type: 'OFFERED',
        event_time: hoursFromBase(-72),
        employee_id: 'alice-uuid',
        employee_name: 'Alice',
      }),
      mkEvent({
        event_type: 'REJECTED',
        event_time: hoursFromBase(-70),
        employee_id: 'alice-uuid',
        employee_name: 'Alice',
      }),
      mkEvent({
        event_type: 'ASSIGNED',
        event_time: hoursFromBase(-48),
        employee_id: 'bob-uuid',
        employee_name: 'Bob',
      }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START, completed: true });

    expect(episodes).toHaveLength(2);
    expect(episodes[0].episodeSeq).toBe(1);
    expect(episodes[0].employeeId).toBe('alice-uuid');
    expect(episodes[0].terminalOutcome).toBe('rejected');
    expect(episodes[0].hadOffer).toBe(true);

    expect(episodes[1].episodeSeq).toBe(2);
    expect(episodes[1].employeeId).toBe('bob-uuid');
    expect(episodes[1].terminalOutcome).toBe('fulfilled');
  });

  // 7. Emergency assigned → positive episode
  it('marks EMERGENCY_ASSIGNED episode with hadEmergency=true', () => {
    const events: ShiftLifecycleEvent[] = [
      mkEvent({
        event_type: 'EMERGENCY_ASSIGNED',
        event_time: hoursFromBase(-1),
        employee_id: 'charlie-uuid',
        employee_name: 'Charlie',
      }),
      mkEvent({
        event_type: 'CHECKED_IN',
        event_time: hoursFromBase(0),
        employee_id: 'charlie-uuid',
        employee_name: 'Charlie',
      }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START, completed: true });

    expect(episodes).toHaveLength(1);
    expect(episodes[0].hadEmergency).toBe(true);
    expect(episodes[0].terminalOutcome).toBe('fulfilled');
    expect(episodes[0].openingEvent).toBe('EMERGENCY_ASSIGNED');
  });

  // 8. Consecutive opening events for the same employee stay in one episode
  it('consecutive opening events for same employee stay in one episode', () => {
    const events: ShiftLifecycleEvent[] = [
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-48) }),
      mkEvent({ event_type: 'OFFERED', event_time: hoursFromBase(-47) }),
      mkEvent({ event_type: 'ACCEPTED', event_time: hoursFromBase(-46) }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START, completed: true });

    expect(episodes).toHaveLength(1);
    expect(episodes[0].hadAssign).toBe(true);
    expect(episodes[0].hadOffer).toBe(true);
    expect(episodes[0].hadAccept).toBe(true);
  });

  // 9. No-show episode
  it('derives a no_show episode', () => {
    const events: ShiftLifecycleEvent[] = [
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-48) }),
      mkEvent({ event_type: 'ACCEPTED', event_time: hoursFromBase(-47) }),
      mkEvent({ event_type: 'NO_SHOW', event_time: hoursFromBase(1) }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START });

    expect(episodes).toHaveLength(1);
    expect(episodes[0].terminalOutcome).toBe('no_show');
    expect(episodes[0].attended).toBe(false);
  });

  // 10. Open episode (no closing event, not completed)
  it('marks episode as open when no closing event and not completed', () => {
    const events: ShiftLifecycleEvent[] = [
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-48) }),
      mkEvent({ event_type: 'ACCEPTED', event_time: hoursFromBase(-47) }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START, completed: false });

    expect(episodes).toHaveLength(1);
    expect(episodes[0].terminalOutcome).toBe('open');
    expect(episodes[0].closedAt).toBeNull();
  });

  // 11. Events without employee_id are skipped
  it('skips events with null employee_id', () => {
    const events: ShiftLifecycleEvent[] = [
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-48), employee_id: null }),
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-47), employee_id: 'alice-uuid' }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START, completed: true });

    expect(episodes).toHaveLength(1);
    expect(episodes[0].employeeId).toBe('alice-uuid');
  });

  // 12. LATE_CANCEL_THRESHOLD_HOURS constant is 4
  it('exports LATE_CANCEL_THRESHOLD_HOURS = 4', () => {
    expect(LATE_CANCEL_THRESHOLD_HOURS).toBe(4);
  });

  // 13. Early out detection
  it('detects early_out from event', () => {
    const events: ShiftLifecycleEvent[] = [
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-48) }),
      mkEvent({ event_type: 'CHECKED_IN', event_time: hoursFromBase(0) }),
      mkEvent({ event_type: 'EARLY_OUT', event_time: hoursFromBase(3) }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START, completed: true });

    expect(episodes).toHaveLength(1);
    expect(episodes[0].earlyOut).toBe(true);
    expect(episodes[0].attended).toBe(true);
  });

  // 14. Opening event priority: ASSIGNED > OFFERED (matches SQL CASE hierarchy)
  it('derives openingEvent using priority hierarchy (ASSIGNED beats OFFERED)', () => {
    const events: ShiftLifecycleEvent[] = [
      mkEvent({ event_type: 'OFFERED', event_time: hoursFromBase(-48) }),
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-47) }),
      mkEvent({ event_type: 'ACCEPTED', event_time: hoursFromBase(-46) }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START, completed: true });

    expect(episodes).toHaveLength(1);
    // SQL: CASE WHEN had_emergency THEN ... WHEN had_swap_in THEN ... WHEN had_assign THEN 'ASSIGNED' ...
    // Both OFFERED and ASSIGNED are present, but ASSIGNED has higher priority.
    expect(episodes[0].openingEvent).toBe('ASSIGNED');
    expect(episodes[0].hadOffer).toBe(true);
    expect(episodes[0].hadAssign).toBe(true);
  });

  // 15. Opening event priority: EMERGENCY_ASSIGNED beats everything
  it('derives openingEvent with EMERGENCY_ASSIGNED priority', () => {
    const events: ShiftLifecycleEvent[] = [
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-48) }),
      mkEvent({ event_type: 'EMERGENCY_ASSIGNED', event_time: hoursFromBase(-47) }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START, completed: true });

    expect(episodes).toHaveLength(1);
    expect(episodes[0].openingEvent).toBe('EMERGENCY_ASSIGNED');
    expect(episodes[0].hadAssign).toBe(true);
    expect(episodes[0].hadEmergency).toBe(true);
  });

  // 16. Superseded episode must NOT be 'fulfilled' on a completed shift.
  //     Only the FINAL episode of a shift can be fulfilled (parity with the
  //     SQL view gating 'fulfilled' to episode_seq = max(episode_seq)).
  it('marks a superseded (replaced) episode as open, not fulfilled, even when completed', () => {
    const events: ShiftLifecycleEvent[] = [
      // Episode 1: Alice held the shift but was replaced with no explicit close event
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-48), employee_id: 'alice-uuid', employee_name: 'Alice' }),
      mkEvent({ event_type: 'ACCEPTED', event_time: hoursFromBase(-47), employee_id: 'alice-uuid', employee_name: 'Alice' }),
      // Episode 2: Bob takes over and actually works it
      mkEvent({ event_type: 'ASSIGNED', event_time: hoursFromBase(-24), employee_id: 'bob-uuid', employee_name: 'Bob' }),
      mkEvent({ event_type: 'CHECKED_IN', event_time: hoursFromBase(0), employee_id: 'bob-uuid', employee_name: 'Bob' }),
    ];

    const episodes = deriveEpisodes(events, { scheduledStart: SCHEDULED_START, completed: true });

    expect(episodes).toHaveLength(2);
    // Alice's episode was superseded — must be 'open', NOT 'fulfilled'
    expect(episodes[0].employeeId).toBe('alice-uuid');
    expect(episodes[0].terminalOutcome).toBe('open');
    // Only Bob's final episode is fulfilled
    expect(episodes[1].employeeId).toBe('bob-uuid');
    expect(episodes[1].terminalOutcome).toBe('fulfilled');
    expect(episodes[1].attended).toBe(true);
  });
});
