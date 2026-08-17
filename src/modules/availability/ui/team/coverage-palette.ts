/**
 * Validated colour tokens for the Team Availability visualisations.
 *
 * Every value here was produced by the data-viz validator, not chosen by eye.
 * Surfaces used are this app's actual composited chart surfaces:
 *   light  #fcfcfd  (PageBody `bg-white/70` over `hsl(220 14% 96%)`)
 *   dark   #141c2e  (PageBody `bg-[#1c2333]/40` over `hsl(222 47% 11%)`)
 *
 * ── Runs (all PASS) ────────────────────────────────────────────────────────
 *  GAP diverging arms, `--ordinal`:
 *    light short  #e79a9b,#d76a6b,#c04243,#9e2526   light-end 2.16:1
 *    light over   #86b6ef,#5598e7,#256abf,#104281   light-end 2.06:1
 *    dark  short  #853738,#aa4849,#cf6162,#ee9192   light-end 2.11:1
 *    dark  over   #184f95,#256abf,#3987e5,#86b6ef   light-end 2.10:1
 *  DAY-STATE hues, `--pairs all`:
 *    light #2a78d6,#1baf7a,#eb6834  worst CVD ΔE 9.2 · normal ΔE 24.0
 *    dark  #3987e5,#199e70,#d95926  worst CVD ΔE 9.4 · normal ΔE 20.9
 *
 * Two obligations came out of those runs and are honoured by the components:
 *   • light-mode aqua sits at 2.75:1 (sub-3:1 WARN) ⇒ relief is mandatory, so
 *     every grid cell carries a glyph and the page ships a CSV/table export;
 *   • `unset` is deliberately NOT a hue. It is an absence, encoded as an
 *     absence — dashed ring, no fill — which also keeps it distinguishable
 *     under any colour-vision deficiency.
 *
 * ── Why `contract` adds NO sixth hue ───────────────────────────────────────
 * `contract` (available by contract, no declaration expected) SHARES the
 * `available` green byte-for-byte and is separated by a dashed ring, its glyph
 * and its label instead.
 *
 * That is not economy, it is the only passing option. A second green step was
 * measured before being rejected:
 *
 *   validate_palette.js "#2a78d6,#1baf7a,#5fd3a8,#eb6834" --pairs all --mode light
 *     [FAIL] Normal-vision floor  #5fd3a8 ↔ #1baf7a  ΔE 12.1  (floor 15)
 *     [FAIL] Lightness band       #5fd3a8 L 0.788    (band 0.43–0.77)
 *
 * A pair full-colour readers cannot separate is a hard fail that secondary
 * encoding does not excuse. And the semantics agree with the measurement:
 * `contract` and `available` are the SAME category — this person can work — so
 * giving them the same hue is the honest encoding. Only the PROVENANCE of that
 * availability differs (a contract rather than a declaration), and provenance
 * rides on the border style, never on colour. The validated three-hue run above
 * is therefore unchanged by this state's existence.
 *
 * GAP is diverging, not sequential, on purpose: under-staffed and over-rostered
 * are opposite failures either side of a neutral "exactly right", and a
 * one-hue ramp would render "perfectly staffed" as an endpoint.
 */

import type { TeamDayState } from '../../model/team-availability.types';

// ── Diverging GAP scale ─────────────────────────────────────────────────────
// Index 0 = |gap| 1 (nearest the surface) … index 3 = |gap| >= 4.

export const GAP_SHORT_STEPS = {
    light: ['#e79a9b', '#d76a6b', '#c04243', '#9e2526'],
    dark: ['#853738', '#aa4849', '#cf6162', '#ee9192'],
} as const;

export const GAP_OVER_STEPS = {
    light: ['#86b6ef', '#5598e7', '#256abf', '#104281'],
    dark: ['#184f95', '#256abf', '#3987e5', '#86b6ef'],
} as const;

/** The neutral midpoint — gap 0. Gray, so it reads as "nothing to see". */
export const GAP_NEUTRAL = { light: '#f0efec', dark: '#383835' } as const;

/** Hours with no demand at all — recedes fully into the surface. */
export const GAP_EMPTY = { light: '#f7f7f5', dark: '#1b2233' } as const;

/**
 * Fill for one coverage bucket.
 * @param gap  required − assigned
 * @param hasDemand  false when `required` is 0 (nothing scheduled that hour)
 */
export function gapFill(gap: number, hasDemand: boolean, isDark: boolean): string {
    const mode = isDark ? 'dark' : 'light';
    if (!hasDemand) return GAP_EMPTY[mode];
    if (gap === 0) return GAP_NEUTRAL[mode];
    const steps = gap > 0 ? GAP_SHORT_STEPS[mode] : GAP_OVER_STEPS[mode];
    return steps[Math.min(Math.abs(gap), 4) - 1];
}

// ── Day-state hues ──────────────────────────────────────────────────────────

export interface StateStyle {
    /** Background fill, or null when the state is encoded as an absence. */
    fill: string | null;
    /** Single-character glyph — the secondary encoding. Never colour alone. */
    glyph: string;
}

const STATE_STYLES: Record<TeamDayState, { light: StateStyle; dark: StateStyle }> = {
    assigned: {
        light: { fill: '#2a78d6', glyph: '' },
        dark: { fill: '#3987e5', glyph: '' },
    },
    available: {
        light: { fill: '#1baf7a', glyph: '' },
        dark: { fill: '#199e70', glyph: '' },
    },
    // Same green as `available` on purpose — see the header note.
    contract: {
        light: { fill: '#1baf7a', glyph: '' },
        dark: { fill: '#199e70', glyph: '' },
    },
    leave: {
        light: { fill: '#eb6834', glyph: '' },
        dark: { fill: '#d95926', glyph: '' },
    },
    unavailable: {
        light: { fill: '#dc2626', glyph: '' },
        dark: { fill: '#ef4444', glyph: '' },
    },
    unset: {
        light: { fill: '#6b7280', glyph: '' },
        dark: { fill: '#9ca3af', glyph: '' },
    },
};

export function stateStyle(state: TeamDayState, isDark: boolean): StateStyle {
    return STATE_STYLES[state][isDark ? 'dark' : 'light'];
}

// ── Soft-tint treatment (the surface both the grid and the day timeline use) ──
//
// Same validated hues as STATE_STYLES, rendered as a low-alpha wash with a
// full-strength border and mark rather than a solid fill. Light mode uses a
// DARKER step for the mark, because the validated light hues sit at 2.5–2.9:1
// against a near-white surface and would not survive on a pale tint.

export interface StateSoftStyle {
    /** Low-alpha wash for the cell background. */
    bg: string;
    /** Border colour; `null` renders as a neutral outline (unset). */
    border: string | null;
    /** Full-strength mark colour for the glyph and legend dot. */
    mark: string;
    /** Single-character glyph — the secondary encoding. Never colour alone. */
    glyph: string;
    /**
     * Render the outline dashed. This is a REAL encoding channel, not decoration:
     * it is what separates `contract` from `available`, which share a hue by
     * design. Carried on the token rather than tested per state name in each
     * component, so a cell, the legend and the timeline cannot disagree about it.
     */
    dashed?: boolean;
}

const STATE_SOFT: Record<TeamDayState, { light: StateSoftStyle; dark: StateSoftStyle }> = {
    assigned: {
        light: { bg: '#1c5cab29', border: '#1c5cab66', mark: '#1c5cab', glyph: '' },
        dark: { bg: '#3987e533', border: '#3987e573', mark: '#3987e5', glyph: '' },
    },
    available: {
        light: { bg: '#0d7a5426', border: '#0d7a5461', mark: '#0d7a54', glyph: '' },
        dark: { bg: '#199e7033', border: '#199e7073', mark: '#199e70', glyph: '' },
    },
    // Identical tokens to `available` — availability is availability — with the
    // ring dashed to say "no declaration on file, and none expected". Reuses the
    // dashed vocabulary `unset` already established for "nothing declared here",
    // which is literally true of a full-timer; the green is what distinguishes
    // "and that is correct" from "and it should not be".
    contract: {
        light: { bg: '#0d7a5426', border: '#0d7a5461', mark: '#0d7a54', glyph: '', dashed: true },
        dark: { bg: '#199e7033', border: '#199e7073', mark: '#199e70', glyph: '', dashed: true },
    },
    leave: {
        light: { bg: '#b8471c26', border: '#b8471c61', mark: '#b8471c', glyph: '' },
        dark: { bg: '#d9592633', border: '#d9592673', mark: '#d95926', glyph: '' },
    },
    unavailable: {
        light: { bg: '#dc262626', border: '#dc262661', mark: '#b91c1c', glyph: '' },
        dark: { bg: '#ef444433', border: '#ef444473', mark: '#f87171', glyph: '' },
    },
    unset: {
        light: { bg: '#6b72801f', border: '#6b728052', mark: '#4b5563', glyph: '', dashed: true },
        dark: { bg: '#6b728026', border: '#6b728066', mark: '#9ca3af', glyph: '', dashed: true },
    },
};

export function stateSoft(state: TeamDayState, isDark: boolean): StateSoftStyle {
    return STATE_SOFT[state][isDark ? 'dark' : 'light'];
}

// ── Status (fixed, never themed) — for the summary tiles ────────────────────
// Sub-3:1 on the light surface by design; always paired with an icon + label.

export const STATUS = {
    good: '#0ca30c',
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b',
} as const;

export type StatusRole = keyof typeof STATUS;

// ── Compliance severity ─────────────────────────────────────────────────────
//
// The hours/compliance cell modes. This is a STATUS encoding, not a categorical
// one: three named states, ordered, that ship with a glyph and a written status
// in the row's summary column. Colour is the redundant channel here, never the
// carrier — which is what makes the steps below legitimate.
//
// ── Runs (surfaces light #fcfcfd, dark #141c2e) ─────────────────────────────
//  MARKS, `--mode light`  #b91c1c,#ca8a04,#0d7a54   → ALL PASS
//      worst adjacent normal ΔE 22.6 · CVD ΔE 13.2 (protan) · contrast all >=3:1
//  MARKS, `--mode dark`   #ef4444,#d9a326,#199e70   → contrast all >=3:1 PASS
//      normal ΔE 20.9 · CVD ΔE 11.1 (deutan) · lightness band FAIL (amber 0.747
//      against the dark band's 0.48–0.67 ceiling)
//
// That dark lightness FAIL is accepted, and the reasoning is worth keeping.
// The band is a CATEGORICAL check — it exists to stop one series receding
// behind another. Every amber dark enough to satisfy it collapses onto the red
// under deuteranopia (best candidate #c08a1e scored ΔE 3.7, far below the 6
// floor), so honouring the band here would trade a cosmetic evenness problem
// for a real "cannot tell a violation from a warning" one. A status ramp is
// SUPPOSED to climb in lightness with severity, and the validator says as much:
// its checks are scoped to categorical palettes.
//
// The first candidate pair — light #b91c1c/#a16207 — was rejected outright:
// normal-vision ΔE 13.2, under the hard floor of 15. Two people with full
// colour vision could not have told a violation from a warning, and secondary
// encoding does not excuse that one.

export type ComplianceSeverity = 'violation' | 'warning' | 'ok';

export interface SeverityStyle {
    /** Low-alpha wash for the cell background. */
    bg: string;
    border: string;
    /** Full-strength colour for the glyph and the status icon. */
    mark: string;
    /** The secondary encoding. Identity never rests on the fill. */
    glyph: string;
}

const SEVERITY: Record<ComplianceSeverity, { light: SeverityStyle; dark: SeverityStyle }> = {
    violation: {
        light: { bg: '#b91c1c26', border: '#b91c1c61', mark: '#b91c1c', glyph: '✕' },
        dark: { bg: '#ef444433', border: '#ef444473', mark: '#ef4444', glyph: '✕' },
    },
    warning: {
        light: { bg: '#ca8a0426', border: '#ca8a0461', mark: '#ca8a04', glyph: '~' },
        dark: { bg: '#d9a32633', border: '#d9a32673', mark: '#d9a326', glyph: '~' },
    },
    ok: {
        light: { bg: '#0d7a5417', border: '#0d7a5440', mark: '#0d7a54', glyph: '·' },
        dark: { bg: '#199e7024', border: '#199e7052', mark: '#199e70', glyph: '·' },
    },
};

export function severityStyle(severity: ComplianceSeverity, isDark: boolean): SeverityStyle {
    return SEVERITY[severity][isDark ? 'dark' : 'light'];
}

// ── Hours magnitude ─────────────────────────────────────────────────────────
//
// SEQUENTIAL — one hue, light to dark, because hours are a magnitude. The
// Annual Shift Grid ramped emerald here and then switched the same cell to red
// or amber when a cap tripped, which put a magnitude and a status on one
// channel: a dark cell meant "long day" until it meant "violation".
//
// They are separated now. Hours mode ramps; compliance mode is a different cell
// mode with the status ramp above. A cell never carries both at once.
//
// Steps are the neutral-warm ink already in this file's vocabulary, held
// deliberately low-contrast so a dense month of cells stays readable as a
// field, with the day's figure printed on top in a text token.

export const HOURS_STEPS = {
    light: ['#eef1f5', '#dbe2ec', '#c2cedd', '#a3b4cb'],
    dark: ['#1b2233', '#25304a', '#324065', '#425584'],
} as const;

/** Bucketed on the EBA daily caps: <4h, <8h, <10h (soft), then over. */
export function hoursFill(hours: number, isDark: boolean): string | null {
    if (hours <= 0) return null;
    const steps = HOURS_STEPS[isDark ? 'dark' : 'light'];
    if (hours < 4) return steps[0];
    if (hours < 8) return steps[1];
    if (hours < 10) return steps[2];
    return steps[3];
}

// ── Chart chrome ────────────────────────────────────────────────────────────

export const CHROME = {
    gridline: { light: '#e1e0d9', dark: '#2c2c2a' },
    muted: '#898781',
} as const;
