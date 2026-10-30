import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRosterViewPrefetch } from '../useRosterViewPrefetch';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';

const mockInvoke = vi.fn();

vi.mock('@/platform/supabase/client', () => ({
    supabase: {
        functions: {
            invoke: (...args: any[]) => mockInvoke(...args),
        },
    },
}));

vi.mock('@/modules/rosters/api/shifts.queries', () => ({
    normalizeShiftRow: (row: any) => ({ ...row, normalized: true }),
}));

function createWrapper(queryClient: QueryClient) {
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
}

describe('useRosterViewPrefetch', () => {
    let queryClient: QueryClient;

    beforeEach(() => {
        vi.clearAllMocks();
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
            },
        });
    });

    it('seeds TanStack Query cache when shift payload is not truncated', async () => {
        const fakeShifts = [{ id: 's-1', title: 'Morning' }];
        const fakeEmployees = [{ id: 'e-1', name: 'Alice' }];

        mockInvoke.mockResolvedValueOnce({
            data: {
                shifts: fakeShifts,
                employees: fakeEmployees,
                roles: [],
                remuneration_levels: [],
                events: [],
                truncated: false,
            },
            error: null,
        });

        const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

        renderHook(
            () =>
                useRosterViewPrefetch({
                    orgId: 'org-1',
                    startDate: '2026-10-19',
                    endDate: '2026-10-25',
                    deptIds: ['dept-1'],
                    subDeptIds: ['sub-1'],
                }),
            { wrapper: createWrapper(queryClient) },
        );

        // Wait for query to resolve
        await vi.waitFor(() => {
            const shiftKey = shiftKeys.byDateRange('org-1', '2026-10-19', '2026-10-25', undefined);
            expect(setQueryDataSpy).toHaveBeenCalledWith(shiftKey, [
                expect.objectContaining({ id: 's-1', normalized: true }),
            ]);
        });
    });

    it('skips seeding shift cache when server indicates payload was truncated', async () => {
        const fakeShifts = [{ id: 's-1', title: 'Morning' }];
        const fakeEmployees = [{ id: 'e-1', name: 'Alice' }];

        mockInvoke.mockResolvedValueOnce({
            data: {
                shifts: fakeShifts,
                employees: fakeEmployees,
                roles: [],
                remuneration_levels: [],
                events: [],
                truncated: true,
            },
            error: null,
        });

        const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        renderHook(
            () =>
                useRosterViewPrefetch({
                    orgId: 'org-1',
                    startDate: '2026-10-19',
                    endDate: '2026-10-25',
                    deptIds: ['dept-1'],
                    subDeptIds: ['sub-1'],
                }),
            { wrapper: createWrapper(queryClient) },
        );

        // Wait for lookup cache seeding to happen
        await vi.waitFor(() => {
            const empKey = shiftKeys.lookups.employees('org-1', 'dept-1', 'sub-1', undefined, undefined, undefined);
            expect(setQueryDataSpy).toHaveBeenCalledWith(empKey, fakeEmployees);
        });

        // Ensure shiftKeys.byDateRange was NEVER seeded
        const shiftKey = shiftKeys.byDateRange('org-1', '2026-10-19', '2026-10-25', undefined);
        expect(setQueryDataSpy).not.toHaveBeenCalledWith(shiftKey, expect.anything());
        expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/truncated/i));

        warnSpy.mockRestore();
    });
});
