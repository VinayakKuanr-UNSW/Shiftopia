/**
 * Regression tests for the 2026-07-21 Gross Pay / EA 2025 compliance audit
 * fixes that had no dedicated coverage elsewhere:
 *
 *   M2 — cl 12.3(e) vs cl 12.4(c)/12.5(c) vs Sch 3 §5.2(e)/§5.3(e): the Sunday
 *        minimum-engagement floor is 4h for Flexible Part-Time / Casual, but
 *        stays 3h for plain Part-Time (both the general and Security engines).
 *   L4 — `penaltyBreakdown` is populated by both engines and reconciles with
 *        the top-line Sat/Sun/PH loading amounts, so the UI's line-item
 *        decomposition (`computeShiftGrossPay.ts`) reads real engine data
 *        instead of re-deriving it independently.
 *   H4 — the Schedule 5 Cert IV +3.8% uplift no longer double-applies to
 *        adult trainees (whose table is already the published AQF IV figure)
 *        end-to-end through the full engine entry point, not just the
 *        isolated `getTraineeBaseRate()` helper already covered by
 *        `trainee-matrix.test.ts`.
 *
 * 2026-07-05 is a plain Sunday (not an NSW public holiday); 2026-07-04 is the
 * preceding Saturday. Both used throughout so day-of-week fixtures are stable.
 */
import { describe, it, expect } from 'vitest';
import { estimateDetailedShiftCost as standardCost } from '../../projections/utils/cost/standard';
import { estimateDetailedShiftCost as securityCost } from '../../projections/utils/cost/security';

const SUNDAY = '2026-07-05';
const SATURDAY = '2026-07-04';

describe('AUDIT M2 — Sunday minimum-engagement floor by employment type', () => {
  it('plain Part-Time: a 2h Sunday shift floors at 3h (cl 12.3(e) has no Sunday exception)', () => {
    const b = standardCost({
      netMinutes: 120, start_time: '10:00', end_time: '12:00', rate: 25.65,
      scheduled_length_minutes: 120, is_overnight: false, is_cancelled: false,
      shift_date: SUNDAY, employmentType: 'Part-Time', classificationLevel: 'LEVEL_1',
    } as any);
    expect(b.ordinaryHours).toBe(3);
  });

  it('Flexible Part-Time: a 2h Sunday shift floors at 4h (cl 12.4(c) exception)', () => {
    const b = standardCost({
      netMinutes: 120, start_time: '10:00', end_time: '12:00', rate: 25.65,
      scheduled_length_minutes: 120, is_overnight: false, is_cancelled: false,
      shift_date: SUNDAY, employmentType: 'Flexible Part-Time', classificationLevel: 'LEVEL_1',
    } as any);
    expect(b.ordinaryHours).toBe(4);
  });

  it('Casual: a 2h Sunday shift floors at 4h (cl 12.5(c) exception)', () => {
    const b = standardCost({
      netMinutes: 120, start_time: '10:00', end_time: '12:00', rate: 32.06,
      scheduled_length_minutes: 0, is_overnight: false, is_cancelled: false,
      shift_date: SUNDAY, employmentType: 'Casual', classificationLevel: 'LEVEL_1',
    } as any);
    expect(b.ordinaryHours).toBe(4);
  });

  it('plain Part-Time STILL floors a public holiday at 4h (cl 56.2 applies to all)', () => {
    // 2026-01-01 (New Year's Day) is a public holiday.
    const b = standardCost({
      netMinutes: 120, start_time: '10:00', end_time: '12:00', rate: 25.65,
      scheduled_length_minutes: 120, is_overnight: false, is_cancelled: false,
      shift_date: '2026-01-01', employmentType: 'Part-Time', classificationLevel: 'LEVEL_1',
    } as any);
    expect(b.ordinaryHours).toBe(4);
  });

  it('Security Part-Time Event Security: a 2h Sunday shift floors at 3h (Sch 3 §5.2(e))', () => {
    const b = securityCost({
      netMinutes: 120, start_time: '10:00', end_time: '12:00', rate: 25.65,
      scheduled_length_minutes: 120, is_overnight: false, is_cancelled: false,
      shift_date: SUNDAY, employmentType: 'Part-Time', classificationLevel: 'LEVEL_3',
    } as any);
    expect(b.ordinaryHours).toBe(3);
  });

  it('Security Casual Event Security: a 2h Sunday shift floors at 4h (Sch 3 §5.3(e))', () => {
    const b = securityCost({
      netMinutes: 120, start_time: '10:00', end_time: '12:00', rate: 34.04,
      scheduled_length_minutes: 0, is_overnight: false, is_cancelled: false,
      shift_date: SUNDAY, employmentType: 'Casual', classificationLevel: 'LEVEL_3',
    } as any);
    expect(b.ordinaryHours).toBe(4);
  });

  // F-locked 2026-07-28: training shifts floor at 2h, winning over every other
  // tier (Sunday/PH uplift, employment sub-type) — shared with the timesheets
  // billable floor via resolvePaymentMinEngagementMinutes().
  it('a training shift floors at 2h even on a Sunday, overriding the 4h uplift', () => {
    const b = standardCost({
      netMinutes: 60, start_time: '10:00', end_time: '11:00', rate: 25.65,
      scheduled_length_minutes: 60, is_overnight: false, is_cancelled: false,
      shift_date: SUNDAY, employmentType: 'Casual', classificationLevel: 'LEVEL_1',
      is_training_shift: true,
    } as any);
    expect(b.ordinaryHours).toBe(2);
  });

  it('Security training shift floors at 2h even on a Sunday', () => {
    const b = securityCost({
      netMinutes: 60, start_time: '10:00', end_time: '11:00', rate: 34.04,
      scheduled_length_minutes: 60, is_overnight: false, is_cancelled: false,
      shift_date: SUNDAY, employmentType: 'Casual', classificationLevel: 'LEVEL_3',
      is_training_shift: true,
    } as any);
    expect(b.ordinaryHours).toBe(2);
  });

  it('Full-Time gets no payment floor at all, training or otherwise', () => {
    const b = standardCost({
      netMinutes: 60, start_time: '10:00', end_time: '11:00', rate: 25.65,
      scheduled_length_minutes: 480, is_overnight: false, is_cancelled: false,
      shift_date: SUNDAY, employmentType: 'Full-Time', classificationLevel: 'LEVEL_1',
    } as any);
    expect(b.ordinaryHours).toBe(1); // raw 1h, un-floored
  });
});

describe('AUDIT L4 — penaltyBreakdown reconciles with the top-line penalty cost', () => {
  it('standard engine: a Sunday 8h shift attributes all hours to sunHours, priced at the 50% Sunday loading', () => {
    const b = standardCost({
      netMinutes: 480, start_time: '09:00', end_time: '17:00', rate: 25.65,
      scheduled_length_minutes: 480, is_overnight: false, is_cancelled: false,
      shift_date: SUNDAY, employmentType: 'Full-Time', classificationLevel: 'LEVEL_1',
    } as any);
    expect(b.penaltyBreakdown).toBeTruthy();
    const pb = b.penaltyBreakdown!;
    expect(pb.satHours + pb.sunHours + pb.phHours).toBeCloseTo(b.ordinaryHours, 6);
    expect(pb.sunHours).toBeCloseTo(8, 6);
    expect(pb.satHours).toBe(0);
    expect(pb.phHours).toBe(0);
    expect(pb.sunCost).toBeCloseTo(8 * 25.65 * 0.5, 2);
  });

  it('standard engine: an 8h public-holiday shift attributes all hours to phHours at the 150% PH loading', () => {
    const b = standardCost({
      netMinutes: 480, start_time: '09:00', end_time: '17:00', rate: 25.65,
      scheduled_length_minutes: 480, is_overnight: false, is_cancelled: false,
      shift_date: '2026-01-01', employmentType: 'Full-Time', classificationLevel: 'LEVEL_1',
    } as any);
    const pb = b.penaltyBreakdown!;
    expect(pb.phHours).toBeCloseTo(8, 6);
    expect(pb.phCost).toBeCloseTo(8 * 25.65 * 1.5, 2);
  });

  it('security engine: an 8h Saturday Casual event-security shift attributes satCost off the de-loaded ordinary rate', () => {
    const b = securityCost({
      netMinutes: 480, start_time: '09:00', end_time: '17:00', rate: 34.04, // Level 3 casual
      scheduled_length_minutes: 0, is_overnight: false, is_cancelled: false,
      shift_date: SATURDAY, employmentType: 'Casual', classificationLevel: 'LEVEL_3',
    } as any);
    const pb = b.penaltyBreakdown!;
    const ordinaryRate = 34.04 / 1.25; // de-loaded
    expect(pb.satHours).toBeCloseTo(8, 6);
    expect(pb.satCost).toBeCloseTo(8 * ordinaryRate * 0.25, 2);
  });

  it('security engine: an annualised Full-Time L4 shift reports a zeroed penaltyBreakdown (salary absorbs penalties, Sch 3 §4.1(b))', () => {
    const b = securityCost({
      netMinutes: 720, start_time: '06:00', end_time: '18:00', rate: 34.63, // Level 4 annualised
      scheduled_length_minutes: 0, is_overnight: false, is_cancelled: false,
      shift_date: SUNDAY, employmentType: 'Full-Time', classificationLevel: 'LEVEL_4',
    } as any);
    const pb = b.penaltyBreakdown!;
    expect(pb.satHours + pb.sunHours + pb.phHours).toBe(0);
    expect(pb.satCost + pb.sunCost + pb.phCost).toBe(0);
  });
});

describe('AUDIT H4 — adult AQF IV trainee no longer double-uplifts (full engine path)', () => {
  it('an adult AQF IV, Wage Level A, first-year trainee resolves to the exact published Sch 5 cl 1.5.4 hourly rate', () => {
    const b = standardCost({
      netMinutes: 180, start_time: '09:00', end_time: '12:00', rate: null,
      scheduled_length_minutes: 180, is_overnight: false, is_cancelled: false,
      shift_date: '2025-06-01', employmentType: 'Part-Time',
      is_trainee: true, trainee_category: 'adult', trainee_level: 'A',
      trainee_aqf_level: 4, trainee_year: 1,
    } as any);
    expect(b.breakdown.baseRate).toBeCloseTo(29.19, 2);
  });

  it('a junior AQF IV, exit-Year-10, school-leaver trainee STILL gets the +3.8% uplift over the AQF III rate', () => {
    const b = standardCost({
      netMinutes: 180, start_time: '09:00', end_time: '12:00', rate: null,
      scheduled_length_minutes: 180, is_overnight: false, is_cancelled: false,
      shift_date: '2025-06-01', employmentType: 'Part-Time',
      is_trainee: true, trainee_category: 'junior', trainee_level: 'A',
      trainee_exit_year: 10, trainee_years_out: 0, trainee_aqf_level: 4,
    } as any);
    expect(b.breakdown.baseRate).toBeCloseTo(13.84 * 1.038, 2);
  });
});
