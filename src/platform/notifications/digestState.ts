export type NotificationDigestState = {
  count: number;
  deliverAt: number;
};

const DIGEST_STORAGE_PREFIX = 'shiftopia.notificationDigest';

export function createNextDigestState(
  previous: NotificationDigestState | null,
  now: number,
  cooldownMinutes: number,
): NotificationDigestState {
  const active = previous && previous.deliverAt > now ? previous : null;
  return {
    count: (active?.count ?? 0) + 1,
    deliverAt: active?.deliverAt ?? now + cooldownMinutes * 60_000,
  };
}

export function readNotificationDigestState(storageKey: string): NotificationDigestState | null {
  try {
    const value = localStorage.getItem(toStorageKey(storageKey));
    return value ? validateDigestState(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}

export function writeNotificationDigestState(storageKey: string, state: NotificationDigestState): void {
  try {
    localStorage.setItem(toStorageKey(storageKey), JSON.stringify(state));
  } catch {
    // A denied storage write should not block notification delivery.
  }
}

function validateDigestState(value: unknown): NotificationDigestState | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as NotificationDigestState;
  if (!Number.isFinite(candidate.count) || !Number.isFinite(candidate.deliverAt)) return null;
  return candidate;
}

function toStorageKey(storageKey: string): string {
  return `${DIGEST_STORAGE_PREFIX}.${storageKey}`;
}
