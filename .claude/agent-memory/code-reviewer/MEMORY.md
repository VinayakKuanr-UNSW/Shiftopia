# Code Reviewer Agent Memory

## Broadcasts Module — Audit Findings Summary (2026-03-25)

See `broadcasts-audit.md` for full report.

### Key Architectural Facts
- `useBroadcasts.ts` contains 5 independent exported hooks (not a god hook per se, but one file)
- `BroadcastsManagerScreen` and `MyBroadcastsScreen` are the true orchestrators — pages are thin routers
- Layout wrappers (Desktop/Tablet/Mobile) are pure pass-through — they only set the `layout` prop
- `useBreakpoint` is duplicated verbatim in both page files instead of living in a shared hook
- `BroadcastAnalytics` bypasses the service layer and calls `BroadcastDbClient` directly (two API clients in play)
- `BroadcastNotification` type has `subject` + `authorName` but `BroadcastNotificationsList.view.tsx` renders `notification.title` and `notification.message` — these fields do not exist on the type (runtime blank render)
- `useEmployeeBroadcasts` has an eslint-disable comment suppressing a legitimate missing-deps warning on its initial-load effect
- Scope filtering is done client-side in `MyBroadcastsScreen` but server-side in `BroadcastsManagerScreen` (inconsistent)
- `BroadcastAnalytics` uses hardcoded fallback data on error (fake numbers shown to users)
- `any` type used for `editingGroup` state and several handler arguments in the manager screen
- `OrgDeptSelector` is imported from `@/modules/core/...` in `MyBroadcastsScreen` but never rendered
- `BroadcastDbClient` is a legacy class in `src/platform/supabase/client.ts` that wraps MockStorage — still used by `BroadcastAnalytics` and `EmployeeSelector`; the modern path is `broadcastGroupService` etc. in `broadcasts.api.ts`
- `useBroadcastAcknowledgements` is exported from `index.ts` (line 11) but the hook body was deleted — importing it will throw at runtime
- `GroupMembers` component uses `(member as any).employee?.name || (member as any).user?.name` — dual-path cast signals unresolved schema migration
- Role/permission checks (`canBroadcast`, `canManage`) are computed client-side in `useBroadcastGroup`; there is no RLS or server-side guard enforcing them
- `subscribeToAcknowledgements` in `broadcastRealtimeService` has no corresponding consumer or cleanup call anywhere in the module
- The `@ts-ignore` + double `as any` cast on `groupParticipantService.updateRole` hides a genuine TypeScript schema type mismatch

### Stable Patterns in this Codebase
- Feature modules live at `src/modules/<feature>/`
- State hooks in `state/`, API in `api/`, UI in `ui/screens|views|components|pages|dialogs|layout`
- Auth via `useAuth()` from `@/platform/auth/useAuth`
- Toast via `useToast()` from `@/modules/core/hooks/use-toast`
