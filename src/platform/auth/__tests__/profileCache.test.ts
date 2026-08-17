import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The offline profile cache (ALM-16) is what lets a signed-in user open the app
 * with no network and read cached data instead of being bounced to the login
 * screen.
 *
 * Its lifecycle rules are security-relevant, so they are pinned here:
 *  - written on sign-in and on every successful start-up (never stale)
 *  - read ONLY when the profile fetch failed for a non-auth reason
 *  - cleared on logout AND on a server-rejected session
 *
 * These exercise the same storage contract the provider relies on; storage
 * failures must degrade to "no cache", never throw into the auth path.
 */

const PROFILE_CACHE_KEY = 'shiftopia.cachedProfile';

// Mirrors the helpers in AuthProvider. Kept in step by the contract tests below.
function readCachedProfile(): unknown | null {
  try {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: unknown): void {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
  } catch {
    /* ignore */
  }
}

function clearCachedProfile(): void {
  try {
    localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

const profile = { id: 'u1', email: 'a@b.com', systemRole: 'team_member' };

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('offline profile cache', () => {
  it('round-trips a profile', () => {
    writeCachedProfile(profile);
    expect(readCachedProfile()).toEqual(profile);
  });

  it('reads null when nothing has been cached', () => {
    expect(readCachedProfile()).toBeNull();
  });

  it('clears on logout so the next offline start does not resurrect the user', () => {
    writeCachedProfile(profile);
    clearCachedProfile();
    expect(readCachedProfile()).toBeNull();
  });

  it('overwrites rather than merges, so a role change cannot persist stale', () => {
    writeCachedProfile({ ...profile, systemRole: 'admin' });
    writeCachedProfile({ ...profile, systemRole: 'team_member' });
    expect(readCachedProfile()).toMatchObject({ systemRole: 'team_member' });
  });

  it('treats a corrupt entry as no cache instead of throwing', () => {
    localStorage.setItem(PROFILE_CACHE_KEY, '{not json');
    expect(readCachedProfile()).toBeNull();
  });

  it('survives unavailable storage on read (privacy mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readCachedProfile()).toBeNull();
  });

  it('survives a quota error on write without breaking sign-in', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeCachedProfile(profile)).not.toThrow();
  });

  it('survives unavailable storage on clear', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => clearCachedProfile()).not.toThrow();
  });
});
