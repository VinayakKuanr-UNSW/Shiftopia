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

  // Check if active contract OR certificate is delta or epsilon
  const isAdmin = (): boolean =>
    activeContract?.accessLevel === 'delta' ||
    activeContract?.accessLevel === 'epsilon' ||
    user?.highestAccessLevel === 'delta' ||
    user?.highestAccessLevel === 'epsilon';

  // Check if active contract OR certificate is gamma or above
  const isManagerOrAbove = (): boolean =>
    (!!activeContract && ['gamma', 'delta', 'epsilon'].includes(activeContract.accessLevel)) ||
    (!!user && ['gamma', 'delta', 'epsilon'].includes(user.highestAccessLevel));

  // Check if active contract OR certificate is beta or above
  const isTeamLeadOrAbove = (): boolean =>
    (!!activeContract && ['beta', 'gamma', 'delta', 'epsilon'].includes(activeContract.accessLevel)) ||
    (!!user && ['beta', 'gamma', 'delta', 'epsilon'].includes(user.highestAccessLevel));

  /* ============================================================
     Feature Permission Checking
     ============================================================ */

  const hasPermission = (feature: string): boolean => {
    // Use contract level by default
    let level = activeContract?.accessLevel || 'alpha';

    // Superuser Fallback: If user is epsilon or delta, they use their certificate rank
    // to bypass site-contract restrictions.
    if (user?.highestAccessLevel === 'epsilon' || user?.highestAccessLevel === 'delta') {
      level = user.highestAccessLevel;
    }

    // Define feature permissions based on AccessLevel
    const permissions: Record<string, AccessLevel[]> = {
      // Everyone (alpha+)
      dashboard: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      'my-roster': ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      availabilities: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      bids: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      'my-swaps': ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      'my-broadcasts': ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      profile: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],

      // Beta and above
      'timesheet-view': ['beta', 'gamma', 'delta', 'epsilon'],

      // Gamma and above
      templates: ['gamma', 'delta', 'epsilon'],
      rosters: ['gamma', 'delta', 'epsilon'],
      'timesheet-edit': ['gamma', 'delta', 'epsilon'],
      management: ['gamma', 'delta', 'epsilon'],
      broadcast: ['gamma', 'delta', 'epsilon'],
      insights: ['gamma', 'delta', 'epsilon'],

      // Delta and above (Managers)

      audit: ['delta', 'epsilon'],

      // Epsilon Only
      users: ['epsilon'],

      read: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      create: ['gamma', 'delta', 'epsilon'],
      update: ['gamma', 'delta', 'epsilon'],
      delete: ['delta', 'epsilon'],
    };

    const allowedLevels = permissions[feature];

    if (!allowedLevels) {
      // Unknown feature - default to delta/epsilon only
      console.warn(
        `[Auth] Unknown feature: ${feature}, defaulting to delta/epsilon only`
      );
      return level === 'delta' || level === 'epsilon';
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
