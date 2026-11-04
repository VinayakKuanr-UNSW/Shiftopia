/**
 * Moving a break without changing its length (12:00–12:30 → 15:00–15:30) keeps
 * the derived unpaid total equal, so an invalidation effect keyed on that total
 * kept the earlier compliance result — built from the old window — marked as
 * run, and the save gate (`!complianceHasRun`) let the shift through.
 *
 * The orchestrator has too many collaborators to render here, so this pins the
 * effect's dependency list, with comments stripped first — a source-reading test
 * in this repo once passed against the comment describing the bug.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(),
    'src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/hooks/useShiftFormOrchestrator.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('compliance invalidation', () => {
    it('re-runs when a break window moves, not only when the unpaid total changes', () => {
        const effect = src.match(/setComplianceHasRun\(false\);\s*compliancePanel\.markStale\(\);\s*\},\s*\[([\s\S]*?)\]\);/);
        expect(effect).not.toBeNull();
        expect(effect![1]).toMatch(/resolvedBreaks\.map\(b => \[b\.start, b\.end\]\)/);
    });
});
