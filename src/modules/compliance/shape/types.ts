/**
 * Shift Shape Compliance — Type Contract
 *
 * "Shape" rules are the EBA constraints that depend ONLY on the shift itself:
 * its length, its breaks, the day it falls on, and which employment type it is
 * targeted at. They are intentionally employee-free.
 *
 * This is the distinction that makes the layer worth having. The V8 engine's
 * contract is `evaluate(employee, shifts[])` — every rule there is scoped to a
 * person. But whether a shift is 90 minutes long, or lacks a meal break, or is
 * a 3-hour shift flagged for a full-timer, is wrong *before anyone is assigned
 * to it*. Routing those checks through an employee-shaped API meant they could
 * not run at all on an unassigned shift, which is exactly how a roster full of
 * 7.5h full-time days went unnoticed.
 *
 * Consequence: shape rules run at shift CREATION (the Add Shift modal, the
 * synthesiser), not at assignment/bid/swap time. Once a shift's shape is valid
 * it stays valid regardless of who fills it, so re-checking downstream is
 * duplicate work.
 *
 * NET LENGTH IS THE UNIVERSAL MEASURE (locked 2026-08-15)
 * ------------------------------------------------------
 * Every duration in this module is NET: gross span minus the unpaid meal break.
 * Previously the modal measured net while V8's `minEngagementRule` and
 * `maxDailyHoursRule` measured gross, so a 07:00–10:00 shift with a 30m unpaid
 * break was blocked by the form (2.5h) and passed by the engine (3.0h). Net is
 * the defensible reading of cl 12 — minimum *engagement* is paid engagement —
 * and it is now the only reading in the codebase.
 */

/** Which employment type a shift is targeted at. Mirrors `shifts.target_employment_type`. */
export type ShapeEmploymentTarget = 'FT' | 'PT' | 'Casual';

/**
 * `INCOMPLETE` means the shift has no evaluable shape yet — a time is missing or
 * half-typed. It is NOT a pass and NOT a failure, and it carries no hits.
 *
 * This distinction is load-bearing. Without it, an empty `end_time` parses to 0
 * minutes, which against an 06:00 start looks like a cross-midnight shift and
 * reports an 18-hour spread, a missing meal break and two rest-pause breaches —
 * every one of them about a field the user had not filled in yet. Rules only
 * describe a shift that exists.
 */
export type ShapeStatus = 'PASS' | 'WARNING' | 'BLOCKING' | 'INCOMPLETE';

/** A hit is only ever raised on an evaluable shift, so it cannot be INCOMPLETE. */
export type ShapeHitStatus = 'WARNING' | 'BLOCKING';

/**
 * A shape finding. Structurally compatible with `V8Hit` so the existing
 * compliance rule-card UI renders it with no new plumbing.
 */
export interface ShapeHit {
    rule_id:     string;
    rule_name:   string;
    status:      ShapeHitStatus;
    /** Short line for inline form feedback. */
    summary:     string;
    /** Full explanation including the EBA clause. */
    details:     string;
    blocking:    boolean;
    /** The form field this finding should attach to, when there is one. */
    field?:      ShapeField;
    /**
     * A concrete one-click remedy, present only when the required value is
     * unambiguous. Computed here rather than in the form because the rule is
     * the only thing that knows what "compliant" means — two render layers
     * (drawer + sheet) consume this, and neither should re-derive it.
     */
    fix?:        ShapeFix;
    calculation?: Record<string, unknown>;
}

export type ShapeField =
    | 'start_time' | 'end_time'
    | 'unpaid_break_minutes' | 'paid_break_minutes'
    | 'target_employment_type';

export interface ShapeFix {
    field: 'end_time' | 'unpaid_break_minutes' | 'paid_break_minutes';
    /** `HH:mm` for `end_time`, minutes for the break fields. The minimum that complies. */
    value: string | number;
    /** Button text — says exactly what will happen. e.g. "Extend to 16:36". */
    label: string;
    /**
     * Every lawful value, when the clause permits a RANGE rather than one number.
     * cl 36.1 allows any meal break from 30 to 60 minutes, so offering only "30m"
     * would present a floor as though it were the answer. Absent when the required
     * value is singular.
     */
    options?: Array<{ value: number; label: string }>;
}

/** Everything the shape layer needs. Deliberately no employee, no async, no DB. */
export interface ShapeInput {
    /** YYYY-MM-DD. Used only to derive Sunday / public-holiday day typing. */
    shift_date:            string;
    /** HH:mm */
    start_time:            string;
    /** HH:mm */
    end_time:              string;
    unpaid_break_minutes?: number;
    paid_break_minutes?:   number;
    is_training?:          boolean;
    /** Mandatory on the shifts table; drives which minimum applies. */
    target_employment_type: ShapeEmploymentTarget;
    /**
     * Pre-computed day typing. When omitted, the evaluator derives both from
     * `shift_date` via the shared holiday calendar. Callers that already know
     * (the solver, batch paths) can pass them to skip the lookup.
     */
    is_sunday?:            boolean;
    is_public_holiday?:    boolean;
}

export interface ShapeResult {
    /**
     * True when the shift is evaluable AND no BLOCKING hit was raised.
     * An INCOMPLETE shift is never `passed` — there is nothing to pass yet.
     */
    passed:      boolean;
    /** Convenience inverse of `passed`, for gate expressions that read better positively. */
    blocking:    boolean;
    status:      ShapeStatus;
    hits:        ShapeHit[];
    /** Net minutes (gross span − unpaid break). The measure every rule used. */
    net_minutes: number;
}

/** Tunables. Defaults are the ICC EBA values; overrides exist for tests. */
export interface ShapeConfig {
    /** cl 35.1(c) — full-time daily ordinary floor. 7.6h. */
    ft_min_ordinary_day_minutes: number;
    /** Maximum net length of a single shift. 12h. */
    max_shift_minutes:           number;
    /**
     * cl 39.2 — maximum SPREAD of a single engagement: first start to last end,
     * breaks included. 12h.
     *
     * Distinct from `max_shift_minutes` and both are needed. Net alone would let
     * a 13-hour span through as long as an hour of it were unpaid break, which
     * is a 13-hour day for the person working it however it is paid. Gross alone
     * would block a lawful 12h-worked shift. The pair is the real constraint.
     */
    max_spread_minutes:          number;
    /**
     * cl 36.1 — net length above which an unpaid meal break is required. 5h.
     *
     * The clause is a single flat rule: "A Team Member who works for more than
     * five (5) hours on any one day shall be entitled to an unpaid meal break of
     * not less than thirty (30) minutes and not more than sixty (60) minutes."
     * There is no second break and no longer-shift tier anywhere in cl 36 — a
     * 12-hour shift owes exactly the same 30–60 minutes as a 5½-hour one.
     */
    meal_break_threshold_minutes: number;
    /** cl 36.1 — minimum unpaid meal break once the threshold is crossed. 30m. */
    meal_break_min_minutes:      number;
    /** cl 36.1 — maximum unpaid meal break. 60m. */
    meal_break_max_minutes:      number;
    /** The values the form offers as one-tap fixes. Any length in 30–60 is lawful. */
    meal_break_choices:          number[];
    /** cl 37.1 — net length at which the first paid rest pause is due. 4h. */
    rest_pause_1_threshold_minutes: number;
    /** cl 37.2 — net length at which the second paid rest pause is due. 8h. */
    rest_pause_2_threshold_minutes: number;
    /** cl 37 — each paid rest pause is 15m. */
    rest_pause_minutes:          number;
}

export const DEFAULT_SHAPE_CONFIG: ShapeConfig = {
    ft_min_ordinary_day_minutes:    456,  // 7.6h — 38h ÷ 5
    max_shift_minutes:              720,  // 12h net
    max_spread_minutes:             720,  // 12h span (cl 39.2)
    meal_break_threshold_minutes:   300,  // 5h
    meal_break_min_minutes:          30,
    meal_break_max_minutes:          60,
    meal_break_choices:      [30, 45, 60],
    rest_pause_1_threshold_minutes: 240,  // 4h
    rest_pause_2_threshold_minutes: 480,  // 8h
    rest_pause_minutes:              15,
};
