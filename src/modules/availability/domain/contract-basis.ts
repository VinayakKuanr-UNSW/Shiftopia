/**
 * Which of a person's active contracts sets their compliance basis.
 *
 * WHY THIS EXISTS. 30 of 103 people in production hold more than one active
 * contract, and one holds two whose employment statuses disagree outright
 * ({Full-Time, Casual}). The reader this replaces took `contracts[0]` straight
 * off unordered PostgREST output, so for that person whether the ordinary-hours
 * rolling caps applied AT ALL could flip between two loads of the same page.
 *
 * The ordering is deterministic and picked to fail in the safe direction:
 *
 *   1. NON-CASUAL BEATS CASUAL. Casuals are exempt from the rolling
 *      ordinary-hours caps (`compliance/v8/rules/ordinary-hours-avg.ts`), so
 *      resolving a dual-status person onto their casual contract would EXEMPT
 *      them from every window check on the strength of an array ordering. A
 *      false exemption is invisible; a false alarm is not.
 *   2. Then the HIGHER `contractedWeeklyHours`. Within the capped population
 *      the weekly basis IS the limit (×2/×3/×4 for the windows), so picking the
 *      smaller of a person's two contracts manufactures violations against
 *      hours they are entitled to work — the same false-positive wall that
 *      `hours-compliance.ts` was written to stop.
 *   3. Then the later `startDate`, then the original order, so the result is
 *      total and stable rather than merely usually-stable.
 *
 * An unrecognised status ranks WITH the capped population, never with the
 * casuals, for the reason in rule 1.
 */

import type { TeamContractType } from '../model/team-availability.types';

export interface ContractBasisInput {
    employmentStatus: string | null;
    /**
     * `user_contracts.contracted_weekly_hours` is a Postgres `numeric`, and
     * PostgREST is entitled to serialise those as STRINGS to preserve
     * precision. Typed to admit that rather than to a `number` a `typeof`
     * check would then quietly reject — dropping a part-timer's 20h basis back
     * onto the 38h default doubles their cap without a single error.
     */
    contractedWeeklyHours: number | string | null;
    /** yyyy-MM-dd, or null when the contract records no start. */
    startDate: string | null;
    /**
     * Ordinary-hours envelope (migration
     * 20260817000000_contract_ordinary_hours_envelope.sql). Optional because
     * most readers of this module never select these columns, and NULL is a
     * meaningful value in its own right: unrestricted.
     */
    ordinarySpanStart?: string | null;
    ordinarySpanEnd?: string | null;
    ordinaryDays?: number[] | null;
}

/**
 * When this contract may be rostered — the span-of-hours question, resolved
 * from the contract rather than declared by the employee.
 *
 * NOT the days-off pattern. cl 35.1(e) paired days off and the 20-in-28 cap
 * are enforced by the solver and the V8 engine; an envelope reading
 * "06:00-18:00, seven days" is correct for someone rostered only five of them.
 *
 * `null` span ends mean unrestricted, which is every contract in production
 * until one is explicitly opted in.
 */
export interface OrdinaryHoursEnvelope {
    /** 'HH:mm:ss', or null when unrestricted. */
    spanStart: string | null;
    spanEnd: string | null;
    /** ISO weekdays (1=Mon .. 7=Sun) the span applies on. Null = all seven. */
    days: number[] | null;
    /** True when both span ends are set — i.e. the envelope actually binds. */
    isConfigured: boolean;
}

export interface ContractBasis {
    contractType: TeamContractType;
    /** Undefined when the chosen contract records no usable weekly basis. */
    contractedWeeklyHours: number | undefined;
    employmentStatus: string | null;
    envelope: OrdinaryHoursEnvelope;
    /**
     * What an ABSENT availability declaration means for this person — the
     * frontend mirror of the solver's `availability_mode`, resolved from the
     * same property (do they carry a contract obligation?) so the page cannot
     * tell the employee something the solver disagrees with.
     *
     * 'OPT_IN'  — casual. Availability is an OFFER; silence means unavailable,
     *             so an empty page IS a problem they need to fix.
     * 'OPT_OUT' — FT/PT. Availability is an EXCEPTION LEDGER; silence means
     *             available, so an empty page is the normal, correct state and
     *             the UI must say so rather than implying work is outstanding.
     */
    availabilityMode: 'OPT_IN' | 'OPT_OUT';
}

const UNRESTRICTED_ENVELOPE: OrdinaryHoursEnvelope = {
    spanStart: null,
    spanEnd: null,
    days: null,
    isConfigured: false,
};

/**
 * Both ends or neither. A half-configured span would otherwise present as a
 * bound with no upper (or lower) edge, and the DB CHECK constraint
 * `user_contracts_ordinary_span_valid` already rejects that shape — this keeps
 * a reader that somehow sees one from rendering it as real.
 */
function toEnvelope(contract: ContractBasisInput): OrdinaryHoursEnvelope {
    const spanStart = contract.ordinarySpanStart ?? null;
    const spanEnd = contract.ordinarySpanEnd ?? null;
    if (!spanStart || !spanEnd) return { ...UNRESTRICTED_ENVELOPE, days: contract.ordinaryDays ?? null };
    return {
        spanStart,
        spanEnd,
        days: contract.ordinaryDays ?? null,
        isConfigured: true,
    };
}

/**
 * Collapse `user_contracts.employment_status` onto the token the rules switch
 * on. Mirrors `rosters/services/eligibility.service.ts` — in particular
 * 'Flexible Part-Time' is a PART-TIME contract, not a casual one, and so keeps
 * its caps. Anything unrecognised returns null, which the rules read as
 * "check them anyway".
 */
export function toContractType(employmentStatus: string | null | undefined): TeamContractType {
    if (!employmentStatus) return null;
    const normalised = String(employmentStatus).trim().toLowerCase();
    if (normalised === 'full-time' || normalised === 'full time') return 'FT';
    if (normalised === 'casual') return 'CASUAL';
    if (normalised === 'part-time' || normalised === 'part time') return 'PT';
    if (normalised.startsWith('flexible')) return 'PT';
    return null;
}

/** Rule 1 as a sortable rank. Higher = more rules apply to them. */
function constraintRank(employmentStatus: string | null): number {
    return toContractType(employmentStatus) === 'CASUAL' ? 0 : 1;
}

function weeklyHoursOf(contract: ContractBasisInput): number {
    const raw = contract.contractedWeeklyHours;
    if (raw === null || raw === undefined || raw === '') return 0;
    const h = typeof raw === 'number' ? raw : Number(raw);
    // Casual rows in production carry 0 here; 0 is "unset", not "a zero-hour
    // limit", and must never become the basis a cap is computed from.
    return Number.isFinite(h) && h > 0 ? h : 0;
}

/** The three rules above, in order, over two contracts. */
function compareBasis(a: ContractBasisInput, b: ContractBasisInput): number {
    const rank = constraintRank(b.employmentStatus) - constraintRank(a.employmentStatus);
    if (rank !== 0) return rank;

    const hours = weeklyHoursOf(b) - weeklyHoursOf(a);
    if (hours !== 0) return hours;

    // Later start first. A missing start_date sorts last rather than comparing
    // as the empty string, which would otherwise win every comparison.
    const aStart = a.startDate ?? '';
    const bStart = b.startDate ?? '';
    if (aStart === bStart) return 0;
    if (!aStart) return 1;
    if (!bStart) return -1;
    return bStart.localeCompare(aStart);
}

/**
 * The ordering, exposed whole because the member reader needs more than its
 * head: the role and employment chip it displays were reading row order too,
 * and now sort the same way.
 *
 * Array.prototype.sort is stable in every engine this ships to, so equal
 * contracts keep their original order without an index tiebreak.
 */
export function sortByComplianceBasis<T extends ContractBasisInput>(contracts: readonly T[]): T[] {
    return [...contracts].sort(compareBasis);
}

/**
 * Pick the contract whose terms the hours rules are applied against.
 *
 * Returns an all-null basis for an empty list — the caller keeps whatever it
 * shows for display; only the compliance basis is undefined.
 */
export function resolveComplianceBasis(contracts: readonly ContractBasisInput[]): ContractBasis {
    const winner = sortByComplianceBasis(contracts)[0];
    if (!winner) {
        return {
            contractType: null,
            contractedWeeklyHours: undefined,
            employmentStatus: null,
            envelope: UNRESTRICTED_ENVELOPE,
            // No contract we could read. OPT_IN is the strict reading and the
            // one the solver defaults to, so the page never promises someone
            // they are available when the solver will not place them.
            availabilityMode: 'OPT_IN',
        };
    }

    const hours = weeklyHoursOf(winner);
    const contractType = toContractType(winner.employmentStatus);
    return {
        contractType,
        contractedWeeklyHours: hours > 0 ? hours : undefined,
        employmentStatus: winner.employmentStatus,
        envelope: toEnvelope(winner),
        // Mirrors the controller: driven by whether a contract obligation
        // exists, not by the employment token. An unrecognised status ranks
        // with the capped population everywhere else in this file, but it
        // carries no known obligation, so it stays OPT_IN here.
        availabilityMode: contractType === 'FT' || contractType === 'PT' ? 'OPT_OUT' : 'OPT_IN',
    };
}
