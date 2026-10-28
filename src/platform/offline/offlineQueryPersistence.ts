/**
 * Keeps the signed-in employee's own read-only views (My Roster, My
 * Broadcasts, notifications) in IndexedDB for up to 24h, so the app shows
 * them with no connection instead of an empty page. Concept from the
 * t19b-donut fork (1c2ff29c et al., Jianwei Gao), rewritten:
 *   - the whitelist matches OUR query keys, and only the user's own rows
 *     (a manager's lookup of another employee's roster is never saved);
 *   - the cache is tagged with the user id, so a different user on the same
 *     device can never restore it;
 *   - persisted queries keep a 24h gcTime, or they would be garbage-collected
 *     after 10 idle minutes and silently drop out of the next save.
 */
import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import { persistQueryClient, type PersistedClient, type Persister } from '@tanstack/react-query-persist-client';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

const OFFLINE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PERSIST_THROTTLE_MS = 1_000;
const CACHE_KEY = 'react-query';

const OFFLINE_KEY_PREFIXES: QueryKey[] = [
  ['shifts', 'list', 'byEmployee'],
  ['broadcasts', 'notifications', 'forUser'],
  ['broadcasts', 'groups', 'employee'],
  ['broadcasts', 'messages', 'byChannel'],
];

/** Whether a query belongs to `userId`'s own offline views. */
export function isOfflineQuery(key: QueryKey, userId: string): boolean {
  const [root, kind, scope, a, b, c] = key as readonly unknown[];
  if (root === 'shifts') return kind === 'list' && scope === 'byEmployee' && a === userId;
  if (root !== 'broadcasts') return false;
  if (kind === 'notifications') return scope === 'forUser' && a === userId;
  if (kind === 'groups') return scope === 'employee';
  if (kind === 'messages') return scope === 'byChannel' && b === 'employee' && c === userId;
  return false;
}

interface OfflinePersister extends Persister {
  /** Drops the saved cache and any write still waiting on the throttle. */
  clear: () => Promise<void>;
}

/** IndexedDB persister; writes are throttled because the cache changes often. */
function createIdbPersister(): OfflinePersister {
  // Opened lazily: creating the store touches indexedDB, absent in tests/SSR.
  let store: UseStore | undefined;
  const db = () => (store ??= createStore('shiftopia-offline', 'query-cache'));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PersistedClient | null = null;

  const cancelPending = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return {
    persistClient: (client) => {
      pending = client;
      if (timer) return;
      timer = setTimeout(() => {
        const next = pending;
        cancelPending();
        if (next) {
          set(CACHE_KEY, next, db()).catch((error) =>
            console.error('[offline] Failed to save the offline cache:', error));
        }
      }, PERSIST_THROTTLE_MS);
    },
    restoreClient: () => get<PersistedClient>(CACHE_KEY, db()),
    removeClient: () => del(CACHE_KEY, db()),
    clear: () => {
      cancelPending();
      return del(CACHE_KEY, db());
    },
  };
}

export const offlinePersister = createIdbPersister();

/** Starts saving `userId`'s offline views; returns the stop function. */
export function startOfflinePersistence(
  queryClient: QueryClient,
  userId: string,
  persister: Persister = offlinePersister,
): () => void {
  for (const prefix of OFFLINE_KEY_PREFIXES) {
    queryClient.setQueryDefaults(prefix, { gcTime: OFFLINE_CACHE_MAX_AGE_MS });
  }

  const [unsubscribe] = persistQueryClient({
    queryClient,
    persister,
    maxAge: OFFLINE_CACHE_MAX_AGE_MS,
    // A cache saved under another user's id is discarded on restore.
    buster: userId,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) =>
        query.state.status === 'success' && isOfflineQuery(query.queryKey, userId),
    },
  });
  return unsubscribe;
}
