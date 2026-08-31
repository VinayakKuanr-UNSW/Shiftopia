/**
 * Full-time shifts come from Baseline FT, and nowhere else.
 *
 * A full-time employee's hours are capped over a DECLARED multi-week cycle
 * (ICC EBA cl 35.1(a)), so whether one more full-time shift is lawful depends
 * on everything else that cycle already holds. A single-shift form cannot ask
 * that, which is why adding them one at a time produced a production roster
 * carrying 160h against a 152h cap with nothing reporting a breach.
 *
 * THE DATABASE IS THE ENFORCEMENT, not this list — `enforce_ft_shifts_are_baseline_only()`
 * rejects any `shifts` row targeting FT whose `creation_source` is not
 * `'baseline_ft'`. It is a TRIGGER rather than a check inside `sm_create_shift`
 * because `apply_template_to_date_range_v2` inserts into `shifts` directly and
 * would otherwise walk straight past it.
 *
 * These tests pin the UI half: that no picker offers full-time, and that an
 * existing full-time shift still renders correctly when opened.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    CREATABLE_TARGET_EMPLOYMENT_TYPES,
    TARGET_EMPLOYMENT_TYPES,
    targetEmploymentTypeOptions,
} from '@/modules/core/model/employment.types';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

const SHEET = 'src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/components/ShiftFormSheet.tsx';
const DRAWER = 'src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/components/ShiftFormDrawerContent.tsx';

describe('the creatable set', () => {
    it('offers part-time and casual, never full-time', () => {
        expect([...CREATABLE_TARGET_EMPLOYMENT_TYPES]).toEqual(['PT', 'Casual']);
        expect(CREATABLE_TARGET_EMPLOYMENT_TYPES).not.toContain('FT');
    });

    it('does not narrow what the column ACCEPTS', () => {
        // The 41 full-time shifts already in production must still load, render
        // and validate. Only what a person may newly choose has changed.
        expect(TARGET_EMPLOYMENT_TYPES).toContain('FT');
    });
});

describe('targetEmploymentTypeOptions', () => {
    it('offers only the creatable set for a new shift', () => {
        expect(targetEmploymentTypeOptions(undefined)).toEqual(['PT', 'Casual']);
        expect(targetEmploymentTypeOptions(null)).toEqual(['PT', 'Casual']);
    });

    it('keeps an existing full-time shift renderable when it is opened', () => {
        // Without the current value in the list, a Radix Select falls back to
        // its placeholder — so the field reads as unset and the next save
        // silently changes the shift's type. Opening a shift to look at it must
        // not edit it.
        expect(targetEmploymentTypeOptions('FT')).toEqual(['FT', 'PT', 'Casual']);
    });

    it('does not duplicate a value that is already creatable', () => {
        expect(targetEmploymentTypeOptions('PT')).toEqual(['PT', 'Casual']);
        expect(targetEmploymentTypeOptions('Casual')).toEqual(['PT', 'Casual']);
    });
});

describe('neither Add Shift form offers full-time', () => {
    // Both variants exist and both render the picker, so a change to one and
    // not the other leaves full-time creatable on half the devices — which is
    // how the day-of-week selector was nearly shipped to desktop only.
    it.each([['mobile sheet', SHEET], ['desktop drawer', DRAWER]])(
        'the %s picker iterates the creatable set',
        (_label, path) => {
            const src = read(path);
            expect(src).toContain('targetEmploymentTypeOptions(field.value)');
            // The unrestricted list must not drive the options any more.
            expect(src).not.toMatch(/options=\{TARGET_EMPLOYMENT_TYPES\.map/);
            expect(src).not.toMatch(/\{TARGET_EMPLOYMENT_TYPES\.map\(\(t\) => \(\s*<SelectItem/);
        },
    );
});

describe('templates cannot seed a full-time shift', () => {
    it('the template editor no longer falls back to FT', () => {
        // `template_shifts` now refuses full-time rows outright, so a dropped
        // type defaulting to 'FT' would make the save fail with a bare 400.
        const src = read('src/modules/templates/ui/components/TemplateEditor.tsx');
        expect(src).not.toMatch(/editShift\?\.targetEmploymentType \|\| 'FT'/);
        expect(src).toMatch(/editShift\?\.targetEmploymentType \|\| 'Casual'/);
    });
});
