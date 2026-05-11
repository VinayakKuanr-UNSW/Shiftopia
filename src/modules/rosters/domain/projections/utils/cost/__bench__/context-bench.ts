/**
 * Phase 3 Benchmark: AwardContext vs Legacy Performance
 *
 * Run with: npx tsx src/modules/rosters/domain/projections/utils/cost/__bench__/context-bench.ts
 */

import { estimateDetailedShiftCost } from '../standard';
import { buildAwardContext } from '../award-context';
import type { CostCalculatorOptions } from '../types';

const SHIFT_COUNT = 500;
const DATES = ['2025-06-09', '2025-06-10', '2025-06-11', '2025-06-12', '2025-06-13', '2025-06-14', '2025-06-15'];

function makeShift(i: number): CostCalculatorOptions {
  return {
    netMinutes: 420 + (i % 120),
    start_time: `${6 + (i % 12)}:00`,
    end_time: `${14 + (i % 12)}:00`,
    rate: 32.06,
    scheduled_length_minutes: 480,
    is_overnight: i % 10 === 0,
    is_cancelled: false,
    shift_date: DATES[i % DATES.length],
    employmentType: i % 3 === 0 ? 'Casual' : i % 3 === 1 ? 'Full-Time' : 'Part-Time',
  };
}

const shifts = Array.from({ length: SHIFT_COUNT }, (_, i) => makeShift(i));

// ── Benchmark: Legacy path (no context) ────────────────────────────────────

console.log(`\n--- Benchmarking ${SHIFT_COUNT} shifts, ${DATES.length} unique dates ---\n`);

const t1 = performance.now();
for (const s of shifts) {
  estimateDetailedShiftCost(s);
}
const legacyMs = performance.now() - t1;
console.log(`LEGACY  (no context):  ${legacyMs.toFixed(2)}ms`);

// ── Benchmark: Phase 3 (with AwardContext) ─────────────────────────────────

const ctxBuildStart = performance.now();
const ctx = buildAwardContext(DATES);
const ctxBuildMs = performance.now() - ctxBuildStart;

const t2 = performance.now();
for (const s of shifts) {
  estimateDetailedShiftCost(s, ctx);
}
const contextMs = performance.now() - t2;
console.log(`CONTEXT (with award):  ${contextMs.toFixed(2)}ms  (ctx build: ${ctxBuildMs.toFixed(2)}ms)`);
console.log(`TOTAL   (ctx + calc):  ${(contextMs + ctxBuildMs).toFixed(2)}ms`);

// ── Results ────────────────────────────────────────────────────────────────

const speedup = legacyMs / (contextMs + ctxBuildMs);
console.log(`\nSpeedup: ${speedup.toFixed(1)}x faster`);
console.log(`Saved:   ${(legacyMs - contextMs - ctxBuildMs).toFixed(2)}ms per projection cycle\n`);
