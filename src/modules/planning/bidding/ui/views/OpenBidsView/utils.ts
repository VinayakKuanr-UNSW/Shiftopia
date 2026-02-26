// src/modules/planning/bidding/ui/views/OpenBidsView/utils.ts

import type { GroupType, TimeRemaining, OpenShift, StatusCounts, FilterState } from './types';

/**
 * Calculate time remaining until deadline
 */
export const calculateTimeRemaining = (deadlineISO: string): TimeRemaining => {
  const deadline = new Date(deadlineISO);
  const now = new Date();
  const diffMs = deadline.getTime() - now.getTime();
  const isExpired = diffMs <= 0;

  if (isExpired) return { hours: 0, minutes: 0, isExpired: true };

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  return { hours, minutes, isExpired: false };
};

/**
 * Get color classes for a group type
 */
export const getGroupColors = (group: GroupType): { bg: string; accent: string; border: string } => {
  const colors: Record<GroupType, { bg: string; accent: string; border: string }> = {
    convention: {
      bg: 'bg-purple-500',
      accent: 'text-purple-400 border-purple-500/30',
      border: 'border-purple-500/30',
    },
    exhibition: {
      bg: 'bg-blue-500',
      accent: 'text-blue-400 border-blue-500/30',
      border: 'border-blue-500/30',
    },
    concert: {
      bg: 'bg-pink-500',
      accent: 'text-pink-400 border-pink-500/30',
      border: 'border-pink-500/30',
    },
    sports: {
      bg: 'bg-green-500',
      accent: 'text-green-400 border-green-500/30',
      border: 'border-green-500/30',
    },
    corporate: {
      bg: 'bg-amber-500',
      accent: 'text-amber-400 border-amber-500/30',
      border: 'border-amber-500/30',
    },
  };

  return colors[group] || colors.convention;
};

/**
 * Get color classes for fatigue risk level
 */
export const getFatigueColors = (risk: string): { text: string; bg: string } => {
  switch (risk) {
    case 'low':
      return { text: 'text-green-400', bg: 'bg-green-500/10' };
    case 'medium':
      return { text: 'text-amber-400', bg: 'bg-amber-500/10' };
    case 'high':
      return { text: 'text-red-400', bg: 'bg-red-500/10' };
    default:
      return { text: 'text-white/50', bg: 'bg-white/5' };
  }
};

/**
 * Get status counts from shifts array
 */
export const getStatusCounts = (shifts: OpenShift[]): StatusCounts => {
  return shifts.reduce(
    (acc, shift) => {
      acc[shift.status] = (acc[shift.status] || 0) + 1;
      return acc;
    },
    { urgent: 0, pending: 0, resolved: 0 } as StatusCounts
  );
};

/**
 * Filter shifts based on search query and status filter.
 * Hierarchy filtering is no longer done here — the global ScopeFilterBanner
 * controls which shifts are fetched from the API.
 */
export const filterShifts = (
  shifts: OpenShift[],
  searchQuery: string,
  filters: FilterState
): OpenShift[] => {
  let result = shifts;

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    result = result.filter(
      (s) =>
        s.role.toLowerCase().includes(q) ||
        s.location.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q) ||
        s.subDepartment.toLowerCase().includes(q) ||
        s.shiftIdDisplay.toLowerCase().includes(q)
    );
  }

  if (filters.status !== 'all') result = result.filter((s) => s.status === filters.status);

  return result;
};

/**
 * Format time remaining for display
 */
export const formatTimeRemaining = (timeRemaining: TimeRemaining): string => {
  if (timeRemaining.isExpired) return 'EXPIRED';
  return `${timeRemaining.hours}h ${timeRemaining.minutes}m`;
};
