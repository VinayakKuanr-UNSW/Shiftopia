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

/** Iteration order for pickers. `null` ("Any") is modelled by the caller. */
export const TARGET_EMPLOYMENT_TYPES: readonly TargetEmploymentType[] = [
    'FT',
    'PT',
    'Casual',
] as const;

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
