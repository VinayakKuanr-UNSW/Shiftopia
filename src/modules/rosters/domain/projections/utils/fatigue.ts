import { parseISO, subDays, isWithinInterval } from 'date-fns';
import type { Shift } from '../../shift.entity';

const ONE_HOUR = 60;
const HOURS_IN_DAY = 24;

/**
 * Calculates shift hours (net)
 */
export const calculateShiftHours = (
    startTime?: string,
    endTime?: string,
    unpaidBreakMinutes?: number | null
): number => {
    if (!startTime || !endTime) return 0;

    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);

    let startMin = sh * ONE_HOUR + sm;
    let endMin = eh * ONE_HOUR + em;

    if (endMin <= startMin) endMin += HOURS_IN_DAY * ONE_HOUR;

    return Math.max(0, (endMin - startMin) - (unpaidBreakMinutes || 0)) / ONE_HOUR;
};

function getShiftTime(time: string): number {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * ONE_HOUR + minutes;
}

/**
 * Calculates the fatigue accumulation for a single shift.
 * Uses a non-linear model with circadian weighting.
 */
export function calculateFatigueAccumulation(
  shift: { start_time: string; end_time: string; unpaid_break_minutes?: number | null }
): number {
    const breakMinutes = shift.unpaid_break_minutes ?? 0;
    const startTime = getShiftTime(shift.start_time);
    let endTime = getShiftTime(shift.end_time);

    if (endTime <= startTime) {
        endTime += HOURS_IN_DAY * ONE_HOUR;
    }

    // Circadian Penalties
    // 12am-2am moderate (+0.25)
    // 2am-6am highest (+0.50)
    // 6am-8am moderate (+0.25)
    // 8am-10am standard (0)
    // 10am-4pm lowest (-0.25)
    // 4pm-10pm standard (0)
    // 10pm-12am moderate (+0.25)
    
    const intervalStart = [0, 2, 6, 8, 10, 16, 22].map(h => h * ONE_HOUR);
    const intervalEnd = [2, 6, 8, 10, 16, 22, 24].map(h => h * ONE_HOUR);
    const penalties = [0.25, 0.5, 0.25, 0, -0.25, 0, 0.25];

    let totalPenalty = 0;
    const totalShiftMinutes = endTime - startTime;

    // Support overnight shifts by doubling intervals
    const fullIntervalStart = [...intervalStart, ...intervalStart.map(x => x + 24 * ONE_HOUR)];
    const fullIntervalEnd = [...intervalEnd, ...intervalEnd.map(x => x + 24 * ONE_HOUR)];
    const fullPenalties = [...penalties, ...penalties];

    for (let i = 0; i < fullIntervalStart.length; i++) {
        const overlapStart = Math.max(startTime, fullIntervalStart[i]);
        const overlapEnd = Math.min(endTime, fullIntervalEnd[i]);

        if (overlapEnd > overlapStart) {
            const overlapMinutes = overlapEnd - overlapStart;
            const fraction = overlapMinutes / totalShiftMinutes;
            totalPenalty += fraction * fullPenalties[i];
        }
    }

    const shiftHours = (totalShiftMinutes - breakMinutes) / ONE_HOUR;
    const effectiveHours = shiftHours * (1 + totalPenalty);

    // Safety: Cap effective hours to 37.9 to avoid log(0) at the 38h asymptote
    const cappedEffectiveHours = Math.min(effectiveHours, 37.9);
    
    // Non-linear fatigue score
    return -76 * Math.log(1 - cappedEffectiveHours / 38);
}

/**
 * Calculates Fatigue score (inclusive of recovery time/rest)
 */
export function calculateFatigueWithRecovery(
    existingShifts: Pick<Shift, 'shift_date' | 'start_time' | 'end_time' | 'unpaid_break_minutes'>[],
    referenceDate: string,
    candidate?: { start_time: string; end_time: string; unpaid_break_minutes?: number | null }
): { current: number; projected: number } {
    const windowEnd = parseISO(referenceDate);
    const windowStart = subDays(windowEnd, 7); // Usually look at the past week for immediate fatigue

    const getEndDateTime = (s: typeof existingShifts[0]) => {
      const start = new Date(`${s.shift_date}T${s.start_time}`);
      const end = new Date(`${s.shift_date}T${s.end_time}`);
      if (end <= start) end.setDate(end.getDate() + 1);
      return end;
    };

    const sortedShifts = existingShifts
        .filter((s) => isWithinInterval(parseISO(s.shift_date), { start: windowStart, end: windowEnd }))
        .map(s => ({
          ...s,
          startDt: new Date(`${s.shift_date}T${s.start_time}`),
          endDt: getEndDateTime(s)
        }))
        .sort((a, b) => a.startDt.getTime() - b.startDt.getTime());

    let fatigue = 0;
    let previousEndTime: Date | null = null;

    for (const shift of sortedShifts) {
        if (previousEndTime) {
            const restHours = (shift.startDt.getTime() - previousEndTime.getTime()) / (1000 * 3600);
            // Linear recovery: 1 hour of rest removes 1 unit of fatigue
            fatigue = Math.max(0, fatigue - restHours);
        }
        fatigue += calculateFatigueAccumulation(shift);
        previousEndTime = shift.endDt;
    }

    const current = Math.round(fatigue * 10) / 10;
    let projected = current;

    if (candidate) {
      if (previousEndTime) {
        const candidateStart = new Date(`${referenceDate}T${candidate.start_time}`);
        const restHours = (candidateStart.getTime() - previousEndTime.getTime()) / (1000 * 3600);
        projected = Math.max(0, projected - restHours);
      }
      projected += calculateFatigueAccumulation(candidate);
    }

    return { 
      current, 
      projected: Math.round(projected * 10) / 10 
    };
}
