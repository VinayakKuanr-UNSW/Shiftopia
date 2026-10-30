/**
 * Leave policy — static entitlement table (NES/EBA rates) + balance projection.
 *
 * This is the authoritative source for leave accrual rates and entitlements
 * within the frontend. Any changes here MUST be mirrored in the DB accrual
 * function (migration) to keep the two in sync.
 *
 * Hours are based on a 38-hour week / 7.6-hour day (cl 36).
 */

import type {
  LeavePolicy, LeaveTypeCode, 
  LeaveElectionMode, OrdinaryHoursCredit,
} from '../model/leave.types';
import { isPublicHoliday } from '@/modules/core/lib/holidays';


// Schedule 3 §8.2/8.3 — Full-Time Security gets a DIFFERENT, more generous
// entitlement than general staff: 210h (5 weeks) annual leave and 84h
// personal/carer's leave, vs. the general 152h/76h. The DB accrual function
// (`accrue_leave_balances`, migration 20260710120000_leave_module.sql)
// already branches on this correctly; these constants and
// `getLeavePolicies()` below are the frontend mirror of that same rule
// (audit H-9: the frontend previously always used the general 152h/76h
// rates for every employment type, including Security).
const SECURITY_ANNUAL_HOURS_PER_YEAR = 210;
const SECURITY_PERSONAL_HOURS_PER_YEAR = 84;

/** Full policy table — one entry per leave type. */
export const LEAVE_POLICIES: Record<LeaveTypeCode, LeavePolicy> = {
  annual: {
    leaveType: 'annual',
    ordinaryHoursCredit: 'CREDITS',
    accrualRateHoursPerYear: 152,  // 4 weeks × 38h (cl 44 / NES s87)
    maxBalanceHours: null,         // accumulates indefinitely
    requiresCertificate: false,
    certificateThresholdDays: null,
    paidForCasual: false,
    balanceTracked: true,
    clause: 'cl 44, NES Div 6',
    description: 'Annual leave — 4 weeks per year of continuous service. 17.5% loading or rostered penalties, whichever is greater.',
  },
  personal: {
    leaveType: 'personal',
    ordinaryHoursCredit: 'CREDITS',
    accrualRateHoursPerYear: 76,   // 10 days × 7.6h (cl 45 / NES s96)
    maxBalanceHours: null,         // accumulates indefinitely
    requiresCertificate: true,
    certificateThresholdDays: 2,   // NES s107 — cert required if >2 consecutive days
    paidForCasual: false,
    balanceTracked: true,
    clause: 'cl 45, NES ss96-99',
    description: "Personal / sick leave — 10 days per year. Certificate required for absences exceeding 2 consecutive days.",
  },
  carer: {
    leaveType: 'carer',
    ordinaryHoursCredit: 'CREDITS',
    accrualRateHoursPerYear: null, // draws from personal leave balance
    maxBalanceHours: null,
    requiresCertificate: true,
    certificateThresholdDays: 2,
    paidForCasual: false,
    balanceTracked: false,         // uses personal balance
    clause: 'cl 45, NES s97',
    description: "Carer's leave — taken from personal leave balance for care of an immediate family/household member.",
  },
  compassionate: {
    leaveType: 'compassionate',
    ordinaryHoursCredit: 'CREDITS',
    accrualRateHoursPerYear: null, // per-occasion entitlement
    maxBalanceHours: null,
    requiresCertificate: false,
    certificateThresholdDays: null,
    paidForCasual: false,
    balanceTracked: false,
    clause: 'cl 48, NES ss104-105',
    description: 'Compassionate leave — 2 days per occasion (death/serious illness of immediate family/household member).',
  },
  parental: {
    leaveType: 'parental',
    ordinaryHoursCredit: 'CREDITS',
    accrualRateHoursPerYear: null, // one-off entitlement
    maxBalanceHours: null,
    requiresCertificate: true,
    certificateThresholdDays: null,
    paidForCasual: false,
    balanceTracked: false,
    clause: 'cl 51, NES Div 5',
    description: 'Paid parental leave — 10 weeks paid at ordinary rate on commencement (cl 51).',
  },
  long_service: {
    leaveType: 'long_service',
    ordinaryHoursCredit: 'CREDITS',
    accrualRateHoursPerYear: null, // state-specific; NSW: 2 months after 10 years
    maxBalanceHours: null,
    requiresCertificate: false,
    certificateThresholdDays: null,
    paidForCasual: false,
    balanceTracked: true,
    clause: 'Long Service Leave Act 1955 (NSW)',
    description: 'Long service leave — state-specific entitlement (NSW: 2 months after 10 years continuous service).',
  },
  jury_duty: {
    leaveType: 'jury_duty',
    // cl 53.2 pays make-up pay for the ordinary hours of the period, so the
    // day is discharged even though the employer funds only the difference.
    ordinaryHoursCredit: 'CREDITS',
    accrualRateHoursPerYear: null,
    maxBalanceHours: null,
    requiresCertificate: true,
    certificateThresholdDays: null,
    paidForCasual: false,
    balanceTracked: false,
    clause: 'cl 53, NES s44',
    description: 'Jury / court attendance — make-up pay (ordinary rate minus jury fee) for up to 10 days per attendance.',
  },
  fdv: {
    leaveType: 'fdv',
    // cl 46.6 anti-detriment: a Team Member taking FDV leave 'will not be
    // prejudiced or disadvantaged in the allocation of shifts or rostered
    // hours'. Crediting is therefore mandatory, not a policy choice.
    ordinaryHoursCredit: 'CREDITS',
    accrualRateHoursPerYear: 76,   // 10 days × 7.6h (NES Div 11) — granted up front
    maxBalanceHours: 76,
    requiresCertificate: false,    // privacy: cert MUST NOT appear on payslip
    certificateThresholdDays: null,
    paidForCasual: true,           // casuals ARE paid FDV leave
    balanceTracked: true,
    grantedUpFront: true,          // full 10 days available from day one; resets on anniversary
    clause: 'cl 46, NES Div 11',
    description: 'Family & domestic violence leave — 10 days per year, paid (incl. casuals), available in full from commencement. Must not appear as FDV on payslip.',
  },
  supporting_carer: {
    leaveType: 'supporting_carer',
    ordinaryHoursCredit: 'CREDITS',
    accrualRateHoursPerYear: null, // per-occasion entitlement, no accruing balance
    maxBalanceHours: null,
    requiresCertificate: false,
    certificateThresholdDays: null,
    paidForCasual: false,
    balanceTracked: false,
    clause: 'cl 52',
    description: 'Supporting carer leave — ONE week paid per occasion for the secondary carer at the birth/placement of a child.',
  },
  community_service: {
    leaveType: 'community_service',
    // NES ss108-112 — unpaid. Jury duty is the carve-out and has its own type.
    ordinaryHoursCredit: 'BLOCKS',
    accrualRateHoursPerYear: null,
    maxBalanceHours: null,
    requiresCertificate: true,
    certificateThresholdDays: null,
    paidForCasual: false,
    balanceTracked: false,
    clause: 'NES ss108-112',
    description: 'Community service leave — unpaid, except jury duty which has make-up pay provisions.',
  },
  unpaid: {
    leaveType: 'unpaid',
    ordinaryHoursCredit: 'BLOCKS',
    accrualRateHoursPerYear: null,
    maxBalanceHours: null,
    requiresCertificate: false,
    certificateThresholdDays: null,
    paidForCasual: false,
    balanceTracked: false,
    clause: 'By arrangement',
    description: 'Unpaid leave — by mutual agreement between the employer and the employee.',
  },
  religious_cultural: {
    leaveType: 'religious_cultural',
    // cl 55.1 grants an ELECTION, not an entitlement: apply to use up to five
    // days of accrued paid ANNUAL leave, or be absent up to five days UNPAID.
    // Which one applies is recorded per request on leave_requests.election_mode
    // and resolved by resolveOrdinaryHoursCredit(); until it is recorded the
    // credit is genuinely unknown and must not be guessed.
    ordinaryHoursCredit: 'ELECTION',
    accrualRateHoursPerYear: null, // no accrual: there is no dedicated entitlement
    maxBalanceHours: null,
    requiresCertificate: false,
    certificateThresholdDays: null,
    paidForCasual: false,
    balanceTracked: false,         // draws on ANNUAL leave, or is unpaid
    clause: 'cl 55.1',
    description: 'Religious, cultural & ceremonial leave (incl. NAIDOC) — up to 5 days per calendar year, taken EITHER as accrued paid annual leave OR as unpaid leave, at the Team Member\u2019s election.',
  },
  gender_affirmation: {
    leaveType: 'gender_affirmation',
    // cl 58.2 is the same construction as cl 55.1, at ten days.
    ordinaryHoursCredit: 'ELECTION',
    accrualRateHoursPerYear: null, // no accrual: there is no dedicated entitlement
    maxBalanceHours: null,
    requiresCertificate: false,
    certificateThresholdDays: null,
    paidForCasual: false,
    balanceTracked: false,         // draws on ANNUAL leave, or is unpaid
    clause: 'cl 58.2',
    description: 'Gender affirmation leave — up to 10 days per calendar year, taken EITHER as accrued paid annual leave OR as unpaid leave, at the Team Member\u2019s election.',
  },
  toil: {
    leaveType: 'toil',
    // A paid absence: the day is time already worked, taken back.
    ordinaryHoursCredit: 'CREDITS',
    accrualRateHoursPerYear: null, // earned from approved timesheets, not by the year
    maxBalanceHours: null,
    requiresCertificate: false,
    certificateThresholdDays: null,
    paidForCasual: false,
    // Held in `toil_ledger`, not `leave_balances` — and it may NOT go negative.
    balanceTracked: false,
    clause: 'Contract (cl 2.2)',
    description: 'Time off in lieu — hours worked beyond 7.6 a day, or beyond your contracted week, on a salaried contract, taken back hour for hour. It cannot be taken before it is earned, and any not taken within 6 months is paid out.',
  },
};

/**
 * Resolve the policy table for a specific employee. Identical to
 * `LEAVE_POLICIES` except for Full-Time Security's annual/personal accrual
 * rates (Sch 3 §8.2/8.3), which are the SAME condition
 * `accrue_leave_balances()` uses server-side: employment_status contains
 * "full" AND the employee's role name contains "security". Callers resolve
 * that boolean once (see `leave.api.ts#isFullTimeSecurityEmployee`) and pass
 * it here rather than duplicating the DB join client-side.
 */
export function getLeavePolicies(isFullTimeSecurity: boolean): Record<LeaveTypeCode, LeavePolicy> {
  if (!isFullTimeSecurity) return LEAVE_POLICIES;
  return {
    ...LEAVE_POLICIES,
    annual: {
      ...LEAVE_POLICIES.annual,
      accrualRateHoursPerYear: SECURITY_ANNUAL_HOURS_PER_YEAR,
      clause: 'Sch 3 §8.2',
      description: 'Annual leave — Full-Time Security: 210h (5 weeks) per year of continuous service (Schedule 3 §8.2), not the general 152h rate.',
    },
    personal: {
      ...LEAVE_POLICIES.personal,
      accrualRateHoursPerYear: SECURITY_PERSONAL_HOURS_PER_YEAR,
      clause: 'Sch 3 §8.3',
      description: 'Personal / sick leave — Full-Time Security: 84h per year (Schedule 3 §8.3), not the general 76h rate. Certificate required for absences exceeding 2 consecutive days.',
    },
  };
}

/** Adjacency context for the cl 45.4 certificate rule (audit M-12). */
interface CertificateAdjacency {
  /** The day immediately before the leave start, or immediately after the
   *  leave end, is a Saturday or Sunday. */
  adjacentToWeekend?: boolean;
  /** The day immediately before the leave start, or immediately after the
   *  leave end, is a public holiday. */
  adjacentToPublicHoliday?: boolean;
  /** cl 45.5(b)(iii): the neighbouring day is the person's ROSTERED day off —
   *  not rostered, while they are rostered on days around it. On a 7-day
   *  roster that is often not a Saturday or Sunday. */
  adjacentToRosteredDayOff?: boolean;
  /** cl 45.5(b)(iv): the leave runs straight on from, or into, other leave. */
  adjacentToOtherLeave?: boolean;
}

/** What `computeCertificateAdjacency` can use beyond the calendar. */
interface CertificateContext {
  /** yyyy-MM-dd dates the person is rostered, covering at least a week either side. */
  rosteredDates?: ReadonlySet<string>;
  /** Their OTHER pending or approved leave (this request excluded). */
  otherLeave?: ReadonlyArray<{ startDate: string; endDate: string }>;
}

/**
 * WHY a certificate is required — empty when it is not. cl 45.5(b) lists four
 * triggers; each that applies is named, so the employee knows what to provide
 * and the manager knows what to ask for.
 */
export function certificateReasons(
  leaveType: LeaveTypeCode,
  consecutiveDays: number,
  adjacency: CertificateAdjacency = {},
): string[] {
  const policy = LEAVE_POLICIES[leaveType];
  if (!policy?.requiresCertificate) return [];
  if (policy.certificateThresholdDays == null) return ['Evidence is always required for this leave'];
  const out: string[] = [];
  if (consecutiveDays > policy.certificateThresholdDays) out.push(`More than ${policy.certificateThresholdDays} working days`);
  if (adjacency.adjacentToPublicHoliday) out.push('Next to a public holiday');
  if (adjacency.adjacentToWeekend) out.push('Next to a weekend');
  if (adjacency.adjacentToRosteredDayOff) out.push('Next to a rostered day off');
  if (adjacency.adjacentToOtherLeave) out.push('Next to other leave');
  return out;
}

/**
 * Compute {@link CertificateAdjacency} for a leave request's date range — the
 * day immediately before `startDate` and immediately after `endDate`
 * (YYYY-MM-DD, both LOCAL date parts, never `.toISOString()`).
 */
export function computeCertificateAdjacency(
  startDate: string,
  endDate: string,
  context: CertificateContext = {},
): CertificateAdjacency {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return {};

  const dayBefore = new Date(start);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const dayAfter = new Date(end);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const before = ymd(dayBefore);
  const after = ymd(dayAfter);

  /*
   * A rostered day off is a day NOT rostered between days that are. Judged
   * only when the roster around it is known — a week either side — because an
   * unpublished future roster is "not rostered yet", not a day off. Weekends
   * are reported as weekends, not again as days off.
   */
  const rostered = context.rosteredDates;
  const isRosteredDayOff = (d: Date): boolean => {
    if (!rostered || rostered.size === 0 || isWeekend(d)) return false;
    const key = ymd(d);
    if (rostered.has(key)) return false;
    const near = (offset: number) => {
      const x = new Date(d);
      x.setDate(x.getDate() + offset);
      return ymd(x);
    };
    const rosteredBefore = [1, 2, 3, 4, 5, 6, 7].some(n => rostered.has(near(-n)));
    const rosteredAfter = [1, 2, 3, 4, 5, 6, 7].some(n => rostered.has(near(n)));
    return rosteredBefore && rosteredAfter;
  };

  const other = context.otherLeave ?? [];
  const touchesOtherLeave = other.some(l =>
    (l.startDate <= before && l.endDate >= before) || (l.startDate <= after && l.endDate >= after));

  return {
    adjacentToWeekend: isWeekend(dayBefore) || isWeekend(dayAfter),
    adjacentToPublicHoliday: isPublicHoliday(dayBefore) || isPublicHoliday(dayAfter),
    adjacentToRosteredDayOff: isRosteredDayOff(dayBefore) || isRosteredDayOff(dayAfter),
    adjacentToOtherLeave: touchesOtherLeave,
  };
}


/**
 * Resolve what a day of leave actually does to contracted ordinary hours.
 *
 * Most types answer from the policy alone. The two election types (cl 55.1,
 * cl 58.2) cannot: the Agreement offers the Team Member a choice between
 * accrued paid annual leave and unpaid leave, and only the request knows which
 * was taken. An unrecorded election stays 'ELECTION' rather than defaulting,
 * because defaulting either way would invent a fact about someone's pay.
 */
export function resolveOrdinaryHoursCredit(
    policy: Pick<LeavePolicy, 'ordinaryHoursCredit'>,
    electionMode: LeaveElectionMode | null | undefined,
): OrdinaryHoursCredit {
    if (policy.ordinaryHoursCredit !== 'ELECTION') return policy.ordinaryHoursCredit;
    if (electionMode === 'annual') return 'CREDITS';
    if (electionMode === 'unpaid') return 'BLOCKS';
    return 'ELECTION';
}
