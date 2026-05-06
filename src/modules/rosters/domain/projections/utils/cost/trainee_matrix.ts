
/**
 * Schedule 5 Trainee Wage Matrix (ICC Sydney EA 2025)
 * Rates as of 2024-2025
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

const WEEKLY_LEVEL_A = {
  10: [420.80, 463.60, 551.10, 641.60, 764.40, 854.90],
  11: [463.60, 551.10, 641.60, 764.40, 854.90, 854.90],
  12: [551.10, 641.60, 764.40, 854.90, 854.90, 854.90]
};

const WEEKLY_LEVEL_B = {
  10: [420.80, 463.60, 537.70, 618.00, 725.00, 826.70],
  11: [463.60, 537.70, 618.00, 725.00, 826.70, 826.70],
  12: [537.70, 618.00, 725.00, 826.70, 826.70, 826.70]
};

const HOURLY_LEVEL_A = {
  10: [13.84, 15.25, 18.13, 21.11, 25.14, 28.12],
  11: [15.25, 18.13, 21.11, 25.14, 28.12, 28.12],
  12: [18.13, 21.11, 25.14, 28.12, 28.12, 28.12]
};

const HOURLY_LEVEL_B = {
  10: [13.84, 15.25, 17.69, 20.33, 23.85, 27.19],
  11: [15.25, 17.69, 20.33, 23.85, 27.19, 27.19],
  12: [17.69, 20.33, 23.85, 27.19, 27.19, 27.19]
};

export function getTraineeBaseRate(req: TraineeWageRequest): number {
  const { category, level, exitYear = 12, yearsOut = 0, aqfLevel, yearOfTraineeship, isPartTime } = req;

  let rate = 0;

  if (category === 'adult') {
    if (isPartTime) {
      if (level === 'A') {
        rate = yearOfTraineeship === 1 ? 29.19 : 30.28;
      } else {
        rate = yearOfTraineeship === 1 ? 28.23 : 29.29;
      }
    } else {
      if (level === 'A') {
        rate = (yearOfTraineeship === 1 ? 887.50 : 920.70) / 38;
      } else {
        rate = (yearOfTraineeship === 1 ? 858.40 : 890.60) / 38;
      }
    }
  } else if (category === 'school_based') {
    // Point 35-36
    rate = exitYear === 12 ? 15.25 : 13.84;
  } else {
    // Junior
    const index = Math.min(yearsOut, 5);
    if (isPartTime) {
      const matrix = level === 'A' ? HOURLY_LEVEL_A : HOURLY_LEVEL_B;
      rate = (matrix as any)[exitYear][index];
    } else {
      const matrix = level === 'A' ? WEEKLY_LEVEL_A : WEEKLY_LEVEL_B;
      rate = (matrix as any)[exitYear][index] / 38;
    }
  }

  // Cert IV increase (3.8%)
  if (aqfLevel === 4) {
    rate *= 1.038;
  }

  return rate;
}
