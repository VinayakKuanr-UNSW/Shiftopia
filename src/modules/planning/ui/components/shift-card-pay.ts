/**
 * The ONE way a planning shift card turns a shift row into `Sched. Pay`.
 *
 * Every card on the bidding and swap surfaces renders through
 * `SharedShiftCard`, but sharing the component never made them share the DATA
 * CONTRACT behind it — each adapter re-derived the pay props and each got it
 * wrong differently:
 *
 *   • Open Bids Manager called the RAW `estimateDetailedShiftCost` instead of
 *     the `estimateDetailedCostFromShift` wrapper, so it passed no
 *     `employmentType` and no `classificationLevel`. With `rate` also missing
 *     the engine fell through to `rateSet.defaultRate` — a flat $33.70 (Level 1
 *     casual) on EVERY card regardless of the shift's level or target, and with
 *     `isCasual` false so no casual loading was applied either.
 *
 *   • It then hand-rolled the tooltip lines and pushed BOTH `penaltyCost` and
 *     `allowanceCost`. On the Standard engine `penaltyCost` is a legacy ALIAS
 *     for the night allowance and `allowanceCost` already CONTAINS it, so the
 *     night loading was billed twice — mislabelled "Meal Allowance" — and the
 *     tooltip total no longer reconciled with the headline figure.
 *
 *   • My Bids (card and drawer) imported the cost engine and then never passed
 *     `estimatedPay` at all, so Sched. Pay rendered as "—".
 *
 * Both correct behaviours already existed and were simply not reached from
 * here: `estimateDetailedCostFromShift` reads `target_employment_type` +
 * `remuneration_level`, and `buildOrdinaryEarningsLines` is engine-aware about
 * the penalty/allowance overlap. This module is the single call site for them,
 * so a future card gets the contract by construction rather than by copy.
 *
 * INPUT CONTRACT: `shift` must be the RAW shift row (snake_case, `select('*')`)
 * — `target_employment_type`, `remuneration_level`, `remuneration_rate`,
 * `roles.name`. A hand-built camelCase view model silently loses all four and
 * lands back on the $33.70 default, which is exactly how this broke.
 */
import { estimateDetailedCostFromShift } from '@/modules/rosters/domain/projections/utils/cost';
import { buildOrdinaryEarningsLines } from '@/modules/payroll/domain/computeShiftGrossPay';
import { isSecurityRoleName } from '@/modules/compliance/security-role';
import type { EarningsLine } from '@/modules/payroll/model/gross-pay.types';

export interface ShiftCardPayProps {
  estimatedPay?: string;
  estimatedPayBreakdown?: EarningsLine[];
}

/** Empty props — the card renders its own "—" placeholder. */
const NO_PAY: ShiftCardPayProps = {};

export function buildShiftCardPay(shift: any): ShiftCardPayProps {
  if (!shift) return NO_PAY;

  try {
    const breakdown = estimateDetailedCostFromShift(shift);
    if (!breakdown || !breakdown.totalCost) return NO_PAY;

    const roleName = shift.roles?.name ?? shift.roleName ?? shift.role;

    return {
      estimatedPay: `$${breakdown.totalCost.toFixed(2)}`,
      estimatedPayBreakdown: buildOrdinaryEarningsLines(breakdown, {
        isSecurityRole: isSecurityRoleName(roleName),
        shiftDate: shift.shift_date ?? shift.shiftDate,
        startTime: shift.start_time ?? shift.startTime,
      }),
    };
  } catch {
    return NO_PAY;
  }
}
