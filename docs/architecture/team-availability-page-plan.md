# Team Availability Page — Feature Plan

**Status:** COMPLETE except mobile · gates green (type-check, 1927 vitest, build)
**Outstanding:** phase 6 (mobile day-list) only — see §8
**Fills:** the employer half of pair #2 in [persona-toggle-plan.md](./persona-toggle-plan.md) §9.1
**Route:** `/team-availability` · **Gate:** `management` OR `insights` · **Toggle counterpart:** `/my-availabilities`

> **Superseded in part.** The page has since absorbed the Annual Shift Grid: the Team view gained
> a cell-mode control (Availability / Hours / Compliance), ISO-week total columns and a compliance
> status column, `/grid` was retired into it, and the gate widened to admit the `insights` audience
> that page served. See
> [availability-manager-grid-merge-plan.md](./availability-manager-grid-merge-plan.md) — read it
> alongside this one for anything touching the grid, hours or the shift read.

---

## 0. What shipped

| File | Role |
|---|---|
| [`model/team-availability.types.ts`](../../src/modules/availability/model/team-availability.types.ts) | The five concepts as types |
| [`domain/team-coverage.ts`](../../src/modules/availability/domain/team-coverage.ts) | Pure logic — cells, buckets, summary, near-miss |
| [`api/team-availability.api.ts`](../../src/modules/availability/api/team-availability.api.ts) | Scoped reads + pluggable Required source |
| [`state/useTeamAvailability.ts`](../../src/modules/availability/state/useTeamAvailability.ts) | React Query hook; filters applied post-fetch |
| [`ui/team/coverage-palette.ts`](../../src/modules/availability/ui/team/coverage-palette.ts) | Validated colour tokens, with the validator runs recorded |
| [`ui/team/TeamCoverageSummary.tsx`](../../src/modules/availability/ui/team/TeamCoverageSummary.tsx) | The KPI row |
| [`ui/team/TeamAvailabilityGrid.tsx`](../../src/modules/availability/ui/team/TeamAvailabilityGrid.tsx) | View A |
| [`ui/team/CoverageHeatmap.tsx`](../../src/modules/availability/ui/team/CoverageHeatmap.tsx) | View B |
| [`ui/team/DeclarationComplianceList.tsx`](../../src/modules/availability/ui/team/DeclarationComplianceList.tsx) | View C |
| [`ui/team/NearMissPanel.tsx`](../../src/modules/availability/ui/team/NearMissPanel.tsx) | §4.1 |
| [`ui/team/TeamDayTimeline.tsx`](../../src/modules/availability/ui/team/TeamDayTimeline.tsx) | The DAY composition (§0.1) |
| [`ui/team/TablePager.tsx`](../../src/modules/availability/ui/team/TablePager.tsx) | Pagination (§0.2) |
| [`pages/TeamAvailabilityPage.tsx`](../../src/modules/availability/pages/TeamAvailabilityPage.tsx) | The page |

53 tests: 25 domain + 15 render + 13 request-path. Wired into `AppRouter`, `routePrefetch`, `NavigationLinks`, and both locale files.

### 0.1 Day / 3-Day / Week / Month

Range navigation reuses `UnifiedRosterNavigator` and its exported `computeRange` /
`navigateDate` — the same snapping, bounds and range labels as the Roster Planner,
rather than a second implementation that would drift. The plain date-range picker
is gone; anchor date + view type are the state.

**The span changes the composition, not just the column count:**

| View | Days | Team view renders |
|---|---|---|
| Day | 1 | `TeamDayTimeline` — members down, **hours across**, declared window and assigned shift on one track |
| 3-Day / Week | 3 / 7 | Grid at `comfortable` density — the declared window is **printed in the cell**, no hover needed |
| Month | 28–31 | Grid at `compact` density — glyph only |

A people × days grid at a one-day span is a single useless column, which is why Day
swaps component rather than squeezing. The heatmap widens its cells the same way and
prints `assigned/required` inside them once they clear 46px.

### 0.2 Pagination

`TablePager` — compact, button-based (paging is view state, not a location, so the
shadcn `pagination` primitive's anchors are the wrong semantics), with a 25/50/100
page-size control.

**Aggregates are never paginated.** The summary strip and the coverage heatmap always
fold over every member in scope; only the row lists page. The numbers must not change
when you turn the page. For the same reason CSV export writes the full filtered set,
and "select all" in the compliance list selects the whole filtered set rather than the
visible page.

### 0.3 UI fixes made in the same pass

- Sticky day-axis **and** sticky member column in the grid, with solid backgrounds —
  `bg-inherit` resolves to transparent on a `<th>` and let content scroll through.
- Heatmap tooltip repositioned to viewport coordinates via `getBoundingClientRect`;
  the previous `offsetLeft/offsetTop` misplaced it inside a scrolled container.
- Summary trimmed to exactly the five concepts. The required-source moved to a badge —
  a stat tile whose value is a word rather than a number is a form mismatch — and
  Required / Assigned are now real staffed-hour totals.
- Loading skeletons replace the bare "Loading…" line.
- Near-miss list discloses truncation instead of silently cutting at 40.
- View tabs moved to the header's `subFunctionBar` row: navigator + filters + search +
  tabs together overflow ~1280px with the sidebar open, and that toolbar's overflow has
  no visible scrollbar, so controls would simply vanish.

**Deviations from the plan as written:**

- **View D (person drawer) not built.** The grid's per-member button is wired to an
  optional `onSelectMember` callback the page does not yet supply. Near-miss shipped
  ahead of it because it does not depend on the drawer after all.
- **`hideViewModeToggle` added to `GoldStandardHeader`.** The page owns its own view
  switcher; without this, the shared header rendered a second, competing card/table
  toggle. Backwards-compatible — optional, undefined on every existing caller.
- **Required is a pluggable source, not demand-only.** See §6.
- **Request-availability now sends** (2026-08-09) — see §4.2. Notification-only; no
  schema change.
- **"Declaration expiry" removed** (2026-08-09) — it was never a real concept. See §1.2.

---

## 1. What prod actually looks like

Queried against `srfozdlphoempdattvtx` on 2026-08-08. These numbers drive the feature set — the page is not "a grid of who's free", it's an answer to five questions the data says managers currently cannot answer.

| Measure | Value |
|---|---|
| `availability_rules` | 106 (102 of them **recurring**) |
| `availability_slots` | 9,980, spanning 2026-03-05 → **2027-01-03** |
| Profiles with any future declaration | 100 of 107 |
| Distinct profiles declared, **weekday** | 66–67 of 107 |
| Distinct profiles declared, **weekend** | **40 of 107** |
| Rules written in one minute on 2026-07-07 18:49 | **100 of 106** (identical `repeat_end_date`) |
| Slots that are true full-day (`00:00–23:59`) | 6, across 2 profiles |

Four things follow directly:

1. **Weekend coverage is a cliff, and it is invisible today.** 66 → 40 declared profiles from Friday to Saturday. Nothing in the app surfaces this.
2. ~~**The whole workforce's availability expires on the same day.**~~ **RETRACTED 2026-08-09.** This was wrong. `repeat_end_date` records how far a recurrence was materialised — it is not a policy that availability lapses, and no renewal or lapse workflow exists anywhere in the product. 100 of the 106 rules were created in a **single minute** (2026-07-07 18:49) carrying an identical end date: a seed script, not 100 people independently choosing 2027-01-03. A banner, a KPI, a sort option and a status column were all built on this non-concept and have been removed. Nothing in the product should treat `repeat_end_date` as an expiry.
3. **Declarations are single wide windows, not full-day flags.** The top patterns are `07:00–23:00`, `09:00–17:00`, `09:00–21:00`, `08:00–22:00`. Combined with the **full-containment** rule in [`availability-check.ts`](../../src/modules/rosters/domain/availability-check.ts), a 06:30 shift start fails against a 07:00 declaration by 30 minutes — and reads to the manager as identically unavailable to someone who declared nothing. This is exactly the AutoScheduler 0/144 incident.
4. **"Never declared" is a small problem (7 people); "declared a pattern that excludes this day" is the big one (~40 people on weekends).** A compliance list alone would miss the actual gap.

---

## 2. Two findings that must be fixed alongside

### 2.1 `availability_slots` / `availability_rules` were readable by `anon` — FIXED 2026-08-09

```
availability_rules  | Enable read access for all | SELECT | {public} | true
availability_slots  | Enable read access for all | SELECT | {public} | true
```

Role is `public`, not `authenticated`, and the qualifier is literally `true`. Anyone holding the publishable key can read every employee's declared availability. Writes are correctly owner-scoped (`auth.uid() = profile_id`); only reads are open.

**Closed by `20260809000200_availability_rls_close_anon_read`.** SELECT is now
`TO authenticated USING (profile_id = auth.uid() OR public.is_manager_or_above())`,
and `anon` is revoked at the grant level so it fails before RLS is even consulted.

Verified as real roles (MCP runs as superuser with `BYPASSRLS`, which would have
shown a false pass):

| Role | Result |
|---|---|
| `anon` | `permission denied for table availability_slots` |
| employee (non-manager) | 181 slots — all their own, **0** belonging to anyone else |
| manager | 9,980 slots / 104 people / 106 rules — unchanged |

**Deliberately NOT scope-narrowed.** `scheduling/data/roster-fetcher` pulls
availability for the solver's whole candidate set; a scope-restricted policy
would silently shrink that set and produce under-filled rosters that look like a
solver bug — the AutoScheduler zero-fill failure mode. This closed the actual
vulnerability without changing what any authenticated manager already saw.
Narrowing to scope is a separate change needing its own solver verification.

### 2.2 `AvailabilityRule.reason` does not exist in the database

[`availability.types.ts`](../../src/modules/availability/model/availability.types.ts) declares `reason?: string | null` on `AvailabilityRule` and `reason?: string` on `AvailabilityFormPayload`. The prod column list is `id, profile_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date, created_at, updated_at` — **no `reason`**. Nothing in the api or service layer reads or writes it, so it is inert today.

It matters here because "why is this person unavailable?" is the first column a manager will ask for, and the answer is: that data was never captured. Either drop the field from the types or add the column — but decide before designing a UI around it. Note that adding it creates a free-text field holding personal reasons (medical, childcare) on a table that is currently world-readable — do 2.1 first.

---

## 3. Views

### View A — Team Grid *(default, desktop)*

People × days matrix — except at a one-day span, where it becomes the hour timeline
described in §0.1. Rows = employees in scope, columns = days in range. Each cell
renders the declared window as a bar, with overlays:

| Overlay | Meaning | Source |
|---|---|---|
| filled bar | declared available window | `availability_slots` |
| hatched block | assigned shift (locked) | `shifts` — the only lock source, per `availability-view.api.ts` |
| grey block | approved leave | `leave_requests` (status `approved`) |
| empty cell + dot | **no declaration** — treated as unavailable | absence of slots |

**Reuse, don't rebuild.** [`PeopleModeGrid`](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx) already renders availability bars from [`useResolvedAvailability`](../../src/modules/rosters/hooks/useResolvedAvailability.ts), which already reads `availability_slots` correctly (note its `'slots-v2'` cache discriminator — added when the read path moved off the empty `availabilities` table). Extract the bar renderer; do not write a second one.

### View B — Coverage Heatmap *(the reason to build this page)*

Hours × days. Cell value = **available headcount ÷ required headcount** for that hour, colour-scaled, red where required exceeds available.

This is the only view that answers "can I fill next week", and nothing in the app does it today — Roster Planner's `showAvailabilities` toggle shows availability *per person*, never aggregated against demand. Required headcount comes from the shifts already placed in the range (and, later, from the demand engine's finalised demand).

Follow the dataviz conventions for the scale: sequential, accessible in both themes, and never colour-alone — cells carry the `available/required` numbers.

### View C — Declaration Compliance

Sortable list: employee · declared? · pattern summary · window · **expires** · last updated. Filters for "no declaration", "expires within 30 days", "weekend-excluded".

Status is binary — rules on file or none — because that is all the data supports. The one extra shade worth showing is a member who has declared but is available on no day in the visible range, which is the shape a stale weekly pattern actually takes.

Bulk-select → **Request availability** (§4.2).

### View D — Person Detail drawer

Click any row or cell → drawer with that employee's month calendar, rules list, assigned shifts and leave. Reuse `MonthGrid` from the shared calendar system and the four-state precedence model already implemented in [`CalendarPane`](../../src/modules/availability/ui/panes/CalendarPane.tsx) (locked > available > partial > unset). Read-only in v1 — see §5.

---

## 4. Cross-cutting features

### 4.1 Near-miss detector

For every unfilled shift in range, list employees whose declared window **nearly** contains it, with the shortfall in minutes:

> `Priya R. — available 07:00–23:00 · shift 06:30–14:30 · **30 min short at start**`

`evaluateShiftAvailability` requires *full containment*, so a 30-minute miss returns the same `outside_window` verdict as someone available only on Sundays. Everywhere else in the app those two look identical. Surfacing the shortfall converts an unfillable shift into a two-minute phone call, and it is the direct remedy for the 0/144 zero-fill incident.

Threshold configurable, default 60 minutes. Rank by shortfall ascending.

### 4.2 Request availability — LIVE

[`api/availability-requests.api.ts`](../../src/modules/availability/api/availability-requests.api.ts).
Select members → one `notifications` row each via the existing `notify_user`
SECURITY DEFINER RPC, deep-linked to `/my-availabilities`.

The loop: manager sends → employee sees it in the bell / My Notifications → taps
through → declares → a DB trigger materialises `availability_slots` → this page
reflects it on the next refetch.

**It cannot change anyone's availability.** RLS permits writes to
`availability_rules` / `availability_slots` only by their owner
(`auth.uid() = profile_id`), which is correct — declared availability is the
employee's statement about their own life. This is a nudge, and only the employee
closes it.

Ships on notification type `general` with `entity_type = 'availability_request'`,
because `notification_type` has no availability-shaped value and adding one needs a
split migration (Postgres cannot use a new enum value in the transaction that adds
it). Swapping to a dedicated type is one line once that migration exists.

`dedup_key` is `(entity, recipient, requester, range)` so a manager clicking twice
does not produce two bell entries. Partial sends are reported honestly — "sent to 17,
failed for 3" — because a manager told "sent" will not chase the three who never
got asked.

**The loop is closed** (`20260809000100_availability_requests`). Every ask writes an
`availability_requests` row (status `pending`) *before* the notification goes out —
if the send fails the record still stands, so an unanswered ask stays visible; the
reverse order would lose the record exactly when it matters.

`availability_rule_closes_request`, an AFTER INSERT trigger on `availability_rules`,
flips any pending request whose period the new rule overlaps to `responded` and links
the rule that closed it. **No employee-side UI was needed** — the employee declares as
they always could, and the request resolves itself. Verified end to end in prod as the
employee's own role, including after the trigger function's EXECUTE was revoked.

The manager sees per-member `Not asked` / `Asked 3d ago` / `Answered`, plus a
"Select unasked" bulk action that skips anyone with an ask already open. Re-asking
someone with an open request is filtered client-side (so the toast reports the real
number) and collapsed server-side by a partial unique index on open requests.

Responding is the trigger's job, never a client's: the UPDATE policy is
manager-only, so an employee cannot mark themselves as having answered without
actually declaring.

**Employee side.** `ui/InboundAvailabilityRequests.tsx` renders open asks at the top
of My Availabilities — who asked, for which dates, any note, and a "Declare
availability" button that jumps the calendar to the requested month and opens the
create form. Without it the notification's deep link worked but the hand-off did
not: the employee arrived with nothing telling them why they were there or which
dates to cover. There is no dismiss control on purpose — dismissing would hide the
ask without answering it while the manager's view still showed it pending. The
banner clears itself when the declaration fires the trigger.

**Recording is a SELECT-then-INSERT, deliberately not an upsert.** The
"one open request per (recipient, requester, period)" rule is a PARTIAL unique
index (`WHERE status = 'pending'`), and Postgres cannot resolve
`ON CONFLICT (cols)` against a partial index — it raises 42P10, which PostgREST
returns as a bare 400. The first version shipped as an upsert and failed at the
first real click with every gate green, because no unit test exercised a real
PostgREST round trip. Making the index total would have "fixed" it by letting a
re-ask silently overwrite a resolved request, destroying the history this table
exists to keep. The index still guards races (23505), reported as
"someone else just requested…" rather than a raw constraint violation.

### 4.3 Coverage summary strip

Above the views, four figures: declared %, weekday vs weekend split, days with a red hour in the heatmap, employees expiring within 30 days. These are the §1 findings rendered permanently visible.

### 4.5 Filters

Managerial scope (org / department / sub-department) via the existing `ManagerialScopeFilter` in header Row 2, plus role, **employment type** (casual availability is the flexible pool — the distinction matters for who you call), and declaration status.

### 4.6 Export

CSV of the current grid. Cheap, and rostering meetings will ask for it within a week.

---

## 5. Explicitly out of scope for v1: manager editing of availability

RLS today permits writes only by the owner (`auth.uid() = profile_id`, on both tables). Letting a manager edit someone's declared availability is a governance decision, not a UI one — it is the employee's statement about their own life, and it feeds scheduling that feeds pay. If it is wanted later it needs a new write policy, an audit trail, and an "edited by manager" provenance flag so the employee can see it happened.

v1 gives managers **read + nudge**. That covers every question in §1.

---

## 6. Data access

New `src/modules/availability/api/team-availability.api.ts`:

- **`getTeamAvailability(profileIds, start, end)`** — wrap the existing `getResolvedAvailabilities` in [`rosters/api/availability.api.ts`](../../src/modules/rosters/api/availability.api.ts). It already batches correctly and already reads slots. Keep its `isValidUuid` guard on the `.in()` list — one non-UUID poisons the whole query with a 22P02.
- **Coverage aggregation is client-side for now.** A month slice is ~2,000 slot rows
  across ~107 members and 744 (date, hour) buckets — comfortably foldable in the
  browser, and it avoids putting a new SECURITY DEFINER function into prod as part
  of a UI change. Revisit with `sm_team_availability_coverage(p_org_ids uuid[],
  p_dept_ids uuid[], p_start date, p_end date)` if the range grows past a quarter;
  that function must `REVOKE EXECUTE FROM PUBLIC, anon` on creation.

- **REQUIRED is source-pluggable, and the source is always badged.**
  DECISION (2026-08-08): forecast demand is the primary source; placed shifts are
  actual planned coverage. `resolveRequired()` tries demand first and falls back to
  `requiredFromShifts`, and the summary strip names which one is live.

  Demand is **not wired yet**, and returning fabricated numbers would be worse than
  returning none. `demand_tensor` has **0 rows** in production, and its grain is
  (`synthesis_run_id`, `event_id`, `slice_idx`, `function_code`, `level`) — where
  `slice_idx` indexes an event-relative time grid with no slice→(date, hour)
  resolver on the frontend. `getRequiredFromDemand()` is the single function to
  fill in; nothing else on the page needs to change, because everything downstream
  already reads `required` source-agnostically.
- **Scope**: read the **whole** `scope.org_ids` array. The Ch.17 audit found 13+ pages reading only `scope.org_ids[0]`; do not add a fourteenth.
- PostgREST: never comment inside a select literal, and always surface `isError` — one bad column name 400s the entire select and react-query's `= []` default renders it as a clean empty state.

---

## 7. Mobile

A people × days matrix is not a phone view, and pretending otherwise produces a grid nobody can read. Mobile gets a genuinely different composition:

- coverage summary strip (§4.3) — the numbers travel fine
- **day-at-a-time list**: pick a date, get cards for available / not declared / on leave / already assigned
- compliance list (§4.3) + request-availability bulk action — these work well on a phone
- **no** grid, **no** heatmap

Until the day-list exists the route stays desktop-only: leave `/team-availability` out of `ALLOWED_MOBILE_ROUTES` and let the persona toggle render its Employer segment disabled with a "Desktop only" caption, the same pattern as Roster Planner in the persona plan §5.4.

---

## 8. Build order

| Phase | Work | Status |
|---|---|---|
| **0** | RLS fix (§2.1) | **DONE 2026-08-09**, verified as anon/employee/manager |
| **1** | Route + gate + `GoldStandardHeader` shell + managerial scope + **View A** | done |
| **2** | Coverage summary strip + **View C** | done |
| **3** | **View B** heatmap | done (client-side aggregation, no RPC) |
| **4** | Near-miss detector (§4.1) | done · **View D** drawer not built |
| **5** | Filters, export | done · request-availability is a stub |
| **6** | Mobile day-list, then add to `ALLOWED_MOBILE_ROUTES` | **DONE** — see below |

Phase 6 shipped as `ui/team/TeamMobileDayList.tsx` + `ui/team/TeamMobileCoverage.tsx`;
`/team-availability` and `/grid` are both allowlisted and the bottom nav carries a
"Team Avail" entry. Details and the WCAG reasoning are in
[availability-manager-grid-merge-plan.md §8](./availability-manager-grid-merge-plan.md).
`NavigationLinks.tsx` also lists this route but is imported by nothing — dead code,
left untouched.

Gates: `npx tsc -p tsconfig.app.json --noEmit` (the bare root `tsc --noEmit` compiles nothing), vitest, build. ESLint is broken repo-wide, so tests are the only guard.

---

## 9. Open questions

1. **Gate: `management` (gamma+) or `timesheet-view`-style beta+?** Shipped as
   `management` — consistent with bids/swaps/leave, and avoids minting a new
   permission key. The cost is that beta team-leads can't see their own team's
   availability, which is arguably the wrong outcome; revisit if they complain.
2. ~~Required-headcount source~~ — **RESOLVED 2026-08-08:** forecast demand is
   primary, placed shifts are actual coverage. Implemented as a pluggable source;
   demand is stubbed pending the slice→(date, hour) resolver. See §6.
3. **`reason` — add the column or drop the field?** (§2.2) Still open. Blocks
   nothing shipped, but settle it before View D's drawer is designed — "why is
   this person unavailable?" is the first thing that drawer will be asked for.
