/**
 * Where full-time shifts are created, and the one rule that holds per day.
 *
 * Full-time shifts live in the roster's Office group (handover 2026-10-04, D2):
 * the Add Shift form offers 'FT' there and starts there as FT, and offers only
 * part-time and casual everywhere else.
 *
 * Until 2026-10-04 they could only come from the Office page, enforced by a
 * trigger that checked `creation_source`. That checked a label, not the shift;
 * it was dropped in 20261004170000. The protections that matter are the form's
 * V8 ordinary-hours rule (declared cycle, blocking at the ceiling) and one
 * full-time shift per person per day (cl 39.1) — `trg_shift_ft_one_per_day` in
 * the database, mirrored in the form so it shows before Save.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    CREATABLE_TARGET_EMPLOYMENT_TYPES,
    FULL_TIME_GROUP_TYPE,
    TARGET_EMPLOYMENT_TYPES,
    initialTargetEmploymentType,
    targetEmploymentTypeOptions,
} from '@/modules/core/model/employment.types';
import { runHardValidation } from '@/modules/compliance';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const stripComments = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SHEET = 'src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/components/ShiftFormSheet.tsx';
const DRAWER = 'src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/components/ShiftFormDrawerContent.tsx';

describe('the target picker', () => {
    it('offers part-time and casual outside the Office group', () => {
        expect([...CREATABLE_TARGET_EMPLOYMENT_TYPES]).toEqual(['PT', 'Casual']);
        expect(targetEmploymentTypeOptions(undefined)).toEqual(['PT', 'Casual']);
        expect(targetEmploymentTypeOptions('Casual')).toEqual(['PT', 'Casual']);
    });

    it('offers every type in the Office group', () => {
        expect(FULL_TIME_GROUP_TYPE).toBe('office');
        expect(targetEmploymentTypeOptions(undefined, { allowFullTime: true }))
            .toEqual(TARGET_EMPLOYMENT_TYPES);
        expect(targetEmploymentTypeOptions('PT', { allowFullTime: true })).toContain('FT');
    });

    it('keeps an existing full-time shift renderable anywhere', () => {
        // Without the current value in the list, a Radix Select falls back to
        // its placeholder — so the field reads as unset and the next save
        // silently changes the shift's type.
        expect(targetEmploymentTypeOptions('FT')).toEqual(['FT', 'PT', 'Casual']);
    });

    it.each([['mobile sheet', SHEET], ['desktop drawer', DRAWER]])(
        'the %s picker allows full-time exactly when the group is Office',
        (_label, path) => {
            // Both variants render the picker, so a change to one and not the
            // other leaves the two devices disagreeing.
            const src = stripComments(read(path));
            expect(src).toMatch(
                /targetEmploymentTypeOptions\(field\.value,\s*\{\s*allowFullTime:\s*watchGroup === FULL_TIME_GROUP_TYPE,?\s*\}\)/);
            expect(src).not.toMatch(/options=\{TARGET_EMPLOYMENT_TYPES\.map/);
        },
    );
});

describe('the target a new shift starts with', () => {
    it('is FT in the Office group', () => {
        expect(initialTargetEmploymentType(undefined, 'office')).toBe('FT');
    });

    it('is undecided anywhere else — the planner must choose', () => {
        expect(initialTargetEmploymentType(undefined, 'convention_centre')).toBeUndefined();
        expect(initialTargetEmploymentType(undefined, undefined)).toBeUndefined();
    });

    it('is whatever the caller decided, if it decided', () => {
        expect(initialTargetEmploymentType('PT', 'office')).toBe('PT');
        expect(initialTargetEmploymentType('FT', 'theatre')).toBe('FT');
    });
});

describe('one full-time shift per person per day (cl 39.1)', () => {
    const base = {
        shift_date: '2099-03-10',
        start_time: '18:00',
        end_time: '22:00',
        employee_id: 'emp-1',
        current_time: new Date('2099-03-01T09:00:00'),
        existing_shifts: [
            { shift_id: 'morning', shift_date: '2099-03-10', start_time: '08:00', end_time: '12:00' },
        ],
    };
    const rules = (r: ReturnType<typeof runHardValidation>) => r.errors.map(e => e.rule);

    it('refuses a second shift on an FT day, even with no overlap', () => {
        expect(rules(runHardValidation({ ...base, target_employment_type: 'FT' })))
            .toEqual(['FT_ONE_SHIFT_PER_DAY']);
    });

    it('does not apply to part-time or casual — split shifts are theirs', () => {
        expect(rules(runHardValidation({ ...base, target_employment_type: 'PT' }))).toEqual([]);
        expect(rules(runHardValidation({ ...base, target_employment_type: 'Casual' }))).toEqual([]);
    });

    it('does not count the shift being edited against itself', () => {
        expect(rules(runHardValidation({
            ...base, target_employment_type: 'FT', shift_id: 'morning',
        }))).toEqual([]);
    });

    it('says nothing extra when the shifts already overlap', () => {
        expect(rules(runHardValidation({
            ...base, start_time: '10:00', target_employment_type: 'FT',
        }))).toEqual(['NO_OVERLAP']);
    });

    it('allows the first shift of the day', () => {
        expect(rules(runHardValidation({
            ...base, shift_date: '2099-03-11', target_employment_type: 'FT',
        }))).toEqual([]);
    });
});

describe('editing and cloning on the roster', () => {
    const ORCH = 'src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/hooks/useShiftFormOrchestrator.ts';

    it('the save gate refuses to empty a full-time shift before anything is written', () => {
        // The edit save writes the field edit BEFORE the unassign op, so a
        // database refusal (FT_NO_UNASSIGN) would leave it half-saved.
        const src = stripComments(read(ORCH));
        const gate = src.slice(src.indexOf('const saveGate = useMemo'), src.indexOf('const canSave = saveGate.ok'));
        expect(gate).toMatch(/editMode && savedTarget === 'FT' && prevAssignee && !watchEmployeeId/);
    });

    it('Clone carries the target, which every shift must have', () => {
        // Without it sm_create_shift's row fails fn_shift_inherit_template_row
        // with "target_employment_type is required" — every clone, every type.
        const src = stripComments(read('src/modules/rosters/ui/modes/GroupModeView.tsx'));
        const clone = src.slice(src.indexOf('const handleCloneShift'), src.indexOf('createShiftMutation.mutateAsync(cloneData)'));
        expect(clone).toMatch(/target_employment_type:\s*\(rawShift as any\)\.target_employment_type/);
        expect(clone).not.toMatch(/assigned_employee_id:/);
    });
});

describe('templates cannot seed a full-time shift', () => {
    it('the template editor does not fall back to FT', () => {
        // `template_shifts` refuses full-time rows outright
        // (trg_no_ft_template_shifts), so a dropped type defaulting to 'FT'
        // would make the save fail with a bare 400.
        const src = read('src/modules/templates/ui/components/TemplateEditor.tsx');
        expect(src).not.toMatch(/editShift\?\.targetEmploymentType \|\| 'FT'/);
        expect(src).toMatch(/editShift\?\.targetEmploymentType \|\| 'Casual'/);
    });
});
