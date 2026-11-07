/**
 * A compliance check still in flight for bidder A must not land its result on
 * bidder B after the manager switches selection — and B's own check must run.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const { gate } = vi.hoisted(() => {
    let release: () => void = () => {};
    const promise = new Promise<void>((r) => { release = r; });
    return { gate: { promise, release: () => release() } };
});

vi.mock('@/platform/supabase/client', () => {
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'lte', 'in', 'order']) builder[m] = () => builder;
    builder.then = (resolve: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return { supabase: { from: () => builder, rpc: () => Promise.resolve({ data: [], error: null }) } };
});
vi.mock('@/modules/compliance/employee-context', () => ({
    fetchV8EmployeeContext: vi.fn(async (employeeId: string) => {
        if (employeeId === 'emp-A') await gate.promise;
        return {};
    }),
}));
vi.mock('@/modules/planning/unified/compliance/input-builder', () => ({ buildBidInput: () => ({}) }));
vi.mock('@/modules/compliance/v8', () => ({ runV8Orchestrator: () => ({ hits: [] }) }));
vi.mock('@/modules/rosters/services/compliance.service', () => ({ validateCompliance: async () => ({}) }));
vi.mock('@/modules/availability/api/availability.api', () => ({ getAvailabilitySlots: async () => [] }));
vi.mock('@/modules/rosters/api/fairnessLedger.queries', () => ({
    fairnessLedgerQueries: { getStandings: async () => [] },
}));

import { useBidsCompliancePanel } from '../index';

const shift = {
    id: 'shift-1', date: '2026-12-06', startTime: '09:00', endTime: '17:30', unpaidBreak: 30,
    bidCount: 2, organizationId: 'org-1', target_employment_type: 'Casual',
} as unknown as Parameters<typeof useBidsCompliancePanel>[1];
const bid = (employeeId: string) => ({ id: `bid-${employeeId}`, employeeId }) as unknown as Parameters<typeof useBidsCompliancePanel>[0];

describe('useBidsCompliancePanel — selection race', () => {
    it("drops bidder A's late result once B is selected, and still runs B's check", async () => {
        const { result, rerender } = renderHook(
            ({ selected }) => useBidsCompliancePanel(selected, shift, vi.fn() as never),
            { initialProps: { selected: bid('emp-A') } },
        );

        let runA: Promise<void> = Promise.resolve();
        act(() => { runA = result.current.run(); });
        await waitFor(() => expect(result.current.status).toBe('running'));

        rerender({ selected: bid('emp-B') });
        await waitFor(() => expect(result.current.status).toBe('idle'));

        await act(async () => { await result.current.run(); });
        expect(result.current.status).toBe('results');
        const bResult = result.current.result;

        await act(async () => { gate.release(); await runA; });
        expect(result.current.status).toBe('results');
        expect(result.current.result).toBe(bResult);
    });
});
