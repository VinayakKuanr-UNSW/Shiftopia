/**
 * Schedule 5 — Trainee wage matrix (ICC Sydney EA 2025), EFFECTIVE-DATED.
 *
 * WHY EFFECTIVE-DATED (audit follow-up)
 * ─────────────────────────────────────
 * Unlike apprentices (a % of Level 4) and SWS (a % of the resolved minimum
 * wage) — both of which track the cl 25.1 CPI + 0.5% uplift automatically
 * because they multiply an already-effective-dated base — the Schedule 5
 * trainee wages are ABSOLUTE dollar figures. Held as a flat snapshot they would
 * silently go stale at each 1 July increase. This module therefore mirrors the
 * `rate-schedule.ts` design: a dated `TRAINEE_RATE_SCHEDULE` resolved by
 * `shiftDate`, plus `applyTraineeCpiIncrease` so a future increase is a pure
 * DATA change (no engine edit).
 *
 * DURABLE MIRROR + DRIFT GUARD: the 2025 baseline below is mirrored into
 * `public.eba_trainee_schedule` (migration 20260711120000) as a JSONB matrix,
 * and `rate-schedule-trainee-sync.test.ts` asserts the two copies are identical
 * — the same protection `rate-schedule-sync.test.ts` gives Schedule 2. Change a
 * value here ⇒ change it in the migration too.
 *
 * VALUE CORRECTION (2026-07-11): the previous flat copy had Wage Level A
 * part-time HOURLY rates of 21.11 / 25.14 where EA 2025 Schedule 5 cl 1.5.1
 * prints 21.10 / 24.55. The baseline below uses the EBA figures.
 */

export interface TraineeWageRequest {
  category: 'junior' | 'adult' | 'school_based';
  level: 'A' | 'B';
  exitYear?: 10 | 11 | 12;
  yearsOut?: number;
  aqfLevel: 1 | 2 | 3 | 4;
  yearOfTraineeship: number;
  isPartTime: boolean;
}

/** A matrix indexed by highest-year-of-schooling (10|11|12) → by years-out (0..5). */
export type SchoolingMatrix = Record<10 | 11 | 12, number[]>;

export interface TraineeRateMatrix {
  weeklyLevelA: SchoolingMatrix;   // cl 1.4.1 — full-time weekly, Wage Level A
  weeklyLevelB: SchoolingMatrix;   // cl 1.4.2 — full-time weekly, Wage Level B
  hourlyLevelA: SchoolingMatrix;   // cl 1.5.1 — part-time hourly, Wage Level A
  hourlyLevelB: SchoolingMatrix;   // cl 1.5.2 — part-time hourly, Wage Level B
  /** AQF Cert IV adult trainees, [year1, year2]. */
  adult: {
    ftWeekly: { A: [number, number]; B: [number, number] }; // cl 1.4.3
    ptHourly: { A: [number, number]; B: [number, number] }; // cl 1.5.4
  };
  /** School-based hourly rate (cl 1.5.3), by highest year completed. */
  schoolBasedHourly: { yr12: number; other: number };
  /** AQF Cert IV uplift (cl 1.4.3 / 1.5.4), as a percentage (e.g. 3.8). */
  certIvUpliftPct: number;
}

export interface TraineeRateSet extends TraineeRateMatrix {
  effectiveFrom: string; // inclusive lower bound YYYY-MM-DD
  label: string;
  source: string;
}

// ── Baseline: EA 2025 commencement (mirrors eba_trainee_schedule) ─────────────
const TRAINEE_2025: TraineeRateSet = {
  effectiveFrom: '2025-01-01',
  label: 'ICC Sydney EA 2025 — commencement (2025 vote)',
  source: 'Schedule 5 §1.4–§1.5',
  weeklyLevelA: {
    10: [420.80, 463.60, 551.10, 641.60, 764.40, 854.90],
    11: [463.60, 551.10, 641.60, 764.40, 854.90, 854.90],
    12: [551.10, 641.60, 764.40, 854.90, 854.90, 854.90],
  },
  weeklyLevelB: {
    10: [420.80, 463.60, 537.70, 618.00, 725.00, 826.70],
    11: [463.60, 537.70, 618.00, 725.00, 826.70, 826.70],
    12: [537.70, 618.00, 725.00, 826.70, 826.70, 826.70],
  },
  hourlyLevelA: {
    10: [13.84, 15.25, 18.13, 21.10, 24.55, 28.12],
    11: [15.25, 18.13, 21.10, 24.55, 28.12, 28.12],
    12: [18.13, 21.10, 24.55, 28.12, 28.12, 28.12],
  },
  hourlyLevelB: {
    10: [13.84, 15.25, 17.69, 20.33, 23.85, 27.19],
    11: [15.25, 17.69, 20.33, 23.85, 27.19, 27.19],
    12: [17.69, 20.33, 23.85, 27.19, 27.19, 27.19],
  },
  adult: {
    ftWeekly: { A: [887.50, 920.70], B: [858.40, 890.60] },
    ptHourly: { A: [29.19, 30.28], B: [28.23, 29.29] },
  },
  schoolBasedHourly: { yr12: 15.25, other: 13.84 },
  certIvUpliftPct: 3.8,
};

/** Effective-dated trainee schedule, ascending by `effectiveFrom`. */
export const TRAINEE_RATE_SCHEDULE: TraineeRateSet[] = [TRAINEE_2025];

function normalizeDate(d?: string | null): string {
  if (!d) return '';
  const s = String(d);
  return s.includes('T') ? s.split('T')[0] : s.slice(0, 10);
}

/** Resolve the trainee rate set in force on `shiftDate` (mirrors resolveRateSet). */
export function resolveTraineeRateSet(
  shiftDate?: string | null,
  schedule: TraineeRateSet[] = TRAINEE_RATE_SCHEDULE,
): TraineeRateSet {
  const date = normalizeDate(shiftDate);
  let earliest = schedule[0];
  let applicable: TraineeRateSet | undefined;
  for (const rs of schedule) {
    if (rs.effectiveFrom < earliest.effectiveFrom) earliest = rs;
    if (rs.effectiveFrom <= date && (!applicable || rs.effectiveFrom > applicable.effectiveFrom)) {
      applicable = rs;
    }
  }
  return applicable ?? earliest;
}

/**
 * The Schedule 5 base hourly rate for a trainee engagement, resolved for the
 * given `shiftDate`. Weekly rates are converted to hourly at the 38h ordinary
 * week (cl 1.5.5); the AQF Cert IV uplift is applied last (cl 1.4.3 / 1.5.4).
 */
export function getTraineeBaseRate(req: TraineeWageRequest, shiftDate?: string | null): number {
  const { category, level, exitYear = 12, yearsOut = 0, aqfLevel, yearOfTraineeship, isPartTime } = req;
  const set = resolveTraineeRateSet(shiftDate);

  let rate = 0;

  if (category === 'adult') {
    const yr = yearOfTraineeship === 1 ? 0 : 1;
    rate = isPartTime ? set.adult.ptHourly[level][yr] : set.adult.ftWeekly[level][yr] / 38;
  } else if (category === 'school_based') {
    rate = exitYear === 12 ? set.schoolBasedHourly.yr12 : set.schoolBasedHourly.other;
  } else {
    // Junior
    const index = Math.min(yearsOut, 5);
    if (isPartTime) {
      const matrix = level === 'A' ? set.hourlyLevelA : set.hourlyLevelB;
      rate = matrix[exitYear][index];
    } else {
      const matrix = level === 'A' ? set.weeklyLevelA : set.weeklyLevelB;
      rate = matrix[exitYear][index] / 38;
    }
  }

  if (aqfLevel === 4) rate *= 1 + set.certIvUpliftPct / 100;

  return rate;
}

const r2 = (x: number): number => Math.round(x * 100) / 100;
const scaleRow = (row: number[], f: number): number[] => row.map((v) => r2(v * f));
const scaleMatrix = (m: SchoolingMatrix, f: number): SchoolingMatrix => ({
  10: scaleRow(m[10], f),
  11: scaleRow(m[11], f),
  12: scaleRow(m[12], f),
});

/**
 * Derive the next trainee rate set by applying the cl 25.1 annual increase
 * (CPI + 0.5%). Pure — never mutates `base`. Dollar figures scale; the Cert IV
 * uplift percentage is a structural rate and is carried through unchanged.
 */
export function applyTraineeCpiIncrease(
  base: TraineeRateSet,
  cpiPercent: number,
  effectiveFrom: string,
  label: string,
): TraineeRateSet {
  const f = 1 + (cpiPercent + 0.5) / 100; // cl 25.1
  return {
    effectiveFrom,
    label,
    source: `CPI ${cpiPercent}% + 0.5% (cl 25.1) applied to ${base.label}`,
    weeklyLevelA: scaleMatrix(base.weeklyLevelA, f),
    weeklyLevelB: scaleMatrix(base.weeklyLevelB, f),
    hourlyLevelA: scaleMatrix(base.hourlyLevelA, f),
    hourlyLevelB: scaleMatrix(base.hourlyLevelB, f),
    adult: {
      ftWeekly: { A: scaleRow(base.adult.ftWeekly.A, f) as [number, number], B: scaleRow(base.adult.ftWeekly.B, f) as [number, number] },
      ptHourly: { A: scaleRow(base.adult.ptHourly.A, f) as [number, number], B: scaleRow(base.adult.ptHourly.B, f) as [number, number] },
    },
    schoolBasedHourly: { yr12: r2(base.schoolBasedHourly.yr12 * f), other: r2(base.schoolBasedHourly.other * f) },
    certIvUpliftPct: base.certIvUpliftPct,
  };
}
