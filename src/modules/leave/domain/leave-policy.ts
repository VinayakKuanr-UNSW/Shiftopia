/**
 * Leave policy — static entitlement table (NES/EBA rates) + balance projection.
 *
 * This is the authoritative source for leave accrual rates and entitlements
 * within the frontend. Any changes here MUST be mirrored in the DB accrual
 * function (migration) to keep the two in sync.
 *
 * Hours are based on a 38-hour week / 7.6-hour day (cl 36).
 */

import type { LeavePolicy, LeaveTypeCode, LeaveBalance, LeaveRequest } from '../model/leave.types';
import { isPublicHoliday } from '@/modules/core/lib/holidays';

const HOURS_PER_DAY = 7.6;   // 38h / 5 days
const DAYS_PER_WEEK = 5;

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
    accrualRateHoursPerYear: null, // per-occasion entitlement
    maxBalanceHours: null,
    requiresCertificate: false,
    certificateThresholdDays: null,
    paidForCasual: false,
    balanceTracked: false,
    clause: 'cl 47, NES ss104-105',
    description: 'Compassionate leave — 2 days per occasion (death/serious illness of immediate family/household member).',
  },
  parental: {
    leaveType: 'parental',
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
    accrualRateHoursPerYear: null, // capped, granted up front — not progressively accrued
    maxBalanceHours: 38,           // 5 days × 7.6h
    requiresCertificate: false,
    certificateThresholdDays: null,
    paidForCasual: false,
    balanceTracked: true,
    grantedUpFront: true,          // resets to the full 38h every 1 January, not on accrual
    clause: 'cl 55',
    description: 'Religious, cultural & ceremonial leave (incl. NAIDOC) — up to 5 days paid per calendar year, drawn from this dedicated balance. An unpaid alternative is also available via a general Unpaid Leave request.',
  },
  gender_affirmation: {
    leaveType: 'gender_affirmation',
    accrualRateHoursPerYear: null,
    maxBalanceHours: 76,           // 10 days × 7.6h
    requiresCertificate: false,
    certificateThresholdDays: null,
    paidForCasual: false,
    balanceTracked: true,
    grantedUpFront: true,          // resets to the full 76h every 1 January
    clause: 'cl 58',
    description: 'Gender affirmation leave — up to 10 days paid per calendar year, drawn from this dedicated balance. An unpaid alternative is also available via a general Unpaid Leave request.',
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

/**
 * Project a leave balance forward in time, accounting for accrual and
 * pending/approved requests.
 *
 * @param balance       Current balance snapshot
 * @param requests      All requests (pending + approved) that consume this balance
 * @param projectionDate  YYYY-MM-DD to project to
 * @param serviceStartDate YYYY-MM-DD — the employee's continuous service start
 * @param policies      Policy table to project against — pass
 *                       `getLeavePolicies(isFullTimeSecurity)` for a
 *                       role-aware projection; defaults to the general table.
 * @returns Projected balance in hours at the projection date
 */
export function projectBalance(
  balance: LeaveBalance,
  requests: LeaveRequest[],
  projectionDate: string,
  serviceStartDate: string,
  policies: Record<LeaveTypeCode, LeavePolicy> = LEAVE_POLICIES,
): number {
  const policy = policies[balance.leaveType];
  if (!policy) return balance.balanceHours;

  // No accrual for per-occasion types or upfront granted types.
  if (policy.accrualRateHoursPerYear == null || policy.grantedUpFront) return balance.balanceHours;

  // Daily accrual rate (continuous pro-rata).
  const dailyAccrual = policy.accrualRateHoursPerYear / 365;

  // Days from the balance's as-of date to the projection date.
  const asOfMs = Date.parse(balance.asOfDate + 'T00:00:00');
  const projMs = Date.parse(projectionDate + 'T00:00:00');
  if (Number.isNaN(asOfMs) || Number.isNaN(projMs)) return balance.balanceHours;
  const daysDiff = Math.max(0, Math.round((projMs - asOfMs) / 86_400_000));

  // Accrued between as-of and projection.
  const projected = balance.balanceHours + dailyAccrual * daysDiff;

  // Deduct pending + approved requests that fall within the projection window.
  const deductions = requests
    .filter((r) => r.leaveType === balance.leaveType)
    .filter((r) => r.status === 'pending') // DB trigger already deducts approved requests from the underlying balance
    .filter((r) => r.startDate <= projectionDate)
    .reduce((sum, r) => sum + r.requestedHours, 0);

  const result = projected - deductions;

  // Apply cap if configured.
  if (policy.maxBalanceHours != null) {
    return Math.min(result, policy.maxBalanceHours);
  }
  return Math.round(result * 100) / 100;
}

/** Adjacency context for the cl 45.4 certificate rule (audit M-12). */
export interface CertificateAdjacency {
  /** The day immediately before the leave start, or immediately after the
   *  leave end, is a Saturday or Sunday. */
  adjacentToWeekend?: boolean;
  /** The day immediately before the leave start, or immediately after the
   *  leave end, is a public holiday. */
  adjacentToPublicHoliday?: boolean;
}

/**
 * Whether a certificate is required for a leave request based on the
 * number of consecutive days requested.
 *
 * AUDIT FIX M-12: cl 45.4's evidence requirement isn't only about the raw
 * day-count — a single day of personal leave taken immediately before or
 * after a weekend or public holiday (the classic "long weekend" pattern) is
 * treated the same as exceeding the day-count threshold, since it has the
 * same practical effect of extending time off without evidence. Previously
 * this only compared `consecutiveDays` to the threshold, so a Friday-only or
 * Monday-only absence never triggered the certificate requirement regardless
 * of adjacency. `adjacency` is optional and defaults to no adjacency
 * (unchanged prior behaviour) so existing callers that don't yet compute it
 * are unaffected.
 */
export function isCertificateRequired(
  leaveType: LeaveTypeCode,
  consecutiveDays: number,
  adjacency: CertificateAdjacency = {},
): boolean {
  const policy = LEAVE_POLICIES[leaveType];
  if (!policy?.requiresCertificate) return false;
  if (policy.certificateThresholdDays == null) return true; // always required (jury, parental)
  if (adjacency.adjacentToWeekend || adjacency.adjacentToPublicHoliday) return true;
  return consecutiveDays > policy.certificateThresholdDays;
}

/**
 * Compute {@link CertificateAdjacency} for a leave request's date range — the
 * day immediately before `startDate` and immediately after `endDate`
 * (YYYY-MM-DD, both LOCAL date parts, never `.toISOString()`).
 */
export function computeCertificateAdjacency(startDate: string, endDate: string): CertificateAdjacency {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return {};

  const dayBefore = new Date(start);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const dayAfter = new Date(end);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

  return {
    adjacentToWeekend: isWeekend(dayBefore) || isWeekend(dayAfter),
    adjacentToPublicHoliday: isPublicHoliday(dayBefore) || isPublicHoliday(dayAfter),
  };
}

/**
 * Leave types that have a trackable balance (for display in the balance cards).
 */
export const BALANCE_TRACKED_TYPES: LeaveTypeCode[] = (
  Object.values(LEAVE_POLICIES) as LeavePolicy[]
)
  .filter((p) => p.balanceTracked)
  .map((p) => p.leaveType);
