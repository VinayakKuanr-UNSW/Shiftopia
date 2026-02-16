---
name: rosters-cache-audit
description: Best practices for Rosters module caching, state management, and avoiding race conditions. Based on the "Zero Stale UI" audit strategy.
license: Complete terms in LICENSE.txt
---

This skill outlines the architectural standards for the Rosters module to ensure a "Zero Stale UI" experience. It targets the elimination of race conditions, manual refresh patterns, and inconsistent state.

## Core Principles

1.  **Unified Query Keys**: All components MUST use centralized query key factories (e.g., `shiftKeys` in `useRosterShifts.ts`). Never hardcode string arrays like `['myShifts']`.
2.  **Await Invalidations**: All mutation `onSuccess` handlers MUST `await` their `queryClient.invalidateQueries` calls. This guarantees the cache is fresh before the UI updates.
3.  **Optimistic Updates**: For high-frequency actions (drag-and-drop, status toggles), use `onMutate` to update the cache immediately, with rollback on error.
4.  **No Manual Refetching**: Do not pass `refetch` functions down to children. Do not use `refreshKey` counters to force re-renders. Rely on React Query's subscription model.

## Anti-Patterns to Avoid

### 1. The `refreshKey` Prop
**Bad Pattern:** Passing a counter or boolean to force a component to re-render.
```tsx
// BAD
<Component key={refreshKey} />
```
**Correct Approach:**
Components should use `useQuery`. When mutations occur, invalidate the query key. React Query will automatically refetch and update all subscribed components.

### 2. Direct API Calls in UI Components
**Bad Pattern:** Calling service methods and manually invalidating queries in the view layer.
```tsx
// BAD
await shiftsApi.employeeDropShift(id);
queryClient.invalidateQueries(['myShifts']);
```
**Correct Approach:**
Encapsulate logic in a custom hook.
```tsx
// GOOD
const dropShift = useDropShift();
await dropShift.mutateAsync(id);
```

### 3. Imperative Data Fetching
**Bad Pattern:** Using `useEffect` to fetch data and store it in local `useState`.
```tsx
// BAD
useEffect(() => {
  service.getData().then(setData);
}, []);
```
**Correct Approach:**
Use `useQuery` for all data fetching. It handles caching, loading states, and deduplication automatically.

### 4. Direct Supabase Calls
**Bad Pattern:** Bypassing the API layer to call Supabase directly in components.
```tsx
// BAD
supabase.from('profiles').select('*')
```
**Correct Approach:**
Always go through the API layer (`api/shifts.api.ts`, etc.) and wrap in a `useQuery` hook.

## Specific Module Guidelines

### RosterFunctionBar
-   **Current State:** Uses complex `useEffect` chains for organization/department selection.
-   **Target State:** Should use `useOrganizations`, `useDepartments` hooks.
-   **Rule:** Do not add actionable logic (fetching) inside the render or effect cycle of this presentational component.

### GroupModeView & Grid Views
-   **Rule:** Grid components should allow passing `shift` data down from a parent `useShifts` query rather than fetching it themselves.
-   **Rule:** User profile data should be fetched via `useEmployees` or `useProfiles` hooks, never raw Supabase calls.

### SmartShiftCard
-   **Rule:** Pure presentation component. Should not fetch data. Should not mutate data directly. Events should be emitted via props (`onBid`, `onDrop`).

## Implementation Checklist for New Features

- [ ] Does this feature use an existing Query Key Factory?
- [ ] Does the mutation `await` its invalidation?
- [ ] Is `onMutate` implemented for immediate feedback (if applicable)?
- [ ] Are we avoiding `useEffect` for data fetching?
