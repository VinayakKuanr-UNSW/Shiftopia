# Employee / Employer Persona Toggle — Implementation Plan

**Status:** DRAFT — not implemented, decisions open in §9
**Scope:** `GoldStandardHeader` / `PersonalPageHeader`, `AppSidebar`, `BottomNavbar`, `AppRouter`, `MobileAccessGuard`, `routePrefetch`
**Goal:** collapse seven employee/employer page pairs behind one in-header toggle, and reclaim the sidebar space that the duplication currently consumes.

---

## 1. The pairs, as they actually exist today

| # | Employee side | Employer side | Employer gate | Mobile OK? |
|---|---|---|---|---|
| 1 | `/my-roster` → `MyRosterPage` | `/rosters` → `RostersPlannerPage` | `rosters` (gamma+) | employee ✅ · employer ❌ **desktop-only** |
| 2 | `/my-availabilities` → `AvailabilityPage` | `/team-availability` → **to be built**, see [team-availability-page-plan.md](./team-availability-page-plan.md) | `management` (gamma+) | ✅ / ❌ **desktop-only in v1** |
| 3 | `/my-attendance` → `AttendancePage` | `/timesheet` → `TimesheetPage` | `timesheet-view` (**beta+**) | ✅ / ✅ |
| 4 | `/my-bids` → `EmployeeBids.page` | `/management/bids` → `ManagerBids.page` | `management` (gamma+) | ✅ / ✅ |
| 5 | `/my-swaps` → `EmployeeSwaps.page` | `/management/swaps` → `ManagerSwaps.page` | `management` (gamma+) | ✅ / ✅ |
| 6 | `/my-leave` → `LeavePage` | `/management/leave` → `LeavePage tab="approvals"` | `management` (gamma+) | ❌ **bug** / ❌ |
| 7 | `/my-broadcasts` → `MyBroadcastsPage` | `/broadcast` → `BroadcastsManager.page` | `broadcast` (gamma+) | ✅ / ✅ |

Three facts from the audit that shape everything below:

- **Pair 3 has a different gate from the rest.** `timesheet-view` is beta+, everything else employer-side is gamma+. So a beta user (team lead) will see the toggle on exactly *one* page. The toggle must be per-pair conditional, not a global on/off.
- **Pair 6 is broken on mobile right now.** `/my-leave` is in [`BottomNavbar.middleItems`](../../src/modules/core/ui/layout/BottomNavbar.tsx#L122) but **not** in [`ALLOWED_MOBILE_ROUTES`](../../src/modules/core/ui/components/MobileAccessGuard.tsx#L20-L43). Tapping "Leave" on a phone today shows the *Desktop Required* screen. `/management/leave` is missing too. This is pre-existing, and the toggle work forces the fix.
- **Pair 1's employer side does not use `GoldStandardHeader`.** [`RostersPlannerPage`](../../src/modules/rosters/pages/RostersPlannerPage.tsx#L1113) inlines `PersonalPageHeader` + `RosterFunctionBar` inside its own hand-rolled glass card.

### The load-bearing consequence of that last point

Put the toggle in **`PersonalPageHeader`**, not `GoldStandardHeader`.

`PersonalPageHeader` is the Row-1/Row-2 renderer that `GoldStandardHeader` wraps *and* that `RostersPlannerPage` calls directly. One edit there covers all 18 `GoldStandardHeader` pages **and** the Roster Planner, with zero migration of the 1511-line planner page. If we put it in `GoldStandardHeader`, pair 1 — the most important pair — is the one that misses out.

---

## 2. Core model: the toggle is navigation, not state

**Do not merge the page components.** `EmployeeSwaps.page` is 2009 lines and `ManagerSwaps.page` is 1294; a merged component would be a 3000-line conditional. Pair 6 already proves the *other* pattern works — `LeavePage` serves both routes via a `tab` prop — but that only works because leave is genuinely one dataset.

So: **URL stays the source of truth. Toggling calls `navigate(counterpartPath)`.**

This preserves, for free:
- deep links, bookmarks and browser back/forward
- `FeatureGate` per-route permission enforcement (no new authorisation surface)
- `MobileAccessGuard`'s path allowlist
- `routePrefetch`'s path-keyed chunk warming
- open-in-new-tab / middle-click, because the control renders as two `<Link>`s

The stored preference (`localStorage`) is used only for **destination resolution** — which side the sidebar and bottom-nav links point at — never for deciding what the current page is.

```
current persona  ←  derived from location.pathname via the pair registry
                    (falls back to stored preference on unpaired routes)

stored persona   ←  written on every toggle
                 →  read by AppSidebar, BottomNavbar, getLandingPage()
```

---

## 3. New modules

### 3.1 `src/modules/core/navigation/personaPairs.ts`

The single registry. Everything else derives from it.

```ts
export type Persona = 'employee' | 'employer';

export interface PersonaSide {
  path: string;
  label: string;          // i18n key
  Icon: LucideIcon;
  permission?: string;    // must equal the route's FeatureGate feature
  mobile: boolean;        // must equal membership in ALLOWED_MOBILE_ROUTES
}

export interface PersonaPair {
  key: 'roster' | 'availability' | 'attendance' | 'bids' | 'swaps' | 'leave' | 'broadcasts';
  neutralLabel: string;   // i18n key — what the sidebar shows
  Icon: LucideIcon;       // stable across personas so nav doesn't reshuffle
  employee: PersonaSide;
  employer?: PersonaSide; // absent ⇒ no toggle (availability, today)
}

export const PAGE_PAIRS: readonly PersonaPair[] = [ ... ];

// derived
export const pathToPair:  ReadonlyMap<string, PersonaPair>;
export const pathToSide:  ReadonlyMap<string, Persona>;
export function resolvePath(pair: PersonaPair, persona: Persona, isMobile: boolean): string;
```

`resolvePath` is where the mobile fallback lives: if `persona === 'employer'` but `pair.employer.mobile === false` and we're on a phone, it returns the employee path. That is what stops the bottom-nav from ever landing a user on the *Desktop Required* screen.

### 3.2 `src/modules/core/contexts/PersonaContext.tsx`

```ts
usePersona(): {
  persona: Persona;           // derived from URL when on a paired route
  storedPersona: Persona;     // the sticky preference
  setPersona(p: Persona): void;
  pair: PersonaPair | null;   // null on unpaired routes
  counterpartPath: string | null;
  canSwitch: boolean;         // pair exists && hasPermission(employer.permission)
  switchReason: 'ok' | 'no-pair' | 'no-permission' | 'desktop-only';
}
```

Seeding rule: first run, `storedPersona = isManagerOrAbove() ? 'employer' : 'employee'`. This matches what [`getLandingPage()`](../../src/platform/auth/useAuth.ts) already does — gamma+ already lands on `/rosters`. Persist under `shiftopia.persona`.

Mount the provider inside `AuthLayout` in `AppRouter`, above `AppLayout`, so the sidebar and bottom nav both see it.

### 3.3 `src/modules/core/ui/components/PersonaToggle.tsx`

One component, two renderings keyed off the existing `useBreakpoint()` (`'mobile' | 'tablet' | 'desktop'`, breakpoint at 768px).

---

## 4. Desktop design

### 4.1 Placement

`PersonalPageHeader` Row 1 today is `[Icon] Title` on the left, `HH:MM / :ss` + `rightActions` on the right. The toggle goes **immediately right of the title**, separated by a hairline divider — it reads as a qualifier on the title, which is exactly what it is.

```
┌──────────────────────────────────────────────────────────────────────┐
│  ⬒  My Roster   │  ⟨ 👤 Employee │ 🏢 Employer ⟩            14:32     │
│                                                                :07   │
│  ── scope filter row (personal ⇄ managerial) ─────────────────────    │
│  ── function bar ────────────────────────────────────────────────    │
└──────────────────────────────────────────────────────────────────────┘
```

Do **not** use the existing `rightActions` slot — it stacks *under* the clock, which buries the control and makes it compete with page-level buttons.

### 4.2 The control

- Pill container matching the existing dark/light idiom: `bg-[#111827]/60` dark, `bg-slate-100` light, `rounded-xl`, `p-1` — same as the view-mode toggle in `UnifiedModuleFunctionBar`.
- Two segments, **fixed equal width** (`min-w-[104px]` each) so the pill does not resize when the labels differ in length.
- Active segment: `bg-[#0f172a] text-white shadow-sm` (dark) / `bg-white text-slate-900 shadow-sm` (light), matching the card/table toggle exactly.
- Sliding indicator via framer-motion `layoutId` — already a dependency, already used in this file's `itemVariants`. Wrap in `motion-safe:` per the calendar-refactor precedent.
- Height `h-9 lg:h-10` to sit under the `text-3xl` title without dominating it.

### 4.3 Semantics and keyboard

Render as two `<Link>`s inside a `<div role="group" aria-label="View as">`:

- active link carries `aria-current="page"`
- roving tabindex — only the active link is in the tab order
- ArrowLeft / ArrowRight move between segments and activate
- visible `focus-visible` ring (the calendar refactor established this pattern)
- the accessible name says *what changes*, not just the persona: `"View as employer — Roster Planner"`, not `"Employer"`. Colour and position alone must not carry the meaning.

### 4.4 Coupling the scope filter

`PersonalPageHeader` already takes `mode?: 'personal' | 'managerial'`, which selects `PersonalScopeFilter` (typeX) vs `ManagerialScopeFilter` (typeY). Today each page hardcodes it and they can drift.

Change the default: `mode = explicitProp ?? (persona === 'employer' ? 'managerial' : 'personal')`. Explicit props still win, so this is backwards-compatible and no call site has to change. It makes "employer page showing a personal scope filter" unrepresentable going forward.

### 4.5 Title

Each page keeps owning its own `title` prop — do not centralise titles into the registry for the *header*. The registry's labels are for the **nav**. `MyRosterPage` says "My Roster", `RostersPlannerPage` says "Roster Planner"; they're different routes, so the string is naturally correct on arrival.

---

## 5. Mobile design

Mobile is where the consolidation actually pays, and where the header has no room.

### 5.1 Compact Row 1 (prerequisite)

Row 1 today is a `text-3xl` title next to a `text-3xl` mono clock with a seconds line under it. On a 375px viewport that is already at the edge; adding a 220px pill inline will overflow.

- title: `text-xl sm:text-2xl lg:text-3xl`
- clock: on mobile drop the `:ss` line and render `HH:mm` at `text-base` as a chip. Keep the `role="timer"` and the full `aria-label` — the seconds stay in the accessible name.
- this frees a full row and is a standalone improvement regardless of the toggle.

### 5.2 The toggle as its own row

Full-width, two 50% segments, `h-11` (44px — the touch-target floor `MobileIconButton` already enforces), directly under the title:

```
┌────────────────────────────────────┐
│  ⬒ My Roster              14:32    │
├────────────────────────────────────┤
│ ⟨   👤 Employee  │  🏢 Employer  ⟩ │   ← h-11, 50/50
├────────────────────────────────────┤
│  scope filter                      │
│  function bar (icon row)           │
└────────────────────────────────────┘
```

Full-width beats a compact pill here: unambiguous targets, no crowding, and it reads as a mode banner rather than a stray button.

### 5.3 `BottomNavbar` must follow the persona

This is the mobile half of "empties the sidebar". The eight `middleItems` keep their icons, labels and order, but their `path`s resolve through `resolvePath(pair, persona, isMobile)`:

| Item | Employee persona | Employer persona |
|---|---|---|
| Roster | `/my-roster` | `/my-roster` — *employer side is desktop-only, see §5.4* |
| Atten | `/my-attendance` | `/timesheet` |
| Avail | `/my-availabilities` | `/my-availabilities` — no employer side |
| Bids | `/my-bids` | `/management/bids` |
| Swaps | `/my-swaps` | `/management/swaps` |
| Radio | `/my-broadcasts` | `/broadcast` |
| Leave | `/my-leave` | `/management/leave` |
| Notif | `/my-notifications` | `/my-notifications` |

Labels stay employee-neutral 4–5 char strings ("Roster", "Bids") — they already are. **Icons and order must not change on toggle**; only destinations do. A bottom bar that reshuffles under your thumb is disorienting.

The `moreItems` panel then loses `Manager Bids`, `Manager Swaps`, `Timesheets`, `Broadcast`, `Leave Mgmt` — five of eleven entries — leaving Templates, Insights, Grid, Users, Settings, Perform. That's a one-screen panel with no scroll.

### 5.4 The Roster Planner mobile problem

`/rosters` is deliberately desktop-only (`MobileAccessGuard`), and rightly so — it's a drag-and-drop grid canvas. In employer persona on a phone the toggle would otherwise navigate straight into *Desktop Required*.

**Recommendation:** on mobile, render the Employer segment on `/my-roster` as **disabled with a "Desktop only" caption**, and have `resolvePath` keep the bottom-nav Roster item on `/my-roster` in both personas. Visible-but-explained beats invisible (the capability exists, just not here) and beats navigable-to-a-dead-end.

### 5.5 The mobile allowlist fix

Add to `ALLOWED_MOBILE_ROUTES`: `/my-leave`, `/management/leave`. `/my-leave` is an existing bug (§1); `/management/leave` renders the same `LeavePage` component at `tab="approvals"` and is equally mobile-capable.

---

## 6. Sidebar consolidation

`NavigationLinks.tsx` today: Overview (8) + Rostering (4) + Management (4) + Broadcast + Insights + Performance + Settings ≈ **18 items across 3 collapsible sections**.

After:

```
WORKSPACE  ·  Employer view          ← neutral labels + persona caption
  Roster · Availability · Attendance · Bids · Swaps · Leave · Broadcasts · Notifications   (8, persona-resolved)

ROSTERING
  Templates · Labor Demand                                                                  (2, employer-only, unpaired)

MANAGEMENT
  Gross Pay                                                                                 (1, unpaired)

  Insights · Performance · Users                                                            (3, unpaired)
  Settings
```

**≈18 → 13 items, and the Management section drops from 4 to 1.**

Two calls worth making explicit:

- **Neutral, stable sidebar labels** ("Roster", not "My Roster" ⇄ "Roster Planner"). If labels flip on toggle, the entire sidebar relabels in response to a control in the page header — a lot of motion for no information. Instead show one small `Employer view` / `Employee view` caption under the section title. That keeps context when the user is deep in a page and the header has scrolled.
- **The freed space goes to breathing room, not new items.** Flatten Overview from a collapsible section to a plain list, give the persona caption a line, and stop there. Filling reclaimed space is how the sidebar got to 18 items.

New i18n keys in **both** `en-GB.json` and `fr-FR.json`: `nav.roster`, `nav.availability`, `nav.attendance`, `nav.bids`, `nav.swaps`, `nav.leave`, `nav.broadcasts`, `nav.notifications`, `nav.persona_employee`, `nav.persona_employer`, `nav.persona_caption_employee`, `nav.persona_caption_employer`. Keep the old `nav.my_*` keys until nothing references them.

---

## 7. Where the toggle does *not* render

Unpaired routes render Row 1 exactly as today: `/templates`, `/labor-demand`, `/insights`, `/insights/:id`, `/users`, `/settings`, `/search`, `/profile`, `/my-notifications`, `/management/payroll`, `/compliance/rejections`, `/rosters/shift/new`, and — pending §9.1 — `/my-availabilities`.

When a pair exists but the user lacks the employer permission (every alpha user, and beta users on all pairs except Attendance): **hide the toggle entirely.** A disabled toggle advertises a capability they will never have on that page. This differs deliberately from §5.4, where the capability *does* exist and only the viewport is wrong.

---

## 8. Phases

| Phase | Work | Gate |
|---|---|---|
| **0** | `personaPairs.ts` registry + `PersonaContext` + invariant tests | tests green |
| **1** | `PersonaToggle` (desktop variant) + wire into `PersonalPageHeader` Row 1; derive `mode` from persona | toggle live on all 7 pairs incl. Roster Planner |
| **2** | Mobile Row-1 compaction + mobile toggle row | 375px viewport, no overflow |
| **3** | `ALLOWED_MOBILE_ROUTES` += `/my-leave`, `/management/leave`; `routePrefetch` += `/my-leave`, `/management/leave`, `/management/payroll` (all three currently missing) | leave reachable on mobile |
| **4** | `BottomNavbar` persona-resolved paths; `moreItems` pruned | — |
| **5** | `NavigationLinks` consolidation + i18n keys (en-GB **and** fr-FR) | sidebar at 13 items |
| **6** | `/team-availability` phases 0–1 — RLS fix + route + team grid ([plan](./team-availability-page-plan.md)) | pair #2 completes |

Phases 0–2 are shippable on their own: the toggle works, nothing else has changed, and no navigation is removed. Phases 4–5 are the payoff but are also the risky half (they change destinations users have muscle memory for), so they want their own PR.

### The invariant tests (phase 0) are the point

Three registry tests, each of which would have caught a bug that is in `main` today:

1. every `path` in `PAGE_PAIRS` is a real route in `AppRouter` — catches typos and future route renames
2. every `employer.permission` equals that route's `FeatureGate` feature — catches a toggle that navigates into `/unauthorized`
3. every side with `mobile: true` is in `ALLOWED_MOBILE_ROUTES`, and vice-versa for the paths the bottom nav links to — **this is the test that catches the `/my-leave` bug**

ESLint is broken repo-wide, so tests are the only guard. Gates: `npx tsc -p tsconfig.app.json --noEmit` (the bare root `tsc --noEmit` compiles nothing), `vitest`, `build`.

---

## 9. Open decisions

### 9.1 Availability's employer half — RESOLVED: build it

`/team-availability` will be built. Full feature plan: [team-availability-page-plan.md](./team-availability-page-plan.md).

Its phases 0–1 (RLS fix + route + team grid) are what this toggle needs; everything beyond that is independent and does not block the persona work. In v1 the page is **desktop-only**, so pair #2 uses the same disabled-segment treatment as pair #1 (§5.4).

### 9.2 Sticky persona default — RESOLVED: seed from the Type Y certificate

`storedPersona` seeds to `'employer'` **iff the user holds an active Type Y (managerial) certificate** — `permissionObject.typeY != null` — otherwise `'employee'`.

This is deliberately *not* `isManagerOrAbove()`. That helper resolves through [`getEffectiveLevel()`](../../src/platform/auth/useAuth.ts), which can return gamma+ from the delta/epsilon/zeta **superuser fallback** on `user.highestAccessLevel`, or from the **position contract** — neither of which means the person actually holds a managerial certificate. `permissionObject.typeY` is precisely "has a managerial certificate".

The second reason is better: `ManagerialScopeFilter` renders `null` unless `permissionObject.typeY` **and** `allowed_scope_tree` are both present. Seeding on `typeY` means a user defaulted into employer persona is guaranteed to get a working scope filter on arrival — which closes the risk row in §10 about a gamma user with no typeY landing on a scope-filter-less page.

Precise rule:

```ts
// seed once, then sticky
storedPersona = permissionObject?.typeY ? 'employer' : 'employee';

// but switching stays aligned with the route guard, NOT with typeY
canSwitch = pair.employer !== undefined && hasPermission(pair.employer.permission);
```

`canSwitch` must keep using `hasPermission` — the same predicate as `FeatureGate` — otherwise the toggle would hide a page the user can still reach by typing the URL. So a gamma user without typeY still *sees* the toggle and can still use it; they simply are not defaulted into it.

### 9.3 Global persona vs per-pair memory

Recommend **global** — "I am working as a manager right now" is one mental state, and per-pair memory produces a sidebar where half the links are employee and half employer with no visible explanation.

---

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Sidebar destinations change on first load for everyone holding a Type Y certificate (§9.2) | Medium | Ship phases 0–2 first (additive only); phases 4–5 as a separate PR with a release note |
| Toggling on `/my-leave` ⇄ `/management/leave` remounts `LeavePage` and drops in-progress form state on the "new request" tab | Medium | Guard: if the `new` tab has dirty form state, confirm before switching. Same class of issue on any pair with an open editor |
| A gamma user with no `typeY` certificate passes `hasPermission('management')` but the managerial scope filter renders nothing | Low | Mitigated by §9.2 — such a user is never *defaulted* into employer persona, only allowed to switch into it. If they do, `ScopeFilterBanner` returns `null`, which is already today's behaviour on `/management/*`. `canSwitch` uses the same predicate as `FeatureGate`, so no `/unauthorized` bounce |
| Registry drifts from `AppRouter` as routes are added | Medium | The phase-0 invariant tests; they fail loudly on drift |
| Persona in `localStorage` desyncs across tabs | Low | `storage` event listener in `PersonaContext`, or accept it — the URL always wins for what's on screen |
| Mobile Row-1 compaction changes every page's header, not just paired ones | Medium | It's a genuine improvement, but it is a wide blast radius. Land it as its own commit so it can be reverted independently |
