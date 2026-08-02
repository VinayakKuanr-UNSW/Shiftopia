/**
 * Regression test for the 2026-07-21 audit finding H2: the Gross Pay page
 * must default to pricing only APPROVED timesheets, not draft/unworked
 * shifts. `useGrossPay.ts` previously hard-coded `approvedOnly: false`
 * ("preview / estimate" mode per the read-adapter's own JSDoc) as the ONLY
 * mode the live page ever used — contradicting the module's stated "priced
 * from APPROVED ACTUAL worked hours" contract. The fix defaults the option to
 * `true` and lets a caller (the page's "Preview Unapproved" toggle) opt out.
 *
 * `getPeriodGrossPay` is mocked so this stays a pure wiring test — it asserts
 * WHAT OPTION THE HOOK PASSES DOWNSTREAM, not the read adapter's own
 * filtering logic (covered separately in read-adapter.test.ts).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getPeriodGrossPayMock = vi.fn().mockResolvedValue([]);
vi.mock('../data/grossPay.read.api', () => ({
  getPeriodGrossPay: (...args: unknown[]) => getPeriodGrossPayMock(...args),
}));

import { useGrossPay } from '../state/useGrossPay';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const BOUNDS = { periodStart: '2026-07-06', periodEnd: '2026-07-12' };

describe('useGrossPay — approvedOnly default (AUDIT H2)', () => {
  beforeEach(() => {
    getPeriodGrossPayMock.mockClear();
  });

  it('defaults to approvedOnly: true when no option is supplied', async () => {
    const { result } = renderHook(() => useGrossPay({ bounds: BOUNDS }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getPeriodGrossPayMock).toHaveBeenCalledTimes(1);
    const [, opts] = getPeriodGrossPayMock.mock.calls[0];
    expect(opts).toEqual({ approvedOnly: true });
  });

  it('respects an explicit approvedOnly: false (the "Preview Unapproved" toggle)', async () => {
    const { result } = renderHook(
      () => useGrossPay({ bounds: BOUNDS, options: { approvedOnly: false } }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [, opts] = getPeriodGrossPayMock.mock.calls[0];
    expect(opts).toEqual({ approvedOnly: false });
  });

  it('respects an explicit approvedOnly: true (same as the default, but caller-supplied)', async () => {
    const { result } = renderHook(
      () => useGrossPay({ bounds: BOUNDS, options: { approvedOnly: true } }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [, opts] = getPeriodGrossPayMock.mock.calls[0];
    expect(opts).toEqual({ approvedOnly: true });
  });
});
