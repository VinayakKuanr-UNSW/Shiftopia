/**
 * An employee who withdraws a bid must not reappear as an assignable bidder:
 * assigning a withdrawn bid fails server-side with WINNER_NOT_PENDING.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

const tables: Record<string, Array<Record<string, unknown>>> = {
    shift_bids: [
        { id: 'b1', shift_id: 's1', employee_id: 'e1', status: 'pending', created_at: '2026-10-27T01:00:00Z', profiles: { first_name: 'Ada', last_name: 'Lee' } },
        { id: 'b2', shift_id: 's1', employee_id: 'e2', status: 'withdrawn', created_at: '2026-10-27T00:00:00Z', profiles: { first_name: 'Ben', last_name: 'Ng' } },
    ],
};

// Minimal PostgREST-style builder: applies eq/neq so the test sees what the
// query would actually return, not which methods were called.
vi.mock('@/platform/supabase/client', () => {
    const from = (table: string) => {
        let rows = tables[table] ?? [];
        const builder: Record<string, unknown> = {
            select: () => builder,
            order: () => builder,
            in: () => builder,
            eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder; },
            neq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] !== val); return builder; },
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
        };
        return builder;
    };
    return { supabase: { from, rpc: () => Promise.resolve({ data: [], error: null }) } };
});

import { useShiftBids } from '../useShiftBids';

describe('useShiftBids', () => {
    it('leaves withdrawn bids out of the bidder list', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        );

        const { result } = renderHook(() => useShiftBids('s1'), { wrapper });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.bids.map((b) => b.employeeId)).toEqual(['e1']);
    });
});
