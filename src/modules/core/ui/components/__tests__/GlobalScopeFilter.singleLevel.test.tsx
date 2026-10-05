import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GlobalScopeFilter } from '../GlobalScopeFilter';

/**
 * `singleSelectLevels` — constraining ONE level without changing the others.
 *
 * `multiSelect` is a single flag for all three levels, which is right for the
 * pages that use the scope filter to narrow a list. It is wrong wherever a
 * level names a thing rather than narrowing a view: My Availabilities declares
 * availability FOR a sub-department, and "these three sub-departments" is not a
 * job anyone can declare for.
 *
 * The alternative was passing `multiSelect={false}`, which would also have made
 * Venue and Department single on that page — a different control from the one
 * every other page shows, which is exactly what was asked not to happen.
 *
 * The regression risk here is wide: this component is on Timesheets, Insights,
 * Roster Planner, Broadcasts, Attendance, Bids and Swaps. The default-off test
 * below is the one that guards them.
 */

const TREE = {
    organizations: [
        {
            id: 'org-1',
            name: 'ICC Sydney',
            departments: [
                {
                    id: 'dept-1',
                    name: 'Event Delivery',
                    subdepartments: [
                        { id: 'sub-1', name: 'Set-up' },
                        { id: 'sub-2', name: 'Front of House' },
                        { id: 'sub-3', name: 'Security' },
                    ],
                },
                // A SECOND department, deliberately. With only one, a
                // "dept collapsed to a single choice" assertion passes whether
                // the code collapses it or not — the mutation run proved it:
                // that test survived the flags being ignored entirely.
                {
                    id: 'dept-2',
                    name: 'Building Services',
                    subdepartments: [
                        { id: 'sub-4', name: 'Cleaning' },
                    ],
                },
            ],
        },
    ],
};

const LOCKS = { orgLocked: false, deptLocked: false, subDeptLocked: false };

function renderFilter(props: Record<string, unknown> = {}) {
    const onScopeChange = vi.fn();
    render(
        <GlobalScopeFilter
            allowedScopeTree={TREE as any}
            lockConfig={LOCKS}
            onScopeChange={onScopeChange}
            mode="personal"
            {...props}
        />,
    );
    return onScopeChange;
}

/** The most recent scope the filter emitted. */
const latest = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.length ? spy.mock.calls[spy.mock.calls.length - 1][0] : null;

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe('GlobalScopeFilter — singleSelectLevels', () => {
    it('collapses the named level to one selection while the rest stay multi', async () => {
        const onScopeChange = renderFilter({ singleSelectLevels: ['subdept'] });

        await waitFor(() => expect(latest(onScopeChange)).not.toBeNull());
        const scope = latest(onScopeChange);

        // Sub-department is the identity here, so exactly one.
        expect(scope.subdept_ids).toHaveLength(1);
        // …and the levels above it are untouched: all of them, as everywhere else.
        expect(scope.org_ids).toEqual(['org-1']);
        expect(scope.dept_ids).toEqual(['dept-1', 'dept-2']);
    });

    // The guard for the seven other pages that render this component.
    it('leaves every level multi-select when the prop is omitted', async () => {
        const onScopeChange = renderFilter();

        await waitFor(() => expect(latest(onScopeChange)).not.toBeNull());
        const scope = latest(onScopeChange);

        expect(scope.subdept_ids).toHaveLength(4);
        expect(scope.dept_ids).toEqual(['dept-1', 'dept-2']);
    });

    it('still honours multiSelect={false} for every level', async () => {
        const onScopeChange = renderFilter({ multiSelect: false });

        await waitFor(() => expect(latest(onScopeChange)).not.toBeNull());
        expect(latest(onScopeChange).subdept_ids).toHaveLength(1);
    });

    it('constrains only the levels named', async () => {
        const onScopeChange = renderFilter({ singleSelectLevels: ['dept'] });

        await waitFor(() => expect(latest(onScopeChange)).not.toBeNull());
        const scope = latest(onScopeChange);

        expect(scope.dept_ids).toHaveLength(1);
        // Sub-department was NOT named, so it keeps the default behaviour —
        // every sub-department of the one department now selected.
        expect(scope.subdept_ids).toHaveLength(3);
    });

    // Picking a second sub-department must REPLACE the first, not add to it —
    // otherwise the page reads `subdept_ids[0]` and silently shows the old job.
    it('replaces the selection rather than adding to it', async () => {
        const onScopeChange = renderFilter({ singleSelectLevels: ['subdept'] });
        await waitFor(() => expect(latest(onScopeChange)).not.toBeNull());

        const trigger = screen.getAllByText(/Sub-Department/i)[0];
        fireEvent.click(trigger);

        const option = await screen.findByText('Front of House');
        fireEvent.click(option);

        await waitFor(() => {
            expect(latest(onScopeChange).subdept_ids).toEqual(['sub-2']);
        });
    });
});
