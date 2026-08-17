/**
 * F1 — Longitudinal Fairness Ledger: Domain Logic.
 *
 * Pure, deterministic functions for:
 *   1. Classifying shifts by fairness-relevant dimensions (weekend, night, PH).
 *   2. Computing per-employee fairness debts from raw metric counts.
 *   3. Converting debts into objective coefficients for the solver.
 *
 * Matches the optimizer's shift classification (model_builder.py SC-10):
 *   - Weekend: Saturday (day 6) or Sunday (day 0).
 *   - Night:   shift window overlaps 00:00–06:00 (360 minutes into the day).
 *   - PH:      shift date is a public holiday in the shared AU-NSW calendar
 *              (`core/lib/holidays.ts`) — the same one compliance and payroll
 *              use, and the source the `public_holidays` table was seeded from.
 *
 * Backward-compatibility: when no ledger data exists, all debts are zero
 * and the solver's existing per-run balance (SC-10) continues to operate
 * unchanged — the feature is purely additive.
 */

import { getShiftDayType } from '@/modules/core/lib/holidays';

// ─── Types ──────────────────────────────────────────────────────────────────────

/**
 * The fairness dimensions tracked by the ledger.
 *
 * `saturday_shifts` / `sunday_shifts` replaced a single binary `weekend_shifts`
 * (stakeholder decision Q6). The EBA already prices these two days differently
 * — cl 41: Saturday +25%, Sunday +50% — so collapsing them told the ledger that
 * a Sunday and a Saturday impose the same burden when the agreement the parties
 * actually bargained says one is worth twice the other.
 *
 * These are OBSERVATIONS (counts of what happened), never valuations. The
 * valuation lives in `DEFAULT_COEFFICIENTS` and is applied at read time, so
 * re-weighting a dimension never requires rewriting stored history.
 */
export type FairnessMetric =
    | 'saturday_shifts'
    | 'sunday_shifts'
    | 'night_shifts'
    | 'public_holiday_shifts'
    | 'overtime_minutes'
    | 'total_hours'
    | 'denial_rate';

export const ALL_FAIRNESS_METRICS: readonly FairnessMetric[] = [
    'saturday_shifts',
    'sunday_shifts',
    'night_shifts',
    'public_holiday_shifts',
    'overtime_minutes',
    'total_hours',
    'denial_rate',
] as const;

/** Classification result for a single shift. */
export interface ShiftFairnessFlags {
    isSaturday: boolean;
    isSunday: boolean;
    isNight: boolean;
    isPublicHoliday: boolean;
    durationMinutes: number;
}

/** A single employee's metric values for one ledger snapshot. */
export interface EmployeeLedgerEntry {
    employeeId: string;
    values: Record<FairnessMetric, number>;
    /**
     * Share of the rolling window this employee was actually available to work,
     * in [0,1] — window days minus approved leave and minus any period outside
     * their contract's active span (stakeholder decision Q4).
     *
     * Omitted means fully available. See `computeDebts` for why this matters.
     */
    availability?: number;
}

/**
 * Metrics whose expected share scales with availability.
 *
 * Counts and durations do: someone available half the window is expected to
 * carry half the burden. `denial_rate` does NOT — it is already normalised by
 * the employee's own bid count, so scaling it a second time would double-count
 * their absence.
 */
const AVAILABILITY_SCALED_METRICS: ReadonlySet<FairnessMetric> = new Set<FairnessMetric>([
    'saturday_shifts',
    'sunday_shifts',
    'night_shifts',
    'public_holiday_shifts',
    'overtime_minutes',
    'total_hours',
]);

/** Availability, clamped and defaulted. */
function availabilityOf(entry: EmployeeLedgerEntry): number {
    const a = entry.availability;
    if (a === undefined || Number.isNaN(a)) return 1;
    return Math.min(1, Math.max(0, a));
}

/** Per-employee, per-metric debt (value − team average). */
export interface FairnessDebt {
    employeeId: string;
    metric: FairnessMetric;
    rollingValue: number;
    teamAverage: number;
    /** Positive = has done MORE than average (owed rest).
     *  Negative = has done LESS than average (owes work). */
    debt: number;
}

/** Minimal shift representation for classification. */
export interface ShiftForFairness {
    shiftDate: string;     // YYYY-MM-DD
    startTime: string;     // HH:MM
    endTime: string;       // HH:MM
    employeeId: string;
    id?: string;
    durationMinutes?: number;
    unpaidBreakMinutes?: number;
}

// ─── Default rolling window ─────────────────────────────────────────────────────

/** Default rolling window in days (13 weeks ≈ 1 quarter). */
export const DEFAULT_WINDOW_DAYS = 91;

// ─── Public holidays ────────────────────────────────────────────────────────────
//
// Resolved through the app-wide AU-NSW calendar in `core/lib/holidays.ts` — the
// same `date-holidays` instance the compliance adapters and the payroll/award
// cost engine use, and the same one the `public_holidays` table was seeded from.
//
// This used to be a hardcoded 11-date literal covering 2026 ONLY (audit F-21).
// Three problems: it disagreed with the compliance engine, so a shift could be a
// public holiday for pay but not for fairness; it was NSW-only in a multi-org
// schema; and — worst — it would have started returning false for EVERY date on
// 2027-01-01, silently pinning the `public_holiday_shifts` metric at zero with
// no error anywhere.
//
// `classifyShift` still accepts an injected set, so tests and any future
// per-jurisdiction lookup can override it without touching this default.

// ─── Time helpers ───────────────────────────────────────────────────────────────

function timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + (m || 0);
}

function shiftDurationMinutes(startTime: string, endTime: string): number {
    const start = timeToMinutes(startTime);
    let end = timeToMinutes(endTime);
    if (end <= start) end += 1440; // cross-midnight
    return end - start;
}

// ─── Shift Classification ───────────────────────────────────────────────────────

/**
 * Classify a shift by fairness-relevant dimensions.
 *
 * @param shiftDate     YYYY-MM-DD
 * @param startTime     HH:MM
 * @param endTime       HH:MM
 * @param publicHolidays  Optional override set of YYYY-MM-DD strings. When
 *                        omitted, the shared AU-NSW calendar is consulted.
 */
export function classifyShift(
    shiftDate: string,
    startTime: string,
    endTime: string,
    publicHolidays?: ReadonlySet<string>,
): ShiftFairnessFlags {
    const day = shiftDayOfWeek(shiftDate);
    return {
        isSaturday: day === 6,
        isSunday: day === 0,
        isNight: isNightShift(startTime, endTime),
        isPublicHoliday: publicHolidays
            ? publicHolidays.has(shiftDate)
            : getShiftDayType(shiftDate).isPublicHoliday,
        durationMinutes: shiftDurationMinutes(startTime, endTime),
    };
}

/**
 * Day of week for a shift date. 0 = Sunday … 6 = Saturday.
 *
 * Parsed at LOCAL NOON, never `new Date(dateStr)` — the latter parses as UTC
 * midnight and reads back a day earlier anywhere west of UTC (audit F-11).
 */
export function shiftDayOfWeek(shiftDate: string): number {
    return new Date(shiftDate + 'T12:00:00').getDay(); // noon to avoid TZ edge
}

/**
 * True if the shift falls on a Saturday or Sunday.
 *
 * Retained as a convenience predicate for callers that genuinely only need
 * "is this a weekend day". The LEDGER no longer uses it — it tracks Saturday
 * and Sunday separately because the EBA prices them differently (Q6).
 */
export function isWeekendShift(shiftDate: string): boolean {
    const day = shiftDayOfWeek(shiftDate);
    return day === 0 || day === 6; // Sunday=0, Saturday=6
}

/**
 * True if the shift window overlaps the night zone 00:00–06:00.
 * Matches `_is_night` in model_builder.py (lines 1414–1425).
 */
export function isNightShift(startTime: string, endTime: string): boolean {
    const start = timeToMinutes(startTime);
    let end = timeToMinutes(endTime);
    if (end <= start) end += 1440; // cross-midnight

    // Night zone: 00:00–06:00 (minutes 0–360).
    // For cross-midnight shifts, also check 1440–1800 (next day's 00:00–06:00).
    const nightEnd = 360;
    const nextNightStart = 1440;
    const nextNightEnd = 1800;

    return (
        (start < nightEnd && end > 0) ||
        (start < nextNightEnd && end > nextNightStart)
    );
}

// ─── Debt Computation ───────────────────────────────────────────────────────────

/**
 * Compute per-employee, per-metric fairness debts from raw ledger entries.
 *
 * For each metric, computes the team average and each employee's deviation.
 *   debt = rolling_value − team_average
 *   - Positive debt → employee has done MORE than average (owed a break).
 *   - Negative debt → employee has done LESS than average (owes work).
 *
 * Pure, deterministic. Returns one `FairnessDebt` per (employee, metric) pair.
 */
export function computeDebts(entries: EmployeeLedgerEntry[]): FairnessDebt[] {
    if (entries.length === 0) return [];

    const debts: FairnessDebt[] = [];
    const availabilities = entries.map(availabilityOf);
    const totalAvailability = availabilities.reduce((a, b) => a + b, 0);

    for (const metric of ALL_FAIRNESS_METRICS) {
        const values = entries.map(e => e.values[metric] ?? 0);
        const sum = values.reduce((a, b) => a + b, 0);
        const scaled = AVAILABILITY_SCALED_METRICS.has(metric);

        // For scaled metrics the baseline is a RATE PER AVAILABLE WINDOW-SHARE,
        // not a flat mean — otherwise everyone who was absent for part of the
        // window is measured against a full window's worth of expectation.
        //
        // Reduces exactly to the plain mean when everyone is fully available
        // (Σavailability = n), so this changes nothing for a stable workforce
        // and only bites where it should.
        const teamRate = scaled
            ? (totalAvailability > 0 ? sum / totalAvailability : 0)
            : sum / values.length;

        for (let i = 0; i < entries.length; i++) {
            const value = values[i];
            const expected = scaled ? teamRate * availabilities[i] : teamRate;
            debts.push({
                employeeId: entries[i].employeeId,
                metric,
                rollingValue: value,
                // `teamAverage` is this employee's EXPECTED share — the team
                // rate scaled by their availability. Equal to the plain team
                // mean whenever they were available for the whole window, which
                // keeps the invariant `debt = rollingValue − teamAverage` true
                // by construction. That invariant is what makes a debt
                // explainable to the employee it describes (Q9).
                //
                // 4dp, matching ROUND(…, 4) in recompute_fairness_ledger. Two
                // decimals was fine while every metric was a count or a
                // duration, but `denial_rate` lives in [0,1] and 2dp would
                // quantise a real spread of denial rates into the same bucket.
                teamAverage: round4(expected),
                debt: round4(value - expected),
            });
        }
    }

    return debts;
}

/**
 * Aggregate a list of classified shifts into per-employee metric counts.
 *
 * @param shifts   Classified shift data.
 * @param contractedHoursPerWeek  Map of employeeId → contracted weekly hours.
 *                                Used to compute overtime. Defaults to 38h if absent.
 * @param windowWeeks  Number of weeks in the rolling window (for OT calculation).
 */
export function aggregateShiftsToEntries(
    shifts: Array<ShiftForFairness & { flags: ShiftFairnessFlags }>,
    contractedHoursPerWeek?: Map<string, number>,
    windowWeeks = DEFAULT_WINDOW_DAYS / 7,
    bidOutcomes?: Map<string, BidOutcomeCounts>,
): EmployeeLedgerEntry[] {
    const byEmployee = new Map<string, {
        saturday: number;
        sunday: number;
        night: number;
        ph: number;
        totalMinutes: number;
    }>();

    for (const s of shifts) {
        const cur = byEmployee.get(s.employeeId)
            ?? { saturday: 0, sunday: 0, night: 0, ph: 0, totalMinutes: 0 };
        const netMinutes = s.flags.durationMinutes - (s.unpaidBreakMinutes ?? 0);
        cur.totalMinutes += Math.max(0, netMinutes);
        if (s.flags.isSaturday) cur.saturday++;
        if (s.flags.isSunday) cur.sunday++;
        if (s.flags.isNight) cur.night++;
        if (s.flags.isPublicHoliday) cur.ph++;
        byEmployee.set(s.employeeId, cur);
    }

    const priorRate = orgDenialRate(bidOutcomes);

    const entries: EmployeeLedgerEntry[] = [];
    for (const [employeeId, agg] of byEmployee) {
        const contractedWeekly = contractedHoursPerWeek?.get(employeeId) ?? 38;
        const contractedTotalMinutes = contractedWeekly * 60 * windowWeeks;
        const overtimeMinutes = Math.max(0, agg.totalMinutes - contractedTotalMinutes);

        entries.push({
            employeeId,
            values: {
                saturday_shifts: agg.saturday,
                sunday_shifts: agg.sunday,
                night_shifts: agg.night,
                public_holiday_shifts: agg.ph,
                overtime_minutes: overtimeMinutes,
                total_hours: round2(agg.totalMinutes / 60),
                denial_rate: smoothedDenialRate(bidOutcomes?.get(employeeId), priorRate),
            },
        });
    }

    // Employees who bid but worked no shifts still have a denial rate.
    if (bidOutcomes) {
        for (const [employeeId, counts] of bidOutcomes) {
            if (!byEmployee.has(employeeId)) {
                entries.push({
                    employeeId,
                    values: {
                        saturday_shifts: 0,
                        sunday_shifts: 0,
                        night_shifts: 0,
                        public_holiday_shifts: 0,
                        overtime_minutes: 0,
                        total_hours: 0,
                        denial_rate: smoothedDenialRate(counts, priorRate),
                    },
                });
            }
        }
    }

    return entries;
}

// ─── Denial rate (Q5) ───────────────────────────────────────────────────────────

/** Bids an employee submitted in the window, and how many were rejected. */
export interface BidOutcomeCounts {
    /** Bids with status = 'rejected'. Withdrawn and expired do NOT count. */
    denied: number;
    /** All bids submitted in the window, whatever their outcome. */
    submitted: number;
}

/**
 * Prior strength for the denial-rate estimate, in "virtual bids".
 *
 * An employee needs roughly this many real bids before their own record
 * outweighs the org-wide baseline. Five is about one bidding cycle.
 */
export const DENIAL_RATE_PRIOR_STRENGTH = 5;

/** Org-wide denials ÷ submissions — the baseline a thin record shrinks toward. */
export function orgDenialRate(bidOutcomes?: Map<string, BidOutcomeCounts>): number {
    if (!bidOutcomes || bidOutcomes.size === 0) return 0;
    let denied = 0;
    let submitted = 0;
    for (const c of bidOutcomes.values()) {
        denied += c.denied;
        submitted += c.submitted;
    }
    return submitted > 0 ? denied / submitted : 0;
}

/**
 * Smoothed share of an employee's bids that were rejected.
 *
 * Replaces the raw `denied_preferences` COUNT (stakeholder decision Q5). The
 * count rewarded bidding VOLUME: bid on everything, accrue denials fastest,
 * receive the largest preference bonus. Because the solver applies that bonus
 * one-sidedly (only positive debt boosts the discount — model_builder.py SC-1),
 * the dominant strategy was to bid indiscriminately, and once one employee
 * noticed, everyone had to bid defensively and the signal was destroyed.
 *
 * A rate cannot be farmed by volume. But a raw rate over-reacts to a thin
 * record — one bid, one loss reads as 100% denied — so the estimate is shrunk
 * toward the org baseline by `DENIAL_RATE_PRIOR_STRENGTH` virtual bids:
 *
 *     (denied + k·prior) / (submitted + k)
 *
 * Someone who has never bid lands exactly on the org rate, hence zero debt:
 * not bidding is neither owed nor owing. Someone who bids often and loses often
 * converges on their true rate and accrues real debt.
 */
export function smoothedDenialRate(counts: BidOutcomeCounts | undefined, priorRate: number): number {
    const k = DENIAL_RATE_PRIOR_STRENGTH;
    const denied = counts?.denied ?? 0;
    const submitted = counts?.submitted ?? 0;
    return round4((denied + k * priorRate) / (submitted + k));
}

// ─── What-if Impact Projection (bid review preview) ─────────────────────────────

/** One metric's rolling value + team-relative debt. */
export interface MetricImpact {
    value: number;
    /** value − team average. Positive = above the team's fair share. */
    debt: number;
}

/** The bidder's before/after fairness standing if a candidate shift is assigned. */
export interface FairnessImpact {
    /** metrics this shift actually moves (weekend/night/PH/total_hours/overtime_minutes) */
    changed: FairnessMetric[];
    before: Record<FairnessMetric, MetricImpact>;
    after: Record<FairnessMetric, MetricImpact>;
}

/** Minimal candidate shift for the impact projection. */
export interface FairnessCandidateShift {
    shiftDate: string;   // YYYY-MM-DD
    startTime: string;   // HH:MM
    endTime: string;     // HH:MM
    unpaidBreakMinutes?: number;
}

const zeroValues = (): Record<FairnessMetric, number> => ({
    saturday_shifts: 0,
    sunday_shifts: 0,
    night_shifts: 0,
    public_holiday_shifts: 0,
    overtime_minutes: 0,
    total_hours: 0,
    denial_rate: 0,
});

/** Contracted minutes across the whole rolling window. */
export function contractedWindowMinutes(contractedWeekly: number, windowWeeks: number): number {
    return contractedWeekly * 60 * windowWeeks;
}

/**
 * Overtime minutes over the window's contracted total (same formula as
 * `aggregateShiftsToEntries`).
 *
 * Overtime is NOT decomposable into a per-shift delta — it only exists once the
 * window TOTAL crosses the contracted threshold, so it must always be derived
 * from the running total, never accumulated shift-by-shift. `updateAfterCommit`
 * previously added a per-delta OT figure computed with `windowWeeks = 0`, which
 * made the threshold zero and booked 100% of every committed minute as overtime
 * (audit F-02); it now re-derives through this helper instead.
 */
export function overtimeFromHours(totalHours: number, contractedTotalMinutes: number): number {
    return Math.max(0, Math.round(totalHours * 60 - contractedTotalMinutes));
}

const pickBidderDebts = (debts: FairnessDebt[], bidderId: string): Record<FairnessMetric, MetricImpact> => {
    const out = {} as Record<FairnessMetric, MetricImpact>;
    for (const m of ALL_FAIRNESS_METRICS) out[m] = { value: 0, debt: 0 };
    for (const d of debts) {
        if (d.employeeId === bidderId) out[d.metric] = { value: d.rollingValue, debt: d.debt };
    }
    return out;
};

/**
 * PURE what-if: how assigning `bidderId` the `candidate` shift would move that
 * employee's fairness ledger. Read-only mirror of the write path
 * `fairnessLedgerService.updateAfterCommit` (classify → add to the bidder's
 * rolling values → computeDebts), minus the DB upsert — reusing the SAME
 * primitives (`classifyShift`, `computeDebts`) so the preview and the committed
 * ledger stay consistent.
 *
 * Both `before` and `after` are computed on a team set that INCLUDES the bidder
 * (a zero entry is added if they have no history yet) so the two are comparable.
 * `denied_preferences` is untouched — winning a bid does not deny it.
 */
export function projectFairnessImpact(
    currentEntries: EmployeeLedgerEntry[],
    bidderId: string,
    candidate: FairnessCandidateShift,
    opts?: { contractedWeekly?: number; windowWeeks?: number; publicHolidays?: ReadonlySet<string> },
): FairnessImpact {
    const windowWeeks = opts?.windowWeeks ?? DEFAULT_WINDOW_DAYS / 7;
    const contractedWeekly = opts?.contractedWeekly ?? 38;
    const contractedTotalMinutes = contractedWeekly * 60 * windowWeeks;

    const flags = classifyShift(candidate.shiftDate, candidate.startTime, candidate.endTime, opts?.publicHolidays);
    const addHours = round2(Math.max(0, flags.durationMinutes - (candidate.unpaidBreakMinutes ?? 0)) / 60);

    // Baseline team set including the bidder (zero if they have no rows yet).
    const baseline: EmployeeLedgerEntry[] = currentEntries.map(e => ({ employeeId: e.employeeId, values: { ...e.values } }));
    let bidderBase = baseline.find(e => e.employeeId === bidderId);
    if (!bidderBase) {
        bidderBase = { employeeId: bidderId, values: zeroValues() };
        baseline.push(bidderBase);
    }
    // Recompute the bidder's OT from their own total_hours so the before/after OT
    // delta reflects only the added hours (other employees keep their ledger OT).
    bidderBase.values.overtime_minutes = overtimeFromHours(bidderBase.values.total_hours, contractedTotalMinutes);
    const beforeDebts = computeDebts(baseline);

    // Projected set: apply the candidate's classification to the bidder.
    const projected: EmployeeLedgerEntry[] = baseline.map(e => ({ employeeId: e.employeeId, values: { ...e.values } }));
    const bidderProj = projected.find(e => e.employeeId === bidderId)!;
    if (flags.isSaturday) bidderProj.values.saturday_shifts += 1;
    if (flags.isSunday) bidderProj.values.sunday_shifts += 1;
    if (flags.isNight) bidderProj.values.night_shifts += 1;
    if (flags.isPublicHoliday) bidderProj.values.public_holiday_shifts += 1;
    bidderProj.values.total_hours = round2(bidderProj.values.total_hours + addHours);
    bidderProj.values.overtime_minutes = overtimeFromHours(bidderProj.values.total_hours, contractedTotalMinutes);
    const afterDebts = computeDebts(projected);

    const before = pickBidderDebts(beforeDebts, bidderId);
    const after = pickBidderDebts(afterDebts, bidderId);
    const changed = ALL_FAIRNESS_METRICS.filter(m => before[m].value !== after[m].value);

    return { changed, before, after };
}

// ─── Objective Coefficient Conversion ───────────────────────────────────────────

/**
 * Default coefficient scales per metric (in solver-penalty-cents per unit of debt).
 *
 * Sized to sit between SC-10 (intra-run balance, ~50¢/shift) and SC-1
 * (labour cost, ~$25/shift) — roughly $2–5 per unit of debt — so the ledger
 * is meaningful but doesn't override coverage or hard constraints.
 */
const DEFAULT_COEFFICIENTS: Record<FairnessMetric, number> = {
    // ── Undesirability weights, derived from EBA cl 41 (stakeholder decision Q6) ──
    //
    // The agreement already prices how burdensome each day is, and those prices
    // were bargained by the parties:
    //
    //     Saturday +25%   Sunday +50%   Public holiday +150%
    //     → ratio          1     :  2   :  6
    //
    // Using that ratio rather than a number we chose makes every weighting
    // question answerable from the agreement ("why is a Sunday worth two
    // Saturdays?" → "clause 41"), and means a renegotiated EBA updates fairness
    // by updating one table. `penaltyLoading()` in utils/cost/standard.ts is the
    // same ratio on the pay side; the two must not drift.
    //
    // Anchored so the mean weekend weight is unchanged at ~300¢ (Sat 200 + Sun
    // 400 averages 300), keeping total objective magnitude stable relative to
    // SC-10 and SC-1. What changes is the ratio, not the scale — except public
    // holidays, which were badly underweighted at 500¢ (1.67× a weekend, where
    // the EBA implies 6× a Saturday).
    saturday_shifts: 200,           // cl 41: +25%  → 1×
    sunday_shifts: 400,             // cl 41: +50%  → 2×
    public_holiday_shifts: 1200,    // cl 41: +150% → 6×

    // Night is NOT a cl 41 day loading — it is the cl 41.4 shift allowance, and
    // it competes with (rather than adds to) the weekend loading on the pay
    // side. As a fairness dimension it is orthogonal: the burden is circadian,
    // not calendar. Left at its own scale rather than folded into the ratio.
    night_shifts: 300,

    overtime_minutes: 2,            // 2¢ per OT-minute debt unit (~$1.20/hr)
    total_hours: 10,                // 10¢ per total-hour debt unit

    // A RATE in [0,1], not a count (Q5) — so one unit of debt means "100
    // percentage points above the org denial rate", which never happens. A
    // realistic debt of +0.25 yields 500¢, matching the flat preference
    // discount the solver already applies. The old count-based 200¢/denial is
    // therefore preserved in magnitude for a typical case while becoming
    // unfarmable.
    denial_rate: 2000,
};

/**
 * Strategy multiplier. Symmetric exponential: 0→0.5×, 50→1.0×, 100→2.0×.
 * Mirrors `_strategy_mult` in optimizer-service/model_builder.py.
 *
 * Exported so the greedy fallback and any other consumer share ONE definition
 * rather than re-deriving `Math.pow(2, (w - 50) / 50)` inline (audit F-13).
 */
export function strategyMult(weight = 50): number {
    return Math.pow(2, (weight - 50) / 50);
}

/**
 * Convert a fairness debt into an objective coefficient.
 *
 * THE single debt→penalty conversion. Audit F-13 found this function had no
 * production caller at all while three consumers each hardcoded their own
 * coefficients — the solver at 300/300/500, the greedy fallback at 50/50/20,
 * and this table at 300/300/500/200. The fallback therefore weighted weekend
 * and night fairness 6× weaker and preference equity 10× weaker than the
 * solver, so which engine ran changed who got assigned.
 *
 * @param debt     The employee's debt for this metric.
 * @param metric   Which metric.
 * @param weight   Fairness weight from the strategy (0–100). Default 50.
 * @returns        Penalty in solver cents. Positive = penalise assigning more.
 *                 Negative = bonus for assigning more (employee is owed).
 */
export function debtToObjectiveCoeff(
    debt: number,
    metric: FairnessMetric,
    weight = 50,
): number {
    if (debt === 0) return 0;
    const baseCoeff = DEFAULT_COEFFICIENTS[metric] ?? 100;
    return Math.round(debt * baseCoeff * strategyMult(weight));
}

/**
 * Total fairness penalty (solver cents) for assigning `shift` to an employee
 * carrying `debts`. Positive = bias away, negative = bias toward.
 *
 * This is the shared scoring kernel: the CP-SAT solver's SC-11 and the greedy
 * fallback must rank two candidates identically for the same debt vector, or a
 * fallback run silently produces a different roster (audit F-13).
 *
 * Mirrors SC-11 — only the metrics the shift actually moves contribute, so a
 * weekday day shift is untouched by weekend/night/PH debt.
 */
export function shiftFairnessPenaltyCents(
    debts: Partial<Record<FairnessMetric, number>> | undefined,
    flags: Pick<ShiftFairnessFlags, 'isSaturday' | 'isSunday' | 'isNight' | 'isPublicHoliday'>,
    weight = 50,
): number {
    if (!debts) return 0;
    let total = 0;
    if (flags.isSaturday) total += debtToObjectiveCoeff(debts.saturday_shifts ?? 0, 'saturday_shifts', weight);
    if (flags.isSunday) total += debtToObjectiveCoeff(debts.sunday_shifts ?? 0, 'sunday_shifts', weight);
    if (flags.isNight) total += debtToObjectiveCoeff(debts.night_shifts ?? 0, 'night_shifts', weight);
    if (flags.isPublicHoliday) {
        total += debtToObjectiveCoeff(debts.public_holiday_shifts ?? 0, 'public_holiday_shifts', weight);
    }
    return total;
}

/**
 * Build a map of employeeId → per-metric debt values from a flat debt array.
 * Convenience for the auto-scheduler to attach to OptimizerEmployee.
 */
export function debtsToMap(debts: FairnessDebt[]): Map<string, Record<string, number>> {
    const map = new Map<string, Record<string, number>>();
    for (const d of debts) {
        const existing = map.get(d.employeeId) ?? {};
        existing[d.metric] = d.debt;
        map.set(d.employeeId, existing);
    }
    return map;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Rates live in [0,1]; 2dp would quantise them into uselessly coarse buckets. */
function round4(n: number): number {
    return Math.round(n * 10000) / 10000;
}
