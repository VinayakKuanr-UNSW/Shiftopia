/**
 * Casual fairness — the client half of the opportunity-adjusted ledger.
 *
 * The ledger itself is computed in SQL (`recompute_casual_fairness`, nightly):
 * for each approved, billed casual shift, its hours are shared equally among
 * the casuals who were eligible AND available for it, and
 *
 *     debt = actual billed hours − expected (fair-share) hours
 *
 * per metric. Positive debt = above their fair share. This module holds what
 * the browser needs around that: the shared vocabulary, the category split
 * (mirrors `fairness_category_minutes`), the solver's pricing kernel (mirrors
 * SC-11 / SC-11b in model_builder.py) and the bid-review what-if.
 *
 * Design: docs/design/fairness/casual-opportunity-fairness.md
 */

import { getShiftDayType } from '@/modules/core/lib/holidays';

export type FairnessMetric =
    | 'total_hours'
    | 'saturday_hours'
    | 'sunday_hours'
    | 'public_holiday_hours'
    | 'night_hours'
    | 'overtime_hours';

export const ALL_FAIRNESS_METRICS: readonly FairnessMetric[] = [
    'total_hours',
    'saturday_hours',
    'sunday_hours',
    'public_holiday_hours',
    'night_hours',
    'overtime_hours',
] as const;

/** One row of `casual_fairness_ledger`. */
export interface FairnessStanding {
    employeeId: string;
    metric: FairnessMetric;
    actualHours: number;
    expectedHours: number;
    /** actual − expected. Positive = above their fair share. */
    debtHours: number;
    /** Billed shifts in this metric the employee could have worked. */
    opportunityCount: number;
    /** min(1, opportunityCount / CONFIDENCE_SHIFTS): how far the debt may steer. */
    confidence: number;
    windowStart: string;
    windowEnd: string;
}

/** Opportunities at which a debt counts in full; mirrors recompute_casual_fairness's default. */
export const CONFIDENCE_SHIFTS = 10;

// ─── Category split ─────────────────────────────────────────────────────────

export interface CategoryMinutes {
    total: number;
    saturday: number;
    sunday: number;
    public_holiday: number;
    night: number;
}

const toMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + (m || 0);
};

const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
    Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

const addDays = (date: string, days: number): string => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

/** 0 = Sunday … 6 = Saturday, from the calendar date alone (no timezone). */
const dayOfWeek = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();

/**
 * Net minutes of a span in each fairness category: a wall-clock split of
 * [start, end) on `shiftDate` (end <= start ⇒ next day), scaled to
 * `netMinutes` so an unpaid break comes proportionally out of every category.
 * Night is 22:00–06:00. Mirrors `public.fairness_category_minutes`.
 */
export function categoryMinutes(
    shiftDate: string,
    startTime: string,
    endTime: string,
    netMinutes: number,
    isPublicHoliday: (date: string) => boolean = (d) => getShiftDayType(d).isPublicHoliday,
): CategoryMinutes {
    const s0 = toMinutes(startTime);
    let s1 = toMinutes(endTime);
    if (s1 <= s0) s1 += 1440;
    const k = netMinutes / (s1 - s0);

    const out: CategoryMinutes = { total: netMinutes, saturday: 0, sunday: 0, public_holiday: 0, night: 0 };
    for (const offset of [0, 1]) {
        const date = addDays(shiftDate, offset);
        const onDay = overlap(s0, s1, offset * 1440, (offset + 1) * 1440) * k;
        const dow = dayOfWeek(date);
        if (dow === 6) out.saturday += onDay;
        if (dow === 0) out.sunday += onDay;
        if (isPublicHoliday(date)) out.public_holiday += onDay;
    }
    for (const offset of [-1, 0, 1]) {
        out.night += overlap(s0, s1, offset * 1440 + 1320, offset * 1440 + 1800) * k;
    }
    return out;
}

// ─── Debts as the solver sees them ──────────────────────────────────────────

/**
 * Employee → metric → debt × confidence. A thin record steers proportionally
 * less, so a newcomer's first shifts never read as a confident imbalance.
 */
export function effectiveDebtsByEmployee(
    rows: FairnessStanding[],
): Map<string, Partial<Record<FairnessMetric, number>>> {
    const map = new Map<string, Partial<Record<FairnessMetric, number>>>();
    for (const r of rows) {
        const debts = map.get(r.employeeId) ?? {};
        map.set(r.employeeId, { ...debts, [r.metric]: r.debtHours * r.confidence });
    }
    return map;
}

// ─── Pricing kernel — mirrors SC-11 / SC-11b (pinned by fairness-scoring-parity.test.ts) ──

const REFERENCE_SHIFT_HOURS = 8;

/** ¢ per (debt-hour × shift-hour): EBA cl 41 Sat:Sun:PH = 1:2:6, night on its own scale. */
export const SC11_COEFF_PER_HOUR2 = {
    saturday_hours: 200 / REFERENCE_SHIFT_HOURS ** 2,
    sunday_hours: 400 / REFERENCE_SHIFT_HOURS ** 2,
    public_holiday_hours: 1200 / REFERENCE_SHIFT_HOURS ** 2,
    night_hours: 300 / REFERENCE_SHIFT_HOURS ** 2,
} as const;

const SC11_CATEGORY: Record<keyof typeof SC11_COEFF_PER_HOUR2, keyof CategoryMinutes> = {
    saturday_hours: 'saturday',
    sunday_hours: 'sunday',
    public_holiday_hours: 'public_holiday',
    night_hours: 'night',
};

export const SC11B_TOTAL_HOURS_COEFF = 2.0;
export const SC11B_OVERTIME_HOURS_COEFF = 3.0;

/** Mirrors `_strategy_mult`: 0 → 0.5×, 50 → 1×, 100 → 2×. */
export function strategyMult(weight = 50): number {
    return Math.pow(2, (weight - 50) / 50);
}

/**
 * Solver cents for giving a shift to an employee carrying `debts`
 * (confidence-weighted hours). Positive = bias away, negative = bias toward.
 */
export function shiftFairnessPenaltyCents(
    debts: Partial<Record<FairnessMetric, number>> | undefined,
    minutes: CategoryMinutes,
    weight = 50,
): number {
    if (!debts) return 0;
    const mult = strategyMult(weight);
    let sc11 = 0;
    for (const [metric, coeff] of Object.entries(SC11_COEFF_PER_HOUR2) as [keyof typeof SC11_COEFF_PER_HOUR2, number][]) {
        sc11 += coeff * (debts[metric] ?? 0) * minutes[SC11_CATEGORY[metric]] / 60;
    }
    const sc11b = ((debts.total_hours ?? 0) * SC11B_TOTAL_HOURS_COEFF
        + (debts.overtime_hours ?? 0) * SC11B_OVERTIME_HOURS_COEFF) * (minutes.total / 60) * mult;
    return Math.trunc(sc11 * mult) + Math.trunc(sc11b) + 0;
}

// ─── Bid review: what-if ────────────────────────────────────────────────────

interface MetricStanding {
    actual: number;
    expected: number;
    debt: number;
    opportunities: number;
    confidence: number;
}

export interface FairnessImpact {
    /** Metrics this shift moves, in ALL_FAIRNESS_METRICS order. */
    changed: FairnessMetric[];
    before: Partial<Record<FairnessMetric, MetricStanding>>;
    after: Partial<Record<FairnessMetric, MetricStanding>>;
}

interface FairnessCandidateShift {
    shiftDate: string;
    startTime: string;
    endTime: string;
    unpaidBreakMinutes?: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const METRIC_CATEGORY: Partial<Record<FairnessMetric, keyof CategoryMinutes>> = {
    total_hours: 'total',
    saturday_hours: 'saturday',
    sunday_hours: 'sunday',
    public_holiday_hours: 'public_holiday',
    night_hours: 'night',
};

/**
 * How awarding `candidate` would move the bidder's standing. The bidder gains
 * the hours as actual work and one fair share (hours / poolSize) as expected —
 * the same arithmetic the nightly recompute will apply once the shift is
 * billed. `poolSize` is everyone who could take the shift (≥ 1). Overtime is
 * never projected: awarding a shift does not bill beyond its roster.
 */
export function projectFairnessImpact(
    bidderRows: FairnessStanding[],
    candidate: FairnessCandidateShift,
    poolSize: number,
    isPublicHoliday?: (date: string) => boolean,
): FairnessImpact {
    const s0 = toMinutes(candidate.startTime);
    let s1 = toMinutes(candidate.endTime);
    if (s1 <= s0) s1 += 1440;
    const net = Math.max(0, s1 - s0 - (candidate.unpaidBreakMinutes ?? 0));
    const minutes = categoryMinutes(candidate.shiftDate, candidate.startTime, candidate.endTime, net, isPublicHoliday);
    const pool = Math.max(1, poolSize);

    const impact: FairnessImpact = { changed: [], before: {}, after: {} };
    for (const metric of ALL_FAIRNESS_METRICS) {
        const category = METRIC_CATEGORY[metric];
        const hours = category ? minutes[category] / 60 : 0;
        if (hours <= 0) continue;

        const row = bidderRows.find(r => r.metric === metric);
        const before: MetricStanding = row
            ? { actual: row.actualHours, expected: row.expectedHours, debt: row.debtHours,
                opportunities: row.opportunityCount, confidence: row.confidence }
            : { actual: 0, expected: 0, debt: 0, opportunities: 0, confidence: 0 };
        const actual = round2(before.actual + hours);
        const expected = round2(before.expected + hours / pool);
        const opportunities = before.opportunities + 1;

        impact.changed.push(metric);
        impact.before[metric] = before;
        impact.after[metric] = {
            actual,
            expected,
            debt: round2(actual - expected),
            opportunities,
            confidence: Math.min(1, opportunities / CONFIDENCE_SHIFTS),
        };
    }
    return impact;
}
