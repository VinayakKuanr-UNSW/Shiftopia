// src/hooks/useAuth.ts
// FIXED VERSION - Proper role checking with corrected role names

import { useContext } from 'react';
import { AuthContext, Role } from '@/platform/auth/AuthProvider';
import {
  FEATURE_RULES,
  allows,
  hasAdminSuite,
  holdingFrom,
  managerialMode,
} from './accessSuites';

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

  // Access is decided per suite from both certificates a person can hold —
  // Type X (Personal) and Type Y (Managerial / Admin) — never from a single
  // "effective level". See src/platform/auth/accessSuites.ts.
  const holding = holdingFrom(user?.certificates, user?.contracts);

  // Admin Suite: zeta only.
  const isAdmin = (): boolean => hasAdminSuite(holding);

  // Any managerial page, read-only or full (gamma, delta, epsilon, zeta).
  const isManagerOrAbove = (): boolean => {
    const mode = managerialMode(holding);
    return mode === 'view' || mode === 'full';
  };

  // Any managerial page at all, including beta's read-only Timesheets.
  const isTeamLeadOrAbove = (): boolean => managerialMode(holding) !== 'none';

  /* ============================================================
     Role-aware Landing Page
     ============================================================ */

  // Where this user should land after login (or when a generic
  // "home"/"workspace" target is needed). Anyone who sees the Managerial
  // suite lands on the Roster Planner; everyone else on My Roster.
  // Mirrors the FeatureGate guard on the /rosters route.
  const getLandingPage = (): string =>
    isManagerOrAbove() ? '/rosters' : '/my-roster';

  /* ============================================================
     Feature Permission Checking
     ============================================================ */

  const hasPermission = (feature: string): boolean => {
    if (!(feature in FEATURE_RULES)) {
      console.warn(`[Auth] Unknown feature: ${feature} — refused`);
    }
    return allows(holding, feature);
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
  };
};
