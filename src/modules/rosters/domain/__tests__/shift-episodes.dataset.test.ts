import { describe, it, expect } from 'vitest';
import { deriveEpisodes, type ShiftLifecycleEvent } from '../shift-episodes';

/**
 * Verification of the "10 Shifts" worked example against the actual episode
 * logic. The SQL view v_shift_assignment_episodes mirrors deriveEpisodes (shared
 * boundary rules), and get_marketplace_kpis sources the offer funnel + snapshots
 * from that view — so deriving these episodes in TS verifies the numbers the SQL
 * KPI layer produces.
 *
 * Event streams reflect the ACTUAL capture semantics:
 *   - ASSIGNED fires only on assigned_employee_id null→non-null.
 *   - ACCEPTED fires on assignment_outcome→'confirmed' — which happens for offer
 *     ACCEPTS, bid WINS (select_winner), and trade approvals. So a raw ACCEPTED
 *     event is NOT a reliable "offer accepted" signal; had_offer is.
 *   - OFFERED fires on entering S3.
 *   - A drop (S4→S5) unassigns → UNASSIGNED. A bid win → ASSIGNED(+ACCEPTED).
 *   - A swap approval → SWAPPED_OUT (old) + SWAPPED_IN (new).
 */

let t = 0;
const ev = (event_type: ShiftLifecycleEvent['event_type'], who: string): ShiftLifecycleEvent => ({
  event_id: `e${++t}`,
  event_type,
  event_time: new Date(Date.UTC(2026, 5, 1, 0, 0, t)).toISOString(),
  employee_id: who,
  employee_name: who,
  metadata: null,
});

/** Each shift's ledger (employee_id-bearing events), in order. */
const SHIFTS: Record<string, ShiftLifecycleEvent[]> = {
  // 1: Alice offered + accepted
  s1: [ev('ASSIGNED', 'Alice'), ev('OFFERED', 'Alice'), ev('ACCEPTED', 'Alice')],
  // 2: Bob offered + rejected; Charlie wins bid (ASSIGNED + ACCEPTED-as-confirm)
  s2: [ev('ASSIGNED', 'Bob'), ev('OFFERED', 'Bob'), ev('REJECTED', 'Bob'),
       ev('ASSIGNED', 'Charlie'), ev('ACCEPTED', 'Charlie')],
  // 3: David wins bid — NO offer
  s3: [ev('ASSIGNED', 'David'), ev('ACCEPTED', 'David')],
  // 4: Emma offered+accepted; swapped out to Frank
  s4: [ev('ASSIGNED', 'Emma'), ev('OFFERED', 'Emma'), ev('ACCEPTED', 'Emma'),
       ev('SWAPPED_OUT', 'Emma'), ev('SWAPPED_IN', 'Frank')],
  // 5: Grace offered+accepted; trade rejected → Grace stays (no swap events)
  s5: [ev('ASSIGNED', 'Grace'), ev('OFFERED', 'Grace'), ev('ACCEPTED', 'Grace')],
  // 6: Ian offered; offer ignored (expired)
  s6: [ev('ASSIGNED', 'Ian'), ev('OFFERED', 'Ian'), ev('IGNORED', 'Ian')],
  // 7: published to bidding, no bids, expired unfilled — NO employee-bearing events
  s7: [],
  // 8: Jack offered+accepted; dropped (UNASSIGNED); Kate wins bid
  s8: [ev('ASSIGNED', 'Jack'), ev('OFFERED', 'Jack'), ev('ACCEPTED', 'Jack'),
       ev('UNASSIGNED', 'Jack'), ev('ASSIGNED', 'Kate'), ev('ACCEPTED', 'Kate')],
  // 9: Lisa offered+accepted; trade expired → Lisa stays
  s9: [ev('ASSIGNED', 'Lisa'), ev('OFFERED', 'Lisa'), ev('ACCEPTED', 'Lisa')],
  // 10: Nina→Owen→Paul in DRAFT (only Nina gets ASSIGNED; Owen/Paul are non-null→non-null,
  //     no event), then published + Paul offered + accepted
  s10: [ev('ASSIGNED', 'Nina'), ev('OFFERED', 'Paul'), ev('ACCEPTED', 'Paul')],
};

type Ep = ReturnType<typeof deriveEpisodes>[number];
const allEpisodes = (): Ep[] =>
  Object.values(SHIFTS).flatMap((events) => deriveEpisodes(events, { completed: false }));

describe('10-shift worked example — offer funnel (episode-sourced)', () => {
  const eps = allEpisodes();
  const offered = eps.filter((e) => e.hadOffer);
  const accepted = offered.filter((e) => e.hadAccept);
  const ignored = offered.filter((e) => !e.hadAccept && e.terminalOutcome === 'ignored');
  const rejected = offered.filter(
    (e) => !e.hadAccept && e.terminalOutcome !== 'ignored' && e.terminalOutcome !== 'open',
  );

  it('counts 8 offers (had_offer), excluding bid-wins and trade-confirms', () => {
    expect(offered.length).toBe(8); // Shifts 1,2,4,5,6,8,9,10 — NOT 3 (bid) or 7 (no offer)
  });
  it('Offer Acceptance Rate = 6/8 = 75%', () => {
    expect(accepted.length).toBe(6);
    expect(Math.round((accepted.length / offered.length) * 1000) / 10).toBe(75);
  });
  it('Offer Rejection Rate = 1/8 = 12.5% (Bob)', () => {
    expect(rejected.length).toBe(1);
    expect(rejected[0].employeeId).toBe('Bob');
  });
  it('Offer Ignore Rate = 1/8 = 12.5% (Ian)', () => {
    expect(ignored.length).toBe(1);
    expect(ignored[0].employeeId).toBe('Ian');
  });
});

describe('10-shift worked example — published-active snapshots & churn', () => {
  // A snapshot = published-active episode (had_accept OR had_emergency OR had_swap_in).
  const snapshotsPerShift = Object.entries(SHIFTS).map(([id, events]) => {
    const snaps = deriveEpisodes(events, { completed: false }).filter(
      (e) => e.hadAccept || e.hadEmergency || e.hadSwapIn,
    );
    return { id, count: snaps.length };
  });
  const total = snapshotsPerShift.reduce((s, x) => s + x.count, 0);
  const distinct = snapshotsPerShift.filter((x) => x.count > 0).length;

  it('Shift 10 S2 churn (Nina/Owen) produces NO snapshot — only Paul', () => {
    expect(snapshotsPerShift.find((x) => x.id === 's10')!.count).toBe(1);
  });
  it('Shifts 6 & 7 produce NO published-active snapshot (offer-only / unfilled)', () => {
    expect(snapshotsPerShift.find((x) => x.id === 's6')!.count).toBe(0);
    expect(snapshotsPerShift.find((x) => x.id === 's7')!.count).toBe(0);
  });
  it('total snapshots = 10 across 8 distinct shifts', () => {
    expect(total).toBe(10);
    expect(distinct).toBe(8);
  });
  it('churn = 2 confirmed-owner changes (Shifts 4 & 8) — NOT 3', () => {
    // The example counts Bob→Charlie (Shift 2) as a change, but Bob only had a
    // REJECTED offer and never became an ACTIVE owner — so per the snapshot
    // principle it is not churn. Churn = snapshots - distinct = 10 - 8 = 2.
    expect(total - distinct).toBe(2);
  });
});
