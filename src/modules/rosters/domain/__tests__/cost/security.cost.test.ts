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
  shift_date: '2026-07-06',
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
