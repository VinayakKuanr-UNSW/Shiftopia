# Broadcasts Module — Enterprise Architecture Audit & Remediation Plan
**Date:** 2026-03-25
**Auditors:** 4 specialized agents (API layer, State management, UI components, Cross-cutting concerns)

---

## LIVE BUGS IN PRODUCTION (Fix before next deploy)

### BUG-1 — Notifications silently render blank
`BroadcastNotificationsList` renders `notification.title` and `notification.message`. Neither field exists. Type is `{ subject, authorName, ... }`. Every notification card shows blank title and body. Fix: `notification.title` → `notification.subject`, `notification.message` → `notification.authorName`.

### BUG-2 — Analytics dashboard shows fake data
`BroadcastAnalytics` uses `BroadcastDbClient` (legacy mock-backed client in `platform/`). It never hits the real `broadcasts` table. On any fetch error it falls back to hardcoded numbers (`totalGroups: 2, totalBroadcasts: 15, totalMembers: 45`). Managers see invented metrics with zero indication of failure.

### BUG-3 — Dead barrel export throws at runtime
`index.ts` exports `useBroadcastAcknowledgements` which was deleted. Any consumer gets `undefined` then `TypeError: useBroadcastAcknowledgements is not a function`. TypeScript does not catch it (named re-export of deleted symbol compiles silently).

---

## PHASE 1 — Hotfixes (1-2 days, no architecture change)

| # | File | Fix |
|---|------|-----|
| H1 | `BroadcastNotificationsList.view.tsx:107,110` | `notification.title` → `notification.subject`; `notification.message` → `notification.authorName` |
| H2 | `index.ts:11` | Remove `useBroadcastAcknowledgements` export |
| H3 | `BroadcastAnalytics.view.tsx:85-98` | Replace fake fallback with error state render + retry button |
| H4 | `BroadcastsManagerScreen.tsx:271` | Remove duplicate `<BroadcastAnalytics />` mount (use `renderAnalyticsSection` only) |
| H5 | `MyBroadcastsScreen.tsx:76` | Remove dead `OrgDeptSelector` import |
| H6 | `useBroadcasts.ts:462-481` | Remove `fetchBroadcasts` from realtime subscription deps → `[channelId]` only |
| H7 | `broadcasts.api.ts:882,889` | Fix `@ts-ignore` + double `as any` in `updateRole` by aligning enum types |
| H8 | `BroadcastAnalytics.view.tsx:38` | Remove `console.log('Fetching broadcast analytics...')` |

---

## PHASE 2 — Type Safety & Data Correctness (3-5 days)

### P2-1: Fix `BroadcastAnalytics` to use the real API client
Replace `BroadcastDbClient` import with `broadcastGroupService` + `broadcastService` from `broadcasts.api.ts`.
Extract `useBroadcastAnalytics()` hook in `state/` — makes it testable and prevents double-mount issue.

### P2-2: Fix `GroupMembers` type mismatch
Change prop type from `GroupParticipant` → `GroupParticipantWithDetails`.
Remove all `(member as any).employee?.name || (member as any).user?.name` dual-path hacks.

### P2-3: Eliminate `any` in critical paths
- `BroadcastsManagerScreen`: `editingGroup: any` → `BroadcastGroupWithStats | null`
- `ComposeSection`: `onSend: (data: any)` → `onSend: (data: Omit<CreateBroadcastRequest, 'channelId'>)`
- `ControlRoom.view.tsx`: `onValueChange: (v: any)` → typed tab value
- `GroupCard`: typed color/icon props
- `AddMemberDialog`: `catch (error: any)` → `catch (error: unknown)`

### P2-4: Fix `EmployeeSelector` to use correct API
Replace `BroadcastDbClient.fetchUsers()` with a proper query via `broadcasts.api.ts`.

### P2-5: Verify RLS enforcement
Audit Supabase RLS policies for `broadcasts`, `broadcast_channels`, `group_participants` tables.
`canBroadcast` / `canManage` are currently UI-only flags. If RLS is missing, any authenticated user can write to any table via direct API call.

---

## PHASE 3 — State Architecture (1 sprint)

### P3-1: Stabilize real-time subscription
Current: subscription torn down on every page/filter change (fetchBroadcasts in deps).
Fix: track page via `useRef`, pass stable `refetchRef` to subscription effect, deps = `[channelId]` only.

### P3-2: Align scope filtering strategy
Employee path fetches all groups and filters client-side (memory + data exposure risk).
Manager path correctly passes scope to server. Add `scope` params to `broadcastGroupService.getForEmployee()`.

### P3-3: Fix stale-closure pagination in `useEmployeeBroadcasts`
Remove `page` from `fetchBroadcasts` useCallback dep array. Track page via `useRef`.
Current `eslint-disable-next-line react-hooks/exhaustive-deps` is suppressing a legitimate warning.

### P3-4: Standardize mutation strategy
Three different patterns in play (optimistic, full refetch, local filter). Pick one and align:
- Optimistic update + rollback on error (preferred for UX)
- Or: full refetch (simpler, less fragile)
Do NOT mix without clear intent.

---

## PHASE 4 — Component Architecture (1 sprint)

### P4-1: Split `MyBroadcastsScreen` (1053 lines, god component)
Extract 7 inline sub-components to dedicated files:
- `GroupCard` → `ui/components/GroupCard.tsx` (file exists, reconcile)
- `ChannelView` → `ui/views/ChannelView.view.tsx`
- `MessageItem` → `ui/components/MessageItem.tsx`
- `EmptyGroups`, `EmptyMessages`, `EmptyChannels` → `ui/components/EmptyStates.tsx`

All constants (PRIORITY_CONFIG, GROUP_COLORS, etc.) → `ui/constants.ts`
All utilities (formatFileSize) → `ui/utils.ts`

### P4-2: Merge `CreateGroupDialog` + `EditGroupDialog`
~80% shared code. Extract `BroadcastGroupForm` base component.
`CreateGroupDialog` = `BroadcastGroupForm` + org hierarchy selector
`EditGroupDialog` = `BroadcastGroupForm` with pre-filled values

### P4-3: Fix `AddMemberDialog` dual hook call
Dialog calls `useBroadcastGroup(groupId)` internally, but its parent `ControlRoomParticipants` (inside `ControlRoom`) already called it. Double fetch on every dialog open.
Fix: pass `addParticipant` as a prop instead.

### P4-4: Consolidate responsive layout
Delete all 6 layout wrapper files (138 lines of pure pass-through boilerplate).
Extract `useBreakpoint()` to `src/modules/core/hooks/useBreakpoint.ts` (currently duplicated in both page files).
Pages call screen directly with computed layout prop.

### P4-5: Reclassify `ControlRoom` as a screen
Move `ControlRoom.view.tsx` → `ui/screens/ControlRoomScreen.tsx`.
Move `ControlRoomChannels.tsx` + `ControlRoomParticipants.tsx` → `ui/screens/ControlRoom/` subdirectory (private sub-components, not barrel-exported).

### P4-6: Fix `RichTextEditor` contentEditable + dangerouslySetInnerHTML conflict
Current: React re-renders replace contentEditable content on every keystroke → cursor jumps.
Fix: initialize with `useEffect` on mount only, let contentEditable manage its own DOM after that.

### P4-7: Move `EmployeeSelector` to core
`src/modules/broadcasts/ui/components/EmployeeSelector.tsx` → `src/modules/core/ui/components/EmployeeSelector.tsx`
Not broadcasts-specific; usable by rosters, users, planning modules.

---

## PHASE 5 — API Layer Modernization (1-2 sprints)

### P5-1: Add query key registry
Create `src/modules/broadcasts/api/queryKeys.ts` following the rosters pattern.
Enables surgical cache invalidation instead of full refetch on every mutation.

### P5-2: Migrate to TanStack Query
Module is the only major module not using TanStack Query.
Split hooks: `useBroadcastGroups` (query) + `useCreateGroup` (mutation) + etc.
Gives: automatic cache, stale-while-revalidate, deduplication, optimistic updates with rollback.

### P5-3: Eliminate N+1 queries in `getByChannelId` and `getForEmployee`
Current: 1 list query + 5 sub-queries per broadcast row = 101 requests for 20 broadcasts.
Fix: use Supabase relational selects (`select('*, profiles!author_id(*), broadcast_attachments(*)')`) matching the pattern in `shifts.queries.ts`.

### P5-4: Split `broadcasts.api.ts` (1124 lines, monolith)
Following rosters pattern:
- `broadcasts.queries.ts` — all read operations
- `broadcasts.commands.ts` — all mutations
- `broadcasts.dto.ts` — normalizer functions (move `toCamelCase`/`toSnakeCase` here)

### P5-5: Narrow barrel exports
Replace `export * from './api/broadcasts.api'` and `export * from './model/broadcast.types'` with explicit named exports.
Internal service objects (`broadcastGroupService`, etc.) should not be part of the public module API.

---

## PHASE 6 — Test Coverage (ongoing)

Zero test files exist in this module. Start with pure functions (no mocking needed):
1. `toCamelCase` / `toSnakeCase` helpers
2. `canBroadcast` / `canManage` derivation logic
3. Scope filter logic (extract from screen, test as pure function)
4. Analytics aggregation (once extracted to `useBroadcastAnalytics`)

---

## Issue Registry (full cross-agent consolidation)

### P0 — Fix before deploy
| ID | Issue | Location |
|----|-------|----------|
| P0-1 | Blank notification renders (wrong field names) | `BroadcastNotificationsList.view.tsx:107,110` |
| P0-2 | Dead export throws at runtime | `index.ts:11` |
| P0-3 | Analytics uses mock-backed legacy client | `BroadcastAnalytics.view.tsx:7-8` |
| P0-4 | Analytics shows fake numbers on error | `BroadcastAnalytics.view.tsx:85-98` |
| P0-5 | Permission checks are UI-only (no RLS verification) | `useBroadcasts.ts:292-298` |

### P1 — Fix this sprint
| ID | Issue | Location |
|----|-------|----------|
| P1-1 | No TanStack Query / query key infrastructure | Entire module |
| P1-2 | N+1 queries (101 requests for 20 broadcasts) | `broadcasts.api.ts:414-549` |
| P1-3 | God hooks (5 concerns per hook) | `useBroadcasts.ts` |
| P1-4 | `MyBroadcastsScreen` 1053 lines, 7 inline sub-components | `MyBroadcastsScreen.tsx` |
| P1-5 | Realtime subscription tears down on every page change | `useBroadcasts.ts:462-481` |
| P1-6 | Scope filter: server-side for manager, client-side for employee | `MyBroadcastsScreen.tsx:690-699` |
| P1-7 | `ControlRoom` is a screen, classified as a view | `ControlRoom.view.tsx` |
| P1-8 | `BroadcastAnalytics` mounted twice on desktop | `BroadcastsManagerScreen.tsx:271,287` |
| P1-9 | 6 layout wrappers are pure pass-throughs (138 lines boilerplate) | `layout/` |
| P1-10 | `useBreakpoint` duplicated in both page files | `BroadcastsManager.page.tsx`, `MyBroadcastsPage.tsx` |
| P1-11 | `formatFileSize` defined 3 times | `BroadcastItem`, `ComposeSection`, `MyBroadcastsScreen` |
| P1-12 | Constants scattered (PRIORITY_CONFIG ×2, ROLE_CONFIG ×2, etc.) | 6 files |
| P1-13 | `EmployeeSelector` uses wrong API client | `EmployeeSelector.tsx:8,34` |
| P1-14 | `RichTextEditor` contentEditable + dangerouslySetInnerHTML conflict | `RichTextEditor.tsx:114-118` |

### P2 — Fix next sprint
| ID | Issue | Location |
|----|-------|----------|
| P2-1 | `any` in 12+ files (types, handlers, callbacks) | Multiple |
| P2-2 | `GroupMembers` dual `(member as any)` path | `GroupMembers.tsx:65-85` |
| P2-3 | `CreateGroupDialog`/`EditGroupDialog` 80% duplicated | Both dialog files |
| P2-4 | `AddMemberDialog` duplicates `useBroadcastGroup` call | `AddMemberDialog.tsx:20` |
| P2-5 | Inconsistent mutation strategy (3 different patterns) | `useBroadcasts.ts` |
| P2-6 | `ControlRoomChannels`/`Participants` are loose, not private | `ui/views/` |
| P2-7 | Barrel star-exports internal API services + all types | `index.ts:57-58` |
| P2-8 | Stale closure + suppressed eslint in pagination | `useBroadcasts.ts:678-680` |
| P2-9 | `subscribeToAcknowledgements` dead infrastructure | `broadcasts.api.ts:1049-1066` |
| P2-10 | `EmployeeSelector` is broadcasts-specific, should be in core | `ui/components/EmployeeSelector.tsx` |
| P2-11 | `GroupCard` hardcodes `text-white` (blocks light mode) | `GroupCard.tsx:50-56` |
| P2-12 | `StatCard` uses fragile string manipulation for CSS classes | `StatCard.tsx:35` |
| P2-13 | Missing accessibility (ARIA labels, semantic HTML) | 6+ components |
| P2-14 | `OrgDeptSelector` imported but never used | `MyBroadcastsScreen.tsx:76` |

### P3 — Backlog
| ID | Issue |
|----|-------|
| P3-1 | Zero test files in module |
| P3-2 | `constants.tsx` should be `.ts` |
| P3-3 | `BroadcastAnalytics` should be hook + pure view |
| P3-4 | Barrel export surface too wide |
| P3-5 | Hardcoded pagination constant (20) inline |
| P3-6 | `handleSendBroadcast` is an `any`-typed trivial pass-through |
| P3-7 | Commented-out code blocks left in `BroadcastItem` |

---

## Estimated Effort

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1 (Hotfixes) | 8 targeted line changes | 0.5–1 day |
| Phase 2 (Type safety + data) | 6 targeted fixes | 2–3 days |
| Phase 3 (State architecture) | 4 hook-level changes | 3–4 days |
| Phase 4 (Component architecture) | 7 component restructures | 1 sprint |
| Phase 5 (API modernization) | Query keys + TanStack + N+1 | 1–2 sprints |
| Phase 6 (Tests) | First coverage layer | Ongoing |

**Overall module health before remediation: ~55/100**
**Target after Phase 1–3: ~75/100**
**Target after Phase 4–5: ~90/100**
