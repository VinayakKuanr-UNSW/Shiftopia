/**
 * Reasons a manager selects when a billable time varies from the roster.
 *
 * Required whenever a manager edits the billable start/end beyond the ±5-min
 * grace (i.e. Payroll Rules would read something other than "On Time In" /
 * as fixed option lists so the reasons are reportable, not free text.
 */

/** Minutes of grace before a billable time counts as "varied" from the roster. */
export const VARIANCE_GRACE_MIN = 5;

/** Reasons the billable START differs from the rostered start. */
export const ARRIVAL_VARIANCE_REASONS = [
    'Approved early start',
    'Operational demand',
    'Opening/setup duties',
    'Training or handover',
    'Corrected clock in error',
    'Other',
] as const;

/** Reasons the billable END differs from the rostered end. */
export const DEPARTURE_VARIANCE_REASONS = [
    'Approved early finish',
    'Low customer demand',
    'Shift covered by another employee',
    'Personal emergency (approved)',
    'Corrected clock out error',
    'Approved overtime',
    'Overtime — operational need',
    'Other',
] as const;

export type ArrivalVarianceReason = (typeof ARRIVAL_VARIANCE_REASONS)[number];
export type DepartureVarianceReason = (typeof DEPARTURE_VARIANCE_REASONS)[number];
