import React, { createContext, useCallback, useContext } from 'react';
import { AuthContext } from '@/platform/auth/AuthProvider';
import { DEFAULT_JURISDICTION } from '@/modules/core/lib/holidays';
import { getOrganizationJurisdiction } from '@/modules/core/lib/jurisdiction-registry';

/**
 * Optional scoped override so a page or dialog working on a specific venue
 * (e.g. from GlobalScopeFilter) propagates its jurisdiction to any nested
 * `<Calendar>` or date primitive automatically.
 */
const JurisdictionContext = createContext<string | undefined>(undefined);

export const JurisdictionProvider: React.FC<{
  jurisdiction?: string;
  children: React.ReactNode;
}> = ({ jurisdiction, children }) =>
  React.createElement(JurisdictionContext.Provider, { value: jurisdiction }, children);

export interface UseJurisdictionOptions {
  /** Explicit jurisdiction override (highest precedence). */
  jurisdiction?: string | null;
  /** Single organization id whose jurisdiction should be resolved. */
  organizationId?: string | null;
  /** Multiple selected organization ids (e.g. from GlobalScopeFilter). Used when all resolve to a single jurisdiction. */
  organizationIds?: readonly string[] | null;
}

/**
 * Resolve the effective public-holiday jurisdiction in React components.
 *
 * Reads `AuthContext` directly (never `useAuth()`, which throws outside
 * `<AuthProvider>`) so shared UI primitives (`Calendar`, `MonthGrid`,
 * `WeekStrip`, etc.) remain safe in standalone component tests.
 */
export function useJurisdiction(opts?: UseJurisdictionOptions): string {
  const auth = useContext(AuthContext);
  const contextJurisdiction = useContext(JurisdictionContext);

  if (opts?.jurisdiction) return opts.jurisdiction;

  const lookupOrg = (orgId: string | null | undefined): string | undefined => {
    if (!orgId) return undefined;
    return auth?.organizationJurisdictions?.[orgId] ?? getOrganizationJurisdiction(orgId);
  };

  if (opts?.organizationId) {
    const found = lookupOrg(opts.organizationId);
    if (found) return found;
  }

  if (opts?.organizationIds && opts.organizationIds.length > 0) {
    const unique = new Set<string>();
    for (const id of opts.organizationIds) {
      const jur = lookupOrg(id);
      if (jur) unique.add(jur);
    }
    if (unique.size === 1) {
      return [...unique][0];
    }
  }

  if (contextJurisdiction) return contextJurisdiction;
  if (auth?.activeJurisdiction) return auth.activeJurisdiction;
  if (auth?.accessScope?.organizationJurisdiction) return auth.accessScope.organizationJurisdiction;
  return DEFAULT_JURISDICTION;
}

/**
 * Memoised per-row jurisdiction resolver for views that render shifts/entries
 * across potentially multiple organizations.
 */
export function useResolveOrgJurisdiction(): (
  organizationId?: string | null,
  explicitJurisdiction?: string | null,
) => string {
  const auth = useContext(AuthContext);
  const contextJurisdiction = useContext(JurisdictionContext);
  const orgMap = auth?.organizationJurisdictions;
  const fallback =
    contextJurisdiction
    ?? auth?.activeJurisdiction
    ?? auth?.accessScope?.organizationJurisdiction
    ?? DEFAULT_JURISDICTION;

  return useCallback(
    (organizationId?: string | null, explicitJurisdiction?: string | null): string => {
      if (explicitJurisdiction) return explicitJurisdiction;
      if (organizationId) {
        const known = orgMap?.[organizationId] ?? getOrganizationJurisdiction(organizationId);
        if (known) return known;
      }
      return fallback;
    },
    [orgMap, fallback],
  );
}
