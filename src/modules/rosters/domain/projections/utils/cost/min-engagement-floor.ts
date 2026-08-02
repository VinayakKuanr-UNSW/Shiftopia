/**
 * The minimum-engagement PAYMENT guarantee (cl 12.3(e)/12.4(c)/12.5(c)/56.2 —
 * general award; Sch 3 §5.2(e)/§5.3(e) — Security) — distinct from the
 * scheduling-time `V8_MIN_ENGAGEMENT` rule
 * (`compliance/v8/rules/min-engagement.ts`), which blocks ROSTERING a
 * too-short shift for any employment type. This is the separate guarantee
 * that a Part-Time/Flexible-Part-Time/Casual member who ends up working
 * FEWER hours than rostered (sent home early, a cancelled multi-hire, etc.)
 * is still PAID for at least the floor. Full-Time members are weekly-
 * salaried and excluded — they have no per-engagement payment floor.
 *
 * Single source of truth shared by:
 *   - `cost/standard.ts` / `cost/security.ts` — the actual $ top-up.
 *   - `timesheets/domain/billable-time.ts` — the billable NET MINUTES floor
 *     shown/enforced in the timesheets UI, so the displayed hours and the
 *     priced dollars can never disagree.
 */

export interface PaymentMinEngagementInput {
  employmentType?: string | null;
  /**
   * Selects between the general award (cl 12.x) and Security Schedule 3
   * (§5.2(e)/§5.3(e)) floors — they diverge on Flexible Part-Time:
   *   - General award: only PLAIN Part-Time is excluded from the Sunday/PH
   *     4h exception; Flexible Part-Time gets it (cl 12.4(c)).
   *   - Security Schedule 3: no Flexible Part-Time security category is
   *     defined, so anything non-casual/non-Full-Time is treated as the
   *     plain-Part-Time case (no exception) — AUDIT FIX M2.
   * Do not "simplify" these into one rule; they cite different clauses.
   */
  isSecurityRole?: boolean;
  isTraining?: boolean;
  isSunday?: boolean;
  isPublicHoliday?: boolean;
  /** cl 13.1(e) — a genuinely separate same-day hire gets a reduced 2h floor,
   *  but ONLY when `multiHireStartsWithinUsualFinishWindow` is also true
   *  (see below). General award only. */
  isMultiHire?: boolean;
  /**
   * cl 13.1(e): "A separate multi-hire engagement will be for a minimum
   * three (3) hour period, EXCEPT where the separate engagement commences
   * within one (1) hour of the Team Member's usual rostered finish time, the
   * minimum engagement period will be two (2) hours." The reduced 2h floor
   * is therefore conditional on THIS precondition, not automatic for every
   * multi-hire engagement. Ignored unless `isMultiHire` is also true.
   * Compliance audit finding (2026-08-02): previously unchecked, so every
   * multi-hire engagement got the reduced floor regardless of start time —
   * currently dormant in production (no live `shifts.shift_type` column
   * populates `isMultiHire` yet), fixed ahead of that wiring going live.
   */
  multiHireStartsWithinUsualFinishWindow?: boolean;
}

/**
 * Returns the required minutes, or `null` when no per-engagement payment
 * floor applies at all (Full-Time). Training wins over every other tier,
 * mirroring the scheduling-time rule's precedence.
 */
export function resolvePaymentMinEngagementMinutes(input: PaymentMinEngagementInput): number | null {
  const employmentType = input.employmentType || '';
  const isFullTime = /full/i.test(employmentType);
  if (isFullTime) return null;

  if (input.isTraining) return 120;
  if (!input.isSecurityRole && input.isMultiHire && input.multiHireStartsWithinUsualFinishWindow) {
    return 120;
  }

  const isCasual = /casual/i.test(employmentType);
  const isPartTime = /part/i.test(employmentType);
  const isFlexible = /flex/i.test(employmentType);

  const isPlainPartTime = input.isSecurityRole
    ? !isCasual
    : (isPartTime && !isFlexible);

  // cl 56.2 — DELIBERATELY UNCONDITIONAL, unlike the Sunday branch below: "A
  // Team Member working on a public holiday will be rostered to work for a
  // minimum period of four (4) consecutive hours..." is a general Part E
  // rule with no employment-type carve-out at all, and applies "in
  // conjunction with" Schedule 3 too (Sch.3 §1.1) since Schedule 3 states no
  // inconsistent PH-minimum rule of its own. So a plain Part-Time (or PT
  // Security) member still gets the 4h PH floor via cl 56.2, even though
  // cl 12.3/Sch.3 §5.2(e) themselves are silent on public holidays.
  //
  // (2026-08-02 self-correction: an earlier pass in this file briefly made
  // this conditional on `!isPlainPartTime`, reasoning it should mirror the
  // Sunday branch below — that was wrong. The Sunday exception comes from
  // cl 12.4(c)/12.5(c)'s OWN "Sunday or public holiday" wording, which IS
  // employment-type-scoped; cl 56.2 is a separate, broader, unqualified rule
  // that independently guarantees the PH floor for everyone. Reverted.)
  if (input.isPublicHoliday) return 240;
  if (input.isSunday && !isPlainPartTime) return 240;
  return 180;
}
