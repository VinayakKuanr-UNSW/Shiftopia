import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

/**
 * `useSwaps` hangs FIVE read queries off one call. `ShiftDetailsDialog` is
 * mounted unconditionally by every My Roster calendar view (so Radix can animate
 * it open), and `CreateSwapRequestModal` calls the hook purely to get the
 * `createSwap` mutation — so simply opening My Roster fired all five, including
 * `pendingSwapApprovals`, which is a MANAGER query, for every employee.
 *
 * These count real queryFn invocations, so they fail if the gate is removed or
 * if a sixth query is added without one.
 */

const getMySwaps = vi.fn(async () => []);
const getAvailableSwaps = vi.fn(async () => []);
const fetchSwapRequests = vi.fn(async () => []);
const getMyActiveOfferDetails = vi.fn(async () => []);
const getMyActiveOffers = vi.fn(async () => []);

vi.mock('../../api/swaps.api', () => ({
  swapsApi: {
    getMySwaps: (...a: unknown[]) => getMySwaps(...(a as [])),
    getAvailableSwaps: (...a: unknown[]) => getAvailableSwaps(...(a as [])),
    fetchSwapRequests: (...a: unknown[]) => fetchSwapRequests(...(a as [])),
    getMyActiveOfferDetails: (...a: unknown[]) => getMyActiveOfferDetails(...(a as [])),
    getMyActiveOffers: (...a: unknown[]) => getMyActiveOffers(...(a as [])),
    createSwapRequest: vi.fn(),
  },
}));
vi.mock('@/modules/core/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/platform/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'emp-1' }, activeContract: { organizationId: 'org-1' } }),
}));
vi.mock('@/modules/core/contexts/OrgSelectionContext', () => ({
  useOrgSelection: () => ({ organizationId: 'org-1', departmentId: null, subDepartmentId: null }),
}));
vi.mock('@/platform/supabase/hooks/useRealtimeInvalidate', () => ({ useRealtimeInvalidate: () => {} }));

const { useSwaps } = await import('../useSwaps');

const allSpies = [getMySwaps, getAvailableSwaps, fetchSwapRequests, getMyActiveOfferDetails, getMyActiveOffers];
const totalCalls = () => allSpies.reduce((n, s) => n + s.mock.calls.length, 0);

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => allSpies.forEach((s) => s.mockClear()));

describe('useSwaps read-query gating', () => {
  it('fires NOTHING when disabled', async () => {
    renderHook(() => useSwaps(undefined, { enabled: false }), { wrapper });
    // Give react-query a chance to have fetched if it were going to.
    await new Promise((r) => setTimeout(r, 20));
    expect(totalCalls()).toBe(0);
  });

  it('still returns the mutations when disabled', () => {
    // `CreateSwapRequestModal` wants only `createSwap`; gating must not take it away.
    const { result } = renderHook(() => useSwaps(undefined, { enabled: false }), { wrapper });
    expect(typeof result.current.createSwap).toBe('function');
  });

  it('fires the reads when enabled, and defaults to enabled', async () => {
    const { unmount } = renderHook(() => useSwaps(), { wrapper });
    await waitFor(() => expect(getMySwaps).toHaveBeenCalled());
    unmount();

    // The manager-scoped one is part of the set an employee was paying for.
    expect(fetchSwapRequests).toHaveBeenCalled();
  });

  it('gates every read query, not just the first', async () => {
    renderHook(() => useSwaps(undefined, { enabled: false }), { wrapper });
    await new Promise((r) => setTimeout(r, 20));

    for (const spy of allSpies) {
      expect(spy, `${spy.getMockName() || 'query'} must be gated`).not.toHaveBeenCalled();
    }
  });
});
