/**
 * TOIL rules as pure functions — no React, no I/O.
 *
 * THE DATABASE IS THE AUTHORITY. Accrual, the balance, FIFO expiry and the
 * refusal to overdraw all run in Postgres (migration 20261010082231), because
 * timesheets are approved from several places and a rule held in one caller is
 * skipped by the others. What is here mirrors those rules so the screens can
 * explain a number and stop a request the database would refuse anyway.
 *
 * WHO EARNS IT — salaried class-1 contracts only:
 *   • Full-Time, Part-Time or Flexible Part-Time, AND paid by salary.
 *   • The ICC EBA 2025 has no time-off-in-lieu clause: cl 42.2 pays overtime
 *     at 150% then 200% and cl 42.4 says it is PAID. So an EBA-level contract
 *     never earns TOIL — its overtime is already paid.
 *   • Casual (class 2) hours never count, even for someone who also holds a
 *     salaried contract: only shifts linked to the salaried contract do.
 *
 * HOW IT IS EARNED (decisions 2026-10-10):
 *   daily    billable net − 7.6h per day, over approved timesheets.
 *   weekly   billable net beyond contracted weekly hours (less approved leave
 *            and weekday public holidays), minus what the daily rule gave.
 *   Hour for hour. Taken within 6 months, or paid out. Never overdrawn.
 */
import { format, parseISO } from 'date-fns';
import type { ToilEntryType, ToilLedgerEntry, ToilPosition } from '../model/toil.types';

/** 7.6h — one ordinary day (cl 35.1(c)). */
export const TOIL_DAILY_THRESHOLD_MINUTES = 456;
/** 38h — a full-time week (cl 12.2(b)). */
export const FULL_TIME_WEEK_MINUTES = 2280;
/** TOIL not taken within this many months is paid out. */
export const TOIL_EXPIRY_MONTHS = 6;

const CLASS_ONE = new Set(['fulltime', 'parttime', 'flexibleparttime']);

/** 'Full-Time' / 'full_time' / 'Full Time' → 'fulltime'. */
function normaliseStatus(s: string | null | undefined): string {
    return String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Does this contract earn TOIL? Mirrors `internal.toil_contract_eligible`
 * (which also honours effective-dated pay terms; this reads current terms).
 */
export function isToilEligibleContract(c: {
    employmentStatus?: string | null;
    payBasis?: string | null;
}): boolean {
    return CLASS_ONE.has(normaliseStatus(c.employmentStatus)) && c.payBasis === 'salary';
}

/** Daily rule for one person-day: the billable nets of every eligible shift that day. */
export function dailyAccrualMinutes(netMinutes: readonly (number | null | undefined)[]): number {
    const worked = netMinutes.reduce<number>((s, n) => s + (n ?? 0), 0);
    return Math.max(0, worked - TOIL_DAILY_THRESHOLD_MINUTES);
}

/** Weekly rule for one person-week. Mirrors `internal.toil_recompute_week`. */
export function weeklyTopupMinutes(i: {
    workedMinutes: number;
    contractedMinutes: number;
    absenceCreditMinutes: number;
    dailyAccruedMinutes: number;
}): number {
    const required = Math.max(0, i.contractedMinutes - i.absenceCreditMinutes);
    return Math.max(0, i.workedMinutes - required - i.dailyAccruedMinutes);
}

/** Minutes as hours, to two decimals. */
export function toilHours(minutes: number): number {
    const v = Math.round((minutes / 60) * 100) / 100;
    return v === 0 ? 0 : v;
}

/** "2.4h", "0.25h", "-1h". */
export function fmtToil(minutes: number): string {
    return `${toilHours(minutes)}h`;
}

/** Hours (as typed or derived) to whole minutes — how the database stores them. */
export function hoursToMinutes(hours: number): number {
    return Math.round(hours * 60);
}

export interface ToilRequestCheck {
    /** Set when the request must not be sent: the database would refuse it. */
    blockedReason: string | null;
    availableMinutes: number;
    /** Available after this request. */
    afterMinutes: number;
}

/**
 * Can this much TOIL be requested? Unlike annual or personal leave, TOIL may
 * NOT go negative — it cannot be taken before it is earned. Mirrors
 * `internal.trg_toil_leave_guard` (pending: against balance − other pending).
 */
export function toilRequestCheck(requestedHours: number, position: ToilPosition | null | undefined): ToilRequestCheck {
    const requested = hoursToMinutes(requestedHours);
    if (!position || !position.eligible) {
        return {
            blockedReason: 'Time in lieu is only available on a salaried full-time or part-time contract.',
            availableMinutes: 0,
            afterMinutes: 0,
        };
    }
    const available = position.availableMinutes;
    const after = available - requested;
    if (requested <= 0) return { blockedReason: 'Enter how many hours to take.', availableMinutes: available, afterMinutes: after };
    return {
        blockedReason: after < 0
            ? `Only ${fmtToil(Math.max(0, available))} of time in lieu is available; ${fmtToil(requested)} is requested. `
                + 'Time in lieu cannot be taken before it is earned.'
            : null,
        availableMinutes: available,
        afterMinutes: after,
    };
}

/**
 * Approving a pending TOIL request: measured against the balance (its own
 * hold is released by the approval). Mirrors the guard's approved branch.
 */
export function toilApprovalCheck(requestedHours: number, position: ToilPosition | null | undefined): ToilRequestCheck {
    const requested = hoursToMinutes(requestedHours);
    const balance = position?.balanceMinutes ?? 0;
    const after = balance - requested;
    return {
        blockedReason: after < 0
            ? `Only ${fmtToil(Math.max(0, balance))} of time in lieu is left; ${fmtToil(requested)} is requested. `
                + 'It cannot be approved before it is earned.'
            : null,
        availableMinutes: balance,
        afterMinutes: after,
    };
}

/** Can this much be paid out? Against what is available (pending requests stay held). */
export function payoutCheck(minutes: number, position: ToilPosition | null | undefined): string | null {
    if (!Number.isFinite(minutes) || minutes <= 0) return 'Enter how many hours to pay out.';
    const available = position?.availableMinutes ?? 0;
    if (minutes > available) {
        return `Only ${fmtToil(Math.max(0, available))} can be paid out`
            + `${position && position.heldMinutes > 0 ? ` (${fmtToil(position.heldMinutes)} is held by pending requests)` : ''}.`;
    }
    return null;
}

const dateLabel = (ymd: string) => format(parseISO(ymd), 'EEE d MMM yyyy');

const TITLES: Record<ToilEntryType, { earn: string; correct?: string }> = {
    accrual: { earn: 'Earned — day over 7.6h', correct: 'Day recalculated' },
    weekly_topup: { earn: 'Earned — week over contracted hours', correct: 'Week recalculated' },
    taken: { earn: 'Taken as time off' },
    taken_reversal: { earn: 'Returned to balance' },
    payout: { earn: 'Paid out' },
    expiry_payout: { earn: 'Paid out — not taken within 6 months' },
    termination_payout: { earn: 'Paid out — no current salaried contract' },
    adjustment: { earn: 'Adjusted' },
};

/** One history line in words: what happened, and what it was worked out from. */
export function describeEntry(e: ToilLedgerEntry): { title: string; detail: string } {
    const t = TITLES[e.entryType];
    const isCorrection = (e.entryType === 'accrual' || e.entryType === 'weekly_topup') && e.reason != null;
    const title = isCorrection && t.correct ? t.correct : t.earn;
    let detail: string;
    switch (e.entryType) {
        case 'accrual':
            detail = `${dateLabel(e.effectiveDate)} · ${fmtToil(e.workedMinutes ?? 0)} billable against 7.6h`;
            break;
        case 'weekly_topup':
            detail = `Week ending ${dateLabel(e.effectiveDate)} · ${fmtToil(e.workedMinutes ?? 0)} worked against `
                + `${fmtToil(e.thresholdMinutes ?? 0)} required`;
            break;
        case 'taken':
        case 'taken_reversal':
            detail = `Leave from ${dateLabel(e.effectiveDate)}`;
            break;
        default:
            detail = dateLabel(e.effectiveDate);
    }
    if (e.reason && e.entryType !== 'accrual' && e.entryType !== 'weekly_topup') detail += ` · ${e.reason}`;
    return { title, detail };
}

/**
 * The hourly rate a TOIL payout is priced at (decision 2026-10-10: the salary's
 * hourly equivalent, hour for hour). A contract no longer salaried at payout
 * time is priced at its permanent level rate instead. Null when neither is known.
 */
export function toilPayoutHourlyRate(terms: {
    payBasis?: string | null;
    annualSalary?: number | null;
    contractedWeeklyHours?: number | null;
    employmentStatus?: string | null;
    permanentLevelRate?: number | null;
}): number | null {
    if (terms.payBasis === 'salary' && terms.annualSalary && terms.annualSalary > 0) {
        const weekly = normaliseStatus(terms.employmentStatus) === 'fulltime'
            ? FULL_TIME_WEEK_MINUTES / 60
            : (terms.contractedWeeklyHours && terms.contractedWeeklyHours > 0 ? terms.contractedWeeklyHours : 38);
        return Math.round((terms.annualSalary / 52 / weekly) * 10000) / 10000;
    }
    return terms.permanentLevelRate && terms.permanentLevelRate > 0 ? terms.permanentLevelRate : null;
}

/** Total scheduled span of these shifts in minutes (an end at/before the start runs past midnight). */
export function rosteredSpanMinutes(shifts: readonly { startTime: string | null; endTime: string | null }[]): number {
    return shifts.reduce((sum, sh) => {
        if (!sh.startTime || !sh.endTime) return sum;
        const [startH, startM] = sh.startTime.split(':').map(Number);
        const [endH, endM] = sh.endTime.split(':').map(Number);
        let d = (endH * 60 + endM) - (startH * 60 + startM);
        if (d <= 0) d += 1440;
        return sum + d;
    }, 0);
}

/**
 * Is a TOIL request only PART of the rostered day? Then approving it must not
 * delete the full-time shift — the person still works the rest of it.
 */
export function isPartialDayToil(requestedHours: number, rosteredFtMinutes: number): boolean {
    return rosteredFtMinutes > 0 && hoursToMinutes(requestedHours) < rosteredFtMinutes;
}
