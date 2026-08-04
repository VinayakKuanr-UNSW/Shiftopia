import type { Shift } from '../../shift.entity';

const ONE_HOUR = 60;
const HOURS_IN_DAY = 24;

/**
 * Fatigue classification bands.
 *
 * These are a HEURISTIC recalibration (pending validation), not a
 * regulatory threshold. The per-shift model yields ~14 for a normal 8h day
 * shift and ~26 for an 8h night shift, so the old <10/<20 bands classified
 * essentially every working employee as amber/red. The bands below map:
 *   - `ok`       — normal day work (a plateaued run of day shifts sits here)
 *   - `risk`     — night work / accumulation across insufficiently-rested days
 *   - `critical` — stacked shifts with no recovery (e.g. clopenings)
 */
export const FATIGUE_BANDS = { OK_MAX: 20, RISK_MAX: 35 } as const;

/**
 * Minimum rest break between shifts, in hours.
 *
 * The same 11 hours the rest-gap compliance rule enforces. Named here because
 * it is the anchor for the recovery rate below, and the two must not drift.
 */
export const MINIMUM_REST_BREAK_HOURS = 11;

/**
 * Rest recovery rate: fatigue units removed per hour of rest.
 *
 * DERIVED, not chosen (stakeholder decision Q8).
 *
 * The previous value was a bare literal `1` with no cited basis, which is the
 * worst kind of constant: it drives who counts as rested, and therefore who is
 * assignable, while looking like an implementation detail nobody need justify.
 *
 * We cannot invent a validated physiological constant, and pretending to would
 * be worse than the status quo. What we CAN do is anchor it to a rest period
 * the business has already committed to. The agreement requires an 11-hour
 * break between shifts — that is a bargained statement that 11 hours is
 * sufficient recovery. So a full break should return an employee from the top
 * of the OK band to baseline:
 *
 *     OK_MAX / MINIMUM_REST_BREAK_HOURS  =  20 / 11  ≈  1.82 units/hour
 *
 * The old `1` under-credited rest by ~45%, so employees read as more fatigued
 * than the agreement assumes they are after a compliant break. That is not the
 * safe direction it appears to be: it suppressed their availability and
 * concentrated work onto whoever the model happened to consider rested.
 *
 * STILL LINEAR, and real recovery is not — the early hours of a rest period
 * restore more than the later ones. A linear model anchored at a defensible
 * endpoint beats a linear model anchored at nothing, but this remains the
 * fatigue stack's weakest assumption and should be revisited against real
 * absence / incident data.
 */
export const RECOVERY_UNITS_PER_HOUR = FATIGUE_BANDS.OK_MAX / MINIMUM_REST_BREAK_HOURS;

/**
 * Circadian interval weights, as multipliers on clock time.
 *
 * MUST stay identical to `_calculate_effective_minutes` in
 * optimizer-service/model_builder.py — the two are the one part of the fatigue
 * stack that already agreed exactly, and `effectiveMinutes` below is what keeps
 * them agreeing now that the solver is fed effective minutes directly.
 *
 * Per Award MA000080 fatigue principles:
 *   00–02 +25% · 02–06 +50% (danger zone) · 06–08 +25%
 *   08–10 flat · 10–16 −25% (daylight) · 16–22 flat · 22–24 +25%
 */
const CIRCADIAN_INTERVALS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 2, 1.25], [2, 6, 1.5], [6, 8, 1.25], [8, 10, 1.0],
  [10, 16, 0.75], [16, 22, 1.0], [22, 24, 1.25],
] as const;

export type FatigueBand = 'ok' | 'risk' | 'critical';

/** Classify a fatigue score into a display band. Single source of truth for
 *  the FTG badge, its tooltip, and the Health-Mode heatmap tint. */
export function getFatigueBand(score: number): FatigueBand {
  return score < FATIGUE_BANDS.OK_MAX
    ? 'ok'
    : score < FATIGUE_BANDS.RISK_MAX
      ? 'risk'
      : 'critical';
}

/**
 * Fast datetime parser returning absolute hours since epoch.
 * Eliminates GC pressure from instantiating Date objects.
 */
function parseShiftDateTimeHours(dateStr: string, timeStr: string): number {
  const y = parseInt(dateStr.substring(0, 4), 10);
  const m = parseInt(dateStr.substring(5, 7), 10) - 1;
  const d = parseInt(dateStr.substring(8, 10), 10);
  
  const h = parseInt(timeStr.substring(0, 2), 10);
  const min = parseInt(timeStr.substring(3, 5), 10);
  
  return Date.UTC(y, m, d, h, min) / (1000 * 3600);
}

/**
 * Fast date parser returning absolute hours since epoch for midnight of that day.
 */
function parseDateMidnightHours(dateStr: string): number {
  const y = parseInt(dateStr.substring(0, 4), 10);
  const m = parseInt(dateStr.substring(5, 7), 10) - 1;
  const d = parseInt(dateStr.substring(8, 10), 10);
  
  return Date.UTC(y, m, d) / (1000 * 3600);
}

/**
 * Calculates shift hours (net)
 */
export const calculateShiftHours = (
    startTime?: string,
    endTime?: string,
    unpaidBreakMinutes?: number | null
): number => {
    if (!startTime || !endTime) return 0;

    const sh = parseInt(startTime.substring(0, 2), 10);
    const sm = parseInt(startTime.substring(3, 5), 10);
    const eh = parseInt(endTime.substring(0, 2), 10);
    const em = parseInt(endTime.substring(3, 5), 10);

    let startMin = sh * ONE_HOUR + sm;
    let endMin = eh * ONE_HOUR + em;

    if (endMin <= startMin) endMin += HOURS_IN_DAY * ONE_HOUR;

    return Math.max(0, (endMin - startMin) - (unpaidBreakMinutes || 0)) / ONE_HOUR;
};

function getShiftTime(timeStr: string): number {
    const h = parseInt(timeStr.substring(0, 2), 10);
    const m = parseInt(timeStr.substring(3, 5), 10);
    return h * ONE_HOUR + m;
}

/**
 * Calculates the fatigue accumulation for a single shift.
 * Uses a non-linear model with circadian weighting.
 */
export function calculateFatigueAccumulation(
  shift: { start_time: string; end_time: string; unpaid_break_minutes?: number | null }
): number {
    const effectiveHours = effectiveMinutes(shift) / ONE_HOUR;

    // Safety: Cap effective hours to 37.9 to avoid log(0) at the 38h asymptote
    const cappedEffectiveHours = Math.min(effectiveHours, 37.9);

    // Non-linear fatigue score
    return -76 * Math.log(1 - cappedEffectiveHours / 38);
}

/**
 * Circadian-weighted, break-adjusted duration of one shift, in minutes.
 *
 * This is the SAME quantity the CP-SAT solver accumulates per ISO week and
 * bands at 1200/1800 (`_calculate_effective_minutes`). Exporting it is what
 * lets the auto-scheduler hand the solver prior load in the solver's own unit
 * instead of the old `initial_fatigue_score × 60` guess (audit F-07): that
 * constant claimed "1 fatigue unit ≈ 60 effective minutes" but the log
 * transform is convex, so it overstated by ~2.2× at a day shift and worsened
 * from there — enough that a single prior night shift pushed an employee past
 * the amber threshold before any assignment was made.
 *
 * Equivalent to the Python routine by construction: weighting each minute by
 * its interval multiplier and then pro-rating the unpaid break is the same as
 * scaling net minutes by the duration-weighted mean multiplier.
 */
export function effectiveMinutes(
  shift: { start_time: string; end_time: string; unpaid_break_minutes?: number | null }
): number {
    const breakMinutes = shift.unpaid_break_minutes ?? 0;
    const startTime = getShiftTime(shift.start_time);
    let endTime = getShiftTime(shift.end_time);

    if (endTime <= startTime) {
        endTime += HOURS_IN_DAY * ONE_HOUR;
    }

    const totalShiftMinutes = endTime - startTime;
    if (totalShiftMinutes <= 0) return 0;

    // Two days of intervals so a cross-midnight shift is weighted correctly.
    let weightedMinutes = 0;
    for (let day = 0; day < 2; day++) {
        const dayOffset = day * HOURS_IN_DAY * ONE_HOUR;
        for (const [fromHour, toHour, weight] of CIRCADIAN_INTERVALS) {
            const overlapStart = Math.max(startTime, dayOffset + fromHour * ONE_HOUR);
            const overlapEnd = Math.min(endTime, dayOffset + toHour * ONE_HOUR);
            if (overlapEnd > overlapStart) {
                weightedMinutes += (overlapEnd - overlapStart) * weight;
            }
        }
    }

    // Pro-rate the unpaid break across the weighted total (mirrors Python).
    const paidFraction = Math.max(0, totalShiftMinutes - breakMinutes) / totalShiftMinutes;
    return weightedMinutes * paidFraction;
}

/**
 * Calculates Fatigue score (inclusive of recovery time/rest)
 * Completely optimized using high-speed integer arithmetic (O(1) memory, zero GC allocations).
 */
export function calculateFatigueWithRecovery(
    existingShifts: Pick<Shift, 'shift_date' | 'start_time' | 'end_time' | 'unpaid_break_minutes'>[],
    referenceDate: string,
    candidate?: { start_time: string; end_time: string; unpaid_break_minutes?: number | null }
): { current: number; peak: number; projected: number } {
    const windowEndHours = parseDateMidnightHours(referenceDate) + 24; // End of the reference day
    const windowStartHours = windowEndHours - 7 * 24; // Past 7 days

    const shiftsWithinWindow: Array<Pick<Shift, 'shift_date' | 'start_time' | 'end_time' | 'unpaid_break_minutes'> & { startHours: number; endHours: number }> = [];
    
    for (let i = 0; i < existingShifts.length; i++) {
      const s = existingShifts[i];
      const startHours = parseShiftDateTimeHours(s.shift_date, s.start_time);
      
      // Filter manually within integer bounds
      if (startHours >= windowStartHours && startHours <= windowEndHours) {
        let endHours = parseShiftDateTimeHours(s.shift_date, s.end_time);
        if (endHours <= startHours) endHours += 24; // Overnight shift
        
        shiftsWithinWindow.push({
          ...s,
          startHours,
          endHours
        });
      }
    }

    // Sort by integer start time
    shiftsWithinWindow.sort((a, b) => a.startHours - b.startHours);

    let fatigue = 0;
    let previousEndTimeHours: number | null = null;

    for (let i = 0; i < shiftsWithinWindow.length; i++) {
        const shift = shiftsWithinWindow[i];

        if (previousEndTimeHours !== null) {
            const restHours = shift.startHours - previousEndTimeHours;
            fatigue = Math.max(0, fatigue - restHours * RECOVERY_UNITS_PER_HOUR);
        }
        fatigue += calculateFatigueAccumulation(shift);
        previousEndTimeHours = shift.endHours;
    }

    // `peak` — the highest fatigue reached in the window: the value at the end
    // of the last shift, before any subsequent rest. This is the planning
    // reading ("how bad does this roster get for this person"), and it is what
    // `computePeakFatigue` samples per day.
    const peakRaw = fatigue;

    // `current` — fatigue AT the reference instant (end of the reference day),
    // i.e. after resting since the last shift (audit F-03).
    //
    // Recovery used to be applied ONLY between consecutive shifts, never from
    // the final shift to the reference instant — so `current` was really `peak`
    // under another name. An 8h night shift that ended today and the same shift
    // ended six days ago both reported 26, and the only way a shift stopped
    // counting was falling out of the 7-day window entirely: a step function,
    // not the decay curve the module's name promises. `projected` already
    // decayed to the candidate's start, so the two halves of the return value
    // were being measured at different instants.
    const currentRaw = previousEndTimeHours !== null
        ? Math.max(0, fatigue - (windowEndHours - previousEndTimeHours) * RECOVERY_UNITS_PER_HOUR)
        : fatigue;
    const current = Math.round(currentRaw * 10) / 10;

    // The candidate is projected from the pre-decay state at the last shift's
    // end, then rested forward to the candidate's own start — decaying to
    // end-of-day first and then again to the candidate start would double-count
    // the same rest.
    let projected = fatigue;
    if (candidate) {
      if (previousEndTimeHours !== null) {
        const candidateStartHours = parseShiftDateTimeHours(referenceDate, candidate.start_time);
        const restHours = candidateStartHours - previousEndTimeHours;
        projected = Math.max(0, projected - restHours * RECOVERY_UNITS_PER_HOUR);
      }
      projected += calculateFatigueAccumulation(candidate);
    } else {
      projected = currentRaw;
    }

    return {
      current,
      peak: Math.round(peakRaw * 10) / 10,
      projected: Math.round(projected * 10) / 10
    };
}
