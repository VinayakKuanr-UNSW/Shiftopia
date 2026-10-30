import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { GlobalScopeFilter } from '../GlobalScopeFilter';

/**
 * Two logic faults in the core filter, with no visual change:
 *  - a single-select filter kept EVERY saved organization when it started;
 *  - when the tree changed under it (permissions re-read after a contract edit
 *    on the Users page), an organization no longer reached stayed selected, and
 *    the emit guard then refused every selection, so the page froze.
 */

const org = (id: string, sub: string) => ({
    id, name: id,
    departments: [{ id: `${id}-d`, name: `${id}-d`, subdepartments: [{ id: sub, name: sub }] }],
});
const TWO = { organizations: [org('icc', 'bar'), org('other', 'cafe')] };
const ICC_ONLY = { organizations: [org('icc', 'bar')] };
const OTHER_ONLY = { organizations: [org('other', 'cafe')] };
const LOCKS = { orgLocked: false, deptLocked: false, subDeptLocked: false };

const latest = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.length ? spy.mock.calls[spy.mock.calls.length - 1][0] : null;

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe('GlobalScopeFilter — organizations follow the tree', () => {
    it('a single-select filter starts on one organization even when given several', async () => {
        const onScopeChange = vi.fn();
        render(
            <GlobalScopeFilter
                allowedScopeTree={TWO as any}
                lockConfig={LOCKS}
                defaultSelection={{ org_ids: ['icc', 'other'], dept_ids: ['icc-d', 'other-d'], subdept_ids: ['bar', 'cafe'] }}
                onScopeChange={onScopeChange}
                multiSelect={false}
            />,
        );
        await waitFor(() => expect(latest(onScopeChange)).not.toBeNull());
        expect(latest(onScopeChange).org_ids).toEqual(['icc']);
        expect(latest(onScopeChange).subdept_ids).toEqual(['bar']);
    });

    it('drops an organization the new tree no longer holds and emits again', async () => {
        const onScopeChange = vi.fn();
        const { rerender } = render(
            <GlobalScopeFilter allowedScopeTree={ICC_ONLY as any} lockConfig={LOCKS}
                onScopeChange={onScopeChange} multiSelect={false} />,
        );
        await waitFor(() => expect(latest(onScopeChange)?.org_ids).toEqual(['icc']));

        rerender(
            <GlobalScopeFilter allowedScopeTree={OTHER_ONLY as any} lockConfig={LOCKS}
                onScopeChange={onScopeChange} multiSelect={false} />,
        );
        await waitFor(() => expect(latest(onScopeChange)?.org_ids).toEqual(['other']));
        expect(latest(onScopeChange).subdept_ids).toEqual(['cafe']);
    });
});
