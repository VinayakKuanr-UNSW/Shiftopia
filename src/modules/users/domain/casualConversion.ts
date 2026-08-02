/**
 * Casual conversion eligibility (Fair Work Act s15A / EBA cl 12.5(g)).
 *
 * A casual Team Member employed for at least 6 months may notify the
 * Employer in writing that they believe they no longer meet the
 * requirements of a casual employee and request conversion to full-time or
 * part-time. This is a statutory NES entitlement, not just a contractual
 * term — audit H-2 found it had zero code presence anywhere.
 *
 * Scope: this module is the "at minimum, tenure flagging" first step —
 * surfacing eligibility so HR/managers can see it and act, ahead of a full
 * offer/response workflow (21-day SLA, refusal-reason codes) which is a
 * larger follow-up.
 */

const ELIGIBILITY_MONTHS = 6;

export interface CasualConversionInput {
  employmentStatus: string | null | undefined;
  contractStatus: string | null | undefined; // e.g. 'Active'
  startDate: string | null | undefined;      // YYYY-MM-DD
}

export interface CasualConversionStatus {
  /** True only for an ACTIVE casual contract. */
  isCasual: boolean;
  /** Whole months of continuous service on this contract, as of today. */
  tenureMonths: number;
  /** The date this contract crosses the 6-month eligibility threshold. */
  eligibleFrom: Date | null;
  /** True once tenure has reached the 6-month threshold (cl 12.5(g)). */
  eligible: boolean;
}

function isCasualStatus(employmentStatus: string | null | undefined): boolean {
  return /casual/i.test(employmentStatus || '');
}

/** Whole months between two dates (floor — a partial month doesn't count). */
function monthsBetween(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Resolve casual-conversion eligibility for a single contract. Pure
 * function — pass `asOf` in tests to avoid a real-time dependency.
 */
export function getCasualConversionStatus(
  input: CasualConversionInput,
  asOf: Date = new Date(),
): CasualConversionStatus {
  const isCasual = isCasualStatus(input.employmentStatus) && input.contractStatus === 'Active';
  if (!isCasual || !input.startDate) {
    return { isCasual, tenureMonths: 0, eligibleFrom: null, eligible: false };
  }

  const start = new Date(input.startDate + 'T00:00:00');
  if (Number.isNaN(start.getTime())) {
    return { isCasual, tenureMonths: 0, eligibleFrom: null, eligible: false };
  }

  const eligibleFrom = new Date(start);
  eligibleFrom.setMonth(eligibleFrom.getMonth() + ELIGIBILITY_MONTHS);

  return {
    isCasual,
    tenureMonths: monthsBetween(start, asOf),
    eligibleFrom,
    eligible: asOf >= eligibleFrom,
  };
}
