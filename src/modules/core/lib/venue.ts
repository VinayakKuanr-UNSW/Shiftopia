/**
 * The venue context on the client: each organization's IANA timezone and
 * public-holiday jurisdiction (`public.organizations.timezone / jurisdiction`).
 * docs/architecture/multi-organization.md §10 (V7) and §3 (H5).
 *
 * One registry, filled once per session from the organizations the user can
 * read (`loadVenues` in `venue.api.ts`, called by AuthProvider beside the permission fetch, so it
 * has landed before a page reads it), plus the ACTIVE venue — the organization
 * of the person's active access certificate (the account-menu switcher).
 *
 * Every lookup is synchronous so that plain helpers (date formatting, "has it
 * started", holiday day-typing) can use it without a hook. Prefer the most
 * specific answer at hand:
 *   1. a shift's own `timezone` (the database stamps it from its organization),
 *   2. `venueZone(orgId)` / `venueJurisdiction(orgId)` for a known organization,
 *   3. `venueZone()` / `venueJurisdiction()` — the active venue — for screens
 *      that are not about one shift (a calendar's "today", a grid's past days).
 * Until the registry is filled, or for an organization the user cannot read,
 * the answers are ICC Sydney's (the only venue before BCEC). The database
 * still decides every start/lock/past check; the client's are advisory.
 */

import { registerOrganizationJurisdictions } from './jurisdiction-registry';

export const DEFAULT_VENUE_ZONE = 'Australia/Sydney';
export const DEFAULT_VENUE_JURISDICTION = 'AU-NSW';

export interface Venue {
  id: string;
  timezone: string;
  jurisdiction: string;
}

let venuesById: ReadonlyMap<string, Venue> = new Map();
let activeVenueId: string | null = null;

/** Replace the registry (a new Map, never mutated in place). */
export function setVenues(venues: readonly Venue[]): void {
  venuesById = new Map(venues.map((v) => [v.id, v]));
  registerOrganizationJurisdictions(venues);
}

/** The organization the person is working in now; null clears it. */
export function setActiveVenue(organizationId: string | null | undefined): void {
  activeVenueId = organizationId ?? null;
}

function venueOf(organizationId?: string | null): Venue | undefined {
  return venuesById.get(organizationId ?? activeVenueId ?? '');
}

/** IANA timezone of the organization (the active venue when none is named). */
export function venueZone(organizationId?: string | null): string {
  return venueOf(organizationId)?.timezone ?? venueOf()?.timezone ?? DEFAULT_VENUE_ZONE;
}

/** Holiday jurisdiction of the organization (the active venue when none is named). */
export function venueJurisdiction(organizationId?: string | null): string {
  return venueOf(organizationId)?.jurisdiction ?? venueOf()?.jurisdiction ?? DEFAULT_VENUE_JURISDICTION;
}

/** The fields a shift-like row may carry to say where it happens. */
export interface VenueRef {
  timezone?: string | null;
  organization_id?: string | null;
  organizationId?: string | null;
}

/** A shift's zone: its own stamped `timezone`, else its organization's, else the active venue's. */
export function shiftZone(shift: VenueRef | null | undefined): string {
  return shift?.timezone || venueZone(shift?.organization_id ?? shift?.organizationId);
}

/** A shift's holiday jurisdiction: its organization's, else the active venue's. */
export function shiftJurisdiction(shift: VenueRef | null | undefined): string {
  return venueJurisdiction(shift?.organization_id ?? shift?.organizationId);
}
