/**
 * Advanced filter application — pure function, no React, no imports from UI.
 *
 * The hook (useRosterProjections) applies these filters once before passing
 * shifts to any projector, so projectors never need to know about filters.
 */

import type { Shift } from '../../shift.entity';
import type { AdvancedFilters } from '../../../state/useRosterStore';
import { determineShiftState } from '../../shift-state.utils';

/**
 * Filter a flat Shift[] according to the current AdvancedFilters state.
 * Returns the original array reference unchanged when no filters are active
 * (zero allocation on the hot path).
 */
export function applyAdvancedFilters(
  shifts: Shift[],
  filters: AdvancedFilters,
): Shift[] {
  const {
    roleId,
    skillIds,
    lifecycleStatus,
    assignmentStatus,
    assignmentOutcome,
    biddingStatus,
    tradingStatus,
    stateId,
    searchQuery,
  } = filters;

  // Quick-path: nothing active
  const noop =
    !roleId &&
    skillIds.length === 0 &&
    lifecycleStatus  === 'all' &&
    assignmentStatus === 'all' &&
    assignmentOutcome === 'all' &&
    biddingStatus     === 'all' &&
    tradingStatus     === 'all' &&
    (!stateId || stateId === 'all') &&
    !searchQuery.trim();

  if (noop) return shifts;

  return shifts.filter(shift => {
    // ── Role ──────────────────────────────────────────────────────────────
    if (roleId && shift.role_id !== roleId) return false;

    // ── Skills (shift must have ALL required skills) ───────────────────
    if (skillIds.length > 0) {
      const shiftSkills: string[] = shift.required_skills ?? [];
      if (!skillIds.every(id => shiftSkills.includes(id))) return false;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────
    if (lifecycleStatus !== 'all') {
      const lc = (shift.lifecycle_status ?? '').toLowerCase();
      if (lc !== lifecycleStatus) return false;
    }

    // ── Assignment status ──────────────────────────────────────────────
    if (assignmentStatus !== 'all') {
      const isAssigned = !!shift.assigned_employee_id;
      if (assignmentStatus === 'assigned'   && !isAssigned)                         return false;
      if (assignmentStatus === 'unassigned' &&  isAssigned)                         return false;
      if (assignmentStatus === 'on_bidding' && shift.bidding_status === 'not_on_bidding') return false;
    }

    // ── Assignment outcome ─────────────────────────────────────────────
    if (assignmentOutcome !== 'all') {
      if (assignmentOutcome === 'none') {
        if (shift.assignment_outcome) return false;
      } else {
        if (shift.assignment_outcome !== assignmentOutcome) return false;
      }
    }

    // ── Bidding status ─────────────────────────────────────────────────
    if (biddingStatus !== 'all') {
      if (shift.bidding_status !== biddingStatus) return false;
    }

    // ── Trading status ─────────────────────────────────────────────────
    if (tradingStatus !== 'all') {
      const isTrade = !!shift.trade_requested_at;
      if (tradingStatus === 'requested' && !isTrade) return false;
      if (tradingStatus === 'none'      &&  isTrade) return false;
    }

    // ── State machine ID (S1-S15) ──────────────────────────────────────
    if (stateId && stateId !== 'all') {
      if (determineShiftState(shift) !== stateId) return false;
    }

    // ── Full-text search ───────────────────────────────────────────────
    if (searchQuery.trim()) {
      const q         = searchQuery.toLowerCase();
      const role      = (shift.roles?.name ?? '').toLowerCase();
      const emp       = shift.assigned_profiles
        ? `${shift.assigned_profiles.first_name} ${shift.assigned_profiles.last_name}`.toLowerCase()
        : '';
      const subGroup  = (shift.sub_group_name ?? '').toLowerCase();
      const notes     = (shift.notes ?? '').toLowerCase();
      if (!role.includes(q) && !emp.includes(q) && !subGroup.includes(q) && !notes.includes(q)) {
        return false;
      }
    }

    return true;
  });
}
