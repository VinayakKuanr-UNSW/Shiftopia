export type LocalDemoNotification = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  entity_id: null;
  entity_type: 'demo';
  read_at: string | null;
  created_at: string;
  source: 'local-demo';
};

export type LocalDemoNotificationInput = Pick<
  LocalDemoNotification,
  'type' | 'title' | 'message' | 'link'
>;

type LocalDemoNotificationChange = {
  profileId: string;
  items: LocalDemoNotification[];
};

const STORAGE_PREFIX = 'shiftopia.demoNotifications';
const CHANGE_EVENT = 'shiftopia:demo-notifications-changed';
const MAX_DEMO_NOTIFICATIONS = 50;

export function createLocalDemoNotification(
  profileId: string,
  input: LocalDemoNotificationInput,
): LocalDemoNotification {
  const notification = toDemoNotification(input);
  saveLocalDemoNotifications(profileId, [notification, ...readLocalDemoNotifications(profileId)]);
  return notification;
}

export function readLocalDemoNotifications(profileId: string): LocalDemoNotification[] {
  try {
    const raw = localStorage.getItem(toStorageKey(profileId));
    return raw ? validateNotifications(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function markLocalDemoNotificationRead(profileId: string, id: string): LocalDemoNotification[] {
  return updateLocalDemoNotifications(profileId, (items) =>
    items.map((item) => (item.id === id ? { ...item, read_at: new Date().toISOString() } : item)),
  );
}

export function markAllLocalDemoNotificationsRead(profileId: string): LocalDemoNotification[] {
  const readAt = new Date().toISOString();
  return updateLocalDemoNotifications(profileId, (items) =>
    items.map((item) => (item.read_at ? item : { ...item, read_at: readAt })),
  );
}

export function dismissLocalDemoNotification(profileId: string, id: string): LocalDemoNotification[] {
  return updateLocalDemoNotifications(profileId, (items) => items.filter((item) => item.id !== id));
}

export function clearLocalDemoNotifications(profileId: string): void {
  saveLocalDemoNotifications(profileId, []);
}

export function isLocalDemoNotificationId(id: string): boolean {
  return id.startsWith('demo:');
}

export function subscribeToLocalDemoNotifications(
  profileId: string,
  onChange: (items: LocalDemoNotification[]) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<LocalDemoNotificationChange>).detail;
    if (detail?.profileId !== profileId) return;
    onChange(detail.items);
  };
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

function updateLocalDemoNotifications(
  profileId: string,
  update: (items: LocalDemoNotification[]) => LocalDemoNotification[],
): LocalDemoNotification[] {
  const items = update(readLocalDemoNotifications(profileId));
  saveLocalDemoNotifications(profileId, items);
  return items;
}

function saveLocalDemoNotifications(profileId: string, items: LocalDemoNotification[]): void {
  const limitedItems = items.slice(0, MAX_DEMO_NOTIFICATIONS);
  try {
    localStorage.setItem(toStorageKey(profileId), JSON.stringify(limitedItems));
  } catch {
    // The live in-app notification flow remains available if storage is denied.
  }
  window.dispatchEvent(
    new CustomEvent<LocalDemoNotificationChange>(CHANGE_EVENT, {
      detail: { profileId, items: limitedItems },
    }),
  );
}

function toDemoNotification(input: LocalDemoNotificationInput): LocalDemoNotification {
  return {
    id: `demo:${createLocalId()}`,
    ...input,
    entity_id: null,
    entity_type: 'demo',
    read_at: null,
    created_at: new Date().toISOString(),
    source: 'local-demo',
  };
}

function createLocalId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function validateNotifications(value: unknown): LocalDemoNotification[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isLocalDemoNotification);
}

function isLocalDemoNotification(value: unknown): value is LocalDemoNotification {
  if (!value || typeof value !== 'object') return false;
  const item = value as LocalDemoNotification;
  return isLocalDemoNotificationId(item.id) && typeof item.type === 'string' && typeof item.title === 'string';
}

function toStorageKey(profileId: string): string {
  return `${STORAGE_PREFIX}.${profileId}`;
}
