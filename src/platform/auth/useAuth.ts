// src/hooks/useAuth.ts
// FIXED VERSION - Proper role checking with corrected role names

import { useContext } from 'react';
import { AuthContext, Role, AccessScope } from '@/platform/auth/AuthProvider';
import type { AccessLevel } from './types';

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  const {
    user,
    activeContract,
    activeContractId,
    setActiveContractId,
    activeCertificateId,
    setActiveCertificateId,
    isLoading
  } = context;

  /* ============================================================
     Role Checking Helpers
     ============================================================ */

  // Check if user has a specific role (DEPRECATED: Use access level instead)
  const hasRole = (role: Role | Role[]): boolean => {
    if (!user) return false;
    const roles = Array.isArray(role) ? role : [role];
    return roles.includes(user.systemRole);
  };

  // Check if active contract OR certificate is delta, epsilon or zeta
  const isAdmin = (): boolean =>
    ['delta', 'epsilon', 'zeta'].includes(activeContract?.accessLevel || '') ||
    ['delta', 'epsilon', 'zeta'].includes(user?.highestAccessLevel || '');

  // Check if active contract OR certificate is gamma or above
  const isManagerOrAbove = (): boolean =>
    (!!activeContract && ['gamma', 'delta', 'epsilon', 'zeta'].includes(activeContract.accessLevel)) ||
    (!!user && ['gamma', 'delta', 'epsilon', 'zeta'].includes(user.highestAccessLevel));

  // Check if active contract OR certificate is beta or above
  const isTeamLeadOrAbove = (): boolean =>
    (!!activeContract && ['beta', 'gamma', 'delta', 'epsilon', 'zeta'].includes(activeContract.accessLevel)) ||
    (!!user && ['beta', 'gamma', 'delta', 'epsilon', 'zeta'].includes(user.highestAccessLevel));

  /* ============================================================
     Feature Permission Checking
     ============================================================ */

  const hasPermission = (feature: string): boolean => {
    // Use contract level by default
    let level = activeContract?.accessLevel || 'alpha';

    // Superuser Fallback: If user is epsilon, zeta or delta, they use their certificate rank
    // to bypass site-contract restrictions.
    if (['delta', 'epsilon', 'zeta'].includes(user?.highestAccessLevel || '')) {
      level = user!.highestAccessLevel;
    }

    // Define feature permissions based on AccessLevel
    const permissions: Record<string, AccessLevel[]> = {
      // Everyone (alpha+)
      dashboard: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      'my-roster': ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      availabilities: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      bids: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      'my-swaps': ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      'my-broadcasts': ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      profile: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],

      // Beta and above
      'timesheet-view': ['beta', 'gamma', 'delta', 'epsilon', 'zeta'],

      // Gamma and above
      templates: ['gamma', 'delta', 'epsilon', 'zeta'],
      rosters: ['gamma', 'delta', 'epsilon', 'zeta'],
      'timesheet-edit': ['gamma', 'delta', 'epsilon', 'zeta'],
      management: ['gamma', 'delta', 'epsilon', 'zeta'],
      broadcast: ['gamma', 'delta', 'epsilon', 'zeta'],
      insights: ['gamma', 'delta', 'epsilon', 'zeta'],

      // Delta and above (Managers)
      audit: ['delta', 'epsilon', 'zeta'],

      // Epsilon and above
      users: ['epsilon', 'zeta'],

      read: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      create: ['gamma', 'delta', 'epsilon', 'zeta'],
      update: ['gamma', 'delta', 'epsilon', 'zeta'],
      delete: ['delta', 'epsilon', 'zeta'],
    };

    const allowedLevels = permissions[feature];

    if (!allowedLevels) {
      // Unknown feature - default to delta/epsilon/zeta only
      console.warn(
        `[Auth] Unknown feature: ${feature}, defaulting to delta/epsilon/zeta only`
      );
      return ['delta', 'epsilon', 'zeta'].includes(level);
    }

    return allowedLevels.includes(level);
  };

  /* ============================================================
     Shift Eligibility (placeholder for your business logic)
     ============================================================ */

  const isEligibleForShift = (
    shiftDepartment: string,
    shiftRole: string
  ): boolean => {
    if (!user) return false;

    // Admin can bid on any shift
    if (user.systemRole === 'admin') return true;

    // Add your business logic here
    return true;
  };

  /* ============================================================
     Work Hour Compliance (placeholder)
     ============================================================ */

  const checkWorkHourCompliance = (shiftDate: string, shiftHours: number) => {
    return {
      compliant: true,
      dailyHours: shiftHours,
      weeklyHours: shiftHours * 5,
      monthlyHours: shiftHours * 20,
      dailyLimit: 12,
      weeklyLimit: 48,
      monthlyLimit: 152,
    };
  };

  return {
    ...context,
    user,
    activeContract,
    activeContractId,
    setActiveContractId,
    activeCertificateId,
    setActiveCertificateId,
    isLoading,
    hasRole,
    isAdmin,
    isManagerOrAbove,
    isTeamLeadOrAbove,
    hasPermission,
    isEligibleForShift,
    checkWorkHourCompliance,
  };
};
