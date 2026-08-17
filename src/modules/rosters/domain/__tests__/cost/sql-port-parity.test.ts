import { describe, it, expect } from 'vitest';
import { estimateDetailedCostFromShift } from '@/modules/rosters/domain/projections/utils/cost';

/**
 * GOLDEN FIGURES for the SQL port of this engine.
 *
 * `public.fn_eba_estimate_shift_cost` (migration 20260807100000) reimplements
 * standard.ts in SQL so the Roster Planner footer can total a whole view
 * server-side — Bucket View deliberately fetches no raw shifts, so the client
 * cannot sum the cards.
 *
 * Two engines computing pay is a divergence risk, so these cases pin the TS
 * side. If a change here fails this test, the SQL port in that migration must
 * be updated to match before the change ships — otherwise the footer and the
 * cards will silently disagree.
 *
 * Verified equal against the live SQL function on 2026-08-07: 19/21 exact, 2
 * within $0.01. Those two differ only because TS rounds each cost COMPONENT
 * with Math.round() and IEEE-754 places e.g. 275.315*100 at 27531.499999999996,
 * so TS rounds down where exact decimal arithmetic rounds up. SQL is the
 * arithmetically correct side; the bound is one cent per shift.
 *
 * Cases cover: weekday, Saturday (+25%), Sunday (+50%), public holiday (+150%),
 * night allowance (22:00-06:00, casual and permanent rates, and the cl 41.4
 * non-cumulative cap against a weekend penalty), tiered overtime (1.5x/2.0x),
 * the 2.5x public-holiday overtime floor, the casual 12h-cap-only OT rule, the
 * cl 28.1 meal allowance, minimum engagement (3h / 4h Sunday / 4h PH / 2h
 * training / none for FT, and the plain-PT Sunday carve-out), and overnight
 * shifts crossing midnight into a different day type.
 */
const CASES: Array<{ id: string; date: string; st: string; net: number; sched: number; lvl: number; emp: string; expected: number }> = [
  { id: 'weekday-casual-L2',       date: '2026-08-06', st: '06:30', net: 420, sched: 450, lvl: 2, emp: 'Casual', expected: 242.48 },
  { id: 'weekday-ft-L5',           date: '2026-08-06', st: '08:30', net: 450, sched: 480, lvl: 5, emp: 'FT',     expected: 242.93 },
  { id: 'saturday-casual',         date: '2026-08-08', st: '06:30', net: 420, sched: 450, lvl: 2, emp: 'Casual', expected: 290.98 },
  { id: 'sunday-casual',           date: '2026-08-09', st: '06:30', net: 420, sched: 450, lvl: 2, emp: 'Casual', expected: 339.47 },
  { id: 'sunday-ft',               date: '2026-08-09', st: '08:30', net: 450, sched: 480, lvl: 5, emp: 'FT',     expected: 364.39 },
  { id: 'publicholiday-casual',    date: '2026-12-28', st: '06:30', net: 420, sched: 450, lvl: 2, emp: 'Casual', expected: 533.46 },
  { id: 'publicholiday-ft',        date: '2026-12-28', st: '08:30', net: 450, sched: 480, lvl: 5, emp: 'FT',     expected: 607.31 },
  { id: 'night-casual-2200',       date: '2026-08-06', st: '22:00', net: 420, sched: 450, lvl: 2, emp: 'Casual', expected: 290.98 },
  { id: 'night-ft-2200',           date: '2026-08-06', st: '22:00', net: 450, sched: 480, lvl: 5, emp: 'FT',     expected: 303.66 },
  { id: 'night-sat-2200',          date: '2026-08-08', st: '22:00', net: 420, sched: 450, lvl: 2, emp: 'Casual', expected: 339.47 },
  { id: 'overtime-ft-2h',          date: '2026-08-06', st: '08:00', net: 600, sched: 480, lvl: 5, emp: 'FT',     expected: 370.59 },
  { id: 'overtime-ft-5h',          date: '2026-08-06', st: '08:00', net: 780, sched: 480, lvl: 5, emp: 'FT',     expected: 548.73 },
  { id: 'overtime-casual-13h',     date: '2026-08-06', st: '06:00', net: 780, sched: 780, lvl: 2, emp: 'Casual', expected: 457.25 },
  { id: 'overtime-ph-ft',          date: '2026-12-28', st: '08:00', net: 660, sched: 480, lvl: 5, emp: 'FT',     expected: 905.02 },
  { id: 'minengage-casual-1h',     date: '2026-08-06', st: '09:00', net:  60, sched:  60, lvl: 2, emp: 'Casual', expected: 103.92 },
  { id: 'minengage-sun-casual-1h', date: '2026-08-09', st: '09:00', net:  60, sched:  60, lvl: 2, emp: 'Casual', expected: 193.98 },
  { id: 'minengage-pt-sun-1h',     date: '2026-08-09', st: '09:00', net:  60, sched:  60, lvl: 2, emp: 'PT',     expected: 124.70 },
  { id: 'minengage-ph-pt-1h',      date: '2026-12-28', st: '09:00', net:  60, sched:  60, lvl: 2, emp: 'PT',     expected: 277.10 },
  { id: 'minengage-ft-1h',         date: '2026-08-06', st: '09:00', net:  60, sched:  60, lvl: 5, emp: 'FT',     expected:  32.39 },
  { id: 'overnight-sat-into-sun',  date: '2026-08-08', st: '20:00', net: 480, sched: 510, lvl: 2, emp: 'Casual', expected: 374.11 },
  { id: 'overnight-into-ph',       date: '2026-12-27', st: '20:00', net: 480, sched: 510, lvl: 2, emp: 'Casual', expected: 498.82 },
];

const price = (c: typeof CASES[number]) =>
  estimateDetailedCostFromShift({
    shift_date: c.date,
    start_time: `${c.st}:00`,
    end_time: '23:59:00',
    net_length_minutes: c.net,
    scheduled_length_minutes: c.sched,
    remuneration_rate: null,
    actual_hourly_rate: null,
    remuneration_level: c.lvl,
    target_employment_type: c.emp,
    unpaid_break_minutes: 0,
    roles: { name: 'Team Member' },
  } as never).totalCost;

describe('EBA engine — golden figures mirrored by the SQL port', () => {
  it.each(CASES)('$id', (c) => {
    expect(Number(price(c).toFixed(2))).toBe(c.expected);
  });

  it('prices Saturday above a weekday and Sunday above Saturday (cl 41)', () => {
    const wd = price(CASES.find(c => c.id === 'weekday-casual-L2')!);
    const sat = price(CASES.find(c => c.id === 'saturday-casual')!);
    const sun = price(CASES.find(c => c.id === 'sunday-casual')!);
    const ph = price(CASES.find(c => c.id === 'publicholiday-casual')!);
    expect(sat).toBeGreaterThan(wd);
    expect(sun).toBeGreaterThan(sat);
    expect(ph).toBeGreaterThan(sun);
  });

  it('gives a full-time member no minimum-engagement top-up (cl 12)', () => {
    // 1h worked, 1h paid — PT/casual would be floored to 3h.
    expect(price(CASES.find(c => c.id === 'minengage-ft-1h')!)).toBeCloseTo(32.39, 2);
  });
});
