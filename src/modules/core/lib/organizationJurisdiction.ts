import { supabase } from '@/platform/supabase/client';
import { DEFAULT_JURISDICTION } from './holidays';
import {
  clearOrganizationJurisdictions,
  getOrganizationJurisdiction,
  registerOrganizationJurisdiction,
} from './jurisdiction-registry';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** In-flight per-org fetches so concurrent callers coalesce onto one request. */
const inFlight = new Map<string, Promise<string | undefined>>();

/**
 * Batch-resolve public-holiday jurisdictions for a set of organization UUIDs.
 *
 * Reads from the synchronous registry first; only queries `public.organizations`
 * for valid UUIDs not yet cached. Never caches failures so a transient network
 * blip recovers on the next call.
 */
export async function fetchOrganizationJurisdictions(
  organizationIds: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const missing: string[] = [];
  const waiting: Array<[string, Promise<string | undefined>]> = [];

  for (const raw of organizationIds) {
    if (!raw || result.has(raw)) continue;
    const cached = getOrganizationJurisdiction(raw);
    if (cached) {
      result.set(raw, cached);
      continue;
    }
    if (!UUID_RE.test(raw)) continue;
    const pending = inFlight.get(raw);
    if (pending) {
      waiting.push([raw, pending]);
    } else if (!missing.includes(raw)) {
      missing.push(raw);
    }
  }

  if (missing.length > 0) {
    const batchPromise: Promise<Map<string, string>> = (async () => {
      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('id, jurisdiction')
          .in('id', missing);
        const fetched = new Map<string, string>();
        if (error) {
          console.warn('[organizationJurisdiction] lookup failed:', error);
          return fetched;
        }
        for (const row of (data ?? []) as Array<{ id?: string | null; jurisdiction?: string | null }>) {
          if (row.id && row.jurisdiction) {
            registerOrganizationJurisdiction(row.id, row.jurisdiction);
            fetched.set(row.id, row.jurisdiction);
          }
        }
        return fetched;
      } catch (err) {
        console.warn('[organizationJurisdiction] lookup exception:', err);
        return new Map<string, string>();
      } finally {
        for (const id of missing) inFlight.delete(id);
      }
    })();

    for (const id of missing) {
      const p = batchPromise.then((m) => m.get(id));
      inFlight.set(id, p);
      waiting.push([id, p]);
    }
  }

  if (waiting.length > 0) {
    await Promise.all(
      waiting.map(async ([id, p]) => {
        const jur = await p;
        if (jur) result.set(id, jur);
      }),
    );
  }

  return result;
}

/** Resolve one organization's jurisdiction, falling back to `DEFAULT_JURISDICTION`. */
export async function fetchOrganizationJurisdiction(
  organizationId: string | null | undefined,
): Promise<string> {
  if (!organizationId) return DEFAULT_JURISDICTION;
  const cached = getOrganizationJurisdiction(organizationId);
  if (cached) return cached;
  const map = await fetchOrganizationJurisdictions([organizationId]);
  return map.get(organizationId) ?? DEFAULT_JURISDICTION;
}

/** Test seam. */
export function resetOrganizationJurisdictionCache(): void {
  inFlight.clear();
  clearOrganizationJurisdictions();
}
