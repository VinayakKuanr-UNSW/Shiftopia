/**
 * Railway-Oriented Result<T, E> monad.
 *
 * Eliminates the try/catch swallowing pattern by making failure an
 * explicit, typed path in the return type. Functions return a Result
 * instead of throwing, forcing callers to handle both branches.
 *
 * Usage:
 *   const result = await tryCatch(() => fetchSomething());
 *   if (!result.ok) {
 *     // handle result.error — it's typed, not `unknown`
 *   }
 *   const value = result.value; // only reachable when ok
 */

import type { AppError } from './errors';

// ── Core types ─────────────────────────────────────────────────────────────

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E extends Error = AppError> = { readonly ok: false; readonly error: E };
export type Result<T, E extends Error = AppError> = Ok<T> | Err<E>;

// ── Constructors ───────────────────────────────────────────────────────────

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E extends Error>(error: E): Err<E> => ({ ok: false, error });

// ── Operators ──────────────────────────────────────────────────────────────

/** Transform the success value, pass errors through unchanged */
export function map<T, U, E extends Error>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Chain a Result-returning function onto a success value */
export function flatMap<T, U, E extends Error>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/** Extract the value or throw the error (escape hatch — prefer explicit handling) */
export function unwrap<T, E extends Error>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error;
}

/** Extract the value or return a fallback */
export function unwrapOr<T, E extends Error>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

// ── Async helpers ──────────────────────────────────────────────────────────

/**
 * Wrap any async function into a Result — the canonical way to call
 * external services without relying on try/catch.
 *
 * @param fn        The async operation that may throw
 * @param onError   Optional mapper: converts the thrown value into a typed E
 */
export async function tryCatch<T, E extends Error = AppError>(
  fn: () => Promise<T>,
  onError?: (e: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(onError ? onError(e) : (e as E));
  }
}

/**
 * Run multiple Results in parallel and collect all successes / failures.
 * Returns Ok with all values only if ALL succeed; otherwise Err with the
 * first error.
 */
export async function all<T, E extends Error>(
  results: Array<Promise<Result<T, E>>>,
): Promise<Result<T[], E>> {
  const settled = await Promise.all(results);
  const values: T[] = [];
  for (const r of settled) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
}
