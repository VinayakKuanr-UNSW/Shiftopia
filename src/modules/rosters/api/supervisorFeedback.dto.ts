/**
 * Demand Engine L5 — Supervisor Feedback types.
 *
 * Mirrors the public.supervisor_feedback table (migration 20260502000013).
 * Reason codes are a closed taxonomy enforced by DB CHECK; keep this list in
 * sync with the migration if either changes.
 */

export type FeedbackVerdict = 'UNDER' | 'OVER' | 'OK';

export const FUNCTION_CODES = ['F&B', 'Logistics', 'AV', 'FOH', 'Security'] as const;
export type FunctionCode = (typeof FUNCTION_CODES)[number];

export const REASON_CODES = [
    'peak_underestimated',
    'peak_overestimated',
    'bump_in_too_short',
    'bump_out_too_short',
    'vip_unforecasted',
    'weather_impact',
    'late_pax',
    'staff_no_show_masked',
    'other_with_note',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** Human-readable labels for the prompt UI. */
export const REASON_LABELS: Record<ReasonCode, string> = {
    peak_underestimated: 'Peak underestimated',
    peak_overestimated: 'Peak overestimated',
    bump_in_too_short: 'Bump-in too short',
    bump_out_too_short: 'Bump-out too short',
    vip_unforecasted: 'Unforecasted VIP / surge',
    weather_impact: 'Weather impact',
    late_pax: 'Late attendees',
    staff_no_show_masked: 'Staff no-show masked demand',
    other_with_note: 'Other (note required)',
};

export interface SupervisorFeedbackRow {
    id: string;
    event_id: string | null;
    function_code: FunctionCode;
    level: number;
    slice_start: number;
    slice_end: number;
    verdict: FeedbackVerdict;
    severity: number;
    reason_code: ReasonCode;
    reason_note: string | null;
    supervisor_id: string | null;
    rule_version_at_event: number | null;
    created_at: string;
}

export interface CreateFeedbackInput {
    event_id: string | null;
    function_code: FunctionCode;
    level: number;
    slice_start: number;
    slice_end: number;
    verdict: FeedbackVerdict;
    severity: number;
    reason_code: ReasonCode;
    reason_note?: string | null;
    rule_version_at_event?: number | null;
}

export interface FeedbackBucketKey {
    function_code: FunctionCode;
    level: number;
}

/** Query window for the multiplier accumulator. */
export interface FeedbackWindowParams extends FeedbackBucketKey {
    /** ISO timestamp; rows older than this are excluded. */
    sinceIso?: string;
    /** Hard cap on rows considered (newest first). Default 10. */
    limit?: number;
    /** Optional: restrict to a specific rule generation. */
    ruleVersion?: number;
}
