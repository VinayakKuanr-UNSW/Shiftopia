/**
 * Baseline FT Schedule — domain type contract.
 *
 * WHAT THIS MODULE IS FOR. The AutoScheduler answers "given shifts that exist,
 * who should cover them". This answers the other question: "given a full-time
 * employee's contract and their normal working pattern, what shifts SHOULD
 * exist". It therefore has to be able to create shifts, which is why it cannot
 * live inside the AutoScheduler's data model — `autoschedule_assignments` is
 * keyed on `shift_id`, so a shift must already exist to appear in it.
 *
 * EVERYTHING HERE IS PURE. No I/O, no `Date.now()`, no `Math.random()`, no
 * `Set` iteration order leaking into output. Every time-dependent input is
 * passed in explicitly. That is not tidiness — it is the only way the
 * idempotency guarantee ("generate twice, get the same proposal") can be
 * asserted in a unit test rather than hoped for in production.
 *
 * THE PRODUCT PHILOSOPHY, IN ONE LINE. The generator prefers an honest variance
 * over an illegal roster. If an employee is owed 24h 24m and the pattern
 * produces three lawful 8h days, the answer is three shifts and a stated 24
 * minutes of variance — never a fourth shift of 24 minutes, which cl 35.1(c)
 * forbids, and never a silent rounding that makes the arithmetic look tidy.
 */

import type { OrdinaryCycleWeeks } from '@/modules/compliance/ordinary-hours-cycle';

/* ────────────────────────────────────────────────────────────────────────────
   Pattern — what a normal week looks like
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * ISO weekday. 1 = Monday … 7 = Sunday.
 *
 * Deliberately ISO rather than JavaScript's `Date#getDay()` (0 = Sunday):
 * cl 35.1(b) allows ordinary hours "Monday to Sunday inclusive", and every
 * cycle boundary in `ordinary-hours-cycle.ts` is anchored to a Monday. Using
 * the same origin as the clause and the anchor removes an off-by-one that
 * would otherwise sit between this module and every date it reasons about.
 */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * One slot in a baseline pattern — a weekday plus a shift shape.
 *
 * Sourced from a `template_shifts` row. Carries NO date: a pattern describes a
 * repeating week, and turning it into dates is `candidateGenerator`'s job.
 */
export interface PatternSlot {
    templateShiftId: string;
    /**
     * REQUIRED, and the reason `patternValidator` exists.
     *
     * In production every `template_shifts` row has `day_of_week = NULL`, which
     * `apply_template_to_date_range_v2` reads as "stamp on every day". A pattern
     * whose day is universally null is not a pattern — it is a shape with no
     * schedule — so the validator rejects the template rather than letting this
     * field be optional and defaulting it to something plausible.
     */
    dayOfWeek: IsoWeekday;
    /** `HH:mm`, naive Sydney local — the same basis `shifts.start_time` uses. */
    startTime: string;
    /** `HH:mm`. May be <= startTime for a shift crossing midnight. */
    endTime: string;
    unpaidBreakMinutes: number;
    paidBreakMinutes: number;
    /** Gross span minus the UNPAID break. The universal measure in this codebase. */
    netMinutes: number;
    roleId: string;
    /** Tie-break for deterministic ordering within a day. */
    sortOrder: number;
}

/** A baseline pattern, resolved from one `roster_templates` row. */
export interface BaselinePattern {
    templateId: string;
    /**
     * Sub-department is a property of the TEMPLATE, not of its shifts —
     * `template_shifts` has no `sub_department_id` column. One template is
     * therefore one sub-department, and that is enforced rather than assumed.
     */
    subDepartmentId: string;
    slots: PatternSlot[];
}

/* ────────────────────────────────────────────────────────────────────────────
   Requirement — what the contract owes
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The contract facts the calculator needs, already resolved across a person's
 * several active contracts by `resolveComplianceBasis`.
 *
 * Note `contractedWeeklyHours` is optional: `resolveComplianceBasis` returns
 * `undefined` when the winning contract records no usable weekly basis. The
 * calculator falls back to the 38h the ladder is built from and raises a
 * WARNING rather than failing — a missing number is a data gap, not an
 * eligibility question.
 */
export interface EmployeeContractFacts {
    employeeId: string;
    userContractId: string;
    contractedWeeklyHours: number | undefined;
    cycleWeeks: OrdinaryCycleWeeks;
    /** `yyyy-MM-dd`, always a Monday. */
    cycleAnchor: string;
    /** `yyyy-MM-dd`. */
    contractStart: string;
    /** `yyyy-MM-dd`, or null for an open-ended engagement. */
    contractEnd: string | null;
    /** Role the contract authorises. Compared against the pattern's role. */
    roleId: string;
    subDepartmentId: string;
}

/**
 * A day the employee is absent, already classified.
 *
 * `credit` mirrors `LeavePolicy.ordinaryHoursCredit`. 'ELECTION' is carried
 * through rather than collapsed, so the calculator can report BOTH readings
 * instead of picking one — the EBA gives the Team Member the choice and we do
 * not record which they made.
 */
export interface LeaveDay {
    date: string;
    leaveType: string;
    credit: 'CREDITS' | 'BLOCKS' | 'ELECTION';
    /** Hours this day discharges when it credits. Usually the contracted daily hours. */
    creditHours: number;
    /** Approved leave binds; pending is surfaced as a WARNING and does not. */
    status: 'approved' | 'pending';
}

/** A shift that already exists, in any sub-department. */
export interface ExistingShift {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    netMinutes: number;
    subDepartmentId: string | null;
    /**
     * Whether the roster this shift belongs to is published or locked.
     *
     * Carried because published hours still COUNT as consumption — the employee
     * really is working them — while the roster itself cannot be added to.
     * Those are two different questions and conflating them would either
     * over-roster the employee or under-count their hours.
     */
    rosterPublishedOrLocked: boolean;
}

/**
 * The requirement for ONE anchored work cycle.
 *
 * There is deliberately no "requirement for the roster period" type. cl 35.x(a)
 * caps a CYCLE, and the roster period is an unrelated calendar chosen by a
 * manager; a period of 15 Jul – 15 Aug against a four-week cycle anchored on
 * 2024-01-01 straddles two of them, and each is capped on its own. Producing a
 * single number for the period would be the averaging bug this whole module
 * exists to avoid.
 */
export interface CycleRequirement {
    cycleIndex: number;
    /** `yyyy-MM-dd`, inclusive. */
    start: string;
    /** `yyyy-MM-dd`, inclusive. */
    endInclusive: string;
    /** Full ceiling for the cycle, before pro-rating. `weeklyHours × weeks`. */
    ceilingHours: number;
    /** Days of this cycle that lie inside BOTH the contract's life and the roster period. */
    activeDays: number;
    /** `weeks × 7`. */
    cycleDays: number;
    /** `ceilingHours × activeDays / cycleDays`. What the employee is owed. */
    requiredHours: number;
    /** Existing rostered hours in this cycle, across EVERY sub-department. */
    existingHours: number;
    /** Hours discharged by leave that credits. */
    paidLeaveHours: number;
    /** Hours discharged by public holidays under cl 56.4. */
    publicHolidayCreditHours: number;
    /** Dates nothing may be rostered on, and which discharge nothing. */
    blockedDates: string[];
    /** `max(0, required − existing − paidLeave − phCredit)`. */
    deficitHours: number;
    /**
     * The same deficit computed under the OTHER reading of every 'ELECTION'
     * leave day in this cycle. Equal to `deficitHours` when there are none.
     * Both are shown; neither is chosen for the user.
     */
    deficitHoursIfElectionUnpaid: number;
}

/* ────────────────────────────────────────────────────────────────────────────
   Candidate — a shift that does not exist yet
   ──────────────────────────────────────────────────────────────────────────── */

export interface Candidate {
    employeeId: string;
    userContractId: string;
    templateShiftId: string;
    /** `yyyy-MM-dd`. */
    shiftDate: string;
    startTime: string;
    endTime: string;
    unpaidBreakMinutes: number;
    paidBreakMinutes: number;
    netMinutes: number;
    roleId: string;
    /** Which cycle's deficit this candidate is discharging. */
    cycleIndex: number;
    /**
     * Stable natural key. Deliberately a readable composite rather than a hash:
     * a hash cannot be debugged from a database row, and the uniqueness this
     * needs is exact, not probabilistic. See `buildIdempotencyKey`.
     */
    idempotencyKey: string;
}

/* ────────────────────────────────────────────────────────────────────────────
   Findings
   ──────────────────────────────────────────────────────────────────────────── */

export type Severity = 'BLOCKING' | 'WARNING' | 'INFO';

/**
 * Every finding leads with plain English and carries the clause second.
 *
 * The review screen shows `plain` first and `ruleId`/`clause` behind a "Why?"
 * disclosure. A manager reconciling a roster needs to know that 48 minutes is
 * below a full-time day's minimum; they do not need to know it was
 * `SHAPE_FT_MIN_DAY` that said so, until they want to check.
 */
export interface Finding {
    severity: Severity;
    /** User-facing sentence. Complete, specific, no rule ids. */
    plain: string;
    /** Machine identifier, e.g. `SHAPE_FT_MIN_DAY`, `BFT_PATTERN_EXCEEDS_CONTRACT`. */
    code: string;
    /** e.g. `ICC EBA cl 35.1(c)`. Absent for product rules, which have no clause. */
    clause?: string;
    calculation?: Record<string, unknown>;
    employeeId?: string;
    /** Set when the finding is about one rejected candidate. */
    candidateKey?: string;
    /**
     * May a manager proceed past this?
     *
     * True only for WARNING. Every WARNING here corresponds to a clause the
     * Agreement itself qualifies — "on average", "unless otherwise mutually
     * agreed" — so accepting one is exercising a discretion the EBA grants.
     * Every BLOCKING is unqualified, and is never overridable in v1.
     */
    overridable: boolean;
}

/** Convenience: is this finding set safe to act on? */
export function hasBlocking(findings: readonly Finding[]): boolean {
    return findings.some(f => f.severity === 'BLOCKING');
}
