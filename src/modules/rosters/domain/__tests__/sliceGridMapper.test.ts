/**
 * Unit tests for sliceGridMapper.ts.
 *
 * Covers:
 *   - sliceIdxToSynthSlot: mapping, boundary, out-of-window null
 *   - synthSlotToSliceIdx: mapping, post-midnight null
 *   - l3CellsToSynthSlots: filter, dense output, multi-cell aggregation
 *   - synthSlotsToSliceCounts: inverse mapping
 */

import { describe, it, expect } from 'vitest';
import {
    sliceIdxToSynthSlot,
    synthSlotToSliceIdx,
    l3CellsToSynthSlots,
    synthSlotsToSliceCounts,
} from '../sliceGridMapper';
import type { RuleBaselineCell } from '../ruleEngine.types';
import { SLOT_MINUTES } from '../shiftSynthesizer.policy';

describe('sliceIdxToSynthSlot', () => {
    it('slice 12 = 06:00 maps to synth slot 0', () => {
        expect(sliceIdxToSynthSlot(12)).toBe(0);
    });

    it('slice 13 = 06:30 maps to synth slot 1', () => {
        expect(sliceIdxToSynthSlot(13)).toBe(1);
    });

    it('slice 0 (00:00) returns null — before synthesizer window', () => {
        expect(sliceIdxToSynthSlot(0)).toBeNull();
    });

    it('slice 11 (05:30) returns null — before 06:00', () => {
        expect(sliceIdxToSynthSlot(11)).toBeNull();
    });

    it('slice 47 (23:30) maps to synth slot 35 = 23:30', () => {
        // synth slot 35 = 360 + 35*30 = 1410 min = 23:30
        expect(sliceIdxToSynthSlot(47)).toBe(35);
    });

    it('slice 32 (16:00) maps to synth slot 20 = 16:00', () => {
        // 360 + 20*30 = 960 min = 16:00; slice 32 = 32*30 = 960 min ✓
        expect(sliceIdxToSynthSlot(32)).toBe(20);
    });
});

describe('synthSlotToSliceIdx', () => {
    it('synth slot 0 (06:00) maps to slice 12', () => {
        expect(synthSlotToSliceIdx(0)).toBe(12);
    });

    it('synth slot 1 (06:30) maps to slice 13', () => {
        expect(synthSlotToSliceIdx(1)).toBe(13);
    });

    it('synth slot 35 (23:30) maps to slice 47', () => {
        expect(synthSlotToSliceIdx(35)).toBe(47);
    });

    it('synth slot 36 (24:00 = midnight+) returns null', () => {
        // SLOT_MINUTES[36] = 360 + 36*30 = 1440 min ≥ 48*30 = 1440
        expect(synthSlotToSliceIdx(36)).toBeNull();
    });

    it('out-of-range negative returns null', () => {
        expect(synthSlotToSliceIdx(-1)).toBeNull();
    });

    it('out-of-range beyond SLOT_MINUTES returns null', () => {
        expect(synthSlotToSliceIdx(SLOT_MINUTES.length)).toBeNull();
    });
});

// Helper to make a minimal RuleBaselineCell
function cell(
    slice_idx: number,
    function_code: string,
    level: number,
    headcount: number,
): RuleBaselineCell {
    return {
        slice_idx,
        function_code: function_code as RuleBaselineCell['function_code'],
        level,
        headcount,
        contributing_rule_codes: ['r1'],
        explanation: [`rule:r1 +${headcount}`],
    };
}

describe('l3CellsToSynthSlots', () => {
    it('returns a dense slots array of length SLOT_MINUTES.length', () => {
        const { slots } = l3CellsToSynthSlots([], 'F&B', 1);
        expect(slots).toHaveLength(SLOT_MINUTES.length);
    });

    it('maps a single cell to the correct synth slot', () => {
        const cells = [cell(32, 'F&B', 1, 10)]; // slice 32 = 16:00 = synth slot 20
        const { slots } = l3CellsToSynthSlots(cells, 'F&B', 1);
        expect(slots[20].headcount).toBe(10);
        expect(slots[20].slotStartMinutes).toBe(SLOT_MINUTES[20]);
    });

    it('collects pre-dawn cells (slice < 12) into droppedPreDawn', () => {
        const cells = [cell(5, 'F&B', 1, 99)]; // 02:30 — before 06:00
        const { slots, droppedPreDawn } = l3CellsToSynthSlots(cells, 'F&B', 1);
        expect(slots.every((s) => s.headcount === 0)).toBe(true);
        expect(droppedPreDawn).toHaveLength(1);
        expect(droppedPreDawn[0]).toMatchObject({ slice_idx: 5, headcount: 99, function_code: 'F&B', level: 1 });
    });

    it('returns empty droppedPreDawn when all cells are in-window', () => {
        const { droppedPreDawn } = l3CellsToSynthSlots([cell(32, 'F&B', 1, 10)], 'F&B', 1);
        expect(droppedPreDawn).toHaveLength(0);
    });

    it('aggregates multiple cells landing on the same synth slot', () => {
        // Two rules both produce headcount in slice 32 → slot 20
        const cells = [cell(32, 'F&B', 1, 6), cell(32, 'F&B', 1, 4)];
        const { slots } = l3CellsToSynthSlots(cells, 'F&B', 1);
        expect(slots[20].headcount).toBe(10);
    });

    it('filters by function_code and level', () => {
        const cells = [
            cell(32, 'F&B', 1, 10),
            cell(32, 'Security', 3, 5),
            cell(32, 'F&B', 2, 3),
        ];
        const { slots } = l3CellsToSynthSlots(cells, 'F&B', 1);
        expect(slots[20].headcount).toBe(10);
        // Other function/level combinations should not leak in
        expect(slots.reduce((acc, s) => acc + s.headcount, 0)).toBe(10);
    });

    it('carries explanation from the cell', () => {
        const cells = [cell(32, 'F&B', 1, 10)];
        const { slots } = l3CellsToSynthSlots(cells, 'F&B', 1);
        expect(slots[20].explanation).toContain('rule:r1 +10');
    });
});

describe('synthSlotsToSliceCounts', () => {
    it('maps synth slot 20 → slice 32 correctly', () => {
        const { slots } = l3CellsToSynthSlots([cell(32, 'F&B', 1, 10)], 'F&B', 1);
        const counts = synthSlotsToSliceCounts(slots);
        expect(counts.get(32)).toBe(10);
    });

    it('returns empty map for all-zero slots', () => {
        const { slots } = l3CellsToSynthSlots([], 'F&B', 1);
        const counts = synthSlotsToSliceCounts(slots);
        expect(counts.size).toBe(0);
    });

    it('does not include post-midnight synth slots (null sliceIdx)', () => {
        // Synthetically inject a headcount at synth slot 37 (post-midnight)
        const { slots } = l3CellsToSynthSlots([], 'F&B', 1);
        slots[37].headcount = 5;
        const counts = synthSlotsToSliceCounts(slots);
        // sliceIdx should be null for 37 — no entry in the map
        expect(counts.has(48)).toBe(false);
        expect(counts.has(49)).toBe(false);
    });
});
