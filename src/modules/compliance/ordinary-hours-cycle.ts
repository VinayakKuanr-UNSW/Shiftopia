/**
 * The declared ordinary-hours work cycle — one definition, three consumers.
 *
 * ICC EBA cl 35.1(a) (FT), 35.2(b) (PT), 35.3(b) (FPT) and 35.4(a) (CASUAL) all
 * state the same ladder of ordinary-hours ceilings:
 *
 *     38 hours in one (1) week;
 *     76 hours in two (2) weeks;
 *     114 hours in three (3) weeks;  OR
 *     152 hours in four (4) weeks.
 *
 * The list is a DISJUNCTION. cl 12.2(b)/12.3(b)/12.4(b) supply the other half —
 * the engagement runs "over a work cycle of up to four (4) weeks" — so the cycle
 * length is DECLARED per engagement and 35.x(a) merely prices each length. It is
 * not four caps applied at once.
 *
 * WHY THIS FILE EXISTS AT ALL. Before it, the same rule had three incompatible
 * implementations: the solver hardcoded a rolling 28 days, the V8 auditor took
 * the worst rolling 28-day window, and the Availability Manager applied rolling
 * 2-, 3- AND 4-week windows as blocking. Every one of them was a hand-rolled
 * reading of the same clause. Adding a fourth would have been the actual bug, so
 * the cycle arithmetic lives here and the consumers import it.
 *
 * ANCHORED, NOT ROLLING. A work cycle is a bounded repeating period: cl 42.6
 * substitutes a day off "during the work cycle", cl 35.1(e) wants two consecutive
 * days off per week "during each work cycle". Both presuppose edges. A rolling
 * window is strictly stricter than an anchored cycle and reports breaches on
 * rosters the Agreement permits — that is the false-violation mechanism.
 *
 * SCHEDULE 3 IS NOT MODELLED HERE. Full-time Security run 42h/week over an
 * EIGHT-week cycle (Sch 3 §3.1(d)), and §1.1 makes the Schedule prevail. That
 * stays a discriminated branch in the callers, and the DB CHECK pins this column
 * to the 1-4 range clause 35 enumerates so there are never two ways to say it.
 */

/** cl 12.2(b) — "a work cycle of up to four (4) weeks". */
export const ORD_CYCLE_WEEKS_DEFAULT = 4;

/**
 * Shared cycle epoch — 2024-01-01, a Monday.
 *
 * Mirrors `hr.user_contracts.ordinary_hours_cycle_anchor`'s default. Rosters are
 * published team-wide (cl 38.1); anchoring each engagement to its own start_date
 * would make the identical roster compliant for one person and breaching for the
 * next purely by hire date.
 */
export const ORD_CYCLE_ANCHOR_DEFAULT = '2024-01-01';

/** cl 35.x(a) — the weekly basis the ladder is built from. */
export const ORD_WEEKLY_LIMIT_DEFAULT = 38;

export type OrdinaryCycleWeeks = 1 | 2 | 3 | 4;

/** The four ceilings cl 35.x(a) enumerates, at the standard 38h basis. */
export const ORD_CYCLE_CEILINGS: Readonly<Record<OrdinaryCycleWeeks, number>> = {
    1: 38,
    2: 76,
    3: 114,
    4: 152,
};

const MS_PER_DAY = 86_400_000;

/**
 * Days since the Unix epoch for a `yyyy-MM-dd` date.
 *
 * Deliberately parsed field-by-field into `Date.UTC` rather than `new Date(iso)`:
 * cycle boundaries are calendar facts, and letting the runtime's local zone into
 * the arithmetic shifts every boundary by a day for half the year in Sydney.
 *
 * EXPORTED so callers that reason about the same calendar — the Office
 * requirement calculator counts a contract's active days inside a cycle — do
 * not write a second date implementation. A second one would be a second place
 * for the local-timezone bug above to reappear, which is exactly the class of
 * duplication this file was created to end.
 */
export function toEpochDay(iso: string): number {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
    return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** Inverse of {@link toEpochDay}. Exported for the same reason. */
export function fromEpochDay(day: number): string {
    return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Coerce a stored cycle length to the 1-4 range clause 35 enumerates.
 *
 * PostgREST may serialise a `smallint` as a string, and an out-of-range or
 * unreadable value falls back to the four-week default rather than throwing —
 * a cycle is a scheduling parameter, never a gate.
 */
export function normaliseCycleWeeks(raw: unknown): OrdinaryCycleWeeks {
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof n !== 'number' || !Number.isFinite(n)) return ORD_CYCLE_WEEKS_DEFAULT;
    const i = Math.trunc(n);
    return i >= 1 && i <= 4 ? (i as OrdinaryCycleWeeks) : ORD_CYCLE_WEEKS_DEFAULT;
}

/**
 * Coerce a stored anchor to a `yyyy-MM-dd` Monday.
 *
 * A non-Monday anchor would put every cycle edge mid-week; the DB CHECK forbids
 * it, and this snaps back to the shared epoch if one ever arrives from elsewhere.
 */
export function normaliseCycleAnchor(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length < 10) return ORD_CYCLE_ANCHOR_DEFAULT;
    const day = toEpochDay(raw);
    if (!Number.isFinite(day)) return ORD_CYCLE_ANCHOR_DEFAULT;
    // 1970-01-01 was a Thursday, so epoch day 0 ≡ ISO weekday 4.
    const isoDow = (((day + 3) % 7) + 7) % 7 + 1;
    return isoDow === 1 ? raw.slice(0, 10) : ORD_CYCLE_ANCHOR_DEFAULT;
}

/**
 * Which cycle a date falls in, counted from the anchor. Negative before it.
 *
 * Takes a plain `number` of weeks, not `OrdinaryCycleWeeks`: the narrow type
 * belongs to the DECLARED column (cl 35.x(a) enumerates 1-4), while the
 * arithmetic also has to serve Schedule 3 §3.1's eight-week security cycle,
 * which is "even time" over the cycle and therefore anchored in exactly the
 * same way.
 *
 * This integer IS the cycle's identity — two dates share a cycle exactly when
 * they return the same index, which is what makes bucketing possible without
 * materialising boundaries.
 */
export function cycleIndexFor(dateISO: string, anchorISO: string, weeks: number): number {
    const span = weeks * 7;
    const delta = toEpochDay(dateISO) - toEpochDay(anchorISO);
    if (!Number.isFinite(delta)) return 0;
    return Math.floor(delta / span);
}

/** Half-open bounds `[start, endExclusive)` of the cycle containing `dateISO`. */
export function cycleBoundsFor(
    dateISO: string,
    anchorISO: string,
    weeks: number,
): { start: string; endExclusive: string; endInclusive: string } {
    const span = weeks * 7;
    const idx = cycleIndexFor(dateISO, anchorISO, weeks);
    const startDay = toEpochDay(anchorISO) + idx * span;
    return {
        start: fromEpochDay(startDay),
        endExclusive: fromEpochDay(startDay + span),
        endInclusive: fromEpochDay(startDay + span - 1),
    };
}

/**
 * The ordinary-hours ceiling for a cycle.
 *
 * Uses the employee's own contracted weekly hours where they have them — a
 * part-timer on 20h/week has a 40h fortnight, not a 76h one (cl 35.2(b) caps at
 * "an average of 38", and cl 12.3(b) engages them for "a predetermined number of
 * hours less than" that). Falls back to the 38h basis the ladder is built from.
 */
export function cycleCeilingHours(weeks: number, weeklyHours?: number | null): number {
    const basis = typeof weeklyHours === 'number' && weeklyHours > 0
        ? weeklyHours
        : ORD_WEEKLY_LIMIT_DEFAULT;
    return basis * weeks;
}

/** Human label for a cycle, e.g. "76h in 2 weeks" — used in badges and hits. */
export function cycleLabel(weeks: number, weeklyHours?: number | null): string {
    const ceiling = cycleCeilingHours(weeks, weeklyHours);
    const hrs = Number.isInteger(ceiling) ? String(ceiling) : ceiling.toFixed(1);
    return `${hrs}h in ${weeks} week${weeks === 1 ? '' : 's'}`;
}

/**
 * Resolve one governing cycle for someone holding several active contracts.
 *
 * Takes the SHORTEST declared cycle. Cycle length is a smoothing allowance, not
 * a rate — all four rungs average 38h/week, but a one-week cycle permits no
 * smoothing at all. The shortest is therefore the strictest, and the strictest is
 * the safe aggregation when one person's engagements disagree.
 */
export function resolveGoverningCycleWeeks(
    declared: readonly (number | string | null | undefined)[],
): OrdinaryCycleWeeks {
    const weeks = declared
        .filter(v => v !== null && v !== undefined)
        .map(normaliseCycleWeeks);
    if (weeks.length === 0) return ORD_CYCLE_WEEKS_DEFAULT;
    return Math.min(...weeks) as OrdinaryCycleWeeks;
}
