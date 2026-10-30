/**
 * TOIL — time off in lieu. Domain types.
 *
 * The ledger lives in `public.toil_ledger` (migration 20261010082231). It is
 * append-only and every entry is signed MINUTES, so a balance is a plain sum
 * and a correction is a further entry, never an edit.
 */

export type ToilEntryType =
    /** Daily rule: billable net over 7.6h on one day. Corrections are negative. */
    | 'accrual'
    /** Weekly rule: hours beyond contracted weekly hours, less the week's daily TOIL. */
    | 'weekly_topup'
    /** An approved TOIL leave request. */
    | 'taken'
    /** That request revoked, rejected or reduced. */
    | 'taken_reversal'
    /** Paid out at the employee's request (or by a manager on their behalf). */
    | 'payout'
    /** Not taken within 6 months — paid out by the nightly job. */
    | 'expiry_payout'
    /** No eligible contract any more — the whole balance paid out. */
    | 'termination_payout'
    /** A manual correction, always with a reason. */
    | 'adjustment';

export interface ToilLedgerEntry {
    id: string;
    employeeId: string;
    userContractId: string;
    entryType: ToilEntryType;
    /** Signed: earning is positive, taking and paying out are negative. */
    minutes: number;
    /** yyyy-MM-dd — the work date, the Sunday ending the week, the leave's first day, or the payout date. */
    effectiveDate: string;
    leaveRequestId: string | null;
    sourceTimesheetIds: string[];
    /** accrual / weekly_topup: the billable minutes the target was computed from. */
    workedMinutes: number | null;
    /** accrual: 456 (7.6h). weekly_topup: the week's required minutes after leave and public holidays. */
    thresholdMinutes: number | null;
    reason: string | null;
    createdBy: string | null;
    createdAt: string;
}

/** Where one person stands — `get_toil_balances`. */
export interface ToilPosition {
    employeeId: string;
    /** Holds a salaried full-time or part-time contract today. */
    eligible: boolean;
    balanceMinutes: number;
    /** Reserved by pending TOIL requests. */
    heldMinutes: number;
    /** `balanceMinutes − heldMinutes` — what a new request or payout is measured against. */
    availableMinutes: number;
    earnedMinutes: number;
    takenMinutes: number;
    paidOutMinutes: number;
    /** The soonest-expiring hours still unused, or null when nothing is banked. */
    nextExpiry: { date: string; minutes: number } | null;
    hasHistory: boolean;
}

/** What is left of one earned day / week, oldest used first — `get_toil_lots`. */
export interface ToilLot {
    lotDate: string;
    earnedMinutes: number;
    remainingMinutes: number;
    expiresOn: string;
}
