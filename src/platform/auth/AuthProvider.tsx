// src/platform/auth/AuthProvider.tsx
// Certificate-driven auth with Type X/Y permission model

import React, { createContext, useEffect, useState } from 'react';
import { supabase } from '@/platform/supabase/client';
import { User, AccessLevel, Role, UserContract, AccessCertificate, PermissionObject } from './types';
import { authService, AuthSessionError } from './auth.service';
import { hasAccess as checkAccess } from './access.policy';

// Re-export types for backward compatibility with existing imports
export type { User, AccessLevel, Role };
export type { UserContract, AccessCertificate, PermissionObject } from './types';

/**
 * AccessScope represents the organizational boundaries derived from the user's
 * Access Certificate (NOT Position Contract). This determines what data the user
 * can view/edit across the application.
 */
export interface AccessScope {
  organizationId: string | null;
  organizationName: string;
  departmentId: string | null;
  departmentName: string | null;
  subDepartmentId: string | null;
  subDepartmentName: string | null;
  accessLevel: AccessLevel;
  isOrgLocked: boolean;
  isDeptLocked: boolean;
  isSubDeptLocked: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  /** True if the user has at least one active contract */
  hasActiveContracts: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasAccess: (feature: string, subDeptId?: string) => boolean;
  activeContractId: string | null;
  activeContract: UserContract | null;
  setActiveContractId: (id: string | null) => void;
  /** The user's highest-level access certificate (determines data scope) */
  activeCertificate: AccessCertificate | null;
  /** Active certificate ID for manual switching */
  activeCertificateId: string | null;
  /** Setter for manual certificate switching */
  setActiveCertificateId: (id: string | null) => void;
  /** Derived access scope from the certificate - use this for data filtering */
  accessScope: AccessScope | null;
  /** Full permission object from resolve_user_permissions RPC */
  permissionObject: PermissionObject | null;
  /** Whether permissions are still loading */
  isPermissionsLoading: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);

/**
 * A cached copy of the profile lets an already-signed-in user stay signed in
 * offline: when the startup profile fetch fails because there is no network,
 * we fall back to this so they can open the app and read cached data instead of
 * being bounced to the login screen. Cleared on logout and on a rejected
 * session.
 *
 * This is deliberately only a *fallback*. A rejected token takes the sign-out
 * path in `endRejectedSession` and wipes the cache first — reusing it there
 * would produce a signed-in-looking shell where every screen reads zero.
 */
const PROFILE_CACHE_KEY = 'shiftopia.cachedProfile';

function readCachedProfile(): User | null {
  try {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY);
    return cached ? (JSON.parse(cached) as User) : null;
  } catch {
    // Unavailable storage or a corrupt entry — treat as no cache.
    return null;
  }
}

function writeCachedProfile(profile: User): void {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
  } catch {
    /* ignore storage quota / privacy-mode errors */
  }
}

function clearCachedProfile(): void {
  try {
    localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [activeContractId, setActiveContractId] = useState<string | null>(null);
  const [activeCertificateId, setActiveCertificateId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionObject, setPermissionObject] = useState<PermissionObject | null>(null);
  const [isPermissionsLoading, setIsPermissionsLoading] = useState(false);

  // Profile fetch delegate
  const fetchProfile = async (userId: string): Promise<User | null> => {
    return authService.getUserProfile(userId);
  };

  /**
   * Ends a session the server has explicitly rejected.
   *
   * Signing out is the point: it clears the stale token from storage so the
   * next load starts clean instead of retrying a credential that can never
   * succeed. The message is set last so `logout()`'s state reset cannot
   * clear it before the login screen renders.
   */
  const endRejectedSession = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e: any) {
      // Already unauthenticated server-side is fine — local state is what matters.
      console.error('[Auth] sign-out during session teardown failed:', e?.message);
    }
    // Drop the offline cache too. Leaving it would let the next load resurrect
    // a profile whose token the server has already rejected.
    clearCachedProfile();
    setUser(null);
    setPermissionObject(null);
    setActiveContractId(null);
    setActiveCertificateId(null);
    setError('Your session expired. Please sign in again.');
  };

  // Fetch resolved permissions from RPC
  const fetchPermissions = async () => {
    setIsPermissionsLoading(true);
    try {
      const permissions = await authService.fetchPermissions();
      if (permissions) {
        setPermissionObject(permissions);
        console.log('[Auth] Permissions loaded:', {
          typeX: permissions.typeX?.length || 0,
          typeY: permissions.typeY?.level || 'none',
          orgs: permissions.allowed_scope_tree?.organizations?.length || 0,
        });
      }
    } catch (e: any) {
      console.error('[Auth] Permission fetch error:', e.message);
      // Permissions are fetched after the profile loads, so a token revoked
      // mid-session surfaces here first. Left unhandled it produced the
      // zero-everything screen: a signed-in user whose every scope is empty.
      if (e instanceof AuthSessionError) {
        await endRejectedSession();
      }
    } finally {
      setIsPermissionsLoading(false);
    }
  };

  /**
   * Centralized feature access check
   * Delegates to AccessPolicy
   */
  const hasAccess = (feature: string, subDeptId?: string): boolean => {
    return checkAccess(user, feature, activeContract, activeCertificate);
  };

  useEffect(() => {
    let mounted = true;
    console.log('[Auth] useEffect START');

    const init = async () => {
      try {
        const {
          data: { session },
          error: sessionErr,
        } = await supabase.auth.getSession();

        if (!mounted) return;

        if (session?.user) {
          const profile = await fetchProfile(session.user.id);

          if (mounted) {
            if (profile) {
              setUser(profile);
              // Refresh the offline copy on every successful start-up so the
              // fallback below never serves a stale role or scope.
              writeCachedProfile(profile);
            } else {
              // Valid session but no fresh profile. getUserProfile resolves
              // null for a network failure (a *rejected* token throws
              // AuthSessionError instead and is handled in catch), so this is
              // the offline case: fall back to the cached profile rather than
              // bouncing a signed-in user to the login screen.
              const cached = readCachedProfile();
              if (cached) {
                console.warn('[Auth] profile unavailable — using cached profile (offline)');
                setUser(cached);
              }
            }
          }
        }
      } catch (e: any) {
        console.error('[Auth] init ERROR:', e.message);
        // A rejected token leaves a session in storage that will never work
        // again. Without this the provider just skipped setUser, so the app
        // fell back to the login screen with no message, and the dead session
        // survived every reload. Tear it down and say why.
        if (e instanceof AuthSessionError && mounted) {
          await endRejectedSession();
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    init();

    // Simplified auth listener - only handle sign out
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && mounted) {
        setUser(null);
        setPermissionObject(null);
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Fetch permissions when user is loaded
  useEffect(() => {
    if (user) {
      fetchPermissions();
    } else {
      setPermissionObject(null);
    }
  }, [user]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (signInError) {
        setError(signInError.message);
        throw signInError;
      }

      if (data.user) {
        // fetchProfile can now reject with AuthSessionError. It previously
        // resolved null on every failure, so without this catch the message
        // would never reach `error` and the form would fail silently.
        let profile: User | null;
        try {
          profile = await fetchProfile(data.user.id);
        } catch (e: any) {
          if (e instanceof AuthSessionError) {
            setError(e.message);
            await supabase.auth.signOut();
          }
          throw e;
        }

        if (!profile) {
          setError('Profile not found');
          await supabase.auth.signOut();
          throw new Error('Profile not found');
        }

        setUser(profile);
        // Seed the offline copy at sign-in, so the very next cold start works
        // offline without needing one successful online start-up first.
        writeCachedProfile(profile);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    if (typeof window !== 'undefined') {
      sessionStorage.clear();
    }
    // Must clear, or the next cold start would sign the previous user back in
    // from cache on a device with no network.
    clearCachedProfile();
    setUser(null);
    setActiveContractId(null);
    setActiveCertificateId(null);
    setPermissionObject(null);
  };

  // Auto-select first active contract if none selected
  useEffect(() => {
    if (user && user.contracts.length > 0 && !activeContractId) {
      const firstActive = user.contracts.find(c => c.status === 'Active') || user.contracts[0];
      if (firstActive) {
        setActiveContractId(firstActive.id);
      }
    }
  }, [user, activeContractId]);

  // Derived active contract object
  const activeContract = user?.contracts.find(c => c.id === activeContractId) || null;

  // Derive hasActiveContracts (Access allowed if Contracts OR Certificates exist)
  const hasActiveContracts = (user?.contracts?.length ?? 0) > 0 || (user?.certificates?.length ?? 0) > 0;

  // Find the user's active access certificate
  const activeCertificate: AccessCertificate | null = React.useMemo(() => {
    if (!user || user.certificates.length === 0) return null;

    // 1. If manual selection exists, use it
    if (activeCertificateId) {
      const selected = user.certificates.find(c => c.id === activeCertificateId);
      if (selected) return selected;
    }

    // 2. Fallback to highest access level certificate
    const levels: AccessLevel[] = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];

    let highest: AccessCertificate | null = null;
    let highestIdx = -1;

    user.certificates.forEach(cert => {
      const idx = levels.indexOf(cert.accessLevel);
      if (idx > highestIdx) {
        highestIdx = idx;
        highest = cert;
      }
    });

    return highest;
  }, [user, activeCertificateId]);

  // Derive access scope from the certificate or fallback to allowed_scope_tree
  const accessScope: AccessScope | null = React.useMemo(() => {
    // 1. Primary source: Active Certificate
    if (activeCertificate) {
      return {
        organizationId: activeCertificate.organizationId,
        organizationName: activeCertificate.organizationName || 'Organization',
        departmentId: activeCertificate.departmentId,
        departmentName: activeCertificate.departmentName || null,
        subDepartmentId: activeCertificate.subDepartmentId,
        subDepartmentName: activeCertificate.subDepartmentName || null,
        accessLevel: activeCertificate.accessLevel,
        isOrgLocked: true,
        isDeptLocked: activeCertificate.departmentId !== null,
        isSubDeptLocked: activeCertificate.subDepartmentId !== null,
      };
    }

    // 2. Secondary source: Fallback to first organization in permission tree (for administrative global access)
    // Only if the user has Zeta/Epsilon permissions (Type Y equivalents)
    const firstOrg = permissionObject?.allowed_scope_tree?.organizations?.[0];
    if (firstOrg && (permissionObject?.typeY || (permissionObject?.typeX?.length ?? 0) > 0)) {
      return {
        organizationId: firstOrg.id,
        organizationName: firstOrg.name,
        departmentId: null,
        departmentName: null,
        subDepartmentId: null,
        subDepartmentName: null,
        accessLevel: permissionObject.typeY?.level || 'alpha',
        isOrgLocked: false,
        isDeptLocked: false,
        isSubDeptLocked: false,
      };
    }

    return null;
  }, [activeCertificate, permissionObject]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        error,
        hasActiveContracts,
        login,
        logout,
        hasAccess,
        activeContractId,
        activeContract,
        setActiveContractId,
        activeCertificate,
        activeCertificateId,
        setActiveCertificateId,
        accessScope,
        permissionObject,
        isPermissionsLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
