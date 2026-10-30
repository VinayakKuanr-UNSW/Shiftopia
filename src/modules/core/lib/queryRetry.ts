/**
 * React Query `retry` policy for every query (mutations never retry).
 *
 * Retry only what can succeed on a second attempt: transport failures, 5xx,
 * and transient database states. Fail fast on anything deterministic — a
 * permission denial or constraint violation returns the same answer every
 * time, and two back-off retries just hold the error screen for ~3s.
 *
 * Three error shapes reach here:
 *  - HTTP-style errors carrying `status` (fetch wrappers, edge functions).
 *  - Raw PostgrestError: `code` is a Postgres SQLSTATE (`42501`) or a
 *    PostgREST code (`PGRST116`) and there is NO `status`. A transport failure
 *    is also a PostgrestError, with `code: ''`.
 *  - AppError from callRpc(): `code` is an app code (`PERMISSION_DENIED`) and
 *    the SQLSTATE travels in `details.pgCode`.
 */

const MAX_RETRIES = 2;

/** AppError codes that describe the request, not the network. */
const PERMANENT_APP_CODES = new Set([
  'AUTH_REQUIRED', 'PERMISSION_DENIED', 'NOT_FOUND', 'STATE_TRANSITION',
  'COMPLIANCE', 'CONFLICT', 'VALIDATION', 'RPC_VALIDATION',
]);

/**
 * SQLSTATE classes that cannot change on retry: 22 data exception,
 * 23 integrity constraint, 28 invalid authorization, 42 syntax error or
 * access rule violation (42501 insufficient_privilege, 42P01 undefined table),
 * P0 PL/pgSQL raise_exception. Transient classes — 08 connection, 40
 * serialization/deadlock, 53 resources, 57 cancel/timeout, 58 system, XX
 * internal — and anything unknown stay retryable.
 */
const PERMANENT_SQLSTATE_CLASSES = new Set(['22', '23', '28', '42', 'P0']);

function isPermanentCode(code: string): boolean {
  // PostgREST: PGRST0xx are connection/pool failures (503/504); every other
  // PGRST code is a request, schema-cache or JWT error.
  if (code.startsWith('PGRST')) return !code.startsWith('PGRST0');
  return /^[0-9A-Z]{5}$/.test(code) && PERMANENT_SQLSTATE_CLASSES.has(code.slice(0, 2));
}

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  const e = (error ?? {}) as { status?: unknown; code?: unknown; details?: { pgCode?: unknown } };

  // 4xx = client error, including 408 and 429: no point retrying.
  if (typeof e.status === 'number' && e.status >= 400 && e.status < 500) return false;

  if (typeof e.code === 'string') {
    if (PERMANENT_APP_CODES.has(e.code)) return false;
    if (isPermanentCode(e.code)) return false;
  }
  // callRpc maps every unlisted SQLSTATE to RPC_NETWORK, so check the original.
  const pgCode = e.details?.pgCode;
  if (typeof pgCode === 'string' && isPermanentCode(pgCode)) return false;

  // Network failures, 5xx, transient SQLSTATEs, unknown shapes.
  return true;
}
