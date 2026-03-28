# Broadcasts Module — Full Audit (2026-03-25)

## Files Audited
- src/modules/broadcasts/state/useBroadcasts.ts
- src/modules/broadcasts/ui/pages/BroadcastsManager.page.tsx
- src/modules/broadcasts/ui/pages/MyBroadcastsPage.tsx
- src/modules/broadcasts/ui/screens/BroadcastsManagerScreen.tsx
- src/modules/broadcasts/ui/screens/MyBroadcastsScreen.tsx
- src/modules/broadcasts/ui/views/ControlRoom.view.tsx
- src/modules/broadcasts/ui/views/BroadcastGroups.view.tsx
- src/modules/broadcasts/ui/views/BroadcastNotificationsList.view.tsx
- src/modules/broadcasts/ui/views/BroadcastAnalytics.view.tsx
- src/modules/broadcasts/ui/views/ControlRoomChannels.tsx
- src/modules/broadcasts/ui/views/ControlRoomParticipants.tsx
- src/modules/broadcasts/model/broadcast.types.ts

## Critical Issues

### C1 — P0: BroadcastNotificationsList renders non-existent fields
- `notification.title` and `notification.message` (lines 107, 110)
- `BroadcastNotification` type has `subject` and no `message` or `title` field at all
- Result: silent blank renders in production. No TypeScript error because the component likely treats it as `any` at runtime after toCamelCase transformation ambiguity.

### C2 — P1: BroadcastAnalytics bypasses the service layer
- Imports `BroadcastDbClient` directly from `@/platform/supabase/client`
- The rest of the module uses `broadcastGroupService` etc. from `broadcasts.api.ts`
- Two separate database client abstractions are now coupled into one UI view
- Also uses `(group as any).is_admin`, `(broadcast as any).message` — unsafe casts against a different data shape

### C3 — P1: BroadcastAnalytics uses hardcoded fallback data on error
- On any fetch error, fake analytics numbers (totalGroups:2, totalBroadcasts:15, totalMembers:45) are set
- Managers will see fabricated metrics without any indication they are fake

### C4 — P1: useEmployeeBroadcasts — stale closure on page dependency + eslint-disable suppression
- `fetchBroadcasts` closes over `page` from state but the initial-load effect lists only `[channelId, user?.id]`
- An eslint-disable-next-line comment on line 679 silences the missing-deps warning instead of fixing it
- `loadMore` correctly increments page but `fetchBroadcasts(true)` uses `page + 1` computed from the stale closure value at call time, making rapid double-clicks potentially skip pages

### C5 — P1: Scope filtering strategy is inconsistent between manager and employee views
- `BroadcastsManagerScreen`: scope drives server-side filter params sent to `useBroadcastGroups({ organizationId, departmentId, subDepartmentId })`
- `MyBroadcastsScreen`: all groups are fetched from the server then `filteredGroups` is computed client-side with `useMemo`
- These two strategies diverge: manager gets accurate paginated server results; employee always downloads all groups and filters locally — not scalable

## Warnings

### W1 — P1: useBreakpoint duplicated verbatim in both page files
- Identical 20-line hook defined in `BroadcastsManager.page.tsx` and `MyBroadcastsPage.tsx`
- Should live in `src/modules/core/hooks/useBreakpoint.ts` or the broadcasts shared hooks

### W2 — P2: MyBroadcastsScreen is a 1053-line god component
- Contains: screen state, route decisions, 5 sub-component definitions (GroupCard, ChannelItem, MessageItem, EmptyGroups, EmptyMessages, EmptyChannels, ChannelView), 3 layout renderers, 1 inline hook call (`useEmployeeBroadcasts` inside `ChannelView`)
- Sub-components defined inside the file are re-created on every render of `MyBroadcastsScreen` unless React reconciler happens to keep them stable — but since they are new function references each render, any props change causes full unmount/remount of `GroupCard`, `ChannelView`, etc.

### W3 — P2: ChannelView calls useEmployeeBroadcasts internally — hidden data ownership
- `ChannelView` is defined inside `MyBroadcastsScreen.tsx` but owns its own data subscription
- Parent `MyBroadcastsScreen` cannot observe or cancel the ongoing fetch when the component switches channels
- When `selectedChannel` changes, the old `ChannelView` unmounts and the new one mounts, but the old realtime subscription (if any) depends on the unmount cleanup — this is fragile

### W4 — P2: useBroadcasts real-time subscription captures `fetchBroadcasts` as a stable reference but `fetchBroadcasts` itself depends on `filters` and `page`
- The subscription effect depends on `[channelId, fetchBroadcasts]`
- Every time `page` or `filters` changes, `fetchBroadcasts` gets a new reference, which triggers unsubscribe + resubscribe on every page turn and filter change
- This means every page navigation causes a websocket channel teardown and re-join

### W5 — P2: BroadcastsManagerScreen uses `any` for editingGroup state
- `const [editingGroup, setEditingGroup] = useState<any>(null)` (line 109)
- `handleCreateGroup` and the create dialog `onCreate` prop are also typed `any`
- Loses all type safety for the group editing flow

### W6 — P2: BroadcastNotificationsList duplicates unreadCount derivation
- `useBroadcastNotifications` already computes and returns `unreadCount`
- `BroadcastNotificationsList.view.tsx` re-derives it locally: `const unreadCount = notifications.filter(n => !n.isRead).length` (line 30)
- Two sources of truth for the same derived value; the local one ignores the hook's memoized value

### W7 — P2: BroadcastsManagerScreen double-renders BroadcastAnalytics on desktop
- `renderAnalyticsSection()` renders `<BroadcastAnalytics />` for mobile tab view
- The desktop layout also renders `<BroadcastAnalytics />` directly at line 271 (outside `renderAnalyticsSection`)
- Two separate instances of `BroadcastAnalytics` exist for desktop: the one in the px-8 block and the one that would render if `mobileTab === 'analytics'` (unreachable in desktop, but still instantiated via the render helper being defined)
- Actually on desktop: both `renderAnalyticsSection()` is defined (unused on desktop because `mobileTab` branch is not rendered) and an inline `<BroadcastAnalytics />` is rendered — so only one renders, but the code is confusing and fragile

### W8 — P2: BroadcastAnalytics has a console.log left in production path
- Line 38: `console.log('Fetching broadcast analytics...')` fires on every user?.id change

### W9 — P3: MyBroadcastsPage and BroadcastsManagerPage use `useState` for breakpoint with SSR guard but the guard uses `typeof window === 'undefined'` in the initializer
- This is correct for SSR hydration but the codebase appears to be CSR-only (Vite SPA), making the guard noise that could be removed

### W10 — P3: `scope` prop prop-drilling chain is 3 levels deep for manager path
- Route renders `BroadcastsManagerPage` -> passes `scope` to `BroadcastsManagerDesktopLayout` -> passes to `BroadcastsManagerScreen`
- The layout wrappers add zero value and exist only as an indirection layer
- The `useBreakpoint` detection could live in the screen itself, removing the page+layout layers entirely

### W11 — P3: ControlRoomChannels and ControlRoomParticipants both silently swallow errors
- `catch (err) { // Error handled in parent/hook }` with no actual error surface
- If `onCreateChannel` or `onDeleteChannel` throws, the dialog stays open with no feedback to the user

## Suggestions

### S1 — P2: Extract `useBreakpoint` to a shared hook
- File: `src/modules/core/hooks/useBreakpoint.ts`
- Both page files can then import it; eliminates the duplication

### S2 — P2: Split MyBroadcastsScreen sub-components into separate files
- `GroupCard`, `ChannelItem`, `MessageItem`, empty state components all belong in `ui/components/`
- `ChannelView` belongs in `ui/views/`
- This resolves the god-component pattern and eliminates re-definition on every render

### S3 — P2: Move scope filtering server-side for the employee view
- Align with the manager approach: pass scope params into `useEmployeeBroadcastGroups` and filter at the API call level

### S4 — P2: Fix the real-time subscription re-subscribe thrash
- Separate the subscription effect from the fetch-refresh effect
- The subscription should only depend on `[channelId]` and call a stable `refetch` reference (use `useRef` or `useCallback` with empty deps + manual channelId check inside)

### S5 — P1: Fix BroadcastNotificationsList field references
- `notification.title` should be `notification.subject`
- `notification.message` has no equivalent in the type — either add the field to `BroadcastNotification` or display `notification.subject` only

### S6 — P1: Remove hardcoded fallback data in BroadcastAnalytics
- Replace with a proper error state render; do not show fabricated numbers

### S7 — P2: Replace BroadcastAnalytics direct DB client usage with service layer
- Create `broadcastAnalyticsService.getManagerAnalytics(userId)` in `broadcasts.api.ts`
- Remove direct `BroadcastDbClient` import from the view

### S8 — P3: Collapse the page -> layout -> screen indirection
- Since layout wrappers are pure pass-throughs, `BroadcastsManagerPage` could call `BroadcastsManagerScreen` directly after detecting breakpoint via a shared hook
- Remove `BroadcastsManagerDesktopLayout`, `BroadcastsManagerTabletLayout`, `BroadcastsManagerMobileLayout` (same for My Broadcasts variants)
