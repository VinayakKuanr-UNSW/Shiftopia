/**
 * Office Schedule — domain type contract.
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

/**
 * A leave day before its credit is known.
 *
 * How many hours a leave day discharges is a function of the PATTERN — the
 * employee's own ordinary hours on that weekday — so it cannot be resolved
 * while reading the database, only once the pattern is in hand. Splitting the
 * type is what lets the leave read be cached for a whole period while the
 * pattern is edited live on top of it.
 */
export type RawLeaveDay = Omit<LeaveDay, 'creditHours'>;

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

/* ────────────────────────────────────────────────────────────────────────────
   Findings
   ──────────────────────────────────────────────────────────────────────────── */

type Severity = 'BLOCKING' | 'WARNING' | 'INFO';

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

