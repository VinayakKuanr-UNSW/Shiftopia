import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_VENUE_JURISDICTION,
  DEFAULT_VENUE_ZONE,
  setActiveVenue,
  setVenues,
  shiftJurisdiction,
  shiftZone,
  venueJurisdiction,
  venueZone,
} from '../venue';
import {
  clearOrganizationJurisdictions,
  getOrganizationJurisdiction,
} from '../jurisdiction-registry';

beforeEach(() => {
  setVenues([]);
  setActiveVenue(null);
  clearOrganizationJurisdictions();
});

describe('venue registry', () => {
  it('defaults to ICC Sydney timezone and AU-NSW jurisdiction before venues load', () => {
    expect(venueZone()).toBe(DEFAULT_VENUE_ZONE);
    expect(venueJurisdiction()).toBe(DEFAULT_VENUE_JURISDICTION);
    expect(shiftZone(null)).toBe(DEFAULT_VENUE_ZONE);
    expect(shiftJurisdiction(undefined)).toBe(DEFAULT_VENUE_JURISDICTION);
  });

  it('resolves timezone and jurisdiction per organization and active venue, and syncs jurisdiction-registry', () => {
    setVenues([
      { id: 'org-icc', timezone: 'Australia/Sydney', jurisdiction: 'AU-NSW' },
      { id: 'org-bcec', timezone: 'Australia/Brisbane', jurisdiction: 'AU-QLD-BNE' },
    ]);
    setActiveVenue('org-bcec');

    expect(venueZone()).toBe('Australia/Brisbane');
    expect(venueJurisdiction()).toBe('AU-QLD-BNE');
    expect(venueZone('org-icc')).toBe('Australia/Sydney');
    expect(venueJurisdiction('org-icc')).toBe('AU-NSW');
    expect(getOrganizationJurisdiction('org-bcec')).toBe('AU-QLD-BNE');
  });

  it('prefers a shift-stamped timezone over its organization and active venue', () => {
    setVenues([
      { id: 'org-bcec', timezone: 'Australia/Brisbane', jurisdiction: 'AU-QLD-BNE' },
    ]);
    setActiveVenue('org-bcec');

    expect(shiftZone({ timezone: 'Australia/Perth', organization_id: 'org-bcec' })).toBe('Australia/Perth');
    expect(shiftZone({ organization_id: 'org-bcec' })).toBe('Australia/Brisbane');
    expect(shiftJurisdiction({ organizationId: 'org-bcec' })).toBe('AU-QLD-BNE');
  });
});
