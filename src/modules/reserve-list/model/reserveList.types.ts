import type { ShiftAvailabilityResult } from '@/modules/rosters/domain/availability-check';

/**
 * One structurally-eligible, opted-in, overlap-free, compliance-passing
 * employee returned by a live Reserve List search. Never cached — a fresh
 * search recomputes this from scratch every time (see
 * docs/investigations/2026-07-21_reserve-list-audit-and-implementation-plan.md §4, §10).
 */
export interface ReserveListCandidate {
  employeeId: string;
  name: string;
  email: string;
  roleId: string | null;
  contractType: 'FT' | 'PT' | 'CASUAL' | null;
  /** Projected weekly hours after this shift is added (from the compliance engine). */
  currentWeeklyHours: number;
  maxWeeklyHours: number;
  complianceStatus: 'passed' | 'warned';
  violations: string[];
  warnings: string[];
  availability: ShiftAvailabilityResult;
}

export type ReserveListAssignFailureReason =
  | 'STALE'
  | 'CANDIDATE_NO_LONGER_ELIGIBLE'
  | 'REJECTED'
  | 'ILLEGAL_TRANSITION'
  | 'FORBIDDEN'
  | 'GONE'
  | 'ERROR';

export type ReserveListAssignResult =
  | { success: true; version?: number; warning?: string }
  | { success: false; reason: ReserveListAssignFailureReason; message: string };
