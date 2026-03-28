/**
 * Query Key Registry — Broadcasts module
 *
 * Three-level hierarchy for surgical TanStack Query cache invalidation:
 *
 *   broadcastKeys.groups.all              → nuclear option (all group queries)
 *   broadcastKeys.groups.forManager(scope)→ manager-scoped group list
 *   broadcastKeys.groups.forEmployee(scope)→ employee-scoped group list
 *   broadcastKeys.group.detail(groupId)   → single group with full details
 *   broadcastKeys.channels.byGroup(groupId)→ channels belonging to a group
 *   broadcastKeys.broadcasts.byChannel(channelId) → broadcasts in a channel
 *   broadcastKeys.notifications.all       → root for all notification queries
 *   broadcastKeys.notifications.forUser(userId) → notifications for one user
 *   broadcastKeys.analytics.all           → analytics / aggregated stats
 *
 * Invalidation strategy guide:
 *
 *   After CREATE / DELETE of a group:
 *     → invalidate broadcastKeys.groups.all
 *
 *   After UPDATE of a single group:
 *     → invalidate broadcastKeys.group.detail(groupId)
 *     → setQueriesData on broadcastKeys.groups.all for optimistic update
 *
 *   After CREATE / DELETE of a channel:
 *     → invalidate broadcastKeys.channels.byGroup(groupId)
 *     → invalidate broadcastKeys.group.detail(groupId) (channel list changes)
 *
 *   After CREATE / ARCHIVE of a broadcast:
 *     → invalidate broadcastKeys.broadcasts.byChannel(channelId)
 *     → invalidate broadcastKeys.analytics.all (counts change)
 *
 *   After a notification is read / all-read:
 *     → setQueriesData on broadcastKeys.notifications.forUser(userId) — no round-trip
 *     → invalidate broadcastKeys.notifications.forUser(userId) on settled
 */

// ── Scope filter shape (mirrors manager/employee filter params) ───────────────

export interface BroadcastScopeFilter {
  organizationId?: string;
  departmentId?: string;
  subDepartmentId?: string;
}

// ── Broadcast query keys ──────────────────────────────────────────────────────

export const broadcastKeys = {
  // ── groups — broadcast group lists ─────────────────────────────────────────

  groups: {
    // Level 0: root — invalidate ALL group queries (nuclear)
    all: ['broadcasts', 'groups'] as const,

    // Level 2: manager-scoped group list
    forManager: (scope?: BroadcastScopeFilter | null) =>
      [
        'broadcasts',
        'groups',
        'manager',
        scope?.organizationId ?? null,
        scope?.departmentId ?? null,
        scope?.subDepartmentId ?? null,
      ] as const,

    // Level 2: employee-scoped group list
    forEmployee: (scope?: BroadcastScopeFilter | null) =>
      [
        'broadcasts',
        'groups',
        'employee',
        scope?.organizationId ?? null,
        scope?.departmentId ?? null,
        scope?.subDepartmentId ?? null,
      ] as const,
  },

  // ── group — single group detail ─────────────────────────────────────────────

  group: {
    // Level 2: one group's full details (channels, participants, role)
    detail: (groupId: string) => ['broadcasts', 'group', 'detail', groupId] as const,
  },

  // ── channels — channels within a group ──────────────────────────────────────

  channels: {
    // Level 0: root — invalidate ALL channel queries
    all: ['broadcasts', 'channels'] as const,

    // Level 2: channels for a specific group
    byGroup: (groupId: string) =>
      ['broadcasts', 'channels', 'byGroup', groupId] as const,
  },

  // ── broadcasts — messages within a channel ──────────────────────────────────

  broadcasts: {
    // Level 0: root — invalidate ALL broadcast message queries
    all: ['broadcasts', 'messages'] as const,

    // Level 2: broadcasts in a specific channel
    byChannel: (channelId: string) =>
      ['broadcasts', 'messages', 'byChannel', channelId] as const,
  },

  // ── notifications — per-user notification inbox ─────────────────────────────

  notifications: {
    // Level 0: root — invalidate ALL notification queries
    all: ['broadcasts', 'notifications'] as const,

    // Level 2: notifications for a specific user
    forUser: (userId: string) =>
      ['broadcasts', 'notifications', 'forUser', userId] as const,
  },

  // ── analytics — aggregated stats ────────────────────────────────────────────

  analytics: {
    // Level 0: root — invalidate all analytics queries
    all: ['broadcasts', 'analytics'] as const,
  },
} as const;
