import { describe, it, expect } from 'vitest';
import { estimateDetailedShiftCost } from '../../projections/utils/cost/standard';
import type { CostCalculatorOptions } from '../../projections/utils/cost/types';

/**
 * Regression tests for the Standard cost engine — pins the EBA-correct behaviour
 * fixed in Phase 1 of the compliance audit:
 *   H1  FT/PT overtime must not double-count (ordinary + OT === net worked)
 *   C3  weekend/PH penalty and night allowance are NOT cumulative (cl. 41.4)
 *   M5  school-based apprentices get no +25% loading (Schedule 4 has none)
 * Plus penalty-rate sanity locks (cl. 41 / 56).
 *
 * Dates chosen relative to the project clock: 2026-07-04 = Saturday,
 * 2026-07-05 = Sunday, 2026-07-06 = Monday (none are NSW public holidays).
 */

const base = (o: Partial<CostCalculatorOptions>): CostCalculatorOptions => ({
  netMinutes: 0,
  start_time: '09:00',
  end_time: '17:00',
  rate: 30,
  scheduled_length_minutes: 480,
  is_overnight: false,
  is_cancelled: false,
  shift_date: '2026-07-06', // Monday
  employmentType: 'Full-Time',
  ...o,
});

describe('H1 — FT/PT overtime never double-counts', () => {
  it('a 10h worked / 8h rostered weekday shift bills exactly 10h, not 12h', () => {
    const r = estimateDetailedShiftCost(
      base({ netMinutes: 600, scheduled_length_minutes: 480, start_time: '09:00', end_time: '19:00' }),
    );
    expect(r.ordinaryHours).toBe(8);
    expect(r.overtimeHours).toBe(2);
    // The invariant that was broken: ordinary + overtime === net worked.
    expect(r.ordinaryHours + r.overtimeHours).toBe(10);
    // 8h ordinary @30 + 2h OT @1.5x30 = 240 + 90.
    expect(r.totalCost).toBeCloseTo(330, 5);
  });

  it('the normal projection path (net <= scheduled) is unchanged', () => {
    const r = estimateDetailedShiftCost(
      base({ netMinutes: 480, scheduled_length_minutes: 480, start_time: '09:00', end_time: '17:00' }),
    );
    expect(r.ordinaryHours).toBe(8);
    expect(r.overtimeHours).toBe(0);
    expect(r.totalCost).toBeCloseTo(240, 5);
  });
});

describe('C3 — weekend/PH penalty and night allowance are not cumulative (cl. 41.4 = MAX)', () => {
  // Phase 3 supersedes the earlier "zero the night allowance on a penalty day"
  // stance. cl 41.4 means pay the GREATER of the penalty loading and the night
  // allowance — not zero — and ordinary hours that cross midnight are split so
  // each calendar day carries its own penalty.
  it('a Saturday-night casual shift splits at midnight and pays the cl 41.4 MAX', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 480,
        scheduled_length_minutes: 480,
        start_time: '22:00',
        end_time: '06:00',
        is_overnight: true,
        shift_date: '2026-07-04', // Saturday 22:00 → Sunday 06:00
        employmentType: 'Casual',
        rate: 37.5, // casual base (ordinary 30)
      }),
    );
    // Sat 22:00–24:00 (2h): ordinary 30*(1.25+0.25)=45 → 90; night MAX(0.75,0.25)
    //   ⇒ +0.50 loading → 2*30*0.5 = 30.
    // Sun 00:00–06:00 (6h): ordinary 30*(1.25+0.50)=52.5 → 315; night MAX(0.75,0.50)
    //   ⇒ +0.25 loading → 6*30*0.25 = 45.
    expect(r.ordinaryHours).toBe(8);
    expect(r.ordinaryCost).toBeCloseTo(405, 5);           // 90 + 315
    expect(r.breakdown.nightAllowanceCost).toBeCloseTo(75, 5); // 30 + 45
    expect(r.allowanceCost).toBeCloseTo(75, 5);
    expect(r.totalCost).toBeCloseTo(480, 5);              // 405 + 75
  });

  it('a plain weekday night shift STILL gets the full night allowance (weekday penalty = 0)', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 480,
        scheduled_length_minutes: 480,
        start_time: '22:00',
        end_time: '06:00',
        is_overnight: true,
        shift_date: '2026-07-06', // Monday 22:00 → Tuesday 06:00, no weekend penalty
      }),
    );
    // FT weekday night allowance = 0.20 across all 8 night hours: 8*30*0.20 = 48.
    expect(r.breakdown.nightAllowanceCost).toBeCloseTo(48, 5);
    expect(r.ordinaryCost).toBeCloseTo(240, 5); // 8h * 30, no penalty
  });

  it('a public-holiday night shift suppresses the allowance for the PH hours only', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 480,
        scheduled_length_minutes: 480,
        start_time: '22:00',
        end_time: '06:00',
        is_overnight: true,
        shift_date: '2026-01-26', // Australia Day (PH, Mon) 22:00 → Tue 27th 06:00
        employmentType: 'Casual',
        rate: 37.5, // casual base (ordinary 30)
      }),
    );
    // PH Mon 22:00–24:00 (2h): ordinary 30*(1.25+1.5)=82.5 → 165; night MAX(0.45,1.5)
    //   ⇒ +0 (PH penalty dominates).
    // Tue 00:00–06:00 (6h, not a PH): ordinary 30*1.25=37.5 → 225; night 0.45 full
    //   ⇒ 6*30*0.45 = 81.
    expect(r.ordinaryCost).toBeCloseTo(390, 5);           // 165 + 225
    expect(r.breakdown.nightAllowanceCost).toBeCloseTo(81, 5);
    expect(r.totalCost).toBeCloseTo(471, 5);              // 390 + 81
  });
});

describe('penalty-rate locks (cl. 41 / 56)', () => {
  it('Sunday permanent ordinary is 150%', () => {
    const r = estimateDetailedShiftCost(
      base({ netMinutes: 480, scheduled_length_minutes: 480, shift_date: '2026-07-05' }),
    );
    // 8h @ (30 * 1.5) = 360
    expect(r.ordinaryCost).toBeCloseTo(360, 5);
  });
});

describe('M5 — school-based apprentices get no +25% loading', () => {
  it('applies only the Schedule 4 percentage, not an extra 1.25x', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 60,
        scheduled_length_minutes: 60,
        start_time: '09:00',
        end_time: '10:00',
        rate: 100,
        is_apprentice: true,
        apprentice_type: 'school_based',
        apprentice_year: 1,
      } as Partial<CostCalculatorOptions>),
    );
    // Year-1 school-based apprentice = 50% of base. Must be 50, not 62.5.
    expect(r.breakdown.baseRate).toBeCloseTo(50, 5);
  });
});

describe('M3 — minimum-payment floor (cl. 12.x / 56.2)', () => {
  it('a casual who works 1h on a weekday is paid the 3h minimum', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 60, scheduled_length_minutes: 60,
        start_time: '09:00', end_time: '10:00',
        employmentType: 'Casual', rate: 37.5, // casual base (ordinary 30)
      }),
    );
    expect(r.ordinaryHours).toBe(3);
    expect(r.totalCost).toBeCloseTo(3 * 37.5, 5); // 3h @ loaded casual weekday rate
  });

  it('a casual who works 1h on a Sunday is paid the 4h minimum at Sunday rate', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 60, scheduled_length_minutes: 60,
        start_time: '09:00', end_time: '10:00',
        shift_date: '2026-07-05', // Sunday
        employmentType: 'Casual', rate: 37.5,
      }),
    );
    expect(r.ordinaryHours).toBe(4);
    // 4h @ (ordinary 30 * 1.75 Sunday casual) = 210
    expect(r.ordinaryCost).toBeCloseTo(4 * 30 * 1.75, 5);
  });

  it('full-time is NOT floored (weekly-salaried, no per-engagement minimum)', () => {
    const r = estimateDetailedShiftCost(
      base({ netMinutes: 60, scheduled_length_minutes: 60, start_time: '09:00', end_time: '10:00' }),
    );
    expect(r.ordinaryHours).toBe(1);
  });

  it('does not inflate a normal above-floor casual shift', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 300, scheduled_length_minutes: 300,
        start_time: '09:00', end_time: '14:00',
        employmentType: 'Casual', rate: 37.5,
      }),
    );
    expect(r.ordinaryHours).toBe(5);
  });
});

describe('H3b — fixed allowances reach the total (Schedule 2)', () => {
  it('meal + protein-spill are added to a full-time shift cost', () => {
    const r = estimateDetailedShiftCost(
      base({ netMinutes: 480, scheduled_length_minutes: 480, allowances: { meal: true, proteinSpill: true } }),
    );
    expect(r.allowanceCost).toBeCloseTo(13.61 + 7.17, 5);
    expect(r.totalCost).toBeCloseTo(8 * 30 + 13.61 + 7.17, 5);
  });

  it('split-shift allowance is paid to a part-timer', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 300, scheduled_length_minutes: 300, start_time: '09:00', end_time: '14:00',
        employmentType: 'Part-Time', rate: 30, allowances: { splitShift: true },
      }),
    );
    expect(r.allowanceCost).toBeCloseTo(11.13, 5);
  });

  it('split-shift allowance is NOT paid to a casual (cl. 28.4)', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 300, scheduled_length_minutes: 300, start_time: '09:00', end_time: '14:00',
        employmentType: 'Casual', rate: 37.5, allowances: { splitShift: true },
      }),
    );
    expect(r.allowanceCost).toBe(0);
  });
});

describe('HD — higher duties (cl. 29)', () => {
  it('prices the WHOLE shift at the higher grade when higherDutiesLevel > substantive', () => {
    // Substantive resolves from classificationLevel LEVEL_1 permanent (25.65).
    // Higher duties LEVEL_5 permanent (30.82) is greater ⇒ base becomes 30.82.
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 480, scheduled_length_minutes: 480,
        rate: null, classificationLevel: 'LEVEL_1', higherDutiesLevel: 'LEVEL_5',
        employmentType: 'Full-Time',
      }),
    );
    expect(r.breakdown.baseRate).toBeCloseTo(30.82, 5);
    // 8h weekday ordinary @ 30.82 = 246.56.
    expect(r.ordinaryCost).toBeCloseTo(8 * 30.82, 5);
  });

  it('NEVER underpays: a lower higher-duties grade leaves the substantive rate untouched', () => {
    // Substantive rate 30 explicit; higher duties LEVEL_1 permanent (25.65) is
    // LOWER ⇒ max() keeps 30. Higher duties is a top-up, never a demotion.
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 480, scheduled_length_minutes: 480,
        rate: 30, higherDutiesLevel: 'LEVEL_1', employmentType: 'Full-Time',
      }),
    );
    expect(r.breakdown.baseRate).toBeCloseTo(30, 5);
    expect(r.ordinaryCost).toBeCloseTo(240, 5);
  });

  it('resolves the CASUAL column of the higher grade for a casual member', () => {
    // LEVEL_5 casual = 38.52 ⇒ ordinary 38.52/1.25 = 30.816. 8h weekday casual
    // ordinary = 8 * 38.52 = 308.16 (loaded).
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 480, scheduled_length_minutes: 480,
        rate: null, classificationLevel: 'LEVEL_1', higherDutiesLevel: 'LEVEL_5',
        employmentType: 'Casual',
      }),
    );
    expect(r.breakdown.baseRate).toBeCloseTo(38.52, 5);
    expect(r.ordinaryCost).toBeCloseTo(8 * 38.52, 5);
  });

  it('does NOT apply higher duties to a trainee/apprentice/SWS rate path', () => {
    // is_apprentice short-circuits the classification path — higherDutiesLevel is
    // ignored, so the base stays the Schedule-4-derived value.
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 60, scheduled_length_minutes: 60, start_time: '09:00', end_time: '10:00',
        rate: 100, is_apprentice: true, apprentice_type: 'adult', apprentice_year: 1,
        higherDutiesLevel: 'LEVEL_7',
      } as Partial<CostCalculatorOptions>),
    );
    // Adult year-1 apprentice = 80% of 100 = 80 — higher duties must not lift it.
    expect(r.breakdown.baseRate).toBeCloseTo(80, 5);
  });
});

describe('OT-split — overnight overtime day-split (cl. 42)', () => {
  it('prices only the OT hours ON a public-holiday day at 2.5x', () => {
    // FT, scheduled 2h, net 10h ⇒ 8h daily OT. Start 22:00 on 2026-01-25 (Sun);
    // ordinary 22:00–24:00 stays on Sunday, the 8h OT tail (00:00–08:00) lands
    // entirely on 2026-01-26 Australia Day (PH). Every OT hour on the PH day pays
    // MAX(tiered, 2.5x) = 2.5x ⇒ 8 * 2.5 * 30 = 600.
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 600, scheduled_length_minutes: 120,
        start_time: '22:00', end_time: '08:00', is_overnight: true,
        shift_date: '2026-01-25', rate: 30, employmentType: 'Full-Time',
      }),
    );
    expect(r.overtimeHours).toBe(8);
    expect(r.overtimeCost).toBeCloseTo(8 * 2.5 * 30, 5);
  });

  it('the SAME shape whose OT tail lands on a NON-PH day keeps the 1.5/2.0 tiering', () => {
    // Start 22:00 on 2026-07-04 (Sat); the 8h OT tail lands on Sun 2026-07-05
    // (not a PH). Non-PH ⇒ cumulative tiering: 3h@1.5 + 5h@2.0 = 14.5 cost-hours.
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 600, scheduled_length_minutes: 120,
        start_time: '22:00', end_time: '08:00', is_overnight: true,
        shift_date: '2026-07-04', rate: 30, employmentType: 'Full-Time',
      }),
    );
    expect(r.overtimeHours).toBe(8);
    expect(r.overtimeCost).toBeCloseTo((3 * 1.5 + 5 * 2.0) * 30, 5); // 435
  });

  it('a same-day (non-overnight) PH overtime shift is unchanged (whole run 2.5x)', () => {
    // Regression guard: same-day PH OT must still be flat 2.5x across all OT hours.
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 600, scheduled_length_minutes: 480,
        start_time: '09:00', end_time: '19:00',
        shift_date: '2026-01-26', rate: 30, employmentType: 'Full-Time',
      }),
    );
    expect(r.overtimeHours).toBe(2);
    expect(r.overtimeCost).toBeCloseTo(2 * 2.5 * 30, 5); // 150
  });
});

describe('L1 — leave pay (cl. 38 annual-leave loading / NES personal-carer)', () => {
  it('annual leave on a weekday pays ordinary + 17.5% loading (loading > penalties)', () => {
    const r = estimateDetailedShiftCost(
      base({ netMinutes: 480, scheduled_length_minutes: 480, isAnnualLeave: true }),
    );
    // 8h * 30 * 1.175 = 282, with no penalties / night / OT / allowances.
    expect(r.ordinaryHours).toBe(8);
    expect(r.totalCost).toBeCloseTo(282, 5);
    expect(r.ordinaryCost).toBeCloseTo(282, 5);
    expect(r.overtimeCost).toBe(0);
    expect(r.penaltyCost).toBe(0);
    expect(r.allowanceCost).toBe(0);
  });

  it('annual leave on a Saturday pays the Saturday penalty (penalties > 17.5%)', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 480, scheduled_length_minutes: 480,
        shift_date: '2026-07-04', // Saturday
        isAnnualLeave: true,
      }),
    );
    // greater of 8*30*1.175 (282) and the as-worked Saturday value 8*30*1.25 (300).
    expect(r.totalCost).toBeCloseTo(300, 5);
    expect(r.ordinaryCost).toBeCloseTo(300, 5);
  });

  it('personal / carer leave pays the ordinary base rate — no loading, no penalties', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 480, scheduled_length_minutes: 480,
        shift_date: '2026-07-04', // Saturday — must NOT attract the weekend penalty
        isPersonalLeave: true,
      }),
    );
    expect(r.totalCost).toBeCloseTo(240, 5); // 8h * 30, flat
    expect(r.allowanceCost).toBe(0);
  });

  it('a casual accrues no paid leave — a leave-flagged casual shift costs nothing', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 480, scheduled_length_minutes: 480,
        employmentType: 'Casual', rate: 37.5, isAnnualLeave: true,
      }),
    );
    expect(r.totalCost).toBe(0);
    expect(r.ordinaryHours).toBe(0);
  });

  it('leave suppresses overtime and fixed allowances', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 600, scheduled_length_minutes: 480, // 10h "worked", 8h rostered
        start_time: '09:00', end_time: '19:00',
        allowances: { meal: true }, isAnnualLeave: true,
      }),
    );
    // Only ordinary 8h + 17.5% (282) — no 2h overtime, no meal allowance.
    expect(r.overtimeHours).toBe(0);
    expect(r.overtimeCost).toBe(0);
    expect(r.allowanceCost).toBe(0);
    expect(r.totalCost).toBeCloseTo(282, 5);
  });
});
