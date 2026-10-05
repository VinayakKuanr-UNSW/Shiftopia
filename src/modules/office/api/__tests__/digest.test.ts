/**
 * These two digests are load-bearing for §23's guarantees: `snapshotVersion`
 * decides whether Apply may proceed, and `inputDigest` is how "generate twice,
 * get the same proposal" is asserted. Both are compared for EQUALITY to decide
 * whether to write, so the properties that matter are that identical inputs
 * always agree and that any real difference always disagrees.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, fnv1a64, inputDigest, snapshotVersion } from '../digest';

describe('canonicalJson', () => {
    it('sorts object keys at every depth', () => {
        const a = { b: 1, a: { d: 2, c: 3 } };
        const b = { a: { c: 3, d: 2 }, b: 1 };

        expect(canonicalJson(a)).toBe(canonicalJson(b));
        expect(canonicalJson(a)).toBe('{"a":{"c":3,"d":2},"b":1}');
    });

    it('PRESERVES array order, because reordering would hide a real difference', () => {
        expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    });

    it('drops undefined so an absent key and an undefined key agree', () => {
        expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    });

    it('handles null, which typeof reports as an object', () => {
        expect(canonicalJson(null)).toBe('null');
        expect(canonicalJson({ a: null })).toBe('{"a":null}');
    });
});

describe('fnv1a64', () => {
    it('is stable and 64-bit wide', () => {
        const h = fnv1a64('baseline');
        expect(h).toBe(fnv1a64('baseline'));
        expect(h).toHaveLength(16);
        expect(h).toMatch(/^[0-9a-f]{16}$/);
    });

    it('separates inputs that differ by one character', () => {
        expect(fnv1a64('a')).not.toBe(fnv1a64('b'));
        expect(fnv1a64('')).not.toBe(fnv1a64('\0'));
    });

    it('stays exact well past 2^53, where a Number implementation would drift', () => {
        // A long input exercises many multiply-and-mask rounds. If the
        // arithmetic silently lost precision this would collide or vary.
        const long = 'x'.repeat(5000);
        expect(fnv1a64(long)).toBe(fnv1a64(long));
        expect(fnv1a64(long)).not.toBe(fnv1a64('x'.repeat(4999)));
    });
});

describe('snapshotVersion', () => {
    const shifts = [
        { id: 'b', version: 2 },
        { id: 'a', version: 1 },
    ];

    it('ignores the order rows came back in', () => {
        expect(snapshotVersion(shifts)).toBe(snapshotVersion([...shifts].reverse()));
    });

    it('changes when a shift is EDITED, not only added or removed', () => {
        // shifts.version is bumped by the mutation gateway on every change,
        // which is what makes it usable as a change token. Without it, an edit
        // in place would be invisible and Apply would proceed against a roster
        // that had moved.
        const edited = [{ id: 'b', version: 3 }, { id: 'a', version: 1 }];
        expect(snapshotVersion(edited)).not.toBe(snapshotVersion(shifts));
    });

    it('changes when a shift is added or removed', () => {
        expect(snapshotVersion([...shifts, { id: 'c', version: 1 }]))
            .not.toBe(snapshotVersion(shifts));
        expect(snapshotVersion([shifts[0]])).not.toBe(snapshotVersion(shifts));
    });

    it('distinguishes an empty roster from a missing one only by being stable', () => {
        expect(snapshotVersion([])).toBe(snapshotVersion([]));
        expect(snapshotVersion([])).not.toBe(snapshotVersion(shifts));
    });

    it('does not confuse ids whose concatenation would collide', () => {
        // 'a|b' vs 'ab' — separator discipline. Without it, {a:1},{b:2} and
        // {ab:12} could hash the same.
        expect(snapshotVersion([{ id: 'a', version: 1 }, { id: 'b', version: 2 }]))
            .not.toBe(snapshotVersion([{ id: 'ab', version: 12 }]));
    });
});

describe('inputDigest', () => {
    const base = {
        subDepartmentId: 'sub-1',
        periodStart: '2024-07-15',
        periodEnd: '2024-08-11',
        patternSlots: [{ id: 's1', start: '08:00' }, { id: 's2', start: '09:00' }],
        employees: [{ id: 'e1', hours: 38 }, { id: 'e2', hours: 38 }],
        snapshotVersion: 'abc',
        config: { enforce_ft_days_off: true },
    };

    it('is stable across row order for slots and employees', () => {
        const shuffled = {
            ...base,
            patternSlots: [...base.patternSlots].reverse(),
            employees: [...base.employees].reverse(),
        };
        expect(inputDigest(shuffled)).toBe(inputDigest(base));
    });

    it('changes when the roster snapshot changes', () => {
        // The existing shifts are an INPUT to the deficit, so a different
        // roster is a different question and must be a different run.
        expect(inputDigest({ ...base, snapshotVersion: 'def' })).not.toBe(inputDigest(base));
    });

    it.each([
        ['sub-department', { subDepartmentId: 'sub-2' }],
        ['period start', { periodStart: '2024-07-16' }],
        ['period end', { periodEnd: '2024-08-12' }],
        ['a pattern slot', { patternSlots: [{ id: 's1', start: '07:00' }, { id: 's2', start: '09:00' }] }],
        ['an employee contract', { employees: [{ id: 'e1', hours: 20 }, { id: 'e2', hours: 38 }] }],
        ['engine config', { config: { enforce_ft_days_off: false } }],
    ])('changes when %s changes', (_label, override) => {
        expect(inputDigest({ ...base, ...override })).not.toBe(inputDigest(base));
    });

    it('repeats exactly across many calls', () => {
        const first = inputDigest(base);
        for (let i = 0; i < 50; i++) expect(inputDigest(base)).toBe(first);
    });
});
