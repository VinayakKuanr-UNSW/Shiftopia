/**
 * Leave module — domain types.
 *
 * Aligned with the ICC Sydney EBA and the NES (Fair Work Act 2009).
 * These types are the single source of truth for leave taxonomy,
 * balance tracking, and request lifecycle in the frontend.
 */

/** Leave type taxonomy — aligned with EBA/NES categories. */
export type LeaveTypeCode =
  | 'annual'            // cl 44, NES Div 6 — 4 weeks/yr for permanents
  | 'personal'          // cl 45, NES ss96-99 — 10 days/yr (personal/sick)
  | 'carer'             // cl 45, NES s97 — from personal balance
  | 'compassionate'     // cl 47, NES ss104-105 — 2 days/occasion
  | 'parental'          // cl 51, NES Div 5 — 10 weeks paid
  | 'long_service'      // state LSL acts (NSW: 2 months after 10 years)
  | 'jury_duty'         // cl 53, NES s44 — make-up pay, 10 days max
  | 'fdv'               // cl 46, NES Div 11 — 10 days/yr paid, granted up front
  | 'supporting_carer'  // cl 52 — ONE week paid per occasion (secondary carer)
  | 'community_service' // NES ss108-112 — unpaid (except jury duty)
  | 'unpaid'            // unpaid leave by arrangement
  | 'religious_cultural' // cl 55 — up to 5 days/calendar year (incl. NAIDOC)
  | 'gender_affirmation'; // cl 58 — up to 10 days/calendar year

/** Human-readable labels for leave type codes. */
export const LEAVE_TYPE_LABELS: Record<LeaveTypeCode, string> = {
  annual: 'Annual Leave',
  personal: 'Personal / Sick Leave',
  carer: "Carer's Leave",
  compassionate: 'Compassionate Leave',
  parental: 'Paid Parental Leave',
  long_service: 'Long Service Leave',
  jury_duty: 'Jury / Court Attendance',
  fdv: 'Family & Domestic Violence Leave',
  supporting_carer: 'Supporting Carer Leave',
  community_service: 'Community Service Leave',
  unpaid: 'Unpaid Leave',
  religious_cultural: 'Religious, Cultural & Ceremonial Leave',
  gender_affirmation: 'Gender Affirmation Leave',
};

/**
 * Does a day of this leave type discharge a permanent's contracted ordinary
 * hours, for the purposes of reconciling a roster against a contract?
 *
 * This is a SEPARATE question from `paidForCasual` (which asks whether a casual
 * is paid at all) and from `balanceTracked` (which asks whether we hold a
 * running balance). It exists because the Baseline FT generator has to answer
 * "how many hours does this employee still owe" and a leave day either counts
 * toward that or it does not.
 *
 *   'CREDITS'  — a paid absence. The employee is treated as having worked
 *                their ordinary hours for that day (cl 44.7, 45.2, 46.6, …),
 *                so the day is NOT rostered and NOT counted as a shortfall.
 *   'BLOCKS'   — an unpaid absence. Nothing may be rostered on the day, but
 *                the day discharges nothing either: cl 57.5 says authorised
 *                unpaid leave does not count toward continuous service, so it
 *                SUSPENDS the exchange rather than completing it. The result
 *                is a visible variance, which is the honest answer.
 *   'ELECTION' — the Agreement gives the Team Member a CHOICE between the two
 *                above, and we do not record which they made. Never guessed;
 *                the generator computes the requirement both ways and reports
 *                a WARNING so a human resolves it.
 */
export type OrdinaryHoursCredit = 'CREDITS' | 'BLOCKS' | 'ELECTION';

export interface LeavePolicy {
  leaveType: LeaveTypeCode;
  /**
   * Effect on a permanent's contracted ordinary hours. See
   * {@link OrdinaryHoursCredit}. Consumed by the Baseline FT requirement
   * calculator; deliberately NOT derived from `accrualRateHoursPerYear`,
   * because a type can be paid without accruing (compassionate, parental)
   * and tracked without being paid from a balance at all.
   */
  ordinaryHoursCredit: OrdinaryHoursCredit;
  /** Hours accrued per year of continuous service; null = no accrual (unpaid, community). */
  accrualRateHoursPerYear: number | null;
  /** Maximum balance cap in hours; null = no cap (accumulates indefinitely). */
  maxBalanceHours: number | null;
  /** NES s107: medical cert if >N consecutive days. */
  requiresCertificate: boolean;
  /** Number of consecutive days before certificate is required (null = never). */
  certificateThresholdDays: number | null;
  /** True if this leave type is paid for casual employees (only FDV in most cases). */
  paidForCasual: boolean;
  /**
   * NES Div 11 semantics: the full entitlement is AVAILABLE UP FRONT and
   * resets on the service anniversary — it does not accrue progressively.
   * projectBalance must not add daily accrual for these types.
   */
  grantedUpFront?: boolean;
  /** Whether balance is tracked (false for per-occasion types like compassionate). */
  balanceTracked: boolean;
  /** EBA/NES clause reference. */
  clause: string;
  description: string;
}

export interface LeaveBalance {
  id: string;
  employeeId: string;
  leaveType: LeaveTypeCode;
  balanceHours: number;
  accruedHours: number;
  usedHours: number;
  asOfDate: string; // YYYY-MM-DD
}

export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveType: LeaveTypeCode;
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  requestedHours: number;
  reason: string | null;
  certificateUrl: string | null;
  status: LeaveRequestStatus;
  approvedBy: string | null;
  approvalDate: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string | null;
}

/** Input shape for creating a leave request. */
export interface CreateLeaveRequestInput {
  leaveType: LeaveTypeCode;
  startDate: string;
  endDate: string;
  requestedHours: number;
  reason?: string;
  certificateUrl?: string;
}
