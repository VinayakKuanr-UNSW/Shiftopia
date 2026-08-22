import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The job the availability page is showing — and whether the person may
 * actually declare for it.
 *
 * The sub-department now comes from the shared global scope control, the same
 * one every other page uses. That control builds its options from Type X
 * CERTIFICATES — what you may SEE. Declaring availability is governed by
 * CONTRACTS: `trg_availability_scope_is_contracted` refuses a declaration for a
 * sub-department you hold no active contract in, and in production the two
 * disagree — three contract scopes have no matching certificate.
 *
 * So the filter proposes and this checks. Without the check the page would
 * render a calendar, the save would be rejected by a trigger, and the employee
 * would read the failure in Postgres's words.
 *
 * `isContracted` deliberately distinguishes THREE states, not two:
 * nothing chosen yet, chosen and contracted, chosen and not. Folding the first
 * into the third flashes "you have no contract here" at everyone on first paint.
 */

const h = vi.hoisted(() => ({
    scopes: [] as Array<Record<string, unknown>>,
    isError: false,
    calls: [] as string[],
}));

vi.mock('../../api/contract-basis.api', () => ({
    fetchAvailabilityScopes: (id: string) => {
        h.calls.push(id);
        return Promise.resolve({ scopes: h.scopes, isError: h.isError });
    },
}));

const { useAvailabilityScope } = await import('../useAvailabilityScope');

const SETUP = '50000000-0000-0000-0000-000000000002';
const FOH = '50000000-0000-0000-0000-000000000003';
const SECURITY = '50000000-0000-0000-0000-000000000001';

const scope = (id: string, name: string, over: Record<string, unknown> = {}) => ({
    subDepartmentId: id,
    subDepartmentName: name,
    departmentId: 'dept-1',
    departmentName: 'Event Delivery',
    roleIds: ['role-a'],
    canDeclare: true,
    isFullTime: false,
    contractType: 'CASUAL',
    availabilityMode: 'OPT_IN',
    ...over,
});

function wrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return React.createElement(QueryClientProvider, { client }, children);
}

const render = (userId: string | null, selected: string | null) =>
    renderHook(() => useAvailabilityScope(userId, selected), { wrapper });

beforeEach(() => {
    h.calls = [];
    h.isError = false;
    h.scopes = [
        scope(SETUP, 'Set-up'),
        scope(FOH, 'Front of House'),
        // Full-Time in Security: OPT_OUT follows from the contract type, so the
        // fixture has to carry both or it describes a shape the API never emits.
        scope(SECURITY, 'Security', {
            canDeclare: false, isFullTime: true, contractType: 'FT',
            availabilityMode: 'OPT_OUT',
        }),
    ];
});

describe('useAvailabilityScope', () => {
    it('resolves the selected sub-department to the job held there', async () => {
        const { result } = render('emp-1', SETUP);
        await waitFor(() => expect(result.current.selected).not.toBeNull());
        expect(result.current.selected!.subDepartmentName).toBe('Set-up');
        expect(result.current.isContracted).toBe(true);
    });

    // The whole reason this hook survived the switch to the global filter.
    it('reports a selection the person holds no contract in', async () => {
        const { result } = render('emp-1', 'subdept-they-can-see-but-not-work');
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.selected).toBeNull();
        expect(result.current.isContracted).toBe(false);
    });

    // Third state: nothing chosen is not the same as chosen-and-wrong.
    it('does not call an unmade choice uncontracted', async () => {
        const { result } = render('emp-1', null);
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.selected).toBeNull();
        expect(result.current.isContracted).toBe(true);
    });

    it('carries the per-job basis through, not a person-wide one', async () => {
        const { result } = render('emp-1', SECURITY);
        await waitFor(() => expect(result.current.selected).not.toBeNull());
        expect(result.current.selected!.isFullTime).toBe(true);
        expect(result.current.selected!.canDeclare).toBe(false);
        expect(result.current.selected!.availabilityMode).toBe('OPT_OUT');
    });

    it('follows the selection when the filter changes it', async () => {
        const { result, rerender } = renderHook(
            ({ id }: { id: string }) => useAvailabilityScope('emp-1', id),
            { wrapper, initialProps: { id: SETUP } },
        );
        await waitFor(() => expect(result.current.selected?.subDepartmentName).toBe('Set-up'));
        rerender({ id: FOH });
        await waitFor(() => expect(result.current.selected?.subDepartmentName).toBe('Front of House'));
    });

    it('does not query without a user', async () => {
        const { result } = render(null, SETUP);
        await waitFor(() => expect(result.current.scopes).toEqual([]));
        expect(h.calls).toEqual([]);
    });

    // A failed contracts read must not be reported as "no contract here" —
    // that would tell someone their job does not exist because a fetch blipped.
    it('surfaces a read failure as isError, not as an empty scope list verdict', async () => {
        h.isError = true;
        h.scopes = [];
        const { result } = render('emp-1', SETUP);
        await waitFor(() => expect(result.current.isError).toBe(true));
    });
});
