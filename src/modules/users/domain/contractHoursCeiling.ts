/**
 * Contract Hours Ceiling — 38h/week contracted-hours guardrail.
 *
 * Business rule: the combined `contracted_weekly_hours` across all Active
 * Full-Time, Part-Time, and Flexible Part-Time contracts for a single
 * employee must never exceed 38 hours per week.
 *
 * Casual contracts are excluded — they do not consume the 38h ceiling and
 * can be created without limit.
 *
 * This module provides pure functions (no Supabase dependency) used by the
 * UI for immediate client-side feedback. The authoritative enforcement lives
 * in the database trigger (`hr.enforce_contract_hours_ceiling`); this module
 * mirrors that logic to avoid round-trips for obvious violations.
 */

// ── Constants ──────────────────────────────────────────────────────────────

/** Maximum combined contracted weekly hours across all FT/PT/Flexible PT contracts. */
export const MAX_CONTRACTED_WEEKLY_HOURS = 38;

/** Employment statuses whose contracted_weekly_hours count toward the ceiling. */
export const CEILING_COUNTED_STATUSES = [
    'Full-Time',
    'Part-Time',
    'Flexible Part-Time',
] as const;

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExistingContract {
    id: string;
    employment_status: string | null;
    contracted_weekly_hours: number | string | null;
    status: string | null;
}

export interface CapacityResult {
    /** Total contracted hours from existing Active FT/PT/Flexible PT contracts. */
    existingHours: number;
    /** How many more hours can be added before hitting the ceiling. */
    remainingCapacity: number;
    /** True when existingHours >= MAX_CONTRACTED_WEEKLY_HOURS. */
    isAtCapacity: boolean;
}

export interface ValidationResult {
    valid: boolean;
    message?: string;
    existingHours: number;
    proposedHours: number;
    proposedTotal: number;
    remainingCapacity: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Whether an employment status contributes to the 38h ceiling. */
export function isCeilingCounted(employmentStatus: string | null | undefined): boolean {
    if (!employmentStatus) return false;
    return (CEILING_COUNTED_STATUSES as readonly string[]).includes(employmentStatus);
}

/**
 * Safely coerce `contracted_weekly_hours` to a number. PostgREST may
 * serialise Postgres `numeric` as a string, so we accept both.
 */
function toHours(value: number | string | null | undefined): number {
    if (value === null || value === undefined || value === '') return 0;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

// ── Core Functions ─────────────────────────────────────────────────────────

/**
 * Compute how many contracted hours are already consumed and what capacity
 * remains for additional FT/PT/Flexible PT contracts.
 *
 * @param existingContracts All contracts for this employee (any status/type).
 * @param excludeContractId When editing, exclude this contract from the sum
 *   so that the capacity shown reflects what would be available *if* the
 *   contract's hours are removed.
 */
export function computeRemainingCapacity(
    existingContracts: readonly ExistingContract[],
    excludeContractId?: string,
): CapacityResult {
    const existingHours = existingContracts
        .filter(c =>
            c.status === 'Active' &&
            isCeilingCounted(c.employment_status) &&
            c.id !== excludeContractId,
        )
        .reduce((sum, c) => sum + toHours(c.contracted_weekly_hours), 0);

    const remainingCapacity = Math.max(0, MAX_CONTRACTED_WEEKLY_HOURS - existingHours);

    return {
        existingHours,
        remainingCapacity,
        isAtCapacity: remainingCapacity <= 0,
    };
}

/**
 * Validate whether a proposed contract (create or edit) would stay within the
 * 38h weekly ceiling.
 *
 * @param proposedHours The `contracted_weekly_hours` of the contract being
 *   created or edited.
 * @param proposedStatus The `employment_status` of the contract being
 *   created or edited.
 * @param existingContracts All contracts for this employee.
 * @param excludeContractId When editing, the ID of the contract being edited
 *   (its old hours are excluded from the existing sum).
 */
export function validateContractHours(
    proposedHours: number,
    proposedStatus: string,
    existingContracts: readonly ExistingContract[],
    excludeContractId?: string,
): ValidationResult {
    // Casual contracts are always valid (they don't consume the ceiling)
    if (!isCeilingCounted(proposedStatus)) {
        const { existingHours, remainingCapacity } = computeRemainingCapacity(
            existingContracts,
            excludeContractId,
        );
        return {
            valid: true,
            existingHours,
            proposedHours,
            proposedTotal: existingHours + proposedHours,
            remainingCapacity,
        };
    }

    const { existingHours, remainingCapacity } = computeRemainingCapacity(
        existingContracts,
        excludeContractId,
    );
    const proposedTotal = existingHours + proposedHours;

    if (proposedTotal > MAX_CONTRACTED_WEEKLY_HOURS) {
        const message =
            existingHours >= MAX_CONTRACTED_WEEKLY_HOURS
                ? `This employee already has ${existingHours}h contracted per week. ` +
                  `No additional Full-Time, Part-Time, or Flexible Part-Time contract can be added.`
                : `This employee has ${existingHours}h contracted per week. ` +
                  `Adding ${proposedHours}h would total ${proposedTotal}h, ` +
                  `exceeding the 38h/week ceiling. ` +
                  `Maximum additional hours: ${remainingCapacity}h.`;
        return {
            valid: false,
            message,
            existingHours,
            proposedHours,
            proposedTotal,
            remainingCapacity,
        };
    }

    return {
        valid: true,
        existingHours,
        proposedHours,
        proposedTotal,
        remainingCapacity: MAX_CONTRACTED_WEEKLY_HOURS - proposedTotal,
    };
}
