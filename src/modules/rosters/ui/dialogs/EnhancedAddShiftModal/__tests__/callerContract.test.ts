/**
 * What the Add Shift modal does with what its caller declares — creation
 * source, locked fields, a pre-filled target.
 *
 * Moved from the retired Office page's cell-editor tests (2026-10-04). The
 * Office page was the first caller to lock fields; the modal's side of that
 * contract still stands for any caller.
 *
 * Source-reading, because the alternative is mounting a 1300-line wizard with a
 * dozen providers to assert two props. Comments are stripped first — a previous
 * source-reading test in this repo passed against the comment describing the
 * bug it was meant to catch.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function sourceWithoutComments(relativePath: string): string {
    return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
}

const ORCHESTRATOR =
    'src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/hooks/useShiftFormOrchestrator.ts';

describe('the modal honours what the caller declares', () => {
    const orchestrator = sourceWithoutComments(ORCHESTRATOR);

    it('prefers the caller’s creation source over its own default', () => {
        // Order matters: the default must be the FALLBACK, not the winner.
        expect(orchestrator).toMatch(
            /creation_source:\s*context\?\.creationSource\s*\?\?\s*\(isTemplateMode/);
    });

    it('folds lockedFields into each lock rather than replacing it', () => {
        // The existing locks are each gated on a `mode`; dropping that gating
        // would change the Roster Planner's behaviour, which this must not.
        for (const lock of ['isGroupLocked', 'isSubGroupLocked', 'isRoleLocked', 'isEmployeeLocked']) {
            const line = orchestrator.split('\n').find(l => l.includes(`const ${lock} =`));
            expect(line, `${lock} exists`).toBeTruthy();
            expect(line, `${lock} consults isLockedField`).toMatch(/isLockedField\(/);
        }
        // …and the mode-gated conditions survive alongside it.
        expect(orchestrator).toMatch(/safeContext\.mode === 'group'/);
        expect(orchestrator).toMatch(/safeContext\.mode === 'people'/);
    });

    it('defaults to locking nothing, so other surfaces are unaffected', () => {
        expect(orchestrator).toMatch(/new Set<string>\(lockedFields \?\? \[\]\)/);
    });
});

describe('Role & Context is locked in BOTH renderings of the modal', () => {
    // The orchestrator computed `isTargetTypeLocked` and index.tsx passed it to
    // the desktop wizard, which never destructured it — so the mobile sheet
    // locked Employment target and the desktop wizard offered a live picker.
    const DRAWER = 'src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/components/ShiftFormDrawerContent.tsx';
    const SHEET = 'src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/components/ShiftFormSheet.tsx';

    for (const [name, path] of [['desktop wizard', DRAWER], ['mobile sheet', SHEET]] as const) {
        it(`the ${name} disables Employment target when it is locked`, () => {
            const src = sourceWithoutComments(path);
            const at = src.indexOf('name="target_employment_type"');
            expect(at, 'target field exists').toBeGreaterThan(-1);
            // The field's own disabled prop, within its render block.
            const block = src.slice(at, at + 2500);
            expect(block).toMatch(/disabled=\{isReadOnly \|\| isTargetTypeLocked\}/);
        });
    }
});

describe('compliance is waived only for an unassigned shift', () => {
    const orchestrator = sourceWithoutComments(ORCHESTRATOR);

    it('the save gate waives compliance ONLY when nobody is assigned', () => {
        expect(orchestrator).toMatch(/if \(!watchEmployeeId\) return \{ ok: true, reason: null \};\s*if \(compliancePanel\.status !== 'results'\)/);
        expect(orchestrator).toMatch(/if \(!compliancePanel\.canProceed\)/);
    });
});

describe('Role & Context arrives FILLED, not just locked', () => {
    // A lock over an empty value renders the fallback "General" and leaves the
    // wizard's Role step invalid, so Next never enabled. Locked fields must be
    // supplied by the caller — the modal has nowhere else to get them.
    const orchestrator = sourceWithoutComments(ORCHESTRATOR);

    it('the modal seeds a new shift’s target from the context, not a hard-coded undefined', () => {
        // Through `initialTargetEmploymentType`, which honours the caller's
        // choice first (and starts the Office group as FT when there is none).
        expect(orchestrator).toMatch(/target_employment_type:\s*defaultTargetFor\(context\)/);
        expect(orchestrator).toMatch(/initialTargetEmploymentType\(\s*ctx\?\.targetEmploymentType/);
        expect(orchestrator).not.toMatch(/target_employment_type:\s*undefined,/);
    });

    it('an existing row with no target falls back to the context', () => {
        expect(orchestrator).toMatch(
            /existingShift\.targetEmploymentType\s*\?\?\s*safeContext\.targetEmploymentType/);
    });
});
