/**
 * Unit tests for templateBuilder.service.ts (L9 Template Builder).
 *
 * Pure function tests only — no Supabase mocks, no network.
 *
 * Covers:
 *   - buildClusterKey: pax band boundaries, room band boundaries, null handling,
 *     deterministic output for identical inputs.
 *   - computeMedian: odd count, even count, single element, all-same, sorted
 *     output independence (caller array not mutated).
 */

import { describe, it, expect } from 'vitest';
import {
    buildClusterKey,
    computeMedian,
    classifyPaxBand,
    classifyRoomBand,
} from '../templateBuilder.service';

// ─── classifyPaxBand ──────────────────────────────────────────────────────────

describe('classifyPaxBand — band boundaries', () => {
    it('0 pax → <100', () => expect(classifyPaxBand(0)).toBe('<100'));
    it('99 pax → <100', () => expect(classifyPaxBand(99)).toBe('<100'));
    it('100 pax → 100-300', () => expect(classifyPaxBand(100)).toBe('100-300'));
    it('299 pax → 100-300', () => expect(classifyPaxBand(299)).toBe('100-300'));
    it('300 pax → 300-600', () => expect(classifyPaxBand(300)).toBe('300-600'));
    it('599 pax → 300-600', () => expect(classifyPaxBand(599)).toBe('300-600'));
    it('600 pax → 600-1500', () => expect(classifyPaxBand(600)).toBe('600-1500'));
    it('1499 pax → 600-1500', () => expect(classifyPaxBand(1499)).toBe('600-1500'));
    it('1500 pax → 1500+', () => expect(classifyPaxBand(1500)).toBe('1500+'));
    it('9999 pax → 1500+', () => expect(classifyPaxBand(9999)).toBe('1500+'));
});

// ─── classifyRoomBand ─────────────────────────────────────────────────────────

describe('classifyRoomBand — band boundaries', () => {
    it('0 rooms → 1', () => expect(classifyRoomBand(0)).toBe('1'));
    it('1 room  → 1', () => expect(classifyRoomBand(1)).toBe('1'));
    it('2 rooms → 2-3', () => expect(classifyRoomBand(2)).toBe('2-3'));
    it('3 rooms → 2-3', () => expect(classifyRoomBand(3)).toBe('2-3'));
    it('4 rooms → 4+', () => expect(classifyRoomBand(4)).toBe('4+'));
    it('10 rooms → 4+', () => expect(classifyRoomBand(10)).toBe('4+'));
});

// ─── buildClusterKey ─────────────────────────────────────────────────────────

describe('buildClusterKey — deterministic output', () => {
    it('same input → identical output twice', () => {
        const input = { event_type: 'Conference', pax: 250, service_type: 'Full', alcohol: true, room_count: 2 };
        expect(buildClusterKey(input)).toEqual(buildClusterKey(input));
    });

    it('correct bands for typical conference', () => {
        const key = buildClusterKey({
            event_type: 'Conference', pax: 250, service_type: 'Full', alcohol: true, room_count: 2,
        });
        expect(key.pax_band).toBe('100-300');
        expect(key.room_count_band).toBe('2-3');
        expect(key.event_type).toBe('Conference');
        expect(key.service_type).toBe('Full');
        expect(key.alcohol).toBe(true);
    });

    it('null event_type preserved as null', () => {
        const key = buildClusterKey({ event_type: null, pax: 50, service_type: null, alcohol: null, room_count: 1 });
        expect(key.event_type).toBeNull();
        expect(key.service_type).toBeNull();
        expect(key.alcohol).toBeNull();
    });

    it('pax boundary: 600 → 600-1500', () => {
        const key = buildClusterKey({ event_type: null, pax: 600, service_type: null, alcohol: null, room_count: 1 });
        expect(key.pax_band).toBe('600-1500');
    });

    it('room boundary: 4 → 4+', () => {
        const key = buildClusterKey({ event_type: null, pax: 50, service_type: null, alcohol: false, room_count: 4 });
        expect(key.room_count_band).toBe('4+');
    });

    it('large event → 1500+ pax band', () => {
        const key = buildClusterKey({ event_type: 'Concert', pax: 5000, service_type: null, alcohol: true, room_count: 1 });
        expect(key.pax_band).toBe('1500+');
    });
});

// ─── computeMedian ───────────────────────────────────────────────────────────

describe('computeMedian — correctness', () => {
    it('single element → that element', () => expect(computeMedian([7])).toBe(7));

    it('all same values → that value', () => expect(computeMedian([4, 4, 4, 4])).toBe(4));

    it('odd count → middle element after sort', () => {
        // [1, 3, 5, 7, 9] → median = 5
        expect(computeMedian([9, 1, 5, 3, 7])).toBe(5);
    });

    it('even count → average of two middle elements', () => {
        // sorted [2, 4, 6, 8] → (4+6)/2 = 5
        expect(computeMedian([8, 2, 6, 4])).toBe(5);
    });

    it('even count with fractional midpoint', () => {
        // sorted [1, 2] → 1.5
        expect(computeMedian([2, 1])).toBe(1.5);
    });

    it('does not mutate the caller array', () => {
        const arr = [5, 1, 3];
        computeMedian(arr);
        expect(arr).toEqual([5, 1, 3]);
    });

    it('throws on empty array', () => {
        expect(() => computeMedian([])).toThrow();
    });

    it('two-element even count', () => {
        expect(computeMedian([10, 20])).toBe(15);
    });
});
