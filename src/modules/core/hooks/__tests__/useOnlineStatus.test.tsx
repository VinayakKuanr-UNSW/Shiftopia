import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useOnlineStatus } from '../useOnlineStatus';

describe('useOnlineStatus hook', () => {
  const originalNavigator = window.navigator;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when navigator.onLine is true', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it('responds to online and offline window events', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { result } = renderHook(() => useOnlineStatus());

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });

  it('re-verifies connectivity on offline event and probes network', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    
    // Mock fetch to succeed (simulating online despite navigator.onLine false)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    let hookResult: { current: boolean } | undefined;
    await act(async () => {
      const { result } = renderHook(() => useOnlineStatus());
      hookResult = result;
    });

    expect(fetchSpy).toHaveBeenCalled();
    expect(hookResult?.current).toBe(true);
  });

  it('sets online to false when probe fails', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    
    // Mock fetch to fail (simulating true offline)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'));

    let hookResult: { current: boolean } | undefined;
    await act(async () => {
      const { result } = renderHook(() => useOnlineStatus());
      hookResult = result;
    });

    expect(hookResult?.current).toBe(false);
  });
});
