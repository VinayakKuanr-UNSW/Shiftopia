import type { CostCalculatorOptions } from './types';

export type ShiftAllowances = NonNullable<CostCalculatorOptions['allowances']>;

/**
 * The allowance flags the cost engines read, resolved from a shift row.
 *
 * cl 28.2 first aid belongs to the appointed PERSON, not the shift. The DB
 * exposes it per row as the computed field `is_first_aid_duty` — true when the
 * assignee holds a `first_aid_appointments` row covering `shift_date`
 * (migration 20261005060327). Nothing stores an `allowances` object on a
 * shift, so every caller that passed `shift.allowances` straight through
 * priced first aid at zero; route them through here instead.
 *
 * The field is only present when the query selected it — `select('*')` does
 * not include computed fields — so a missing value means "not appointed".
 */
export function resolveShiftAllowances(shift: {
  allowances?: ShiftAllowances | null;
  is_first_aid_duty?: boolean | null;
}): ShiftAllowances | undefined {
  const base = shift.allowances ?? undefined;
  if (shift.is_first_aid_duty !== true) return base;
  return { ...base, firstAid: true };
}
