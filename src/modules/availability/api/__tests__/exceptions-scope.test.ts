import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `listAvailabilityExceptions` — whose exceptions, and for WHICH job.
 *
 * The exceptions panel is the subtractive half of the availability page, and it
 * sits underneath the same job picker as the additive half. Before scoping it
 * read every exception the profile held, so the employee who is Casual in both
 * Set-up and Front of House saw their Front of House entries listed under
 * Set-up — and since the rows carry no visible job label, the only way to tell
 * was to delete one and watch it not disappear from the other tab.
 *
 * The filter is deliberately a WIDENING one. An exception with a NULL
 * sub-department applies to every job the person holds, so it must appear under
 * each of them: it genuinely does subtract from Set-up, and hiding it would
 * show a calendar that disagrees with what the solver will do.
 *
 * The unscoped call must stay exactly as it was — every caller that has not
 * resolved a job still depends on the person-wide answer.
 */

const h = vi.hoisted(() => {
    const state = {
        rows: [] as Array<Record<string, unknown>>,
        /** Every `.or()` filter string the query was built with. */
        orFilters: [] as string[],
        eqFilters: [] as Array<[string, unknown]>,
        error: null as unknown,
    };

    /** Minimal PostgREST builder: thenable, and records what was asked for. */
    const makeQuery = () => {
        const q: any = {
            select: () => q,
            eq: (col: string, val: unknown) => { state.eqFilters.push([col, val]); return q; },
            or: (f: string) => { state.orFilters.push(f); return q; },
            order: () => q,
            then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve(
                    state.error
                        ? { data: null, error: state.error }
                        : { data: state.rows, error: null },
                ).then(resolve),
        };
        return q;
    };

    return { state, from: () => makeQuery() };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: { from: h.from } }));
// Neither is exercised by the read path; stubbed so the module graph resolves
// without dragging the auth session in.
vi.mock('../contract-basis.api', () => ({ fetchScopedContractBasis: vi.fn() }));
vi.mock('../availability.service', () => ({
    FT_AVAILABILITY_ERROR: 'ft',
    resolveProfileId: vi.fn(),
}));

const { listAvailabilityExceptions } = await import('../exceptions.api');

const SETUP = '50000000-0000-0000-0000-000000000002';
const FOH = '50000000-0000-0000-0000-000000000003';

const row = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    profile_id: 'emp-1',
    exception_date: '2026-09-01',
    start_time: '09:00:00',
    end_time: '17:00:00',
    severity: 'SOFT',
    reason: null,
    sub_department_id: SETUP,
    created_at: '2026-08-21T00:00:00Z',
    ...over,
});

beforeEach(() => {
    h.state.rows = [row()];
    h.state.orFilters = [];
    h.state.eqFilters = [];
    h.state.error = null;
});

describe('listAvailabilityExceptions', () => {
    it('filters to the job when one is given', async () => {
        await listAvailabilityExceptions('emp-1', SETUP);
        expect(h.state.orFilters).toEqual([
            `sub_department_id.eq.${SETUP},sub_department_id.is.null`,
        ]);
    });

    // The NULL half of that `.or()` is the whole point — an exception that
    // applies to every job must not vanish when a job is selected.
    it('keeps the unscoped rows in the filter, not just the matching ones', async () => {
        await listAvailabilityExceptions('emp-1', FOH);
        expect(h.state.orFilters[0]).toContain('sub_department_id.is.null');
    });

    // The regression guard. This is what the panel did for every caller before
    // scoping, and what it must keep doing when no job is resolved.
    it('applies NO scope filter when the job is omitted', async () => {
        await listAvailabilityExceptions('emp-1');
        expect(h.state.orFilters).toEqual([]);
    });

    it('applies no scope filter for an explicit null', async () => {
        await listAvailabilityExceptions('emp-1', null);
        expect(h.state.orFilters).toEqual([]);
    });

    it('still constrains to the profile in every case', async () => {
        await listAvailabilityExceptions('emp-1', SETUP);
        expect(h.state.eqFilters).toEqual([['profile_id', 'emp-1']]);
    });

    it('carries the row scope onto the mapped exception', async () => {
        h.state.rows = [row({ sub_department_id: null })];
        const [ex] = await listAvailabilityExceptions('emp-1', SETUP);
        expect(ex.subDepartmentId).toBeNull();
        expect(ex.startTime).toBe('09:00');
    });

    it('throws rather than reporting an empty list when the read fails', async () => {
        h.state.error = { message: 'boom' };
        await expect(listAvailabilityExceptions('emp-1', SETUP)).rejects.toBeTruthy();
    });
});
