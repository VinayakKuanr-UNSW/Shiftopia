import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A rejected credential and an unreachable server both used to resolve to
 * `null`, which the provider treated as "no profile". The session stayed in
 * storage, `setUser` was skipped, and the app returned to the login screen
 * with nothing explaining why.
 *
 * These tests pin the boundary: an explicit rejection escapes as
 * AuthSessionError, and everything else still resolves null so a transient
 * failure cannot sign anyone out.
 */

const from = vi.fn();
const rpc = vi.fn();

vi.mock('@/platform/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => from(...args),
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

import { authService, AuthSessionError } from '../auth.service';

/** Minimal stand-in for the PostgREST builder chain used by getUserProfile. */
function profileResult(result: { data: unknown; error: unknown }) {
  from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
      }),
      in: () => Promise.resolve({ data: [], error: null }),
      order: () => Promise.resolve({ data: [], error: null }),
    }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getUserProfile — rejected credential vs unreachable server', () => {
  it.each([
    ['a 401', { status: 401, message: 'Unauthorized' }],
    ['a 403', { status: 403, message: 'Forbidden' }],
    ['a string status 401', { statusCode: '401', message: 'Unauthorized' }],
    ['PostgREST PGRST301 (JWT expired)', { code: 'PGRST301', message: 'JWT expired' }],
    ['PostgREST PGRST300 (JWT claims error)', { code: 'PGRST300', message: 'JWT claim and role mismatch' }],
    ['PostgREST PGRST302 (JWT invalid)', { code: 'PGRST302', message: 'JWSError' }],
    ['Postgres 42501 (insufficient privilege)', { code: '42501', message: 'permission denied' }],
    ['JWT message without code', { message: 'token is expired by 5m' }],
  ])('throws AuthSessionError on %s', async (_label, error) => {
    profileResult({ data: null, error });
    await expect(authService.getUserProfile('u1')).rejects.toBeInstanceOf(AuthSessionError);
  });

  it.each([
    ['a network drop', { message: 'Failed to fetch' }],
    ['a 500', { status: 500, message: 'Internal server error' }],
    ['a genuinely missing row', null],
  ])('still resolves null on %s, so the session is left alone', async (_label, error) => {
    profileResult({ data: null, error });
    await expect(authService.getUserProfile('u1')).resolves.toBeNull();
  });
});

describe('fetchPermissions — rejected credential vs unreachable server', () => {
  it('throws AuthSessionError when the token is rejected mid-session', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } });
    await expect(authService.fetchPermissions()).rejects.toBeInstanceOf(AuthSessionError);
  });

  it('resolves null on a transient failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { status: 503, message: 'unavailable' } });
    await expect(authService.fetchPermissions()).resolves.toBeNull();
  });

  it('returns the permission object on success', async () => {
    rpc.mockResolvedValue({ data: { typeX: [], typeY: null }, error: null });
    await expect(authService.fetchPermissions()).resolves.toEqual({ typeX: [], typeY: null });
  });
});

describe('AuthSessionError', () => {
  it('carries the rejecting status for diagnostics', () => {
    expect(new AuthSessionError('nope', 403).status).toBe(403);
  });

  it('is identifiable by name after serialisation boundaries', () => {
    expect(new AuthSessionError('nope').name).toBe('AuthSessionError');
  });
});
