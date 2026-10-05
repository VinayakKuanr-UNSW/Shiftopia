/**
 * The template weekday, and the encoding boundary either side of it.
 *
 * `template_shifts.day_of_week` is stored SUNDAY-FIRST (0 = Sunday … 6 =
 * Saturday), matching JavaScript's `getDay()`. The Office domain speaks
 * ISO (1 = Monday … 7 = Sunday) because every work-cycle boundary is anchored
 * to a Monday. Two encodings for one fact is exactly the shape of an off-by-one
 * that survives review, so the correspondence is pinned here rather than left
 * to a comment.
 *
 * Also pinned: `null` is the "every day" wildcard and must remain a legal,
 * reachable value. It is what `apply_template_to_date_range_v2` reads as "stamp
 * on every date in the range", so removing it would silently change what
 * existing templates do.
 */
import { describe, expect, it } from 'vitest';
import { formSchema } from '../types';
import { TEMPLATE_WEEKDAYS } from '../components/TemplateDaySelect';

/**
 * Stored weekday (0 = Sunday) to ISO weekday (7 = Sunday).
 *
 * The one reader that performed this conversion lived in the Office
 * loader, which has been removed. The column still stores 0–6 while the
 * compliance layer still reasons in ISO 1–7, so the mismatch outlived that
 * caller and this stays as the pin on which convention the column holds.
 */
const toIso = (stored: number): number => (stored === 0 ? 7 : stored);

describe('template weekday encoding', () => {
    it('covers all seven days exactly once, Sunday as 0', () => {
        const values = TEMPLATE_WEEKDAYS.map(d => d.value).sort((a, b) => a - b);
        expect(values).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(TEMPLATE_WEEKDAYS.find(d => d.value === 0)?.label).toBe('Sunday');
        expect(TEMPLATE_WEEKDAYS.find(d => d.value === 1)?.label).toBe('Monday');
    });

    it('presents Monday first, because the roster week starts there', () => {
        expect(TEMPLATE_WEEKDAYS[0].label).toBe('Monday');
        expect(TEMPLATE_WEEKDAYS[TEMPLATE_WEEKDAYS.length - 1].label).toBe('Sunday');
    });

    it('converts to ISO without collision — the boundary Office depends on', () => {
        const iso = TEMPLATE_WEEKDAYS.map(d => toIso(d.value));
        expect(new Set(iso).size).toBe(7);
        expect(iso.every(v => v >= 1 && v <= 7)).toBe(true);
    });

    it.each(TEMPLATE_WEEKDAYS.map(d => [d.label, d.value] as const))(
        '%s maps stored %i to the right ISO day',
        (label, stored) => {
            const EXPECTED_ISO: Record<string, number> = {
                Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4,
                Friday: 5, Saturday: 6, Sunday: 7,
            };
            expect(toIso(stored)).toBe(EXPECTED_ISO[label]);
        },
    );

    it('agrees with JavaScript getDay() on a known date', () => {
        // 2024-01-01 is the shared cycle anchor and a Monday.
        const anchor = new Date('2024-01-01T00:00:00Z');
        expect(anchor.getUTCDay()).toBe(1);
        expect(TEMPLATE_WEEKDAYS.find(d => d.value === anchor.getUTCDay())?.label).toBe('Monday');
        expect(toIso(anchor.getUTCDay())).toBe(1);

        // A Sunday, the case the 0/7 conversion exists for.
        const sunday = new Date('2024-01-07T00:00:00Z');
        expect(sunday.getUTCDay()).toBe(0);
        expect(TEMPLATE_WEEKDAYS.find(d => d.value === sunday.getUTCDay())?.label).toBe('Sunday');
        expect(toIso(sunday.getUTCDay())).toBe(7);
    });
});

describe('formSchema.day_of_week', () => {
    const base = {
        group_type: 'g', sub_group_name: 's', role_id: 'r',
        start_time: '08:00', end_time: '16:06',
        timezone: 'Australia/Sydney',
        target_employment_type: 'FT' as const,
    };

    it('accepts every stored weekday', () => {
        for (const d of TEMPLATE_WEEKDAYS) {
            expect(formSchema.safeParse({ ...base, day_of_week: d.value }).success).toBe(true);
        }
    });

    it('accepts null — the "every day" wildcard stays reachable', () => {
        expect(formSchema.safeParse({ ...base, day_of_week: null }).success).toBe(true);
    });

    it('accepts undefined, which is "not chosen yet" and the save gate blocks', () => {
        // The two are different states: undefined means the author has not
        // answered, null means they answered "every day".
        expect(formSchema.safeParse({ ...base, day_of_week: undefined }).success).toBe(true);
        expect(formSchema.safeParse(base).success).toBe(true);
    });

    it('rejects a day outside 0–6', () => {
        expect(formSchema.safeParse({ ...base, day_of_week: 7 }).success).toBe(false);
        expect(formSchema.safeParse({ ...base, day_of_week: -1 }).success).toBe(false);
        expect(formSchema.safeParse({ ...base, day_of_week: 1.5 }).success).toBe(false);
    });
});
