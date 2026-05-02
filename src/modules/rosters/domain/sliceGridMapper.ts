/**
 * Demand Engine — Slice grid mapper.
 *
 * L3 rule engine uses a 48-slot, midnight-anchored grid (slice_idx 0..47,
 * each 30 min, 00:00–23:30).
 *
 * The shift synthesizer uses a 40-slot, 06:00-anchored grid (SLOT_MINUTES
 * array, 06:00–25:30 i.e. 02:00 next day).
 *
 * This module bridges the two representations in both directions.
 *
 * Mapping:
 *   L3 slice_idx  0 = 00:00–00:30
 *   L3 slice_idx 12 = 06:00–06:30  ← synthesizer slot 0
 *   L3 slice_idx 47 = 23:30–00:00
 *
 *   Synthesizer slot  0 = 06:00 (360 min)
 *   Synthesizer slot 39 = 25:00 = 01:00+1d (1500 min)
 *
 * L3 cells with slice_idx < 12 (00:00–05:30) have no synthesizer slot;
 * they are dropped when converting to synthesizer slots.
 * Synthesizer slots 32..39 (22:00–25:30) have no L3 slice (L3 ends at 23:30
 * = slice 47). They map to L3 slices 44–47 for the 22:00–23:30 overlap and
 * are clamped to 0 beyond that.
 *
 * Determinism: pure functions.
 */

import { SLOT_MINUTES, SLOT_DURATION_MINUTES } from './shiftSynthesizer.policy';
import type { RuleBaselineCell } from './ruleEngine.types';

/** Midnight-anchored minutes for the start of a 30-min slice (0..47). */
export function sliceIdxToMidnightMinutes(sliceIdx: number): number {
    return sliceIdx * 30;
}

/**
 * Convert a midnight-anchored L3 slice index to the corresponding
 * synthesizer slot index (0..39). Returns null if the slice has no
 * corresponding synthesizer slot (i.e., it falls before 06:00).
 */
export function sliceIdxToSynthSlot(sliceIdx: number): number | null {
    const midnightMinutes = sliceIdxToMidnightMinutes(sliceIdx);
    const synthStart = SLOT_MINUTES[0]; // 360 (06:00)
    if (midnightMinutes < synthStart) return null;
    const slotIdx = Math.floor((midnightMinutes - synthStart) / SLOT_DURATION_MINUTES);
    if (slotIdx < 0 || slotIdx >= SLOT_MINUTES.length) return null;
    return slotIdx;
}

/**
 * Convert a synthesizer slot index (0..39, 06:00-anchored) to the
 * corresponding midnight-anchored L3 slice index (0..47).
 * Returns null for post-midnight synthesizer slots (slot index ≥ 36,
 * i.e., after 24:00).
 */
export function synthSlotToSliceIdx(slotIdx: number): number | null {
    if (slotIdx < 0 || slotIdx >= SLOT_MINUTES.length) return null;
    const midnightMinutes = SLOT_MINUTES[slotIdx]; // already midnight-anchored for slots 0..35
    if (midnightMinutes >= 48 * 30) return null; // beyond 23:30
    return Math.floor(midnightMinutes / 30);
}

export interface SynthSlotHeadcount {
    /** Synthesizer slot index (0..39). */
    slotIdx: number;
    /** Minutes since midnight for the slot start (from SLOT_MINUTES). */
    slotStartMinutes: number;
    headcount: number;
    /** Explanation lines from contributing L3 cells. */
    explanation: string[];
}

export interface L3SynthMappingResult {
    slots: SynthSlotHeadcount[];
    droppedPreDawn: Array<{ slice_idx: number; headcount: number; function_code: string; level: number }>;
}

/**
 * Convert L3 RuleBaselineCell[] for a single (function_code, level) bucket
 * into a synthesizer-grid headcount array (one entry per synthesizer slot).
 *
 * L3 slices that fall outside the synthesizer window (00:00–05:30) cannot be
 * mapped to a synthesizer slot and are collected in `droppedPreDawn` so the
 * caller can surface them in the synthesis run summary.
 * The synthesizer grid is dense (all 40 slots present); slots with no
 * matching L3 cell get headcount = 0.
 *
 * @param cells  All L3 cells for a single event (any function/level mix).
 * @param functionCode  Filter to this function only.
 * @param level         Filter to this level only.
 */
export function l3CellsToSynthSlots(
    cells: readonly RuleBaselineCell[],
    functionCode: string,
    level: number,
): L3SynthMappingResult {
    // Build a map from synthSlotIdx → headcount + explanation
    const slotMap = new Map<number, { headcount: number; explanation: string[] }>();
    const droppedPreDawn: L3SynthMappingResult['droppedPreDawn'] = [];

    for (const cell of cells) {
        if (cell.function_code !== functionCode || cell.level !== level) continue;
        const synthSlot = sliceIdxToSynthSlot(cell.slice_idx);
        if (synthSlot === null) {
            // pre-06:00 — record for caller to surface in run summary
            droppedPreDawn.push({
                slice_idx: cell.slice_idx,
                headcount: cell.headcount,
                function_code: cell.function_code,
                level: cell.level,
            });
            continue;
        }
        const existing = slotMap.get(synthSlot);
        if (existing) {
            existing.headcount += cell.headcount;
            existing.explanation.push(...cell.explanation);
        } else {
            slotMap.set(synthSlot, {
                headcount: cell.headcount,
                explanation: [...cell.explanation],
            });
        }
    }

    // Dense array aligned with SLOT_MINUTES (all 40 slots).
    const slots: SynthSlotHeadcount[] = SLOT_MINUTES.map((startMin, idx) => {
        const entry = slotMap.get(idx);
        return {
            slotIdx: idx,
            slotStartMinutes: startMin,
            headcount: entry?.headcount ?? 0,
            explanation: entry?.explanation ?? [],
        };
    });

    return { slots, droppedPreDawn };
}

/**
 * Inverse helper: given headcount per synthesizer slot, produce a sparse
 * headcount map keyed by L3 slice_idx. Used when writing back to demand_tensor.
 */
export function synthSlotsToSliceCounts(
    slots: readonly SynthSlotHeadcount[],
): Map<number, number> {
    const out = new Map<number, number>();
    for (const s of slots) {
        if (s.headcount === 0) continue; // sparse — skip zero-demand slots
        const sliceIdx = synthSlotToSliceIdx(s.slotIdx);
        if (sliceIdx === null) continue;
        out.set(sliceIdx, (out.get(sliceIdx) ?? 0) + s.headcount);
    }
    return out;
}
