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
    activeCertificate,
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

  // Helper to get the current resolved access level
  const getEffectiveLevel = (): AccessLevel => {
    // 1. Priority: Active Certificate (Type X/Y)
    if (activeCertificate?.accessLevel) {
      return activeCertificate.accessLevel;
    }

    // 2. Superuser Fallback (delta+)
    if (['delta', 'epsilon'].includes(user?.highestAccessLevel || '')) {
      return user!.highestAccessLevel;
    }

    // 3. Baseline: Position Contract
    return activeContract?.accessLevel || 'alpha';
  };

  // Check if active contract OR certificate is delta or epsilon
  const isAdmin = (): boolean =>
    ['delta', 'epsilon'].includes(getEffectiveLevel());

  // Check if active contract OR certificate is gamma or above
  const isManagerOrAbove = (): boolean =>
    ['gamma', 'delta', 'epsilon'].includes(getEffectiveLevel());

  // Check if active contract OR certificate is beta or above
  const isTeamLeadOrAbove = (): boolean =>
    ['beta', 'gamma', 'delta', 'epsilon'].includes(getEffectiveLevel());

  /* ============================================================
     Role-aware Landing Page
     ============================================================ */

  // Where this user should land after login (or when a generic
  // "home"/"workspace" target is needed). Managers and above (gamma+)
  // go to the Roster Planner; everyone else to their My Roster view.
  // Mirrors the FeatureGate guard on the /rosters route.
  const getLandingPage = (): string =>
    isManagerOrAbove() ? '/rosters' : '/my-roster';

  /* ============================================================
     Feature Permission Checking
     ============================================================ */

  const hasPermission = (feature: string): boolean => {
    const level = getEffectiveLevel();

    // Define feature permissions based on AccessLevel
    const permissions: Record<string, AccessLevel[]> = {
      // Everyone (alpha+)
      'my-roster': ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      availabilities: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      bids: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      'my-swaps': ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      'my-broadcasts': ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      profile: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      // Employee-facing KPI page. Every level sees their OWN numbers;
      // the managerial roll-up lives behind `insights` (gamma+).
      performance: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],

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
      configurations: ['delta', 'epsilon'],

      // Epsilon
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
      return ['delta', 'epsilon'].includes(level);
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
    getLandingPage,
    hasPermission,
    isEligibleForShift,
    checkWorkHourCompliance,
  };
};
