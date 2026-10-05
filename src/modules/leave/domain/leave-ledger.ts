/**
 * The leave ledger — one entry per ICC Sydney EBA 2025 leave type, for one
 * employee. Pure: no React, no I/O. My Leave renders it as cards; Leave
 * Approvals renders the same entries as one row of its Grid, so the two can
 * never disagree about a number.
 *
 * FOUR KINDS, BECAUSE THE AGREEMENT COUNTS LEAVE FOUR WAYS:
 *
 *   balance   An accruing (or granted-up-front) balance held in
 *             `leave_balances`. Annual (cl 44), Personal/Carer's (cl 45),
 *             Long Service (cl 49), FDV (cl 46 — 10 days, reset at each
 *             employment anniversary by `accrue_leave_balances()`).
 *             MAY GO NEGATIVE: leave in advance, no floor (2026-09-30).
 *
 *   capped    A cap with no balance row, counted from requests, over one of
 *             two periods:
 *               calendar-year  Religious, Cultural & Ceremonial (cl 55.1,
 *                              "5 days per calendar year non-cumulative")
 *               tenure         Gender Affirmation (cl 58.2, "up to ten days")
 *                              — ONE lump sum for the whole of a person's
 *                              employment, never reset (decision 2026-10-01).
 *             Both are paid FROM ANNUAL when the employee elects annual — that
 *             draw shows on the Annual card; this card tracks the cap.
 *
 *   occasion  An entitlement PER OCCASION, so there is nothing to run down:
 *             Compassionate (cl 48, 2 days), Paid Parental (cl 51, 10 weeks),
 *             Supporting Carer (cl 52, 1 week), Jury Service (cl 53, make-up
 *             pay for 10 days), and a casual's unpaid carer's leave
 *             (cl 45.6(c), 2 days). Shown as occasions and hours this year.
 *
 *   unpaid    No entitlement figure at all: Community Service (cl 54) and
 *             Unpaid Leave (cl 57). Shown as hours taken this year.
 *
 * WHO IS ENTITLED. A casual's 25% loading is "full recompense" for paid
 * annual, personal and compassionate leave (cl 12.5(b)), and cl 51–58 each
 * exclude casuals by name. A type that does not apply is `applicable: false`
 * — hidden on My Leave, shown as "—" in the Grid — never a zero, which would
 * read as "used up".
 */
import { ledgerFor, type LedgerLine } from './leave-approval';
import type { LeaveBalance, LeaveRequest, LeaveTypeCode } from '../model/leave.types';

export type LedgerKind = 'balance' | 'capped' | 'occasion' | 'unpaid';

export interface LedgerTypeDef {
    type: LeaveTypeCode;
    label: string;
    clause: string;
    kind: LedgerKind;
    /** Who has it: everyone, permanents only, or casuals only. */
    eligible: 'all' | 'permanent' | 'casual';
    /** `capped`: the cap, in days. */
    capDays?: number;
    /** `capped`: what the cap is counted over. */
    capPeriod?: 'calendar-year' | 'tenure';
    /** `occasion`: the entitlement per occasion, in days. */
    perOccasionDays?: number;
    /** One line saying how the entitlement works. */
    basis: string;
}

/** EBA order: Part E, clause by clause. */
export const LEDGER_TYPES: readonly LedgerTypeDef[] = [
    { type: 'annual', label: 'Annual Leave', clause: 'cl 44', kind: 'balance', eligible: 'permanent',
        basis: '4 weeks (152h) a year, pro-rata; 5 weeks (210h) for full-time Security. Accumulates.' },
    { type: 'personal', label: "Personal / Carer's Leave", clause: 'cl 45', kind: 'balance', eligible: 'permanent',
        basis: "10 days (76h) a year, pro-rata; 84h for full-time Security. Carer's leave draws from here." },
    { type: 'carer', label: "Unpaid Carer's Leave", clause: 'cl 45.6(c)', kind: 'occasion', eligible: 'casual',
        perOccasionDays: 2, basis: '2 days unpaid per occasion.' },
    { type: 'fdv', label: 'Family & Domestic Violence Leave', clause: 'cl 46', kind: 'balance', eligible: 'all',
        basis: '10 days paid per 12 months, available in full; does not accumulate.' },
    { type: 'compassionate', label: 'Compassionate Leave', clause: 'cl 48', kind: 'occasion', eligible: 'all',
        perOccasionDays: 2, basis: '2 days per occasion — paid for permanents, unpaid for casuals.' },
    { type: 'long_service', label: 'Long Service Leave', clause: 'cl 49', kind: 'balance', eligible: 'all',
        basis: '8.667 weeks after 10 years continuous service (NSW LSL Act).' },
    { type: 'parental', label: 'Paid Parental Leave', clause: 'cl 51', kind: 'occasion', eligible: 'permanent',
        perOccasionDays: 50, basis: '10 weeks paid, primary carer, after 12 months service.' },
    { type: 'supporting_carer', label: 'Paid Supporting Carer Leave', clause: 'cl 52', kind: 'occasion',
        eligible: 'permanent', perOccasionDays: 5, basis: '1 week paid, secondary carer, after 12 months service.' },
    { type: 'jury_duty', label: 'Jury Service', clause: 'cl 53', kind: 'occasion', eligible: 'permanent',
        perOccasionDays: 10, basis: 'Make-up pay for the first 10 days.' },
    { type: 'community_service', label: 'Community Service Leave', clause: 'cl 54', kind: 'unpaid', eligible: 'all',
        basis: 'Unpaid, for eligible community service activities.' },
    { type: 'religious_cultural', label: 'Religious, Cultural & Ceremonial', clause: 'cl 55', kind: 'capped',
        eligible: 'permanent', capDays: 5, capPeriod: 'calendar-year',
        basis: 'Up to 5 days a calendar year, from annual leave or unpaid — your choice.' },
    { type: 'unpaid', label: 'Unpaid Leave', clause: 'cl 57', kind: 'unpaid', eligible: 'permanent',
        basis: 'Up to 12 months, at the employer’s discretion. No accrual while away.' },
    { type: 'gender_affirmation', label: 'Gender Affirmation Leave', clause: 'cl 58', kind: 'capped',
        eligible: 'permanent', capDays: 10, capPeriod: 'tenure',
        basis: 'Up to 10 days for your whole time with ICC Sydney — one allowance, never reset. From annual leave or unpaid — your choice.' },
];

export interface LedgerEntry {
    def: LedgerTypeDef;
    /** False when the EBA gives this person no such entitlement. */
    applicable: boolean;
    /** `balance` kind only. Null when no balance row exists yet. */
    line: LedgerLine | null;
    /** Approved hours in the counting period — the calendar year, or all time for a tenure cap. */
    usedHours: number;
    /** Pending hours in the same period (for a `balance` kind see `line.held`). */
    pendingHours: number;
    /** `capped` kind: the cap in hours, and what is left after used + pending. */
    capHours: number | null;
    remainingHours: number | null;
    /** Approved requests this calendar year — the occasions, for `occasion`. */
    occasions: number;
    /**
     * FDV only, when the employment year is known: cl 46.2 grants 10 DAYS per
     * 12 months of employment, not 76 hours — 76h would be 19 of a 20h-a-week
     * part-timer's days. Counted in weekdays of approved / pending FDV requests
     * since the last anniversary of service. The hours balance stays the payroll
     * basis; this is what the person is told.
     */
    fdvDays?: { left: number; taken: number; pending: number; yearStart: string };
    /**
     * Long service only (cl 49, NSW LSL Act). Derived — there is no balance row:
     * 8.667 weeks per 10 years of continuous service (0.8667 weeks a year) at
     * the person's weekly hours, available once 10 years are reached (cl 49.3).
     * `serviceRecorded: false` when `continuous_service_start` is empty — then
     * nothing is calculated, because guessing service is guessing a payout.
     */
    lsl?: LslPosition;
}

export interface LslPosition {
    serviceRecorded: boolean;
    /** Years of continuous service to today, to 2 decimals. */
    years: number;
    accruedHours: number;
    takenHours: number;
    pendingHours: number;
    /** The 10-year anniversary (yyyy-MM-dd). */
    availableFrom: string | null;
    eligible: boolean;
    /** Accrued − taken − pending once eligible; 0 before. */
    availableHours: number;
    /** True for casuals: NSW LSL uses their AVERAGE weekly hours, estimated here from the contract. */
    estimated: boolean;
}

/** NSW LSL Act / cl 49.2: 8.667 weeks for 10 years ⇒ 0.8667 weeks per year of service. */
export const LSL_WEEKS_PER_YEAR = 8.667 / 10;

/** What the ledger needs from a request. `id` lets two reads be merged without double counting. */
export type LedgerRequest =
    Pick<LeaveRequest, 'leaveType' | 'status' | 'requestedHours' | 'electionMode' | 'startDate'>
    & { id?: string; endDate?: string };

export interface BuildLedgerInput {
    balances: readonly Pick<LeaveBalance, 'leaveType' | 'balanceHours'>[];
    requests: readonly LedgerRequest[];
    isCasual: boolean;
    /**
     * Hours in one of this person's days, to turn the EBA's DAYS into hours.
     * Contracted weekly hours ÷ 5 — 7.6h for full-time.
     */
    dailyHours: number;
    /** Calendar year counted for capped / occasion / unpaid kinds. */
    year: number;
    /** yyyy-MM-dd continuous service began, and today — together they give the FDV year. */
    serviceStart?: string | null;
    today?: string;
    /**
     * Every gender-affirmation request this person has ever made — the tenure
     * cap needs all of them, and a caller that loads only recent requests
     * would otherwise overstate what is left. Merged with `requests` by id.
     * Omit when `requests` is already all-time (My Leave loads everything).
     */
    tenureRequests?: readonly LedgerRequest[];
}

const h1 = (n: number) => Math.round(n * 10) / 10;

function isEligible(def: LedgerTypeDef, isCasual: boolean): boolean {
    if (def.eligible === 'all') return true;
    return def.eligible === 'casual' ? isCasual : !isCasual;
}

export function buildLedger(input: BuildLedgerInput): LedgerEntry[] {
    const { balances, requests, isCasual, dailyHours, year, tenureRequests = [] } = input;
    const inYear = (r: { startDate: string }) => r.startDate.slice(0, 4) === String(year);

    // All-time requests for tenure caps: what the caller passed, plus the
    // dedicated all-time read, de-duplicated by id where ids exist.
    const allTime = [...requests];
    const seen = new Set(requests.map(r => r.id).filter(Boolean));
    for (const r of tenureRequests) {
        if (r.id && seen.has(r.id)) continue;
        if (r.id) seen.add(r.id);
        allTime.push(r);
    }

    return LEDGER_TYPES.map(def => {
        const applicable = isEligible(def, isCasual);
        const mine = def.capPeriod === 'tenure'
            ? allTime.filter(r => r.leaveType === def.type)
            : requests.filter(r => r.leaveType === def.type && inYear(r));
        const approved = mine.filter(r => r.status === 'approved');
        const usedHours = h1(approved.reduce((s, r) => s + r.requestedHours, 0));
        const pendingHours = h1(mine.filter(r => r.status === 'pending')
            .reduce((s, r) => s + r.requestedHours, 0));

        let line: LedgerLine | null = null;
        if (def.kind === 'balance') {
            const row = balances.find(b => b.leaveType === def.type);
            // `ledgerFor` routes carer → personal and an annual election → annual,
            // exactly as the deduction trigger does.
            line = row ? ledgerFor(row, requests, isCasual) : null;
        }

        const capHours = def.kind === 'capped' && def.capDays ? h1(def.capDays * dailyHours) : null;
        const fdvDays = def.type === 'fdv' && input.serviceStart && input.today
            ? countFdvDays(requests, input.serviceStart, input.today)
            : undefined;
        const lsl = def.type === 'long_service' && input.today
            ? lslPosition(allTime, input.serviceStart ?? null, input.today, dailyHours * 5, isCasual)
            : undefined;
        return {
            fdvDays,
            lsl,
            def,
            applicable,
            line,
            usedHours,
            pendingHours,
            capHours,
            remainingHours: capHours == null ? null : h1(capHours - usedHours - pendingHours),
            occasions: approved.length,
        };
    });
}

/** Where someone stands on long service leave today. See `LedgerEntry.lsl`. */
export function lslPosition(
    requests: readonly LedgerRequest[],
    serviceStart: string | null,
    today: string,
    weeklyHours: number,
    isCasual: boolean,
): LslPosition {
    const lslReqs = requests.filter(r => r.leaveType === 'long_service');
    const takenHours = h1(lslReqs.filter(r => r.status === 'approved').reduce((a, r) => a + r.requestedHours, 0));
    const pendingHours = h1(lslReqs.filter(r => r.status === 'pending').reduce((a, r) => a + r.requestedHours, 0));
    if (!serviceStart) {
        return {
            serviceRecorded: false, years: 0, accruedHours: 0, takenHours, pendingHours,
            availableFrom: null, eligible: false, availableHours: 0, estimated: isCasual,
        };
    }
    const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${serviceStart}T00:00:00Z`)) / 86_400_000;
    const years = Math.max(0, days / 365.25);
    const availableFrom = `${Number(serviceStart.slice(0, 4)) + 10}${serviceStart.slice(4, 10)}`;
    const eligible = today >= availableFrom;
    const accruedHours = h1(years * LSL_WEEKS_PER_YEAR * weeklyHours);
    return {
        serviceRecorded: true,
        years: Math.round(years * 100) / 100,
        accruedHours,
        takenHours,
        pendingHours,
        availableFrom,
        eligible,
        availableHours: eligible ? h1(accruedHours - takenHours - pendingHours) : 0,
        estimated: isCasual,
    };
}

/** The last anniversary of `serviceStart` on or before `today` (yyyy-MM-dd). */
export function employmentYearStart(serviceStart: string, today: string): string {
    const monthDay = serviceStart.slice(5, 10);
    const ty = Number(today.slice(0, 4));
    const thisYear = `${ty}-${monthDay}`;
    return thisYear <= today ? thisYear : `${ty - 1}-${monthDay}`;
}

/** Monday–Friday days from start to end inclusive. */
function weekdaysIn(start: string, end: string): number {
    let n = 0;
    const cur = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);
    for (let i = 0; cur <= last && i < 3700; i++) {
        const d = cur.getUTCDay();
        if (d !== 0 && d !== 6) n++;
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return n;
}

function countFdvDays(
    requests: readonly LedgerRequest[],
    serviceStart: string,
    today: string,
): NonNullable<LedgerEntry['fdvDays']> {
    const yearStart = employmentYearStart(serviceStart, today);
    let taken = 0;
    let pending = 0;
    for (const r of requests) {
        if (r.leaveType !== 'fdv' || r.startDate < yearStart) continue;
        const days = weekdaysIn(r.startDate, r.endDate ?? r.startDate);
        if (r.status === 'approved') taken += days;
        else if (r.status === 'pending') pending += days;
    }
    return { left: 10 - taken - pending, taken, pending, yearStart };
}

/** Hours in one day of this person's contract. 7.6h when the contract is silent. */
export function dailyHoursFor(contractedWeeklyHours: number | null | undefined): number {
    return contractedWeeklyHours && contractedWeeklyHours > 0 ? contractedWeeklyHours / 5 : 7.6;
}

/**
 * The leave types a casual may REQUEST — mirrors the database trigger
 * `enforce_leave_type_eligibility` (2026-10-01), which refuses the rest.
 * cl 12.5(b) excludes paid annual, personal and compassionate leave; cl 51.1,
 * 52.1, 53.2, 55.1, 57.1 and 58.2 exclude casuals by name. What is left:
 * FDV (cl 46, paid), unpaid carer's (cl 45.6(c)), unpaid compassionate
 * (cl 48.8), community service (cl 54) and long service (cl 49).
 */
export const CASUAL_REQUESTABLE: readonly LeaveTypeCode[] =
    ['fdv', 'carer', 'compassionate', 'community_service', 'long_service'];

/** Which types this person can ask for. Permanents may request every type. */
export function requestableLeaveTypes(all: readonly LeaveTypeCode[], isCasual: boolean): LeaveTypeCode[] {
    return isCasual ? all.filter(t => CASUAL_REQUESTABLE.includes(t)) : [...all];
}

// ── Entitlement warnings ─────────────────────────────────────────────────────

export interface EntitlementCheckInput {
    leaveType: LeaveTypeCode;
    requestedHours: number;
    startDate: string;
    /** This person's other requests (any period). The request being checked is excluded by `excludeId`. */
    requests: readonly LedgerRequest[];
    excludeId?: string;
    isCasual: boolean;
    dailyHours: number;
    /** yyyy-MM-dd the person's continuous service began, when known. */
    serviceStart?: string | null;
}

const fmt = (n: number) => `${Math.round(n * 10) / 10}h`;

/** Whole months from `from` to `to` (yyyy-MM-dd), counting a month only once its day is reached. */
function monthsBetween(from: string, to: string): number {
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

/**
 * Where a request goes past what the Agreement gives — as WARNINGS. Leave is
 * the manager's decision (2026-09-30); these make sure it is an informed one.
 * The employee sees the same sentences before submitting.
 *
 *   capped     cl 55.1 (5 days a calendar year), cl 58.2 (10 days, whole of
 *              employment): taking more than is left.
 *   occasion   cl 48 (2 days), cl 51 (10 weeks), cl 52 (1 week), cl 53
 *              (10 days' make-up pay): one request longer than one occasion.
 *   service    cl 51.1, 52.1: 12 months' continuous service by the start date.
 *
 * Balance types (annual, personal, FDV, LSL) are not here — their warning is
 * the balance going negative (`checkApproval` / the request panel).
 */
export function entitlementWarnings(input: EntitlementCheckInput): string[] {
    const { leaveType, requestedHours, startDate, isCasual, dailyHours, serviceStart } = input;
    const def = LEDGER_TYPES.find(d => d.type === leaveType);
    if (!def) return [];
    const out: string[] = [];
    const others = input.requests.filter(r => !input.excludeId || r.id !== input.excludeId);

    if (def.kind === 'capped' && def.capDays) {
        const year = Number(startDate.slice(0, 4));
        const entry = buildLedger({ balances: [], requests: others, isCasual, dailyHours, year })
            .find(e => e.def.type === leaveType)!;
        const left = entry.remainingHours ?? 0;
        if (requestedHours > left + 1e-9) {
            const period = def.capPeriod === 'tenure' ? 'for the whole of employment' : `in ${year}`;
            out.push(`${def.clause} allows ${def.capDays} days (${fmt(entry.capHours ?? 0)}) ${period}; `
                + `${fmt(Math.max(0, left))} is left and ${fmt(requestedHours)} is requested. `
                + `The excess is beyond the entitlement.`);
        }
    }

    if (def.kind === 'occasion' && def.perOccasionDays) {
        const perOccasion = def.perOccasionDays * dailyHours;
        if (requestedHours > perOccasion + 1e-9) {
            const extra = leaveType === 'compassionate' && !isCasual
                ? ' Up to 2 further days can come from personal leave (cl 48.7).'
                : '';
            out.push(`${def.clause} gives ${def.perOccasionDays} days (${fmt(perOccasion)}) per occasion; `
                + `${fmt(requestedHours)} is requested.${extra}`);
        }
    }

    if (leaveType === 'long_service') {
        const today = startDate; // eligibility is judged at the leave's start
        const pos = lslPosition(others, serviceStart ?? null, today, dailyHours * 5, isCasual);
        if (!pos.serviceRecorded) {
            out.push('cl 49: continuous service start is not recorded, so long service eligibility and '
                + 'accrual cannot be checked. Ask HR to record it before approving.');
        } else if (!pos.eligible) {
            out.push(`cl 49.3: long service leave can be taken after 10 years' continuous service — `
                + `available from ${pos.availableFrom}.`);
        } else if (requestedHours > pos.availableHours + 1e-9) {
            out.push(`cl 49: ${fmt(pos.availableHours)} of long service leave is available by the start date; `
                + `${fmt(requestedHours)} is requested.`);
        }
    }

    if ((leaveType === 'parental' || leaveType === 'supporting_carer') && serviceStart
        && monthsBetween(serviceStart, startDate) < 12) {
        out.push(`${def.clause} needs 12 months' continuous service by the start of the leave; `
            + `service began ${serviceStart}.`);
    }

    return out;
}

