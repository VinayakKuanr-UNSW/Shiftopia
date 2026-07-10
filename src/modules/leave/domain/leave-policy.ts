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

const HOURS_PER_DAY = 7.6;   // 38h / 5 days
const DAYS_PER_WEEK = 5;

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
};

/**
 * Project a leave balance forward in time, accounting for accrual and
 * pending/approved requests.
 *
 * @param balance       Current balance snapshot
 * @param requests      All requests (pending + approved) that consume this balance
 * @param projectionDate  YYYY-MM-DD to project to
 * @param serviceStartDate YYYY-MM-DD — the employee's continuous service start
 * @returns Projected balance in hours at the projection date
 */
export function projectBalance(
  balance: LeaveBalance,
  requests: LeaveRequest[],
  projectionDate: string,
  serviceStartDate: string,
): number {
  const policy = LEAVE_POLICIES[balance.leaveType];
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

/**
 * Whether a certificate is required for a leave request based on the
 * number of consecutive days requested.
 */
export function isCertificateRequired(leaveType: LeaveTypeCode, consecutiveDays: number): boolean {
  const policy = LEAVE_POLICIES[leaveType];
  if (!policy?.requiresCertificate) return false;
  if (policy.certificateThresholdDays == null) return true; // always required (jury, parental)
  return consecutiveDays > policy.certificateThresholdDays;
}

/**
 * Leave types that have a trackable balance (for display in the balance cards).
 */
export const BALANCE_TRACKED_TYPES: LeaveTypeCode[] = (
  Object.values(LEAVE_POLICIES) as LeavePolicy[]
)
  .filter((p) => p.balanceTracked)
  .map((p) => p.leaveType);
