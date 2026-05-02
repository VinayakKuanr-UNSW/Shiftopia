/**
 * Demand Engine L5 — Feedback multiplier accumulator.
 *
 * Pure function. Given a window of supervisor feedback rows for one bucket
 * (function, level), produces a scalar multiplier in [MIN, MAX] that is
 * applied to L3 baseline headcount in L7 finalization.
 *
 * Model (matches design doc §5):
 *   - rows ordered newest-first; weight_i = lambda^i (exponential decay)
 *   - UNDER: contributes  +UNDER_STEP * severity * weight
 *   - OVER:  contributes  -OVER_STEP  * severity * weight
 *   - OK:    pulls multiplier toward 1.0 by OK_PULL * weight
 *   - Final multiplier clamped to [MIN_MULT, MAX_MULT]
 *
 * Asymmetry (UNDER_STEP > OVER_STEP) is intentional: under-staffing is more
 * costly than over-staffing for a venue, so we under-correct on OVER feedback.
 *
 * Determinism: same input rows → identical output, byte-for-byte.
 */

import type { FeedbackVerdict, SupervisorFeedbackRow } from '../api/supervisorFeedback.dto';

export const FEEDBACK_MULT_DEFAULTS = {
    /** Decay factor per row (newer = more weight). 0.85 → ~10 rows of meaningful signal. */
    lambda: 0.85,
    /** Per-severity boost for an UNDER verdict. */
    underStep: 0.04,
    /** Per-severity reduction for an OVER verdict (smaller than underStep on purpose). */
    overStep: 0.03,
    /** Pull-toward-1.0 amount per OK row. */
    okPull: 0.02,
    /** Hard envelope. */
    minMult: 0.8,
    maxMult: 1.3,
    /** Multiplier stays at 1.0 below this many rows (cold-start guard). */
    minRowsForSignal: 3,
} as const;

export interface FeedbackMultiplierConfig {
    lambda?: number;
    underStep?: number;
    overStep?: number;
    okPull?: number;
    minMult?: number;
    maxMult?: number;
    minRowsForSignal?: number;
}

export interface FeedbackMultiplierResult {
    multiplier: number;
    rowsConsidered: number;
    contributions: Array<{
        feedbackId: string;
        verdict: FeedbackVerdict;
        severity: number;
        weight: number;
        delta: number;
    }>;
    /** True if the multiplier is pinned at 1.0 because too few rows. */
    coldStart: boolean;
}

/**
 * Compute a multiplier from a newest-first window of feedback rows.
 *
 * @param rows  Already filtered to a single (function, level) bucket and
 *              ordered newest-first by the caller (matches DB query default).
 */
export function computeFeedbackMultiplier(
    rows: readonly SupervisorFeedbackRow[],
    config: FeedbackMultiplierConfig = {},
): FeedbackMultiplierResult {
    const cfg = { ...FEEDBACK_MULT_DEFAULTS, ...config };

    if (rows.length < cfg.minRowsForSignal) {
        return {
            multiplier: 1.0,
            rowsConsidered: rows.length,
            contributions: [],
            coldStart: true,
        };
    }

    let multiplier = 1.0;
    const contributions: FeedbackMultiplierResult['contributions'] = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const weight = Math.pow(cfg.lambda, i);
        let delta = 0;

        switch (row.verdict) {
            case 'UNDER':
                delta = cfg.underStep * row.severity * weight;
                multiplier += delta;
                break;
            case 'OVER':
                delta = -(cfg.overStep * row.severity * weight);
                multiplier += delta;
                break;
            case 'OK': {
                // Pull current multiplier toward 1.0 by okPull*weight.
                const distance = 1.0 - multiplier;
                delta = distance * cfg.okPull * weight;
                multiplier += delta;
                break;
            }
        }

        contributions.push({
            feedbackId: row.id,
            verdict: row.verdict,
            severity: row.severity,
            weight,
            delta,
        });
    }

    multiplier = Math.max(cfg.minMult, Math.min(cfg.maxMult, multiplier));

    return {
        multiplier,
        rowsConsidered: rows.length,
        contributions,
        coldStart: false,
    };
}
