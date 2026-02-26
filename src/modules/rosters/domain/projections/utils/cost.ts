/**
 * Cost estimation utilities.
 *
 * Centralises the labour-cost formula so every mode shows identical figures.
 * All functions are pure and free of floating-point surprises (values are
 * rounded to the nearest cent).
 */

import type { Shift } from '../../shift.entity';

/** Fallback hourly rate when a shift has no remuneration_rate set */
const DEFAULT_RATE = 25;

/**
 * Estimate the labour cost of a single shift.
 *
 * @param netMinutes  Shift net duration in minutes (after breaks).
 * @param rate        Hourly rate in the shift's currency.  Pass null to fall
 *                    back to DEFAULT_RATE (25).
 */
export function estimateShiftCost(netMinutes: number, rate: number | null): number {
  const effectiveRate = rate ?? DEFAULT_RATE;
  return Math.round((netMinutes / 60) * effectiveRate * 100) / 100;
}

/**
 * Estimate cost directly from a Shift entity.
 * Convenience wrapper around estimateShiftCost.
 */
export function estimateCostFromShift(
  shift: Pick<Shift, 'net_length_minutes' | 'start_time' | 'end_time' | 'unpaid_break_minutes' | 'remuneration_rate'>,
  netMinutesOverride?: number,
): number {
  const mins = netMinutesOverride ?? shift.net_length_minutes ?? 0;
  return estimateShiftCost(mins, shift.remuneration_rate);
}

/**
 * Format a cost value as a localised currency string.
 * e.g. 1234.5 → "$1,234.50" (AUD-style)
 */
export function formatCost(amount: number, currency = 'AUD'): string {
  return amount.toLocaleString('en-AU', {
    style:    'currency',
    currency,
    maximumFractionDigits: 2,
  });
}
