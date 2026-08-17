# Availability Manager ← Annual Shift Grid — Merge Plan

**Status:** ALL PHASES COMPLETE · `/grid` retired · phone composition shipped (§8) · not yet
visually verified in a browser (§7)
**Goal:** fold `/grid`'s hours + compliance overlays into `/team-availability`, add ISO-week
total columns, and retire `/grid`.
**Supersedes for this surface:** [team-availability-page-plan.md](./team-availability-page-plan.md)

> **Phase 1 landed** — gates green (`tsc -p tsconfig.app.json` 0 errors, 154 files / 2137 vitest,
> build 7.0s). Nothing is wired to the UI yet, so the page renders exactly as before.
>
> | File | |
> |---|---|
> | [`domain/contract-basis.ts`](../../src/modules/availability/domain/contract-basis.ts) | new — §2.5, +18 tests |
> | [`domain/hours-compliance.ts`](../../src/modules/availability/domain/hours-compliance.ts) | new — `resolveNetMinutes`, +8 tests. Phase 2 lands `computeEmpComp` beside it |
> | [`state/useTeamHours.ts`](../../src/modules/availability/state/useTeamHours.ts) | new — the widened read, §2.1/§2.2, +8 tests |
> | [`api/team-availability.api.ts`](../../src/modules/availability/api/team-availability.api.ts) | widened select, pagination, `getTeamRestrictedWorkLimits` |
> | [`model/team-availability.types.ts`](../../src/modules/availability/model/team-availability.types.ts) | `TeamContractType`, contract basis + hours fields |
> | [`state/useTeamAvailability.ts`](../../src/modules/availability/state/useTeamAvailability.ts) | consumes `TeamShiftsResult`, exposes `shiftsTruncated` |
>
> Two things the plan did not anticipate, both verified against production:
>
> - **`numeric` arrives as a string.** `contracted_weekly_hours` comes back as `"38"` / `"0"`, so
>   a `typeof x === 'number'` guard rejects it and silently drops a part-timer's 20h basis onto
>   the 38h default — doubling every window limit, with no error anywhere. Both the basis reader
>   and `resolveNetMinutes` coerce, and both have a regression test.
> - **The visa badge under-reported.** Grid matched `name.includes('Subclass 500')`. In production
>   16 people carry `has_restricted_work_limit` — 11 on a Subclass 500 and **5 on a Subclass 485
>   Temporary Graduate that the name match missed entirely**. `getTeamRestrictedWorkLimits` keys on
>   the flag, not the licence name.
>
> §2.5's rule was checked against the one person it decides: they hold a Full-Time contract
> (38h, starting 2026-07-10) alongside four casual ones, and the rule picks the Full-Time.
>
> **Phase 2 landed** — gates green (`tsc` 0 errors, 156 files / 2174 vitest, build 7.0s). Still
> not wired to the UI. `computeEmpComp` now lives in
> [`domain/hours-compliance.ts`](../../src/modules/availability/domain/hours-compliance.ts)
> alongside `buildHoursByEmployee`, `weekKeysInRange` and `buildWeekColumns`; `useTeamHours`
> folds them and exposes `hours`, `complianceByProfile` and `weekColumns`. +35 tests, including
> the §2.1 pair that asserts the same four 40h weeks report `violation` with the lookback and a
> false `ok` without it.
>
> **`insights/model/grid-compliance.ts` is deliberately still there.** It is frozen and now
> duplicated; `/grid` still imports it and phase 4 deletes both together. Repointing a page that
> is about to be removed at the new API would be wasted work and would risk breaking a live page
> mid-migration.
>
> One correction the port required, beyond a move: **weeks are keyed `2026-W33`, not by bare ISO
> week number.** The Grid rendered one calendar year at a time, so numbers could not repeat and
> ascending order was chronological order. Neither holds here — a visible range plus a three-week
> lookback spans two ISO years every New Year, and `[1, 2, 52, 53]` sorted ascending puts January
> *before* the December preceding it. The rolling-window sweep walks that array treating adjacent
> entries as adjacent weeks, so bare numbers would have silently averaged non-adjacent weeks every
> December and January. `yyyy-Www` sorts chronologically, which is the property the sweep actually
> depends on. Locked by tests.

---

## 0. Decisions taken

| # | Decision | Consequence |
|---|---|---|
| D1 | **No year axis.** Day / 3-Day / Week / Month stays the maximum span. | `UnifiedRosterNavigator` is untouched (it is shared with Roster Planner). The annual overview is dropped, not relocated — see §6. |
| D2 | **`/grid` redirects to `/team-availability`**, and the page becomes reachable by `insights` **or** `management`. | No user loses access; bookmarks survive. Same pattern as the existing `/availability-manager` → `/team-availability` redirect at [AppRouter.tsx:192](../../src/router/AppRouter.tsx#L192). |
| D3 | **Cell-content toggle**, not new sibling tabs. The TEAM grid keeps one set of rows, filters and pagination; a segmented control switches what each cell prints: **Availability / Hours / Compliance**. Week-total columns and the compliance status column are always on. | This is the actual merge — hours and availability become readable side by side, which is the only reason to merge rather than to port. |

Assumption taken without asking, because Grid already behaves this way and the alternative
would silently change every number: **draft shifts are included in hours and compliance, and
marked as draft.** See §2.3 — this is more load-bearing than it sounds.

---

## 1. What Grid has that the Availability Manager does not

Inventory of [`GridPage.tsx`](../../src/modules/insights/pages/GridPage.tsx) (788 lines), with a
verdict for each capability.

| Grid capability | Verdict |
|---|---|
| Per-day **net hours** per employee, per-shift breakdown popover (role, dept, sub-dept) | **Port** → Hours cell mode |
| **Draft** marking (`d` suffix, dashed border) | **Port**, and promote — §2.3 |
| **Weekly total column** per ISO week | **Port** → always-on week columns (this is the "week-like columns" ask) |
| Rolling **2/3/4-week window** badges + hover breakdown | **Port**, with a lookback fix — §2.1 |
| Daily cap 12h hard / 10h soft | **Port** as-is |
| Right sticky **compliance status column** (severity + worst description) | **Port** |
| Employee avatar tinted by severity | **Port** onto the existing name column |
| **Student-visa badge** (`employee_licenses`, Subclass 500 + `has_restricted_work_limit`) | **Port** — it is the only surface that shows it |
| `hours` / `compliance` mode toggle | **Becomes** the 3-way cell-content toggle |
| Whole-**year** axis, 2024/2025/2026 buttons | **Dropped** (D1) — §6 |
| Rows for employees who have shifts but **no active contract** | **Dropped by default**, surfaced as a warning — §2.7 |
| Reads `scope.org_ids[0]` only | **Not ported** — this is the Ch.17 org-scope bug. The Availability Manager already reads the whole `org_ids` array. |

Everything the Availability Manager has (5-state availability, coverage heatmap, near-miss call
list, request-availability loop, CSV export, stats dialog, employment filter, sort) is retained
unchanged.

---

## 2. Correctness traps

These are the plan. The UI work is straightforward; these are the parts that produce
confidently-wrong numbers if skipped.

### 2.1 A rolling window needs data from before the visible range — BLOCKING

Grid computes 2/3/4-week rolling windows across a whole year, so the window always had its
history in hand. The Availability Manager fetches exactly the visible range
([`useTeamAvailability.ts:78-83`](../../src/modules/availability/state/useTeamAvailability.ts#L78-L83)).
In Week view that is 7 days — a 4-week window computed from 7 days of shifts sums to roughly a
quarter of the truth and renders a **green "OK" on a real breach**. A silent false negative on a
compliance panel is worse than no panel.

**Fix:** hours and compliance read a *separate, wider* query than availability:

```
availability / cells / coverage   →  [startDate, endDate]                     (unchanged)
hours + compliance                →  [startOfISOWeek(startDate) − 21d,
                                      endOfISOWeek(endDate)]
```

21 days = the three prior ISO weeks a 4-week window ending in the range's first week needs.
A separate React Query key means the two cache independently and the existing fold is not
perturbed. Weeks outside the visible range are computed but **not rendered** — they exist only
to make the windows true.

### 2.2 Partial ISO weeks at the range edges

A Month view starts and ends mid-ISO-week. A week total summed over only the *visible* days of
that week understates it, and would disagree with the same week's total viewed a month later.

**Fix:** week totals are always **true full-ISO-week** figures (the §2.1 fetch already spans
whole ISO weeks). A week column whose days are only partly visible is marked — a thin leading
rule plus `aria-label` "partial week, N of 7 days shown" — so a manager never reads a full-week
number as a sum of what is on screen.

### 2.3 Every assigned shift in production is a Draft

Verified against prod on 2026-08-12:

| lifecycle_status | is_draft | rows | assigned |
|---|---|---:|---:|
| Draft | true | 318 | **120** |
| Published | false | 18 | 0 |

**All 120 assigned shifts are drafts.** So on day one, 100% of the hours and 100% of the
compliance severities on this page derive from provisional rosters. If draft-ness is not
carried through, the page states as fact a workload nobody has committed to.

**Fix:** draft is a first-class visual, not a suffix — a dashed cell border plus a `d` marker
(Grid's convention, kept), a **"Drafts included"** chip in the toolbar next to the mode toggle,
and the CSV export gains a `Draft Hours` column beside `Hours`. A draft on/off filter is
explicitly *out* of scope for v1: with 120/120 drafts, switching it off yields an empty grid,
which teaches the wrong thing.

### 2.4 The casual exemption is no longer near-vacuous

[`grid-compliance.ts`](../../src/modules/insights/model/grid-compliance.ts) exempts casuals from
the rolling windows, mirroring `compliance/v8/rules/ordinary-hours-avg.ts`. That was tuned when
the org was ~102/103 casual, which made rolling windows nearly dead code. Current prod:

| employment_status | active contracts | contracted_weekly_hours |
|---|---:|---|
| Casual | 101 | 0 – 38 |
| Full-Time | 40 | 38 |
| Part-Time | 12 | 20 |

**52 of 153 active contracts (~34%) now get real rolling-window checks**, against a real
per-person basis (38h FT, 20h PT — not a flat 38). The overlay is load-bearing now, which raises
the cost of §2.1 and §2.5 getting it wrong. Some casuals carry `contracted_weekly_hours = 0`;
the existing `> 0` guard in `computeEmpComp` already falls back to 38, and casuals skip the
windows anyway, so this is inert — but assert it in a test rather than leaving it to luck.

### 2.5 Which contract decides a person's compliance basis

30 of 103 users hold more than one active contract, and **1 holds contracts with conflicting
employment status** (`{Full-Time, Casual}`). The team API picks
`contractsInfoList[0]` ([`team-availability.api.ts:139`](../../src/modules/availability/api/team-availability.api.ts#L139))
— unordered PostgREST output. For that person, whether the rolling caps apply at all would flip
between page loads.

**Fix:** one deterministic rule, documented at the call site — pick the **most-constrained**
active contract, `Full-Time > Part-Time / Flexible Part-Time > Casual`, tie-broken by latest
`start_date`. Conservative by construction: never exempt someone from a cap because an
unordered array happened to put their casual contract first. `contracted_weekly_hours` comes
from the same chosen contract. Note `'Flexible Part-Time' → PT`, matching
[`eligibility.service.ts:244-247`](../../src/modules/rosters/services/eligibility.service.ts#L244-L247);
the page's employment filter offers only Casual/Part-Time/Full-Time, so Flexible Part-Time staff
are currently unfilterable — pre-existing, out of scope, worth a follow-up.

### 2.6 The two pages already disagree about which shifts count

`getTeamShifts` excludes cancelled shifts (`lifecycle_status != 'Cancelled'`,
`is_cancelled`, `deleted_at is null`). `getShiftsForDateRange`, which Grid uses, excludes only
`deleted_at`. **The merged page will show different hours than `/grid` showed**, because it
adopts the stricter (correct) filter. Say so in the release note rather than letting someone
diff the two and file a bug.

### 2.7 Employees with shifts but no active contract vanish

Grid's row set is `useEmployees(org)` ∪ *employees discovered from shift rows*
([GridPage.tsx:176-183](../../src/modules/insights/pages/GridPage.tsx#L176-L183)). The
Availability Manager's rows come only from active `user_contracts`. So a person holding shifts
without an active contract — exactly the person most worth noticing — silently disappears.

**Fix:** keep contracts as the row source, but after folding, count assigned shifts whose
`assignedEmployeeId` is not in the member set and render a dismissible bar: *"N shifts are
assigned to M people with no active contract in this scope — not shown."* Cheap, and it converts
a silent omission into a lead.

### 2.8 Two unpaginated queries

`getTeamShifts` issues a bare `.select()` with no `.range()` loop, so it truncates at
PostgREST's default row ceiling; `getShiftsForDateRange` caps at `INTERACTIVE_ROW_CAP = 8_000`
and only `console.warn`s. Neither bites today (336 shifts total in the database, 156 in the
busiest month), but the §2.1 widening makes the team query span up to ~7 weeks, and truncated
shift data reads as *lower* hours and *passing* compliance.

**Fix:** route `getTeamShifts` through the existing `fetchWithPagination` helper pattern, and
surface truncation in the UI rather than the console.

---

## 3. Target design

### 3.1 Toolbar

```
Row 1:  [TEAM | COVERAGE | NEAR MISSES]  │  ◀ Week of 10 Aug ▶  D 3D W M   │  [stats] [csv] [refresh]
Row 2:  [search]  [Employment ▾]  [Sort ▾]      Cells: [Availability | Hours | Compliance]  ⬩ Drafts included
```

The cell-content control sits on row 2 with the other data-shaping controls, not on row 1 with
the view tabs — it changes what a cell says, not which panel you are in. It renders only for the
TEAM view, and is hidden in Day view (which renders `TeamDayTimeline`, already showing real shift
times; forcing hours into it buys nothing).

### 3.2 Grid columns

```
│ Team Member (n) │ Mon 11 │ Tue 12 │ … │ Sun 17 │ W33 │ Status │
  sticky left                                       ^     ^
                                                    │     └ sticky right, new
                                                    └ ISO week total, new
```

- Week column appears after the last visible day of each ISO week.
- Week view: 7 day columns + 1 week column. Month view: 28–31 + 4–6.
- `comfortable` density currently sizes days as `100 / dates.length` %
  ([TeamAvailabilityGrid.tsx:245](../../src/modules/availability/ui/team/TeamAvailabilityGrid.tsx#L245));
  that divisor must account for the extra columns or the header and body drift apart.

### 3.3 Cell content by mode

| Mode | comfortable (Week / 3-Day) | compact (Month) |
|---|---|---|
| Availability | `09:00–17:00` (unchanged) | fill + glyph (unchanged) |
| Hours | `7.5+8.0` per-shift, `d` marks a draft, popover with role/dept/sub-dept | day total, e.g. `15.5` |
| Compliance | glyph + severity fill + hours | glyph only |

**Compliance must not be colour-alone.** Grid encoded severity as a red/amber fill with a bare
dot; this page's stated standard is a glyph *as well as* a fill
([TeamAvailabilityGrid.tsx:1-12](../../src/modules/availability/ui/team/TeamAvailabilityGrid.tsx#L1-L12)),
because the light-mode aqua sits at 2.75:1. So: `✕` violation, `~` near-limit, `·` ok — and the
severity tokens get **added to and validated in
[`coverage-palette.ts`](../../src/modules/availability/ui/team/coverage-palette.ts)** against the
same composited surfaces (light `#fcfcfd`, dark `#141c2e`) as the existing tokens, with the
validator run recorded in the file header. Do not copy Grid's raw Tailwind
`bg-red-500/60` classes across; they were never validated against these surfaces.

### 3.4 Week cell and status column

Week cell carries the week total, plus `2W`/`3W`/`4W` badges when a window trips, plus the hover
breakdown (`hours / limit` per window) — Grid's design, kept, with the partial-week marker from
§2.2. Status column carries the overall severity icon and `worstDesc`, and the name column's
avatar picks up the severity tint.

---

## 4. Implementation

### Phase 1 — data
1. `getTeamMembers`: also select `contracted_weekly_hours` and `start_date`; implement the §2.5
   most-constrained-contract rule; return `contractType: 'FT'|'PT'|'CASUAL'|null` and
   `contractedWeeklyHours` on `TeamMember`.
2. `getTeamShifts`: add `net_length_minutes, scheduled_length_minutes, break_minutes,
   total_hours, lifecycle_status, is_draft` and the `departments(name), sub_departments(name)`
   embeds. **All verified present** in `SHIFT_SELECT`
   ([shifts.queries.ts:27-120](../../src/modules/rosters/api/shifts.queries.ts#L27-L120)) — but
   one bad name 400s the entire select and renders as an empty page, so change it in one commit
   and click it once before moving on.
3. Paginate `getTeamShifts` (§2.8).
4. New `getTeamStudentVisaFlags(profileIds)` — lift the `employee_licenses` query out of
   `GridPage`, keyed on the *visible page* of members as Grid already does.
5. New `useTeamHours(scope, isoRange)` hook on the widened §2.1 range, separate query key.

### Phase 2 — domain
6. **Move** `insights/model/grid-compliance.ts` → `availability/domain/hours-compliance.ts`,
   and its test file with it. Keep the module's public shape; the casual-exemption rationale in
   its header is still correct and must survive the move.
7. New `buildHoursByEmployee(shifts, members)` → `{ byDate, byWeek, draftDates, byDateDraft }`,
   net minutes with the `calculateMinutesBetweenTimes` fallback Grid uses.
8. New `buildWeekColumns(dates)` → `{ isoWeek, visibleDates, isPartial }[]`, the pure driver for
   §3.2 and §2.2.
9. Compute compliance over the **widened** week set, render over the **visible** one.

### Phase 3 — UI
10. `TeamAvailabilityGrid`: `cellMode` prop, week columns, compliance status column, severity
    tint on the avatar, visa badge, draft styling. Fix the `comfortable` width divisor.
11. Severity tokens into `coverage-palette.ts` + validator run (§3.3). Extend the badge legend.
12. Cell-content segmented control in `TeamAvailabilityPage`, hidden in Day view.
13. Orphan-shift bar (§2.7) and truncation notice (§2.8).
14. CSV export gains `Hours`, `Draft Hours`, `Week Total`, `Compliance`.

### Phase 4 — retire `/grid`

| File | Change |
|---|---|
| [`insights/pages/GridPage.tsx`](../../src/modules/insights/pages/GridPage.tsx) | delete |
| [`insights/model/grid-compliance.ts`](../../src/modules/insights/model/grid-compliance.ts) + its test | move (phase 2.6), do not delete |
| [`AppRouter.tsx:53,214`](../../src/router/AppRouter.tsx#L214) | drop the lazy import; `/grid` → `<Navigate to="/team-availability" replace />` |
| [`routePrefetch.ts:46`](../../src/router/routePrefetch.ts#L46) | remove |
| [`AppSidebar.tsx:560-569`](../../src/modules/core/ui/layout/sidebar/AppSidebar.tsx#L560-L569) | delete the Grid item. The Admin section is already gated `insights \|\| management`, so render the Availability Manager item there **guarded by `!hasPermission('management')`** — insights-only users gain it, managers keep it where it is today in the Management section, and nobody sees it twice. |
| [`BottomNavbar.tsx:115`](../../src/modules/core/ui/layout/BottomNavbar.tsx#L115) | delete the Grid item — **see below** |
| [`MobileAccessGuard.tsx:42`](../../src/modules/core/ui/components/MobileAccessGuard.tsx#L42) | remove `'/grid'` |
| `en-GB.json` / `fr-FR.json` `nav.grid` | remove |

> **Mobile — do not skip.** `/grid` **is** in `ALLOWED_MOBILE_ROUTES`; `/team-availability`
> **is not**. Redirect `/grid` while leaving the bottom-nav Grid button in place and every phone
> tap lands on the "Desktop Only" screen. This is the identical shape of the `/my-leave` bug
> already recorded in this repo. Both the nav item and the allowlist entry go, together, in the
> same commit — the merged grid is a wide table and desktop-only is the honest answer.

### Phase 5 — docs & gates
15. Update: [`rulebook/06-workflows.md:182`](../rulebook/06-workflows.md),
    [`rulebook/01-codebase-discovery.md:69,195`](../rulebook/01-codebase-discovery.md),
    [`rulebook/17-production-audit.md:146`](../rulebook/17-production-audit.md) (drop `GridPage`
    from the org-scope offender list — it is gone),
    [`persona-toggle-plan.md:259`](./persona-toggle-plan.md),
    [`modules/people-mode/03-utilization-analysis.md:129`](../modules/people-mode/03-utilization-analysis.md)
    (path moved). Leave `docs/investigations/2026-04-29_*` alone — it is a dated record.
16. Fold this document's outcome back into `team-availability-page-plan.md` §0.

---

## 5. Tests

Preserve `insights/model/__tests__/grid-compliance.test.ts` verbatim through the move — it is the
regression net for the false-positive wall. New cases:

- **§2.1** a 4-week window that breaches only when the 3-week lookback is included → must report
  `violation` in Week view. *This is the test that justifies the whole widened-fetch design.*
- **§2.2** a month whose first ISO week is 3/7 visible → week total equals the full 7-day sum and
  is flagged partial.
- **§2.5** a user with `{Full-Time, Casual}` active contracts → resolves FT, gets rolling windows,
  basis 38h; stable across array orderings.
- **§2.4** casual with `contracted_weekly_hours = 0` → no windows, no divide-by-zero.
- **§2.3** draft-only day → hours present, draft-marked, still counted in the week total.
- **§2.7** shift assigned to a non-member → orphan notice fires, no phantom row.
- Render: three cell modes × two densities; week column count matches `buildWeekColumns`.

Gates: `npx tsc -p tsconfig.app.json --noEmit` (the bare root `tsc --noEmit` compiles nothing),
`vitest`, `npm run build`.

---

## 6. Explicitly dropped

**The whole-year axis.** `/grid` offered 2024 / 2025 / 2026. In production the `shifts` table
holds **336 rows spanning 2026-08-06 → 2026-09-30** — the 2024 and 2025 tabs are entirely empty
and 2026 renders 363 of 365 columns blank. The capability being retired is, against current data,
a mostly-empty 365-column table. If an annual roll-up is wanted later it should be an aggregate
(hours per person per month), not a re-creation of this grid — and it belongs in `/insights`,
which is already the aggregate surface.

Also dropped: Grid's `scope.org_ids[0]` behaviour (a bug), and its inclusion of cancelled shifts
in hours (§2.6).

---

## 7. What shipped, and what is still open

Phases 3–5 landed together. Gates green: `tsc -p tsconfig.app.json` 0 errors, **155 files /
2178 vitest**, build 7.4s.

| Area | Change |
|---|---|
| [`coverage-palette.ts`](../../src/modules/availability/ui/team/coverage-palette.ts) | `severityStyle` (status) + `hoursFill` (sequential), validator runs recorded in the header |
| [`TeamAvailabilityGrid.tsx`](../../src/modules/availability/ui/team/TeamAvailabilityGrid.tsx) | `cellMode`, week total columns, sticky compliance column, severity-tinted avatar, visa badge, draft styling, fixed width divisor |
| [`TeamAvailabilityPage.tsx`](../../src/modules/availability/pages/TeamAvailabilityPage.tsx) | cell-mode control, `useTeamHours` wiring, drafts chip, orphan + truncation notices, 9 new CSV columns |
| `AppRouter` · `routePrefetch` · `AppSidebar` · `BottomNavbar` · `MobileAccessGuard` · both locales | `/grid` retired |
| `GridPage.tsx` · `grid-compliance.ts` · its test | deleted |

**Two decisions worth recording.**

**Severity colour is a STATUS ramp, not a categorical one.** The first candidate pair failed the
validator's hard normal-vision floor — light `#b91c1c` vs `#a16207` at ΔE 13.2, under 15, meaning
two people with full colour vision could not reliably separate a violation from a warning.
Re-stepped to `#b91c1c,#ca8a04,#0d7a54`, which passes every check. Dark mode then hit the opposite
wall: every amber inside the dark lightness band (L 0.48–0.67) collapses onto the red under
deuteranopia (best candidate ΔE 3.7, far under the floor of 6). That band is a *categorical* check
— it exists to stop one series receding behind another — and honouring it here would have traded a
cosmetic evenness problem for a real legibility one. The band FAIL is accepted deliberately; the
reasoning and the runs are in the palette file's header, and identity rests on a glyph plus the
written status column either way.

**Hours and compliance are separate cell modes, not one ramp.** The Annual Shift Grid ramped
emerald for hours and then repainted the same cell red or amber when a cap tripped, putting a
magnitude and a status on one channel — a dark cell meant "long day" until it meant "violation".
Hours now use a neutral sequential ramp and compliance a separate mode; a cell never carries both.

**Open — the merged grid has NOT been opened in a browser.** The colour work is validated by
script and the behaviour by tests, but the dataviz procedure's last step is to render it and
look at it, and that has not happened. Specifically unverified: the `calc()` day-column width that
now has to account for the week and status columns (the arithmetic resolves to exactly 100%, and
`minWidth` still wins on a narrow viewport, which should degrade to a horizontal scroll rather
than an overflow); and the two sticky columns now bracketing the table left and right.

---

## 8. The phone composition

`/team-availability` used to answer a phone with the *Desktop Required* screen. It now has a real
mobile view and both it and `/grid` are allowlisted. Gates green: `tsc` 0 errors, **156 files /
2203 vitest**, build 7.3s.

**It is not a smaller grid, and that is the point.** A people × days matrix cannot satisfy
**SC 1.4.10 (Reflow)** — at 320 CSS px reading one value needs scrolling in two directions — and
shrinking the cells to fit breaks **SC 1.4.4 (Resize Text)** instead. There is no responsive
treatment of a matrix that passes both. So the phone gets a different composition of the same
data: one day, members down the page, one card each, in the same `cellMode` as the desktop cells.
Compliance and week totals survive at day scope because `useTeamHours` always reads its three-week
lookback regardless of what is on screen.

| File | Role |
|---|---|
| [`TeamMobileDayList.tsx`](../../src/modules/availability/ui/team/TeamMobileDayList.tsx) | Members as cards for one day, all three cell modes |
| [`TeamMobileCoverage.tsx`](../../src/modules/availability/ui/team/TeamMobileCoverage.tsx) | Coverage per hour — bars for length, numbers in text |
| `TeamAvailabilityPage.tsx` | `MobileDayStrip` day tablist, mobile branch, 44px controls |
| `MobileAccessGuard` · `BottomNavbar` · `TablePager` | allowlist, "Team Avail" entry, touch targets |

**What each success criterion actually changed:**

- **1.3.1 Info and Relationships** — real `<ul>`/`<li>`, a `<dl>` per card so label→value
  survives being read out of visual order, and an `<h2>` naming the day.
- **1.4.1 Use of Color** — every state carries its word. The desktop heatmap encodes gap as a
  diverging *fill*; on one column that is a colour strip with no scale, so the phone states the
  numbers and uses bar length as the visual channel instead.
- **1.4.3 Contrast** — values and labels wear text tokens. The status hues stay on icons and
  tints, never on text (the light-mode steps sit at 2.75–3:1 and are icon/label-paired by design).
- **2.5.5 Target Size** — the whole card is the target; every control is ≥44×44 (`h-11 md:h-8`,
  keyed to the same 768px breakpoint `useIsMobile` uses).
- **4.1.2 Name, Role, Value** — the card is a real `<button>` when it activates something and
  inert `role="group"` markup when it does not, with the full row summary as its accessible name.
- The day selector is a `role="tablist"` with arrow/Home/End movement and roving `tabIndex`,
  since it selects among sibling panels of the same content.

**One bug the tests caught, worth remembering: `role="group"` on an `<li>` replaces its implicit
`listitem` role.** The coverage rows looked correct and read correctly, but the list was empty to
assistive tech — `getAllByRole('listitem')` returned nothing. An explicit role on a list item is
never additive. The group moved to an inner element.

Shortfall is kept as its own row rather than a darker shade of gap, for the same reason it is a
ring and not "more red" on the desktop heatmap: a gap you can still fill from declared
availability is a rostering task, one you cannot is a recruitment task.

Also unverified in a browser, for the same reason as §7 — no login available. There are no fixed
widths in either mobile component, so nothing should force page-level horizontal scroll, but that
is reasoning, not observation.

---

## 9. Fatigue · Utilization · Fairness — and why only one of them is a cell

Requested as three more per-cell modes. All three shipped, but **at the grain their own canonical
model supports**, because only one of them is a daily quantity. Gates green: `tsc` 0 errors,
**158 files / 2280 vitest**, build 7.3s.

| Metric | Real grain | Where the number is reported | Cells show |
|---|---|---|---|
| **Fatigue** | per (member, **day**) | the cell | the day's peak fatigue + band |
| **Utilization** | per (member, **ISO week**) | the **week column** | the daily hours that build it |
| **Fairness** | per (member), **91-day window** | the **row summary** | that day's ledger *contribution* |

**Fatigue is genuinely daily.** `calculateFatigueWithRecovery(shifts, referenceDate)` is already
defined for any reference date — circadian weighting, and rest decay anchored to the 11-hour
break — and `computePeakFatigue` already samples it per day. The cell takes `peak`, not `current`:
the grid answers "how bad does this get", and `current` decays to midnight, so using it would
report everyone as rested. It reads a 7-day trailing window, covered by the existing 21-day
lookback. Days not worked get NO score — a decayed residue painted across empty cells would make
a fortnight of leave look like a gradient of risk.

**Utilization is not daily, and this codebase already proved it.**
[`workload.ts`](../../src/modules/rosters/domain/projections/utils/workload.ts) floors the
contracted denominator at one week and says why: at `rangeDays=1`, a 38h weekly contract becomes
5.4h and a single legitimate 8h shift reads as **~147% over-utilized**. There is no daily
contracted target in `user_contracts` — only `contracted_weekly_hours`. A per-cell utilization
would have to reinvent the denominator that file deliberately removed, so the percentage lives in
the week column and the cells carry the hours that compose it, labelled as hours.

**Fairness is not daily and not weekly.** `fairness_ledger` is one row per
`(employee, metric, window)` holding `rolling_value`, `team_average` and `debt` — in production,
103 employees × 7 metrics over a 91-day window ending today, cron-recomputed. Fairness is a
*comparison against the cohort*, so one person on one day has no fairness value at all. What IS
per (member, day) is their **contribution** — Saturday, Sunday, night, public holiday — which is
exactly what the ledger counts, so that is what the cells show, under that name. The standing goes
in the row. The distinction is deliberate: the fairness/fatigue audit found five rival definitions
of this word live at once, and a cell renderer is the worst possible place to add a sixth.

Both non-daily modes render an explanatory banner naming where their number actually is, rather
than leaving a plausible-looking cell to be misread.

**Notes on the implementation**

- Fatigue and utilization bands map onto the **existing reserved status ramp** (`severityStyle`) —
  no new hues, so nothing needed re-validating.
- `unsociableDebt` combines only the cl 41-weighted metrics (Sat 1, Sun 2, PH 6, night 1).
  `total_hours` and `denial_rate` are excluded on purpose: folding them in would make someone who
  simply works a lot indistinguishable from someone who works every Sunday.
- The ledger window is **fixed and does not move with the dates on screen**. Navigating to March
  does not re-window fairness, and the UI says "over 91 days" rather than implying it followed.
- The fairness query only fires in fairness mode.

**One bug found while wiring it:** the status column was gated on `cellMode === 'compliance'`,
which would have left utilization and fairness — whose numbers live *in that column* — with
nothing to read. It now renders whenever there is a row-level metric, and the header names the
metric rather than always saying "Compliance".

**Two test premises that were wrong, and the model was right:**
- 16 hours between night shifts genuinely does clear the previous day's fatigue — recovery is
  anchored at 11 hours, so a long gap fully recovers. The accumulation test now uses a clopening
  (3 hours' rest), which is the case the module documents.
- `isNightShift` defines night as work inside **00:00–06:00**, so a 22:00–23:30 shift is not night
  work here. "Starts at 22:00" is the intuitive reading and it is not this codebase's; pinned by
  a test.
