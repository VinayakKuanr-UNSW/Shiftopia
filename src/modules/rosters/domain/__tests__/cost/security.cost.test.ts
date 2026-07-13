import { describe, it, expect } from 'vitest';
import { estimateDetailedShiftCost } from '../../projections/utils/cost/security';
import type { CostCalculatorOptions } from '../../projections/utils/cost/types';

/**
 * Locks the Security cost engine (Schedule 3) so the Phase 2 effective-dating
 * refactor — annualised/ordinary rates moved out of security.ts into
 * rate-schedule.ts — is provably value-preserving.
 *
 * Dates: 2026-07-04 = Saturday, 2026-07-05 = Sunday, 2026-07-06 = Monday
 * (none are NSW public holidays). Security meal breaks are PAID, so the engine
 * prices the full clock span.
 */
const base = (o: Partial<CostCalculatorOptions>): CostCalculatorOptions => ({
  netMinutes: 0,
  start_time: '09:00',
  end_time: '17:00',
  rate: 40,
  scheduled_length_minutes: 480,
  is_overnight: false,
  is_cancelled: false,
  shift_date: '2026-06-29', // Monday (before the 6 Jul 2026 FY26/27 +5.1% increase)
  employmentType: 'Casual',
  ...o,
});

describe('Security engine — annualised full-time (Schedule 2 §2 / cl 4.1)', () => {
  it('Level 3 annualised weekday 8h pays salary with no penalty loading', () => {
    const r = estimateDetailedShiftCost(base({
      rate: 32.20, employmentType: 'Full-Time',
    }));
    expect(r.ordinaryHours).toBe(8);
    expect(r.overtimeHours).toBe(0);
    expect(r.penaltyCost).toBe(0);                 // annualised salary absorbs penalties
    expect(r.totalCost).toBeCloseTo(8 * 32.20, 2); // 257.60
  });
});

describe('Security engine — casual event security penalties (cl 6.2)', () => {
  it('Saturday 5h casual is paid 150% of ordinary (loaded)', () => {
    const r = estimateDetailedShiftCost(base({
      rate: 40, start_time: '09:00', end_time: '14:00', shift_date: '2026-07-04',
    }));
    // ordinary 40/hr; penalty adds (32 * 1.5 − 40) = 8/hr → effective 48/hr
    expect(r.ordinaryHours).toBe(5);
    expect(r.ordinaryCost).toBeCloseTo(5 * 40, 2); // 200
    expect(r.penaltyCost).toBeCloseTo(5 * 8, 2);   // 40
    expect(r.totalCost).toBeCloseTo(5 * 48, 2);    // 240
  });
});

describe('Security engine — minimum engagement (Schedule 3 cl 5.3(e))', () => {
  it('a 1h Sunday casual engagement is floored to 4h at the Sunday rate', () => {
    const r = estimateDetailedShiftCost(base({
      rate: 40, start_time: '09:00', end_time: '10:00', shift_date: '2026-07-05',
    }));
    // Sunday casual effective = 32 * 1.75 = 56/hr, floored to the 4h minimum
    expect(r.ordinaryHours).toBe(4);
    expect(r.totalCost).toBeCloseTo(4 * 56, 2);    // 224
  });
});

describe('Security engine — overtime tier (Sch 3 §6.3(c): 150% first THREE hours)', () => {
  it('a 15h casual engagement pays all 3 OT hours at time-and-a-half, not double time from hour 3', () => {
    const r = estimateDetailedShiftCost(base({
      netMinutes: 900, start_time: '', end_time: '', rate: 40,
    }));
    expect(r.ordinaryHours).toBe(12);
    expect(r.overtimeHours).toBe(3);
    // 3h @ 1.5 × ordinary 32 = 144 (the old 2h cap paid 2×1.5 + 1×2.0 = 160).
    expect(r.overtimeCost).toBeCloseTo(3 * 1.5 * 32, 2);
  });
});

describe('Security engine — overnight split + night allowance (§6.2 / cl 41 / cl 43)', () => {
  it('a casual Sat 22:00→Sun 06:00 shift prices each day and pays the conclusion-day night allowance', () => {
    const r = estimateDetailedShiftCost(base({
      rate: 40, start_time: '22:00', end_time: '06:00', is_overnight: true,
      shift_date: '2026-07-04', // Saturday → Sunday
    }));
    // ordinary earnings: 8h @ loaded 40 = 320.
    expect(r.ordinaryCost).toBeCloseTo(320, 2);
    // penalties per day: Sat 2h × 32 × 0.25 = 16; Sun 6h × 32 × 0.50 = 96.
    expect(r.penaltyCost).toBeCloseTo(112, 2);
    // night allowance: concludes Sunday ⇒ casual 0.75 (incl. loading) ⇒ 0.50 over
    // the loaded base; Sat 2h × 32 × (0.50−0.25) = 16; Sun 6h ⇒ +0 (penalty equal).
    expect(r.breakdown.nightAllowanceCost).toBeCloseTo(16, 2);
    expect(r.totalCost).toBeCloseTo(320 + 112 + 16, 2);
  });

  it('annualised full-time gets NO night allowance (salary in lieu, §4.1(b))', () => {
    const r = estimateDetailedShiftCost(base({
      rate: 32.20, employmentType: 'Full-Time',
      start_time: '18:00', end_time: '06:00', is_overnight: true,
      shift_date: '2026-07-04',
    }));
    expect(r.penaltyCost).toBe(0);
    expect(r.breakdown.nightAllowanceCost ?? 0).toBe(0);
    expect(r.totalCost).toBeCloseTo(12 * 32.20, 2);
  });
});

describe('Security engine — classification rate resolution (effective-dated)', () => {
  it('full-time LEVEL_3 with no explicit rate resolves the annualised hourly rate', () => {
    const r = estimateDetailedShiftCost(base({
      rate: null, classificationLevel: 'LEVEL_3', employmentType: 'Full-Time',
    }));
    expect(r.breakdown.baseRate).toBeCloseTo(32.20, 2);
    expect(r.penaltyCost).toBe(0); // annualised ⇒ salary absorbs penalties
  });

  it('casual LEVEL_3 with no explicit rate resolves the Schedule 2 §1 casual rate', () => {
    const r = estimateDetailedShiftCost(base({
      rate: null, classificationLevel: 'LEVEL_3', employmentType: 'Casual',
    }));
    expect(r.breakdown.baseRate).toBeCloseTo(34.04, 2);
    expect(r.breakdown.ordinaryRate).toBeCloseTo(27.23, 2);
  });

  it('honours higher duties (cl 29): FT L3 acting at L5 is paid the L5 annualised rate', () => {
    const r = estimateDetailedShiftCost(base({
      rate: null, classificationLevel: 'LEVEL_3', higherDutiesLevel: 'LEVEL_5',
      employmentType: 'Full-Time',
    }));
    expect(r.breakdown.baseRate).toBeCloseTo(37.06, 2); // L5 annualised, not L3's 32.20
    expect(r.penaltyCost).toBe(0);
  });

  it('higher duties never demotes: a lower HD grade leaves the substantive rate untouched', () => {
    const r = estimateDetailedShiftCost(base({
      rate: null, classificationLevel: 'LEVEL_5', higherDutiesLevel: 'LEVEL_3',
      employmentType: 'Casual',
    }));
    expect(r.breakdown.baseRate).toBeCloseTo(38.52, 2); // L5 casual stays
  });
});
