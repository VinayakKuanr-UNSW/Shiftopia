// Employment type — canonical domain vocabulary
//
// There are TWO vocabularies in this system and conflating them has already
// caused silent bugs, so they are named separately here:
//
//   EmploymentStatus      — what the DB stores per contract
//                           (`public.employment_status` enum, 4 values, LONG form)
//   TargetEmploymentType  — what the SOLVER compares against
//                           (3 values, SHORT form)
//
// The solver deliberately collapses 'Flexible Part-Time' onto 'PT' and carries
// flexibility on a SEPARATE axis (`EmployeeInput.is_flexible`). See
// `_EMPLOYMENT_TYPE_ALIASES` / `normalize_employment_type()` in
// optimizer-service/model_builder.py — the functions below are the TypeScript
// mirror of that table and MUST stay in step with it.

/** The DB's `public.employment_status` enum, verbatim. */
export type EmploymentStatus =
    | 'Full-Time'
    | 'Part-Time'
    | 'Casual'
    | 'Flexible Part-Time';

/**
 * The solver's canonical set. Also the accepted values of
 * `shifts.target_employment_type` (`shifts_target_employment_type_check`).
 *
 * NOTE there is deliberately no 'Flexible PT' member: flexibility rides on the
 * companion `shifts.target_requires_flexible` boolean, mirroring the solver's
 * (employment_type, is_flexible) tuple. A fourth token would be normalized back
 * down to 'PT' by the solver and silently match every part-timer.
 */
export type TargetEmploymentType = 'FT' | 'PT' | 'Casual';

/**
 * Every value the column accepts. Iteration order for anything that must be
 * able to DISPLAY all three — filters, labels, existing shifts.
 *
 * NOT the list to offer when creating a shift. See
 * `CREATABLE_TARGET_EMPLOYMENT_TYPES`.
 */
export const TARGET_EMPLOYMENT_TYPES: readonly TargetEmploymentType[] = [
    'FT',
    'PT',
    'Casual',
] as const;

/**
 * What a person may CHOOSE when creating a shift by hand, outside the Office
 * group.
 *
 * Full-time shifts live in the roster's Office group (handover 2026-10-04,
 * D2), so 'FT' is offered there and nowhere else — see
 * `targetEmploymentTypeOptions`. That keeps them in one place; it is not what
 * makes them lawful.
 *
 * What makes them lawful is the cycle check. Full-time hours are capped over a
 * declared multi-week cycle (ICC EBA cl 35.1(a)). That check was once missing
 * from the single-shift form, which is how production carried 160h against a
 * 152h cap with no screen saying so. The form's V8 ordinary-hours rule now runs
 * against the employee's declared cycle and the shifts around it, and blocks
 * the save at the ceiling. The database adds one rule of its own: one
 * full-time shift per person per day (cl 39.1), `trg_shift_ft_one_per_day`.
 *
 * (Until 2026-10-04 a trigger refused any FT row not created by the Office
 * page. It checked a label, not the shift, and was dropped in
 * 20261004170000.)
 */
export const CREATABLE_TARGET_EMPLOYMENT_TYPES: readonly TargetEmploymentType[] = [
    'PT',
    'Casual',
] as const;

/**
 * The options a target-employment-type picker should show.
 *
 * `CREATABLE_TARGET_EMPLOYMENT_TYPES`, plus whatever the shift already is.
 *
 * Editing a full-time shift outside the Office group must still RENDER as
 * "Full-Time". Without the current value in the list a Radix Select falls back
 * to its placeholder, so the field silently reads as unset and the next save
 * changes the shift's type — turning "open a shift to check it" into an
 * accidental edit. Switching away is still possible; it just has to be
 * deliberate.
 *
 * `allowFullTime` — the shift is in the Office group, where full-time shifts
 * are created: every type is offered.
 */
export function targetEmploymentTypeOptions(
    current: TargetEmploymentType | null | undefined,
    opts: { allowFullTime?: boolean } = {},
): readonly TargetEmploymentType[] {
    if (opts.allowFullTime) return TARGET_EMPLOYMENT_TYPES;
    if (!current || CREATABLE_TARGET_EMPLOYMENT_TYPES.includes(current)) {
        return CREATABLE_TARGET_EMPLOYMENT_TYPES;
    }
    return [current, ...CREATABLE_TARGET_EMPLOYMENT_TYPES];
}

/** The roster group where full-time shifts are created (D2). */
export const FULL_TIME_GROUP_TYPE = 'office';

/**
 * The target a NEW shift starts with.
 *
 * Only a caller that has already decided supplies one — and opening the form
 * in the Office group is that decision, because it is where full-time shifts
 * live. Everywhere else it is undefined and the planner must choose: seeding
 * e.g. 'Casual' would silently decide who may work the shift, and the match is
 * HARD. A starting value, not a lock — the picker still offers every type.
 */
export function initialTargetEmploymentType(
    explicit: TargetEmploymentType | null | undefined,
    groupType: string | null | undefined,
): TargetEmploymentType | undefined {
    if (explicit) return explicit;
    return groupType === FULL_TIME_GROUP_TYPE ? 'FT' : undefined;
}

export const TARGET_EMPLOYMENT_TYPE_LABELS: Record<TargetEmploymentType, string> = {
    FT: 'Full-Time',
    PT: 'Part-Time',
    Casual: 'Casual',
};

/**
 * Mirror of `_EMPLOYMENT_TYPE_ALIASES` in model_builder.py. Keyed on the
 * lower-cased, trimmed wire value so long form, short form and the underscore /
 * hyphen / space spellings all land on the same canonical token.
 */
const EMPLOYMENT_TYPE_ALIASES: Readonly<Record<string, TargetEmploymentType>> = {
    // -> 'FT'
    'ft': 'FT', 'full-time': 'FT', 'full_time': 'FT', 'fulltime': 'FT',
    'full time': 'FT', 'full': 'FT',
    // -> 'PT'
    'pt': 'PT', 'part-time': 'PT', 'part_time': 'PT', 'parttime': 'PT',
    'part time': 'PT', 'part': 'PT',
    'flexible part-time': 'PT', 'flexible part_time': 'PT',
    'flexible parttime': 'PT', 'flexible part time': 'PT',
    // -> 'Casual'
    'casual': 'Casual',
};

/**
 * Canonicalize any wire form of an employment type to the solver's set.
 *
 * Unrecognized / empty values fall back to 'Casual', matching
 * `normalize_employment_type()`'s documented posture: casuals carry no FT/PT
 * ordinary-hours contract floor, so it is the safest default to assume.
 */
export function toTargetEmploymentType(
    value: string | null | undefined,
): TargetEmploymentType {
    if (!value) return 'Casual';
    return EMPLOYMENT_TYPE_ALIASES[String(value).trim().toLowerCase()] ?? 'Casual';
}

/**
 * Canonical employment type for an employee the scheduling pipeline carries,
 * which holds the answer in TWO fields that disagree in production.
 *
 * `employment_status` (the Active contract's own value) WINS. 17 of 122 staff
 * have a `profiles.employment_type` that contradicts their contract — 12 look
 * Casual but are Full-Time — and the write path's trigger compares against
 * `user_contracts.employment_status`, so anything derived from the other field
 * proposes assignments the write will reject.
 *
 * THIS IS THE PREDICATE THE FT AVAILABILITY MODEL RESTS ON. `RosterFetcher`
 * decides whose availability slots to fetch, and `auto-scheduler.controller`
 * decides whose `availability_mode` is OPT_OUT. If those two ever classify one
 * person differently, that person is sent an EMPTY slot list under OPT_IN — and
 * under `enforce_availability` an empty OPT_IN list hard-filters them out of
 * every single shift, silently, which is the HC-5d 0/144 failure. They call this
 * function so the disagreement is not expressible.
 */
export function resolveEmploymentType(
    employmentStatus: string | null | undefined,
    contractType: string | null | undefined,
): TargetEmploymentType {
    return toTargetEmploymentType(employmentStatus || contractType);
}

/**
 * Is this employee Full-Time — i.e. availability-exempt, rostered from their
 * contract and regulated by Leave alone?
 *
 * The one test behind both halves of the FT availability model: whose slots are
 * skipped (`RosterFetcher.fetchAvailability`) and whose mode is OPT_OUT
 * (`auto-scheduler.controller`). It is also the TS mirror of the SQL
 * `sm_holds_active_ft_contract()`, which guards the write path.
 */
export function isFullTimeEmployee(
    employmentStatus: string | null | undefined,
    contractType: string | null | undefined,
): boolean {
    return resolveEmploymentType(employmentStatus, contractType) === 'FT';
}

/** Does this employee carry a contract obligation (FT/PT) rather than opt in? */
export function hasContractObligation(
    employmentStatus: string | null | undefined,
    contractType: string | null | undefined,
): boolean {
    return resolveEmploymentType(employmentStatus, contractType) !== 'Casual';
}

/**
 * Whether a contract's employment status is a FLEXIBLE variant. Kept separate
 * from `toTargetEmploymentType` precisely because that function erases the
 * distinction.
 */
export function isFlexibleEmploymentStatus(
    value: string | null | undefined,
): boolean {
    if (!value) return false;
    return String(value).trim().toLowerCase().startsWith('flexible');
}

/**
 * Does a contract satisfy a shift's employment target?
 *
 * `target === null` means "Any" and matches everything. When
 * `requiresFlexible` is set, the contract must ALSO be a flexible variant —
 * this is the one case where the collapsed token is not enough on its own.
 */
export function contractMatchesTarget(
    employmentStatus: string | null | undefined,
    target: TargetEmploymentType | null | undefined,
    requiresFlexible = false,
): boolean {
    if (!target) return true;
    if (toTargetEmploymentType(employmentStatus) !== target) return false;
    if (requiresFlexible && !isFlexibleEmploymentStatus(employmentStatus)) return false;
    return true;
}
