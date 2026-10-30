import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { PostgrestError } from '@supabase/supabase-js';
import { AppError } from '@/platform/supabase/rpc/errors';
import { shouldRetry } from '../queryRetry';

const pg = (code: string) => new PostgrestError({ message: 'm', details: '', hint: '', code });
const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe('shouldRetry — first failure (failureCount 0)', () => {
  it.each([400, 401, 403, 404, 422])('HTTP %i: no retry', (s) => {
    expect(shouldRetry(0, http(s))).toBe(false);
  });

  // Existing policy, kept: every 4xx fails fast, timeout and rate-limit included.
  it.each([408, 429])('HTTP %i: no retry (4xx policy)', (s) => {
    expect(shouldRetry(0, http(s))).toBe(false);
  });

  it.each([500, 502, 503, 504])('HTTP %i: retries', (s) => {
    expect(shouldRetry(0, http(s))).toBe(true);
  });

  it.each([
    ['42501', 'insufficient_privilege (RLS / grant)'],
    ['42P01', 'undefined_table'],
    ['23505', 'unique_violation'],
    ['23503', 'foreign_key_violation'],
    ['22P02', 'invalid_text_representation'],
    ['P0001', 'raise_exception'],
    ['PGRST116', 'single row not found'],
    ['PGRST301', 'JWT invalid'],
  ])('PostgrestError %s (%s): no retry', (code) => {
    expect(shouldRetry(0, pg(code))).toBe(false);
  });

  it.each([
    ['40001', 'serialization_failure'],
    ['40P01', 'deadlock_detected'],
    ['57014', 'query_canceled (statement timeout)'],
    ['08006', 'connection_failure'],
    ['53300', 'too_many_connections'],
    ['PGRST000', 'PostgREST cannot reach the database'],
  ])('PostgrestError %s (%s): retries', (code) => {
    expect(shouldRetry(0, pg(code))).toBe(true);
  });

  it('transport failure (postgrest-js returns code "" and no status): retries', () => {
    expect(shouldRetry(0, pg(''))).toBe(true);
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true);
  });

  it('AppError with a request-level code: no retry', () => {
    expect(shouldRetry(0, new AppError({ code: 'PERMISSION_DENIED', message: 'm' }))).toBe(false);
    expect(shouldRetry(0, new AppError({ code: 'CONFLICT', message: 'm' }))).toBe(false);
  });

  it('AppError RPC_NETWORK: judged by the SQLSTATE callRpc kept in details.pgCode', () => {
    // callRpc maps every SQLSTATE it does not list to RPC_NETWORK.
    const undefinedFn = new AppError({ code: 'RPC_NETWORK', message: 'm', details: { pgCode: '42883' } });
    const transport = new AppError({ code: 'RPC_NETWORK', message: 'm', details: { pgCode: '' } });
    expect(shouldRetry(0, undefinedFn)).toBe(false);
    expect(shouldRetry(0, transport)).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'boom'],
    ['a plain object', {}],
    ['a non-SQLSTATE code', { code: 'ECONNRESET' }],
  ])('unknown shape (%s): retries — fail-safe, bounded by the limit', (_l, err) => {
    expect(shouldRetry(0, err)).toBe(true);
  });
});

describe('shouldRetry — retry limit', () => {
  it('stops after two retries', () => {
    expect(shouldRetry(1, http(500))).toBe(true);
    expect(shouldRetry(2, http(500))).toBe(false);
  });

  // Drive the real retryer so the limit is measured in actual attempts.
  const attempts = async (error: unknown) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: shouldRetry, retryDelay: 0 } } });
    let calls = 0;
    await client.fetchQuery({ queryKey: ['t'], queryFn: () => { calls++; throw error; } }).catch(() => {});
    client.clear();
    return calls;
  };

  it('transient errors get 1 attempt + 2 retries', async () => {
    expect(await attempts(http(500))).toBe(3);
    expect(await attempts(pg(''))).toBe(3);
  });

  it('permanent errors get exactly 1 attempt', async () => {
    expect(await attempts(pg('42501'))).toBe(1);
    expect(await attempts(pg('23505'))).toBe(1);
    expect(await attempts(http(403))).toBe(1);
  });
});
