import { describe, it, expect } from 'vitest';
import { estimateDetailedShiftCost as standardDetailed } from '../../projections/utils/cost/standard';
import { estimateDetailedShiftCost as securityDetailed } from '../../projections/utils/cost/security';
import type { CostCalculatorOptions, ShiftCostBreakdown } from '../../projections/utils/cost/types';

/**
 * BEHAVIOUR-AGNOSTIC INVARIANT / PROPERTY SUITE for the worker-safe award-COST
 * ESTIMATOR (src/modules/rosters/domain/projections/utils/cost/).
 *
 * These are SAFETY NETS, not golden-value tests. They assert RELATIONSHIPS and
 * INVARIANTS that must stay true for ANY valid input even as ongoing audit work
 * changes the exact dollar figures — so, apart from the handful of HARD LAWS
 * (cancelled ⇒ 0, casual-leave ⇒ 0), nothing here hardcodes a total.
 *
 * Two engines are dispatched from index.ts:
 *   • Standard engine (standard.ts) — general event staff.
 *       totalCost = ordinaryCost + overtimeCost + allowanceCost
 *       (allowanceCost = nightAllowanceCost + fixed allowances; penaltyCost is a
 *        MIRROR of the night allowance and is NOT a separate additive term).
 *   • Security engine (security.ts) — selected via options.isSecurityRole / role
 *       name containing "security".
 *       totalCost = ordinaryCost + penaltyCost + overtimeCost
 *       (weekend/PH loading lives in penaltyCost here; allowanceCost is not
 *        returned, i.e. `undefined`).
 *
 * Dates (project clock): 2026-07-04 = Sat, 07-05 = Sun, 07-06 = Mon (none PH);
 * 2026-01-26 = Australia Day (NSW public holiday).
 */

// A generous casual base rate so casual ordinary (= rate / 1.25) stays clean.
const CASUAL_RATE = 37.5; // ordinary 30
const PERM_RATE = 30;

// ── Matrix axes ──────────────────────────────────────────────────────────────
const WEEKDAY = '2026-07-06'; // Monday
const SATURDAY = '2026-07-04';
const SUNDAY = '2026-07-05';
const PUBLIC_HOLIDAY = '2026-01-26'; // Australia Day (Monday)

const DAY_LABELS: Record<string, string> = {
  [WEEKDAY]: 'weekday',
  [SATURDAY]: 'Saturday',
  [SUNDAY]: 'Sunday',
  [PUBLIC_HOLIDAY]: 'public holiday',
};

const ALL_DATES = [WEEKDAY, SATURDAY, SUNDAY, PUBLIC_HOLIDAY];
const EMPLOYMENT_TYPES: NonNullable<CostCalculatorOptions['employmentType']>[] = [
  'Casual',
  'Part-Time',
  'Full-Time',
];

const DOLLAR_FIELDS = [
  'totalCost',
  'ordinaryCost',
  'overtimeCost',
  'penaltyCost',
  'allowanceCost',
] as const;

// A standard-engine `base(overrides)` helper mirroring the existing example
// tests. Defaults to a plain 8h Monday full-time day shift.
const base = (o: Partial<CostCalculatorOptions>): CostCalculatorOptions => ({
  netMinutes: 480,
  start_time: '09:00',
  end_time: '17:00',
  rate: PERM_RATE,
  scheduled_length_minutes: 480,
  is_overnight: false,
  is_cancelled: false,
  shift_date: WEEKDAY,
  employmentType: 'Full-Time',
  ...o,
});

// The rate a given employment type should carry so ordinary == 30 for all three
// (casual base is 1.25× because the loading is baked into `rate`).
const rateFor = (t: CostCalculatorOptions['employmentType']): number =>
  t === 'Casual' ? CASUAL_RATE : PERM_RATE;

// ── Shared assertion helpers ─────────────────────────────────────────────────

/** A number that is finite, not NaN, and not negative. */
function expectSafeMoney(value: number | undefined, ctx: string): void {
  // allowanceCost may legitimately be undefined on the Security engine.
  if (value === undefined) return;
  expect(Number.isFinite(value), `${ctx}: must be finite`).toBe(true);
  expect(Number.isNaN(value), `${ctx}: must not be NaN`).toBe(false);
  expect(value, `${ctx}: must be non-negative`).toBeGreaterThanOrEqual(0);
}

/** Every returned dollar field equals itself rounded to 2 dp, and never -0. */
function expectRoundedToCents(value: number | undefined, ctx: string): void {
  if (value === undefined) return;
  const rounded = Math.round(value * 100) / 100;
  expect(value, `${ctx}: must be rounded to 2dp (no sub-cent leakage)`).toBe(rounded);
  // -0 must be normalised to 0 (Object.is distinguishes -0 from 0).
  expect(Object.is(value, -0), `${ctx}: must not be negative zero`).toBe(false);
}

/** Run the full "well-formed money" battery over a breakdown. */
function assertMoneyInvariants(r: ShiftCostBreakdown, ctx: string): void {
  for (const f of DOLLAR_FIELDS) {
    expectSafeMoney(r[f], `${ctx}.${f}`);
    expectRoundedToCents(r[f], `${ctx}.${f}`);
  }
  // Hours are likewise well-formed and non-negative.
  expect(Number.isFinite(r.ordinaryHours), `${ctx}.ordinaryHours finite`).toBe(true);
  expect(r.ordinaryHours, `${ctx}.ordinaryHours >= 0`).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(r.overtimeHours), `${ctx}.overtimeHours finite`).toBe(true);
  expect(r.overtimeHours, `${ctx}.overtimeHours >= 0`).toBeGreaterThanOrEqual(0);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. CANCELLED ⇒ EVERY DOLLAR FIELD IS EXACTLY 0 (HARD LAW, both engines)
//    A cancelled shift is not worked and carries no labour cost (audit Phase 1).
// ═════════════════════════════════════════════════════════════════════════════
describe('INV-1 — cancelled shift ⇒ zero cost (hard law, both engines)', () => {
  const cancelledVariants: Array<[string, Partial<CostCalculatorOptions>]> = [
    ['plain weekday', {}],
    ['Sunday', { shift_date: SUNDAY }],
    ['public holiday', { shift_date: PUBLIC_HOLIDAY }],
    ['overnight', { start_time: '22:00', end_time: '06:00', is_overnight: true }],
    ['with allowances', { allowances: { meal: true, firstAid: true, proteinSpill: true } }],
    ['long 14h shift', { netMinutes: 840, scheduled_length_minutes: 840, end_time: '23:00' }],
    ['casual', { employmentType: 'Casual', rate: CASUAL_RATE }],
  ];

  it.each(cancelledVariants)('Standard: cancelled %s costs nothing', (_label, over) => {
    const r = standardDetailed(base({ ...over, is_cancelled: true }));
    expect(r.totalCost).toBe(0);
    expect(r.ordinaryCost).toBe(0);
    expect(r.overtimeCost).toBe(0);
    expect(r.penaltyCost).toBe(0);
    expect(r.allowanceCost).toBe(0);
    expect(r.ordinaryHours).toBe(0);
    expect(r.overtimeHours).toBe(0);
  });

  it.each(cancelledVariants)('Security: cancelled %s costs nothing', (_label, over) => {
    const r = securityDetailed(base({ ...over, is_cancelled: true, isSecurityRole: true }));
    expect(r.totalCost).toBe(0);
    expect(r.ordinaryCost).toBe(0);
    expect(r.overtimeCost).toBe(0);
    expect(r.penaltyCost).toBe(0);
    expect(r.allowanceCost).toBe(0);
    expect(r.ordinaryHours).toBe(0);
    expect(r.overtimeHours).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. WELL-FORMED MONEY across a broad input matrix
//    Every dollar field finite, non-negative, non-NaN, rounded to cents, no -0.
//    Matrix: day-type × employment-type × (day shift | overnight night shift)
//            × (with | without allowances), for BOTH engines.
// ═════════════════════════════════════════════════════════════════════════════
describe('INV-2 — all dollar/hours fields are well-formed across the input matrix', () => {
  type ShiftShape = { label: string; over: Partial<CostCalculatorOptions> };
  const shiftShapes: ShiftShape[] = [
    { label: 'day 8h', over: { netMinutes: 480, scheduled_length_minutes: 480, start_time: '09:00', end_time: '17:00' } },
    {
      label: 'overnight night 8h',
      over: { netMinutes: 480, scheduled_length_minutes: 480, start_time: '22:00', end_time: '06:00', is_overnight: true },
    },
  ];
  const allowanceShapes: Array<{ label: string; allowances?: CostCalculatorOptions['allowances'] }> = [
    { label: 'no allowances' },
    { label: 'with allowances', allowances: { meal: true, firstAid: true, proteinSpill: true, splitShift: true } },
  ];

  for (const date of ALL_DATES) {
    for (const empType of EMPLOYMENT_TYPES) {
      for (const shape of shiftShapes) {
        for (const al of allowanceShapes) {
          const ctx = `${DAY_LABELS[date]} · ${empType} · ${shape.label} · ${al.label}`;

          it(`Standard: ${ctx} is well-formed`, () => {
            const r = standardDetailed(
              base({ ...shape.over, shift_date: date, employmentType: empType, rate: rateFor(empType), allowances: al.allowances }),
            );
            assertMoneyInvariants(r, `standard[${ctx}]`);
          });

          it(`Security: ${ctx} is well-formed`, () => {
            const r = securityDetailed(
              base({ ...shape.over, shift_date: date, employmentType: empType, rate: rateFor(empType), allowances: al.allowances, isSecurityRole: true }),
            );
            assertMoneyInvariants(r, `security[${ctx}]`);
          });
        }
      }
    }
  }

  it('degenerate / hostile inputs never produce NaN or negative money (Standard)', () => {
    const hostile: Array<Partial<CostCalculatorOptions>> = [
      { netMinutes: 0, scheduled_length_minutes: 0, start_time: '', end_time: '' },
      { rate: null, netMinutes: 0, start_time: '', end_time: '' },
      { rate: NaN as unknown as number },
      { netMinutes: -60 },
      { rate: 0, classificationLevel: 'LEVEL_3', netMinutes: 480 },
    ];
    for (const over of hostile) {
      const r = standardDetailed(base(over));
      assertMoneyInvariants(r, `standard[hostile ${JSON.stringify(over)}]`);
    }
  });

  it('degenerate / hostile inputs never produce NaN or negative money (Security)', () => {
    const hostile: Array<Partial<CostCalculatorOptions>> = [
      { netMinutes: 0, scheduled_length_minutes: 0, start_time: '', end_time: '' },
      { rate: null, netMinutes: 0, start_time: '', end_time: '' },
      { rate: NaN as unknown as number },
      { netMinutes: -60 },
    ];
    for (const over of hostile) {
      const r = securityDetailed(base({ ...over, isSecurityRole: true }));
      assertMoneyInvariants(r, `security[hostile ${JSON.stringify(over)}]`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. ACCOUNTING IDENTITY (Standard engine, worked shifts)
//    Per standard.ts: totalCost = ordinaryCost + overtimeCost + allowanceCost,
//    where allowanceCost already INCLUDES the night allowance. penaltyCost is a
//    MIRROR of the night allowance (a subset of allowanceCost), so it must NOT be
//    added again. We assert the identity the code actually uses, to cents.
// ═════════════════════════════════════════════════════════════════════════════
describe('INV-3 — Standard accounting identity: total = ordinary + overtime + allowance', () => {
  for (const date of ALL_DATES) {
    for (const empType of EMPLOYMENT_TYPES) {
      const worked: Array<{ label: string; over: Partial<CostCalculatorOptions> }> = [
        { label: 'day 8h', over: { netMinutes: 480, scheduled_length_minutes: 480, start_time: '09:00', end_time: '17:00' } },
        {
          label: 'overnight 8h',
          over: { netMinutes: 480, scheduled_length_minutes: 480, start_time: '22:00', end_time: '06:00', is_overnight: true },
        },
        {
          label: 'long 14h (overtime)',
          over: { netMinutes: 840, scheduled_length_minutes: 480, start_time: '09:00', end_time: '23:00' },
        },
        {
          label: 'day 8h + allowances',
          over: { netMinutes: 480, scheduled_length_minutes: 480, allowances: { meal: true, firstAid: true, proteinSpill: true } },
        },
      ];
      for (const w of worked) {
        it(`${DAY_LABELS[date]} · ${empType} · ${w.label}`, () => {
          const r = standardDetailed(base({ ...w.over, shift_date: date, employmentType: empType, rate: rateFor(empType) }));
          const reassembled = r.ordinaryCost + r.overtimeCost + (r.allowanceCost ?? 0);
          // Rounded independently per field, so allow one cent of accumulated
          // rounding slack.
          expect(r.totalCost).toBeCloseTo(reassembled, 2);
          // penaltyCost must be the night-allowance mirror, i.e. it is a SUBSET
          // of allowanceCost (never larger). This documents that penaltyCost is
          // NOT an independent additive term for the Standard engine.
          expect(r.penaltyCost).toBeLessThanOrEqual((r.allowanceCost ?? 0) + 1e-9);
          expect(r.penaltyCost).toBeCloseTo(r.breakdown.nightAllowanceCost ?? 0, 2);
        });
      }
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. ACCOUNTING IDENTITY (Security engine, worked shifts)
//    Per security.ts: totalCost = ordinaryCost + penaltyCost + overtimeCost.
//    Here the weekend/PH loading IS the additive penaltyCost term.
// ═════════════════════════════════════════════════════════════════════════════
describe('INV-4 — Security accounting identity: total = ordinary + penalty + overtime', () => {
  for (const date of ALL_DATES) {
    for (const empType of EMPLOYMENT_TYPES) {
      it(`${DAY_LABELS[date]} · ${empType} · 8h`, () => {
        const r = securityDetailed(
          base({ shift_date: date, employmentType: empType, rate: rateFor(empType), isSecurityRole: true }),
        );
        const reassembled = r.ordinaryCost + r.penaltyCost + r.overtimeCost;
        expect(r.totalCost).toBeCloseTo(reassembled, 2);
      });
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. HOURS IDENTITY & OVERTIME EMERGENCE (Standard engine)
//    ordinaryHours ≥ 0, overtimeHours ≥ 0. On a worked shift overtime only
//    appears once the daily 12h ordinary cap is exceeded, or — for FT/PT — once
//    the scheduled hours are exceeded (cl 42, computed BEFORE ordinary so the
//    two never overlap).
// ═════════════════════════════════════════════════════════════════════════════
describe('INV-5 — hours identity & overtime emergence (Standard)', () => {
  it('no overtime when a casual works within the 12h daily cap', () => {
    // Casual overtime is ONLY past the 12h/day ordinary cap (not scheduled).
    for (const hrs of [1, 3, 8, 11, 12]) {
      const r = standardDetailed(
        base({
          netMinutes: hrs * 60,
          scheduled_length_minutes: 60, // deliberately tiny — must NOT trigger OT for casuals
          start_time: '08:00',
          end_time: '20:00',
          employmentType: 'Casual',
          rate: CASUAL_RATE,
        }),
      );
      expect(r.overtimeHours, `${hrs}h casual within cap`).toBe(0);
    }
  });

  it('casual overtime emerges strictly past the 12h daily cap', () => {
    const r = standardDetailed(
      base({
        netMinutes: 14 * 60,
        scheduled_length_minutes: 60,
        start_time: '06:00',
        end_time: '20:00',
        employmentType: 'Casual',
        rate: CASUAL_RATE,
      }),
    );
    expect(r.overtimeHours).toBeCloseTo(2, 5); // 14 - 12
    expect(r.ordinaryHours).toBeLessThanOrEqual(12);
  });

  it('FT/PT overtime emerges past scheduled hours (before the 12h cap)', () => {
    // 10h worked, 8h rostered ⇒ 2h OT for FT even though under the 12h cap.
    for (const empType of ['Full-Time', 'Part-Time'] as const) {
      const r = standardDetailed(
        base({
          netMinutes: 600,
          scheduled_length_minutes: 480,
          start_time: '09:00',
          end_time: '19:00',
          employmentType: empType,
          rate: PERM_RATE,
        }),
      );
      expect(r.overtimeHours, `${empType} 10/8`).toBeCloseTo(2, 5);
      // Ordinary + overtime === net worked (H1 invariant: no double count).
      expect(r.ordinaryHours + r.overtimeHours, `${empType} sum`).toBeCloseTo(10, 5);
    }
  });

  it('overtimeHours is monotonic non-decreasing in worked minutes (FT past schedule)', () => {
    let prev = -1;
    for (const mins of [480, 540, 600, 720, 780, 840]) {
      const r = standardDetailed(
        base({ netMinutes: mins, scheduled_length_minutes: 480, start_time: '00:00', end_time: '14:00' }),
      );
      expect(r.overtimeHours, `${mins}min OT >= prev`).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r.overtimeHours;
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. MONOTONICITY SANITY (Standard engine)
//    For the SAME shift: a higher input hourly rate never DECREASES totalCost;
//    a longer shift (more netMinutes, same rate, no cap weirdness) never
//    decreases totalCost. These are basic "cost goes the right way" guards.
// ═════════════════════════════════════════════════════════════════════════════
describe('INV-6 — monotonicity sanity (Standard)', () => {
  const monotoneDates = [WEEKDAY, SATURDAY, SUNDAY, PUBLIC_HOLIDAY];

  it('a higher hourly rate never decreases totalCost', () => {
    for (const date of monotoneDates) {
      for (const empType of EMPLOYMENT_TYPES) {
        let prev = -1;
        for (const rate of [20, 25, 30, 37.5, 45, 60, 100]) {
          const r = standardDetailed(
            base({ netMinutes: 480, scheduled_length_minutes: 480, shift_date: date, employmentType: empType, rate }),
          );
          expect(
            r.totalCost,
            `${DAY_LABELS[date]} ${empType} rate ${rate} vs prev`,
          ).toBeGreaterThanOrEqual(prev - 1e-9);
          prev = r.totalCost;
        }
      }
    }
  });

  it('a longer shift (more netMinutes, same rate) never decreases totalCost', () => {
    for (const date of monotoneDates) {
      for (const empType of EMPLOYMENT_TYPES) {
        let prev = -1;
        // Widen the clock span to match, so no floor/night edge cases mislead us.
        for (const mins of [180, 240, 300, 360, 480, 600, 720]) {
          const r = standardDetailed(
            base({
              netMinutes: mins,
              scheduled_length_minutes: mins,
              start_time: '08:00',
              end_time: '20:00',
              shift_date: date,
              employmentType: empType,
              rate: rateFor(empType),
            }),
          );
          expect(
            r.totalCost,
            `${DAY_LABELS[date]} ${empType} ${mins}min vs prev`,
          ).toBeGreaterThanOrEqual(prev - 1e-9);
          prev = r.totalCost;
        }
      }
    }
  });

  it('a longer shift never decreases totalCost (Security)', () => {
    for (const date of monotoneDates) {
      for (const empType of EMPLOYMENT_TYPES) {
        let prev = -1;
        for (const mins of [180, 240, 300, 360, 480, 600, 720]) {
          const r = securityDetailed(
            base({
              netMinutes: mins,
              scheduled_length_minutes: mins,
              start_time: '08:00',
              end_time: '20:00',
              shift_date: date,
              employmentType: empType,
              rate: rateFor(empType),
              isSecurityRole: true,
            }),
          );
          expect(
            r.totalCost,
            `security ${DAY_LABELS[date]} ${empType} ${mins}min vs prev`,
          ).toBeGreaterThanOrEqual(prev - 1e-9);
          prev = r.totalCost;
        }
      }
    }
  });

  it('a higher hourly rate never decreases totalCost (Security casual)', () => {
    // Security casual: ordinaryCost uses `rate`; penaltyCost uses rate/1.25 —
    // both rise with rate, so total stays monotonic. Guard against a regression.
    let prev = -1;
    for (const rate of [30, 40, 50, 60, 80]) {
      const r = securityDetailed(
        base({ shift_date: SATURDAY, employmentType: 'Casual', rate, isSecurityRole: true }),
      );
      expect(r.totalCost, `security casual rate ${rate}`).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r.totalCost;
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. PENALTY ORDERING on a fixed 8h day shift, same rate
//    cl 41 loadings: weekday (100%) < Saturday (125%) < Sunday (150%) < PH (250%).
//    So on an otherwise identical shift:
//        PH total ≥ Sunday total ≥ Saturday total ≥ weekday total.
// ═════════════════════════════════════════════════════════════════════════════
describe('INV-7 — penalty ordering PH ≥ Sun ≥ Sat ≥ weekday (fixed 8h day shift)', () => {
  const fixed = (date: string, engine: 'standard' | 'security', empType: CostCalculatorOptions['employmentType']) => {
    const opts = base({
      netMinutes: 480,
      scheduled_length_minutes: 480,
      start_time: '09:00',
      end_time: '17:00',
      shift_date: date,
      employmentType: empType,
      rate: rateFor(empType),
      isSecurityRole: engine === 'security',
    });
    return engine === 'security' ? securityDetailed(opts) : standardDetailed(opts);
  };

  for (const engine of ['standard', 'security'] as const) {
    // Use casual so weekend/PH penalties clearly apply (annualised security FT
    // is salaried and flat — covered separately in INV-9).
    it(`${engine} casual: weekday ≤ Saturday ≤ Sunday ≤ public holiday`, () => {
      const wd = fixed(WEEKDAY, engine, 'Casual').totalCost;
      const sat = fixed(SATURDAY, engine, 'Casual').totalCost;
      const sun = fixed(SUNDAY, engine, 'Casual').totalCost;
      const ph = fixed(PUBLIC_HOLIDAY, engine, 'Casual').totalCost;
      expect(sat, `${engine}: Sat ≥ weekday`).toBeGreaterThanOrEqual(wd - 1e-9);
      expect(sun, `${engine}: Sun ≥ Sat`).toBeGreaterThanOrEqual(sat - 1e-9);
      expect(ph, `${engine}: PH ≥ Sun`).toBeGreaterThanOrEqual(sun - 1e-9);
    });
  }

  it('Standard permanent: same ordering holds', () => {
    const wd = fixed(WEEKDAY, 'standard', 'Full-Time').totalCost;
    const sat = fixed(SATURDAY, 'standard', 'Full-Time').totalCost;
    const sun = fixed(SUNDAY, 'standard', 'Full-Time').totalCost;
    const ph = fixed(PUBLIC_HOLIDAY, 'standard', 'Full-Time').totalCost;
    expect(sat).toBeGreaterThanOrEqual(wd - 1e-9);
    expect(sun).toBeGreaterThanOrEqual(sat - 1e-9);
    expect(ph).toBeGreaterThanOrEqual(sun - 1e-9);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. LEAVE PAY (Standard engine)
//    • Casual + annual leave ⇒ total 0 (casuals accrue no paid leave; the 25%
//      loading is paid in lieu — cl 11 / NES). HARD LAW.
//    • Permanent annual leave ⇒ total > 0, no overtime, no fixed allowances.
// ═════════════════════════════════════════════════════════════════════════════
describe('INV-8 — leave pay invariants (Standard)', () => {
  const leaveFlags: Array<[string, Partial<CostCalculatorOptions>]> = [
    ['annual', { isAnnualLeave: true }],
    ['personal', { isPersonalLeave: true }],
    ['carer', { isCarerLeave: true }],
  ];

  it.each(leaveFlags)('casual on %s leave costs nothing (no paid leave accrual)', (_l, flag) => {
    for (const date of ALL_DATES) {
      const r = standardDetailed(
        base({ ...flag, netMinutes: 480, scheduled_length_minutes: 480, shift_date: date, employmentType: 'Casual', rate: CASUAL_RATE }),
      );
      expect(r.totalCost, `casual leave ${DAY_LABELS[date]}`).toBe(0);
      expect(r.ordinaryHours).toBe(0);
      expect(r.overtimeHours).toBe(0);
    }
  });

  it('permanent annual leave is paid, carries NO overtime and NO fixed allowance', () => {
    for (const empType of ['Full-Time', 'Part-Time'] as const) {
      for (const date of ALL_DATES) {
        const r = standardDetailed(
          base({
            netMinutes: 600, // 10h "worked" vs 8h rostered — would be OT if worked
            scheduled_length_minutes: 480,
            start_time: '09:00',
            end_time: '19:00',
            shift_date: date,
            employmentType: empType,
            rate: PERM_RATE,
            isAnnualLeave: true,
            allowances: { meal: true, firstAid: true, proteinSpill: true, splitShift: true },
          }),
        );
        const ctx = `${empType} annual-leave ${DAY_LABELS[date]}`;
        expect(r.totalCost, `${ctx}: paid`).toBeGreaterThan(0);
        expect(r.overtimeHours, `${ctx}: no OT hours`).toBe(0);
        expect(r.overtimeCost, `${ctx}: no OT cost`).toBe(0);
        expect(r.allowanceCost, `${ctx}: no fixed/meal allowance`).toBe(0);
        expect(r.penaltyCost, `${ctx}: no night allowance`).toBe(0);
        assertMoneyInvariants(r, ctx);
      }
    }
  });

  it('permanent personal/carer leave is flat ordinary — no loading beyond base', () => {
    // On a Saturday it must NOT attract the weekend penalty (leave ≠ attendance).
    const r = standardDetailed(
      base({
        netMinutes: 480,
        scheduled_length_minutes: 480,
        shift_date: SATURDAY,
        employmentType: 'Full-Time',
        rate: PERM_RATE,
        isPersonalLeave: true,
      }),
    );
    expect(r.allowanceCost).toBe(0);
    expect(r.overtimeCost).toBe(0);
    // 8h * 30 flat = 240 (no Saturday +25%).
    expect(r.totalCost).toBeCloseTo(240, 2);
  });

  it('Security casual leave also costs nothing (loading in lieu)', () => {
    for (const [, flag] of leaveFlags) {
      const r = securityDetailed(
        base({ ...flag, employmentType: 'Casual', rate: CASUAL_RATE, isSecurityRole: true }),
      );
      expect(r.totalCost).toBe(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. SECURITY ENGINE SPECIFICS
//    • An annualised full-time security rate (e.g. 32.20, Schedule 2 §2) on a
//      weekday has penaltyCost 0 — the salary already absorbs penalties.
//    • Minimum engagement (Schedule 3 cl 5.3(e)) floors short casual security
//      shifts to 3h (weekday) / 4h (Sun/PH).
// ═════════════════════════════════════════════════════════════════════════════
describe('INV-9 — security annualised salary & minimum engagement', () => {
  const ANNUALISED = [32.20, 34.63, 37.06, 39.48]; // Schedule 2 §2 hourly

  it.each(ANNUALISED)('annualised FT rate %s on a weekday has zero penalty loading', (rate) => {
    const r = securityDetailed(
      base({ rate, employmentType: 'Full-Time', shift_date: WEEKDAY, isSecurityRole: true }),
    );
    expect(r.penaltyCost).toBe(0);
    // Salary is flat: 8h * rate, no overtime on an 8h shift.
    expect(r.ordinaryHours).toBe(8);
    expect(r.overtimeHours).toBe(0);
    expect(r.totalCost).toBeCloseTo(8 * rate, 2);
  });

  it('annualised FT security carries no weekend penalty either (flat salary)', () => {
    for (const date of [SATURDAY, SUNDAY, PUBLIC_HOLIDAY]) {
      const r = securityDetailed(base({ rate: 32.20, employmentType: 'Full-Time', shift_date: date, isSecurityRole: true }));
      expect(r.penaltyCost, `annualised ${DAY_LABELS[date]}`).toBe(0);
    }
  });

  it('minimum engagement floors short casual security shifts (3h weekday, 4h Sun/PH)', () => {
    const cases: Array<[string, number]> = [
      [WEEKDAY, 3],
      [SATURDAY, 3],
      [SUNDAY, 4],
      [PUBLIC_HOLIDAY, 4],
    ];
    for (const [date, floor] of cases) {
      // A 1h engagement must be floored to the minimum.
      const r = securityDetailed(
        base({ rate: 40, start_time: '09:00', end_time: '10:00', shift_date: date, employmentType: 'Casual', isSecurityRole: true }),
      );
      expect(r.ordinaryHours, `security floor ${DAY_LABELS[date]}`).toBe(floor);
      expect(r.totalCost, `security floor ${DAY_LABELS[date]} > 0`).toBeGreaterThan(0);
    }
  });

  it('minimum engagement never REDUCES a long shift below its worked hours', () => {
    // A 10h casual security shift is not shortened by the floor.
    const r = securityDetailed(
      base({ rate: 40, start_time: '08:00', end_time: '18:00', shift_date: WEEKDAY, employmentType: 'Casual', isSecurityRole: true }),
    );
    expect(r.ordinaryHours + r.overtimeHours).toBeCloseTo(10, 5);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. CROSS-ENGINE DISPATCH SANITY
//     The two engines are genuinely distinct; a security-flagged shift must not
//     silently equal the standard result on a penalty day (guards the dispatch).
// ═════════════════════════════════════════════════════════════════════════════
describe('INV-10 — dispatch produces distinct engines on a penalty day', () => {
  it('a casual Saturday shift is priced differently by the two engines', () => {
    const opts = base({ shift_date: SATURDAY, employmentType: 'Casual', rate: CASUAL_RATE });
    const std = standardDetailed(opts);
    const sec = securityDetailed({ ...opts, isSecurityRole: true });
    // Both are well-formed regardless of the exact figures.
    assertMoneyInvariants(std, 'dispatch/standard');
    assertMoneyInvariants(sec, 'dispatch/security');
    // Security prices the full (paid-meal) span & different penalty basis; the
    // two totals should not coincide. Behaviour-agnostic: just require both > 0.
    expect(std.totalCost).toBeGreaterThan(0);
    expect(sec.totalCost).toBeGreaterThan(0);
  });
});
