import { DEFAULT_JURISDICTION } from './holidays';

/**
 * In-memory organization → jurisdiction registry.
 *
 * Pure and worker-safe (no React, no Supabase, no DOM). Populated at sign-in
 * from `AuthProvider` / `authService`, and topped up whenever a query embeds
 * `organizations(id, jurisdiction)` or calls `fetchOrganizationJurisdictions`.
 *
 * Pure domain functions MUST still accept an explicit `jurisdiction?: string`
 * parameter so unit tests, web workers and multi-venue runs never depend on
 * hidden global state; this registry is the synchronous lookup behind
 * `organizationId` for callers that carry an organization id without an
 * embedded `organizations.jurisdiction` field.
 */
const registry = new Map<string, string>();

export function registerOrganizationJurisdiction(
  organizationId: string | null | undefined,
  jurisdiction: string | null | undefined,
): void {
  if (!organizationId || !jurisdiction) return;
  registry.set(organizationId, jurisdiction);
}

export function registerOrganizationJurisdictions(
  entries:
    | Iterable<readonly [string, string]>
    | Record<string, string>
    | ReadonlyArray<{ id?: string | null; jurisdiction?: string | null }>
    | null
    | undefined,
): void {
  if (!entries) return;
  if (Array.isArray(entries)) {
    for (const item of entries) {
      if (Array.isArray(item)) {
        registerOrganizationJurisdiction(item[0], item[1]);
      } else if (item && typeof item === 'object') {
        registerOrganizationJurisdiction(item.id, item.jurisdiction);
      }
    }
    return;
  }
  if (Symbol.iterator in Object(entries)) {
    for (const [orgId, jur] of entries as Iterable<readonly [string, string]>) {
      registerOrganizationJurisdiction(orgId, jur);
    }
    return;
  }
  for (const [orgId, jur] of Object.entries(entries)) {
    registerOrganizationJurisdiction(orgId, jur);
  }
}

export function getOrganizationJurisdiction(
  organizationId: string | null | undefined,
): string | undefined {
  if (!organizationId) return undefined;
  return registry.get(organizationId);
}

/**
 * Resolve the effective public-holiday jurisdiction from explicit overrides or
 * a registered organization id, falling back to `DEFAULT_JURISDICTION`.
 */
export function resolveJurisdiction(opts?: {
  jurisdiction?: string | null;
  organizationId?: string | null;
}): string {
  if (opts?.jurisdiction) return opts.jurisdiction;
  if (opts?.organizationId) {
    const known = registry.get(opts.organizationId);
    if (known) return known;
  }
  return DEFAULT_JURISDICTION;
}

/** Test seam and logout cleanup. */
export function clearOrganizationJurisdictions(): void {
  registry.clear();
}
