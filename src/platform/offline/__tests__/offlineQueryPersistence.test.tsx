import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { isOfflineQuery, startOfflinePersistence } from '../offlineQueryPersistence';

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock('@/platform/auth/useAuth', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('idb-keyval', () => ({ createStore: vi.fn(), get: vi.fn(), set: vi.fn(), del: vi.fn(async () => {}) }));

import { OfflineCacheGate } from '../OfflineCacheGate';

const ROSTER_A = ['shifts', 'list', 'byEmployee', 'user-a', '2026-10-27', '2026-11-02'];

/** Persistence subscribes only after its restore resolves. */
const afterRestore = () => new Promise((resolve) => setTimeout(resolve, 0));

function memoryPersister(): Persister & { saved: () => PersistedClient | undefined } {
  let saved: PersistedClient | undefined;
  return {
    persistClient: async (client) => { saved = client; },
    restoreClient: async () => saved,
    removeClient: async () => { saved = undefined; },
    saved: () => saved,
  };
}

describe('isOfflineQuery', () => {
  it("keeps only the signed-in user's own views", () => {
    expect(isOfflineQuery(ROSTER_A, 'user-a')).toBe(true);
    // A manager validating someone else's roster uses the same key family.
    expect(isOfflineQuery(['shifts', 'list', 'byEmployee', 'user-b', 'x', 'y'], 'user-a')).toBe(false);
    expect(isOfflineQuery(['broadcasts', 'notifications', 'forUser', 'user-a'], 'user-a')).toBe(true);
    expect(isOfflineQuery(['broadcasts', 'messages', 'byChannel', 'c1', 'employee', 'user-a', 1], 'user-a')).toBe(true);
    // The manager channel view (no 'employee' segment) is not saved.
    expect(isOfflineQuery(['broadcasts', 'messages', 'byChannel', 'c1', {}, 1], 'user-a')).toBe(false);
    expect(isOfflineQuery(['shifts', 'summary', 'org'], 'user-a')).toBe(false);
  });
});

describe('startOfflinePersistence', () => {
  it("saves only the user's own roster and never restores it for another user", async () => {
    const persister = memoryPersister();
    const clientA = new QueryClient();
    const stopA = startOfflinePersistence(clientA, 'user-a', persister);
    await afterRestore();
    clientA.setQueryData(ROSTER_A, [{ id: 's1' }]);
    clientA.setQueryData(['shifts', 'list', 'byEmployee', 'user-b', 'x', 'y'], [{ id: 'not-mine' }]);
    await vi.waitFor(() => expect(persister.saved()?.clientState.queries).toHaveLength(1));
    expect(persister.saved()?.clientState.queries[0].queryKey).toEqual(ROSTER_A);
    stopA();

    const clientB = new QueryClient();
    startOfflinePersistence(clientB, 'user-b', persister);
    await vi.waitFor(() => expect(persister.saved()).toBeUndefined());
    expect(clientB.getQueryData(ROSTER_A)).toBeUndefined();
  });

  it("restores the same user's roster with a gcTime that outlives the 10-minute default", async () => {
    const persister = memoryPersister();
    const first = new QueryClient();
    const stop = startOfflinePersistence(first, 'user-a', persister);
    await afterRestore();
    first.setQueryData(ROSTER_A, [{ id: 's1' }]);
    await vi.waitFor(() => expect(persister.saved()).toBeDefined());
    stop();

    const next = new QueryClient();
    startOfflinePersistence(next, 'user-a', persister);
    await vi.waitFor(() => expect(next.getQueryData(ROSTER_A)).toEqual([{ id: 's1' }]));
    expect(next.getQueryCache().find({ queryKey: ROSTER_A })?.options.gcTime).toBe(24 * 60 * 60 * 1000);
  });
});

describe('OfflineCacheGate', () => {
  it("drops the previous user's in-memory data when the user changes", () => {
    const client = new QueryClient();
    const tree = () => (
      <QueryClientProvider client={client}><OfflineCacheGate /></QueryClientProvider>
    );
    auth.user = { id: 'user-a' };
    const { rerender } = render(tree());
    client.setQueryData(ROSTER_A, [{ id: 's1' }]);

    auth.user = null;
    rerender(tree());

    expect(client.getQueryData(ROSTER_A)).toBeUndefined();
  });
});
