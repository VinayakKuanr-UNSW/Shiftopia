import { describe, it, expect } from 'vitest';
import { estimateDetailedCostFromShift } from '@/modules/rosters/domain/projections/utils/cost';
// The Security engine directly: `utils/cost` resolves to the legacy positional
// wrapper (utils/cost.ts wins over the cost/ directory).
import { estimateDetailedShiftCost } from '@/modules/rosters/domain/projections/utils/cost/security';

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

/**
 * cl 28.2 first aid, ported in migration 20261005063752. Live values from
 * `fn_eba_estimate_shift_cost(..., p_first_aid => true)` on 2026-10-05: each
 * is the base golden figure plus the effective-dated rate on PAID ordinary
 * hours — floored hours included, overtime hours excluded.
 */
const FIRST_AID_CASES: Array<{ base: string; expected: number; why: string }> = [
  { base: 'weekday-casual-L2',   expected: 246.61, why: '+7h x $0.59' },
  { base: 'overtime-ft-2h',      expected: 375.31, why: '+8 ordinary x $0.59; the 2 OT hours earn none' },
  { base: 'minengage-casual-1h', expected: 105.69, why: '+3 floored hours x $0.59' },
  { base: 'publicholiday-ft',    expected: 611.74, why: '+7.5h x $0.59' },
];

/**
 * cl 29 higher duties, ported in migration 20261008104434 (p_higher_duties).
 * An L4 member on an L6 shift is paid L6 for the whole shift, and under 4 paid
 * hours is topped up to 4 at the engagement-day rate (cl 29.1(a)). Live values
 * from `fn_eba_estimate_shift_cost(..., p_higher_duties => true)` on 2026-10-08.
 */
const HIGHER_DUTIES_CASES: Array<{ id: string; date: string; net: number; emp: string; firstAid?: boolean; expected: number; why: string }> = [
  { id: 'hd-casual-3h-thu',   date: '2026-10-08', net: 180, emp: 'Casual', expected: 172.48, why: '4h x $43.12' },
  { id: 'hd-casual-2h-sat',   date: '2026-10-10', net: 120, emp: 'Casual', expected: 206.98, why: '3h floor, then 4h at the Saturday rate' },
  { id: 'hd-casual-3h-sun',   date: '2026-10-11', net: 180, emp: 'Casual', expected: 241.47, why: 'the 4h Sunday floor already meets the minimum' },
  { id: 'hd-ft-3h-thu',       date: '2026-10-08', net: 180, emp: 'FT',     expected: 137.96, why: '4h x $34.49 — cl 29 is not limited to PT/casual' },
  { id: 'hd-ft-8h-thu',       date: '2026-10-08', net: 480, emp: 'FT',     expected: 275.92, why: '8h x $34.49, no top-up' },
  { id: 'hd-casual-firstaid', date: '2026-10-08', net: 180, emp: 'Casual', firstAid: true, expected: 174.84, why: '+4 paid hours x $0.59' },
];

const priceHigherDuties = (c: typeof HIGHER_DUTIES_CASES[number]) =>
  estimateDetailedCostFromShift({
    is_first_aid_duty: !!c.firstAid,
    shift_date: c.date,
    start_time: '09:00:00',
    end_time: '23:59:00',
    net_length_minutes: c.net,
    scheduled_length_minutes: c.net,
    remuneration_rate: null,
    actual_hourly_rate: null,
    remuneration_level: 4,
    higherDutiesLevel: 'LEVEL_6',
    target_employment_type: c.emp,
    unpaid_break_minutes: 0,
    roles: { name: 'Team Member' },
  } as never);

const price = (c: typeof CASES[number], firstAid = false) =>
  estimateDetailedCostFromShift({
    is_first_aid_duty: firstAid,
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

  it.each(FIRST_AID_CASES)('first aid (cl 28.2): $base $why', ({ base, expected }) => {
    expect(Number(price(CASES.find(c => c.id === base)!, true).toFixed(2))).toBe(expected);
  });

  it('first aid uses the FY25/26 rate before 6 Jul 2026 (live SQL: 217.84 -> 222.32)', () => {
    const c = { id: 'weekday-pt-fy2526', date: '2026-06-29', st: '09:00', net: 480, sched: 480, lvl: 3, emp: 'PT', expected: 217.84 };
    expect(Number(price(c).toFixed(2))).toBe(217.84);
    expect(Number(price(c, true).toFixed(2))).toBe(222.32); // +8h x $0.56
  });

  it.each(HIGHER_DUTIES_CASES)('higher duties (cl 29): $id — $why', (c) => {
    expect(Number(priceHigherDuties(c).totalCost.toFixed(2))).toBe(c.expected);
  });

  // Annualised FT Security is priced in internal.shift_cost (same migration),
  // not fn_eba_estimate_shift_cost: full span at the annualised rate, 12h cap,
  // overtime on the ORDINARY rate. Live values, L4 = $36.39 annualised /
  // $30.26 ordinary, L5 = $38.95, on 2026-10-08.
  it.each([
    { id: 'security-L4-12h',          date: '2026-10-08', st: '07:00', end: '19:00', net: 720, hd: undefined,  expected: 436.68 },
    { id: 'security-L4-14h',          date: '2026-10-08', st: '07:00', end: '21:00', net: 840, hd: undefined,  expected: 527.46 },
    { id: 'security-L4-hd-L5-3h-sat', date: '2026-10-10', st: '09:00', end: '12:00', net: 180, hd: 'LEVEL_5', expected: 155.8 },
  ])('annualised Security: $id', (c) => {
    const b = estimateDetailedShiftCost({
      netMinutes: c.net,
      start_time: c.st,
      end_time: c.end,
      rate: null,
      scheduled_length_minutes: c.net,
      is_overnight: false,
      is_cancelled: false,
      shift_date: c.date,
      employmentType: 'Full-Time',
      classificationLevel: 'LEVEL_4',
      higherDutiesLevel: c.hd,
      isSecurityRole: true,
    });
    expect(Number(b.totalCost.toFixed(2))).toBe(c.expected);
    expect(b.penaltyCost).toBe(0); // the annualised rate absorbs weekend loadings
  });

  it('books the cl 29.1(a) top-up hour in the Saturday loading split', () => {
    // Payslip lines are built from penaltyBreakdown — the top-up hour's loading
    // must be in it, or the lines fall short of the total.
    const b = priceHigherDuties(HIGHER_DUTIES_CASES.find(c => c.id === 'hd-casual-2h-sat')!);
    expect(b.penaltyBreakdown?.satHours).toBe(4);
  });
});
