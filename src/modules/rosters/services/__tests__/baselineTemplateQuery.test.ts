import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * `fetchBaselineShifts` had two bugs that both read downstream as "this
 * template contributes no baseline demand" rather than as a failure.
 *
 *   1. It filtered `template_shifts` by `template_id`. That column does not
 *      exist — the hierarchy is
 *      template_shifts.subgroup_id -> template_subgroups.group_id ->
 *      template_groups.template_id. PostgREST rejects a filter on an unknown
 *      column, and the caller swallowed the error with `return []`.
 *
 *   2. It matched `day_of_week` by equality, which excludes NULL. NULL means
 *      "every day" — exactly how apply_template_to_date_range_v2 reads it —
 *      and ALL 22 rows in the production library are NULL. Verified against
 *      production: the corrected join returns 16 shifts for the sample
 *      template and the old equality filter returned 0, so fixing only the
 *      join would still have yielded nothing.
 *
 * Both were dormant because no template carries `is_base_template`. The first
 * row to set that flag would have silently contributed no demand at all.
 *
 * This reads the source rather than mocking the client, because what must not
 * regress is the SHAPE of the query — which column it filters and whether the
 * day filter admits NULL. A mocked chainable builder would assert the same
 * two facts through far more indirection. Same technique as
 * `solver-threshold-parity` and `db-backstop-parity`.
 */

const SERVICE = 'src/modules/rosters/services/demandTensorBuilder.service.ts';
const src = readFileSync(SERVICE, 'utf8');

/**
 * The `fetchBaselineShifts` body with COMMENTS STRIPPED, so assertions cannot
 * match other queries — or, as the first draft of this file did, the very
 * comment explaining the bug. That function documents the old
 * `.eq('day_of_week', ...)` by name, and a naive source match found it and
 * reported the fix as un-applied.
 */
function baselineFn(): string {
    const start = src.indexOf('async function fetchBaselineShifts');
    expect(start, 'fetchBaselineShifts is gone — has it been renamed?').toBeGreaterThan(-1);
    const end = src.indexOf('\nasync function', start + 1);
    return src
        .slice(start, end === -1 ? undefined : end)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
}

describe('the baseline template query', () => {
    it('never filters template_shifts by a template_id column', () => {
        // `template_shifts` has no such column. Regressing this returns an
        // error the caller turns into an empty array.
        expect(baselineFn()).not.toMatch(/from\('template_shifts'\)[\s\S]*?eq\('template_id'/);
    });

    it('reaches template_shifts through the subgroup hierarchy', () => {
        const fn = baselineFn();
        expect(fn).toContain("from('template_groups')");
        expect(fn).toContain("from('template_subgroups')");
        expect(fn).toMatch(/in\('subgroup_id'/);
    });

    it('treats a NULL day_of_week as every day, not no day', () => {
        // The RPC stamps a shift when `day_of_week IS NULL OR day_of_week = dow`.
        // Baseline demand has to read it the same way or it under-counts every
        // template in the library.
        const fn = baselineFn();
        expect(fn).toMatch(/day_of_week\.is\.null/);
        expect(fn).not.toMatch(/\.eq\('day_of_week'/);
    });

    it('says something when the fetch fails instead of returning empty in silence', () => {
        // The original `if (sError) return []` is what made both bugs invisible.
        expect(baselineFn()).toMatch(/if \(sError\) \{[\s\S]*?console\.warn/);
    });
});
