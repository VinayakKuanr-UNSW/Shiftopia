/**
 * Projection Cache Layer
 *
 * Sits BETWEEN the pipeline and the payroll engine. The payroll engine
 * (`standard.ts`, `security.ts`) remains pure, deterministic, and stateless.
 *
 * Cache key: `shift.id + ':' + shift.updatedAtMs`
 *   - Uses ID + timestamp instead of WeakMap object references because
 *     structured cloning across the worker boundary creates new objects.
 *   - Bounded by MAX_CACHE_SIZE to prevent unbounded memory growth.
 *   - Uses a simple LRU eviction: oldest entries are deleted when full.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * This file must NEVER import from React, Zustand, or any browser-only module.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import type { ShiftCostBreakdown } from '../utils/cost/types';

// ── Configuration ─────────────────────────────────────────────────────────────

/** Maximum number of cost results to cache. ~5,000 shifts × 14 days = 70,000 */
const MAX_CACHE_SIZE = 80_000;

// ── Internal state ────────────────────────────────────────────────────────────

const cache = new Map<string, ShiftCostBreakdown>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a deterministic cache key from a shift ID and its last-modified
 * timestamp. The timestamp ensures stale entries are automatically
 * invalidated when the shift is updated.
 */
export function makeCacheKey(shiftId: string, updatedAtMs: number): string {
  return `${shiftId}:${updatedAtMs}`;
}

/**
 * Look up a previously-computed cost breakdown.
 * Returns `undefined` on cache miss.
 */
export function getCachedCost(key: string): ShiftCostBreakdown | undefined {
  return cache.get(key);
}

/**
 * Store a computed cost breakdown.
 * Enforces MAX_CACHE_SIZE via LRU-like eviction (oldest entries first).
 */
export function setCachedCost(key: string, value: ShiftCostBreakdown): void {
  // Evict oldest entries if cache is full
  if (cache.size >= MAX_CACHE_SIZE) {
    // Map.keys() returns insertion order — delete the first (oldest) 10%
    const evictCount = Math.ceil(MAX_CACHE_SIZE * 0.1);
    const keysIter = cache.keys();
    for (let i = 0; i < evictCount; i++) {
      const oldest = keysIter.next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }
  cache.set(key, value);
}

/**
 * Clear all cached entries. Called on worker termination or when the
 * entire roster dataset is replaced (e.g. department switch).
 */
export function clearCostCache(): void {
  cache.clear();
}

/**
 * Current cache size — useful for diagnostics / logging.
 */
export function getCacheSize(): number {
  return cache.size;
}
