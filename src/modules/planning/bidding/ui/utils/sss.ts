/**
 * Shift Suitability Score (SSS) — a single 0–100 score blending a bidder's real
 * performance metrics (from get_quarterly_performance_report) with a per-shift
 * skill/qualification match. Pure + unit-tested; no React, no I/O.
 *
 * Weights (tunable):
 *   0.30 reliability   · 0.25 attendance · 0.20 acceptance
 *   0.15 skill-match   · 0.10 penalty (100 − no-show/late-cancel)
 *
 * Missing performance factors are dropped and the remaining weights are
 * renormalised, so the score stays a meaningful 0–100. A bidder with NO history
 * is flagged INSUFFICIENT_DATA and ranked on skill-match alone — never on a
 * fabricated number (this replaces the old UUID-seeded pseudo-random fallback).
 */

export type SssFlag = 'OK' | 'LIMITED' | 'INSUFFICIENT_DATA';

export interface SssInputs {
    /** 0–100 aggregate reliability (reliability_score). */
    reliability?: number | null;
    /** 0–100 attendance/punctuality (attendance_compliance_rate). */
    attendance?: number | null;
    /** 0–100 responsiveness (acceptance_rate). */
    acceptance?: number | null;
    /** rate 0–100; higher = worse (no_show_rate). */
    noShowRate?: number | null;
    /** rate 0–100; higher = worse (late_cancel_rate). */
    lateCancelRate?: number | null;
    /** per-shift skill/qualification match 0–100 (100 = holds all required). */
    skillMatch: number;
    /** false ⇒ no performance history ⇒ INSUFFICIENT_DATA (skill-match only). */
    hasHistory: boolean;
}

export interface SssBreakdown {
    reliability: number;
    attendance: number;
    acceptance: number;
    skillMatch: number;
    /** 0–100, where 100 = no no-show/late-cancel penalty. */
    penalty: number;
}

export interface SssResult {
    score: number;
    flag: SssFlag;
    breakdown: SssBreakdown;
}

export const SSS_WEIGHTS = {
    reliability: 0.30,
    attendance: 0.25,
    acceptance: 0.20,
    skillMatch: 0.15,
    penalty: 0.10,
} as const;

// How hard a no-show / late-cancel bites the penalty component.
const NO_SHOW_W = 3;
const LATE_CANCEL_W = 1.5;

const clamp = (n: number): number => Math.min(100, Math.max(0, n));
const num = (v: number | null | undefined): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Penalty component: 100 minus weighted no-show / late-cancel rates. */
export function penaltyScore(noShowRate?: number | null, lateCancelRate?: number | null): number {
    return clamp(100 - ((num(noShowRate) ?? 0) * NO_SHOW_W + (num(lateCancelRate) ?? 0) * LATE_CANCEL_W));
}

export function computeSss(i: SssInputs): SssResult {
    const reliability = num(i.reliability);
    const attendance = num(i.attendance);
    const acceptance = num(i.acceptance);
    const skillMatch = clamp(num(i.skillMatch) ?? 0);
    const penalty = penaltyScore(i.noShowRate, i.lateCancelRate);

    // Performance factors only count when we actually have history.
    const perf: Array<[keyof typeof SSS_WEIGHTS, number | null]> = i.hasHistory
        ? [['reliability', reliability], ['attendance', attendance], ['acceptance', acceptance], ['penalty', penalty]]
        : [];

    // skillMatch is always present (defaults to a shift with no requirements = 100).
    const present: Array<[keyof typeof SSS_WEIGHTS, number]> = [
        ...perf.filter((f): f is [keyof typeof SSS_WEIGHTS, number] => f[1] != null),
        ['skillMatch', skillMatch],
    ];

    const totalW = present.reduce((s, [k]) => s + SSS_WEIGHTS[k], 0) || 1;
    const score = clamp(Math.round(
        present.reduce((s, [k, v]) => s + (SSS_WEIGHTS[k] / totalW) * clamp(v), 0),
    ));

    const perfCount = perf.filter(([, v]) => v != null).length;
    const flag: SssFlag = !i.hasHistory ? 'INSUFFICIENT_DATA' : perfCount < 3 ? 'LIMITED' : 'OK';

    return {
        score,
        flag,
        breakdown: {
            reliability: clamp(reliability ?? 0),
            attendance: clamp(attendance ?? 0),
            acceptance: clamp(acceptance ?? 0),
            skillMatch,
            penalty,
        },
    };
}

/** Colour band for an SSS value, reusing the report's tuned reliability thresholds. */
export function sssBand(score: number): 'good' | 'warn' | 'poor' {
    if (score >= 85) return 'good';
    if (score >= 70) return 'warn';
    return 'poor';
}
