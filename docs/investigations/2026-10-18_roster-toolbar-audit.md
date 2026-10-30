# Roster Planner toolbar — functional and non-functional audit

**Date:** 2026-10-18 · **Code:** `feat/access-suites` at `8477c7c` **plus the uncommitted working tree** (the toolbar files carry the in-progress view-only gating: `VIEW_ONLY_TIP`, `!canEdit` on every write control) · **Database:** Supabase `srfozdlphoempdattvtx`, read-only queries only.

**Scope.** No screenshot was attached to the request, so the toolbar was identified from code: the only roster toolbar with a Publish button is `RosterFunctionBar` (row 3 of the Roster Planner header, `src/modules/rosters/ui/components/RosterFunctionBar.tsx`), mounted at `src/modules/rosters/pages/RostersPlannerPage.tsx:1125`. If the screenshot showed a different bar (e.g. the bottom `BulkActionsToolbar`), this report does not cover it beyond the toggle that opens it.

**Evidence labels.** **Confirmed** = observed by running real code (probe tests, live DB definitions) or unambiguous from code. **Inferred** = follows from code plus documented platform semantics, not reproduced. **Unknown** = could not be established.

**Status labels (per control).** Verified working · Verified defective · Partially verified · Not tested · Unknown.

---

## A. Executive summary

**Overall.** The toolbar is mostly sound in structure: server-side authorisation is in place for every write it triggers, the Publish confirm dialog is a real plan/preview, and the Templates flow has a dry-run confirmation. But the **Publish** path, the toolbar's one consequential action, has two silent failure modes that a manager cannot see. Under a network blip or load it can publish part of a roster while saying "Roster published", and its compliance pre-check fails open. Three of the other controls do less than their UI implies: **Reload** and **Filter** have no effect on the default view, and **Auto-Schedule** ignores the period on screen. **Not production-ready** for Publish until F-01 and F-02 are closed.

**Confirmed functional defects (most important):**
1. **F-01 (High)** — Publish plans from a fetch that swallows errors: a failed page yields a *partial* plan, which is published and reported as success. A failed first page yields "nothing to publish".
2. **F-02 (High)** — Publish's compliance pre-check **fails open**. It passes when the `evaluate-compliance` edge function errors, and it passes (skipping compliance entirely) when a shift's detail fetch fails. The server-side publish RPC checks no compliance rule except approved leave.
3. **F-03 (Medium)** — In Month view, Publish acts on 3 days either side of the month while the dialog names only the month.
4. **F-05 (Medium)** — When the server refuses a batch, the reason is dropped (`message` read, `error` sent). The Publish toast never shows reasons at all.
5. **F-06 / F-07 (Medium)** — Reload and Filter do nothing visible in the default Group view.

**Performance/scalability bottlenecks (confirmed):** one Publish click issues **2N+1 requests with N in flight at once** (measured: N = 500 → 500 shift fetches + 500 edge-function calls concurrently), re-fetching rows the plan already holds. This also feeds F-02, because edge-function errors under that burst turn into "passed". Pagination with a non-unique sort (inferred) can skip or duplicate rows above 1,000 shifts.

**Security / data integrity:** no confirmed vulnerability. Server-side authorisation exists and is HTTP-tested for publish. Concerns: the bulk publish RPC reads state and writes without a row lock or state re-check, a TOCTOU race (F-08, inferred). Employees are told "accept or decline" for shifts that were confirmed directly (F-09). Template-apply audit attribution trusts a client-supplied user id (S-02).

**Major testing gaps:** no test touches `RosterFunctionBar`, `PublishRosterButton`, `loadPublishPlan`/`executePublishRoster`, `shiftsCommands.bulkPublishShifts`, `validateCompliance`'s fallback, Reload, Filters, DnD or Bulk toggles. The only Publish E2E (`e2e/manager-publish.spec.ts`) asserts that the page renders.

**Could not be verified:** browser behaviour (no browser automation available in this session), any database timing (**the dev database holds 0 shifts**; seeding requires a write and approval), concurrency races (need two live sessions), edge-function concurrency limits, HTML5 drag-and-drop on touch/Capacitor. JIRA was not consulted; requirements come from `docs/rulebook/06-workflows.md §5`, code comments and existing tests.

---

## B. Toolbar control inventory

| # | Control (accessible name) | Location | Verified purpose | Status |
|---|---|---|---|---|
| C1 | Mode toggle: "Group/People/Events/Roles roster mode" | `RosterFunctionBar.tsx:366-395` | Sets `activeMode` in `useRosterStore` (persisted); clears selection + bulk mode (`useRosterStore.ts:155`) | Partially verified — F-12 |
| C2 | View toggle Day / 3D / Week / Month | `UnifiedRosterNavigator.tsx:241-262` → page `handleViewTypeChange` (`RostersPlannerPage.tsx:475-488`) | Sets `viewType`; snaps date to week start / 1st of month | Partially verified |
| C3/C5 | "Previous / Next date period" | `UnifiedRosterNavigator.tsx:267-289` | Moves anchor by 1/3/7 days or 1 month; bounded to now ± 12 months (`RosterFunctionBar.tsx:313-319`) | Partially verified |
| C4 | "Change date. Currently showing …" (picker) | `UnifiedRosterNavigator.tsx:196-221` | Date picker; snaps to period start | Partially verified |
| C6 | **Publish** ("Publish roster — send offers, open bidding") | `PublishRosterButton.tsx`; plan/execute in `RostersPlannerPage.tsx:734-803` | Plans every draft in the loaded range, confirms, then publishes: assigned → offer (S3), unassigned → bidding (S5), FT assigned → confirmed (S4), assigned TTS < 4h → emergency confirm (S4). Skips: FT unassigned, on approved leave, unassigned TTS < 4h, started-unstaffed, already published | **Verified defective** — F-01…F-05, F-08, F-09, F-11, P-01 |
| C7 | "Reload data" | `RosterFunctionBar.tsx:450` → `handleRefresh` `RostersPlannerPage.tsx:580-586` | Invalidates `['shifts','list']` and toasts "Refreshed" | **Verified defective** — F-06 |
| C8 | "Roster filters[, N active]" | `RosterFilterPopover.tsx` | Writes `advancedFilters` (persisted) — State ID, lifecycle, assignment, outcome, bidding, trading; client-side filtering only | **Verified defective** — F-07 |
| C9 | "Add Subgroup" (Group mode only) | `RosterFunctionBar.tsx:463-471` → `CentralAddSubGroupDialog` → RPC `add_roster_subgroup_range` | Adds a named subgroup to a group across a date range (creates roster days as needed; skips past days) | Partially verified — F-14 |
| C10 | "Auto-Schedule" | `RosterFunctionBar.tsx:472-480` → `RosterModals.openAutoScheduler` → `AutoSchedulerModal` / `useAutoScheduler` | Opens the solver modal scoped to Draft + unassigned + non-emergent shifts | Partially verified — F-10 |
| C11 | "Templates — apply … or capture …" (+ blue applied-count badge) | `RosterFunctionBar.tsx:481-498` → `RosterTemplatesDialog` | Apply a template to a range (with stacking preview/confirm) or capture the roster as a template | Partially verified — F-15, S-02 |
| C12 | "Activate / Deactivate DnD Mode" | `RosterFunctionBar.tsx:499-524` | Toggles `isDnDModeActive` (session-only) + opens the Unfilled panel; turns off bulk mode | Partially verified — F-12 |
| C13 | "Bulk Selection mode" / "Exit Bulk Selection (Esc)" | `RosterFunctionBar.tsx:529-543` → `setBulkModeActive` | Enters selection mode and mounts `BulkActionsToolbar`; Esc exits (`RostersPlannerPage.tsx` keydown effect) | Partially verified (toggle only) |

Props the page passes but the toolbar does not render (no control exists): `showAvailabilities` / `onAvailabilitiesToggle` (button removed in `24f3cea`, 2026-08-17), `showUnfilledPanel` / `onUnfilledPanelToggle`, `onFiltersClick`, `activeFilterCount` (never passed), `onTemplateChange` (never passed). See M-01.

### Execution flows

**C6 Publish.**
1. `PublishRosterButton.handleClick` calls `loadPublishPlan`, which runs `queryClient.fetchQuery(shiftKeys.byDateRange(...), staleTime 30 s)`. That calls `shiftsQueries.getShiftsForDateRange`, which pages through 1,000-row requests with an 8,000-row cap.
2. `loadLeaveDays` loads leave for the draft assignees.
3. `planPublishRoster` (pure; `bulk-action-engine.ts:210-300`) builds the confirm dialog.
4. On Confirm, `executePublishRoster` calls `useBulkPublishShifts.mutateAsync`, which applies an optimistic patch of the shift lists.
5. `shiftsCommands.bulkPublishShifts` (`shifts.commands.ts:660`) does a per-shift `getShiftById` and `evaluate-compliance` edge-function call, all in parallel.
6. Shifts that pass go to RPC `sm_bulk_publish_shifts(ids, actor)`: a single SQL statement with per-shift `sm_require_shift_action(…,'shift.publish')`, FSM routing, and an approved-leave exclusion. Emergency shifts instead go to `sm_apply_shift_op('publish')`, one per shift, with a version check.
7. Triggers on `shifts` fire, including `trg_shift_notifications` (employee notifications), `trg_capture_shift_event` (audit/metrics) and `trg_increment_shift_version`.
8. `onSettled` invalidates lists (`refetchType:'none'`), rosters and aggregates, then a toast is shown.

**C7 Reload.** `queryClient.invalidateQueries({queryKey: ['shifts','list']})` runs, then a toast is shown immediately (it does not wait for the refetch).

**C8 Filter.** `advancedFilters` (Zustand, persisted to `localStorage` `roster-ui-v3`) are consumed by `useRosterProjections` → `applyAdvancedFilters` and by `GroupModeView`'s legacy branch. They are never sent to the server.

**C9–C11** open lazily-loaded dialogs (mounted only when open). **C12–C13** are pure client state.

---

## C. Findings register

Severity reflects technical severity. Business impact is stated separately. Scale: **Critical** = data loss or security breach reachable in normal use (none found). **High** = wrong business outcome reachable in realistic conditions, silently. **Medium** = wrong or misleading outcome for a subset of users or edge conditions, or feedback that leads to operational mistakes. **Low** = minor, cosmetic, maintainability, or hard to reach.

### F-01 · Publish can silently publish a partial roster — High · Confirmed

- **Evidence.** `shifts.queries.ts:469-472`: a page error returns the rows collected so far. `:482-484`: an exception returns `[]`. Neither throws. `RostersPlannerPage.tsx:750-754` builds the plan from that result. The `catch` in `PublishRosterButton.tsx:179-186` ("Could not prepare publish") is therefore unreachable for fetch failures. The 8,000-row cap (`shifts.queries.ts:461-466`) truncates the same way, with only a `console.warn`.
- **Reproduction (probe F-4, real `getShiftsForDateRange`, mocked builder).** Page 1 returns 1,000 rows, page 2 returns error `57014` (statement timeout), page 3 returns 500 rows. Result: 1,000 rows, no throw. `planPublishRoster` → 1,000 actionable of 2,500. When the first page fails, the result is `[]`, which the dialog shows as "No draft shifts in the current view — nothing to publish."
- **Expected (rulebook Ch. 6 §5; dialog copy "applied to every draft shift in the current view").** Either every draft in view is planned, or the manager is told the plan could not be loaded.
- **Root cause.** A read helper designed to degrade gracefully for display is reused for a write decision. `fetchQuery` also caches the partial result as a success for 30 s.
- **Impact.** The manager believes the roster is out. Some staff receive offers and others don't. Unpublished shifts are discovered late, possibly inside the 4 h window, where unassigned shifts can no longer go to bidding.
- **Remediation.** Give write paths a strict fetch that throws (or returns `{rows, complete}`). Refuse to plan when incomplete. Say so in the dialog when the row cap is hit. Use `staleTime: 0` for the plan fetch. Keep the forgiving variant for the grid.
- **Regression tests.** Unit: strict fetch throws on a page error. Component: `PublishRosterButton` shows "Could not prepare publish" when `loadPlan` rejects. Integration: a plan over more than 1,000 rows equals the DB count.
- **Confidence.** High. The failure *frequency* in production is unknown.

### F-02 · Publish's compliance pre-check fails open (two paths) — High · Confirmed

- **Evidence.**
  - (a) `compliance.service.ts:120-157`. When `supabase.functions.invoke('evaluate-compliance')` errors, `validateCompliance` runs `prevalidation.runHardValidation` with `existing_shifts: []`. That checks only past date/time and start = end, so any future shift returns `status:'passed'`. This contradicts the file's own rule (F5, `:187-191`): "'unavailable' must NOT be treated as valid … to prevent silent saves when the compliance engine is unreachable."
  - (b) `shifts.queries.ts:295-298`: `getShiftById` returns `null` on any error. `shifts.commands.ts:673` treats `!shift?.assigned_employee_id` as *unassigned*, which gives `pass:true` with no compliance call.
  - Server: the live `sm_bulk_publish_shifts` checks authorisation, FSM state, time category and approved leave only. No rest-period, hours, qualification or pay rule.
- **Reproduction (probes F-1, F-2).**
  - Edge function returns `FunctionsHttpError: 503` → `validateShiftCompliance` returns `{isValid:true, status:"passed", violations:[]}`.
  - `getShiftById` returns `null` for an assigned shift → `validateShiftCompliance` is never called → `sm_bulk_publish_shifts(['shift-A'])` is called → `publishedIds:['shift-A']`.
- **Expected.** An unreachable engine or unreadable shift blocks that shift (fail closed), per the F5 rule.
- **Impact.** Shifts that breach rules only the engine checks (rest gaps, weekly hours, qualifications) can be offered, or for FT and emergency shifts confirmed directly (S4). Partly mitigated: rulebook Ch. 6 §1 says compliance is evaluated at assignment time. But that path calls the same `validateCompliance`, so it has the same fail-open. The DB keeps its own backstops (overlap, FT one-per-day, approved leave, shape).
- **Aggravated by P-01.** The pre-check fires N edge-function calls at once, the condition most likely to produce errors.
- **Remediation.** Treat `null` shift as `complianceFailed: 'Could not load shift'`. Return `'unavailable'` (not `'passed'`) when the remote engine fails, at least on the bulk path. Longer term, one batched server-side compliance evaluation per publish.
- **Regression tests.** The two probe cases, inverted, as permanent tests in `src/modules/rosters/api/__tests__/`.
- **Confidence.** High for the mechanism. How often the edge function errors under load is unknown.

### F-03 · Month-view Publish acts outside the month the dialog names — Medium · Confirmed

- **Evidence.** The page's Month range is month ± `MONTH_BUFFER_DAYS = 3` (`RostersPlannerPage.tsx:119, 266-279`), and the plan uses that range (`:745-748`). The dialog label is `computeRange(...)`, i.e. `startOfMonth..endOfMonth` (`UnifiedRosterNavigator.tsx:65-66`, `RosterFunctionBar.tsx:417-418`).
- **Reproduction.** Month view, October 2026, with drafts dated 29 Sep and 2 Nov. The dialog reads "Month · October 2026". Confirm publishes the 29 Sep and 2 Nov drafts too.
- **Expected.** The dialog states the exact dates acted on.
- **Root cause.** Two independent range computations.
- **Impact.** Offers or bidding opened for the neighbouring weeks, which may be another manager's planning period. The buffer days are rendered in the grid, so they are "in view", but the label contradicts that.
- **Remediation (product decision).** Either plan on `computeRange` or label the real span ("28 Sep – 3 Nov"). Related, inferred: Week view plans `selectedDate … +6` but labels Mon–Sun. These agree only when `selectedDate` is a Monday. All known setters snap to Monday except ghost-cell navigation (`RostersPlannerPage.tsx:591-594` sets the 1st of the month whatever the view).
- **Regression test.** A unit test over a single exported range function used by both page and dialog.

### F-04 · Mixed-access managers see Publish enabled, then nothing publishes — Medium · Confirmed by code, not reproduced

- **Evidence.** `canEdit = hasPermission('update')` (`RostersPlannerPage.tsx:334`). This resolves `managerial-write` from the whole holding: `managerialMode` returns `'full'` if *any* level is gamma or zeta (`accessSuites.ts:80-85`). It is not scope-aware. The server refuses the **whole** batch if any shift is out of scope. That is intended and tested: `tests/integration/flows/shift-lifecycle.int.test.ts:113`.
- **Scenario.** A person with a gamma contract in Department A and a view-only delta contract in Department B, with both in scope. Every write control is enabled. Publish sends B's drafts, and A's drafts are rejected along with them.
- **Impact.** Nothing publishes, and the toast says only "N skipped" (see F-05). The in-progress `VIEW_ONLY_TIP` gating inherits the same blind spot.
- **Remediation.** Partition the plan by the user's per-scope publish right before sending, and show the excluded count. Alternatively, make `canEdit` scope-aware.
- **Open question.** Can one person hold different managerial levels across contracts in today's data? The model allows it: access level is carried per contract row (see `docs/architecture/access-suites-plan.md`).

### F-05 · Publish failure reasons are lost — Medium · Confirmed

- **Evidence.** The RPC's error branch returns `{success:false, error: SQLERRM}`. The client reads `result.message || 'Bulk publish failed'` (`shifts.commands.ts:751`; the schema `contracts/index.ts:146-156` has `message`, not `error`). `executePublishRoster` collects `failedReasons` (`RostersPlannerPage.tsx:797`), but `PublishRosterButton.tsx:194-202` shows only counts.
- **Reproduction (probe F-3).** Server returns `error: 'Not authorised: shift.publish is not granted to you in this scope'`. Every `dbFailed.reason` is "Bulk publish failed".
- **Impact.** Managers can't tell an authorisation, leave, state or timeout problem apart, and retry blindly.
- **Remediation.** Read `result.error ?? result.message`. Show grouped reasons in a result panel (the bulk toolbar already has one).

### F-06 · Reload does not refresh the default view — Medium · Confirmed

- **Evidence.** `handleRefresh` (`RostersPlannerPage.tsx:580-586`) invalidates only `['shifts','list']`. In the default Group view, cells come from `['shifts','summary',…]`, the footer from `['shifts','plannerStats',…]`, and rows from `['rosterStructure',…]`. None of these is invalidated. In Month + Group the list query is disabled (`isGroupBucketView`, `:177`), so the spinner (`isRefreshing` = that query's `isFetching`) never turns. "Refreshed" is toasted synchronously, even if the refetch later fails.
- **Reproduction (probe F-6, real `QueryClient` + real key factories).** After Reload: `{list:true, summary:false, plannerStats:false, structure:false}`.
- **Impact.** After another manager's changes, or a background job (offer expiry, bidding close), Reload shows stale numbers and claims success.
- **Remediation.** Invalidate `shiftKeys.summaries`, `shiftKeys.plannerStatsRoot` and `[ROSTER_STRUCTURE_KEY]` too. Await the active refetches before toasting. Show the spinner while any of them is fetching.

### F-07 · Filters have no visible effect in the default Group view — Medium · Confirmed by code

- **Evidence.** `GroupModeView.tsx:2286-2288`: when `!isDnDModeActive && summaryData`, rows are built from the server summary and returned before any filter runs. `summaryData` is always passed in Group mode (`RostersPlannerPage.tsx:1374`). The summary RPC takes only org, date and department filters. Meanwhile the Filter button shows its active state and badge (`RosterFilterPopover.tsx:46-60`). Bulk bucket-selection also ignores filters.
- **Impact.** "Assigned only" still shows unassigned counts. Managers can conclude the data is wrong.
- **Remediation (product decision).** Push the filter fields to `get_roster_summary`, or disable Filter in Bucket View with an explanation.
- **Not runtime-verified.** No browser available.

### F-08 · Bulk publish has a read-then-write race (TOCTOU) — Medium · Inferred

- **Evidence (live definition).** `sm_bulk_publish_shifts` computes `current_state` in a CTE (`get_shift_state_id`), then `UPDATE … FROM valid_transitions WHERE s.id = vt.id`. It takes no `FOR UPDATE`, re-checks no state and compares no version. Under READ COMMITTED, a row changed after the statement's snapshot is re-evaluated against `s.id = vt.id` only, so the stale transition is applied. Rulebook Ch. 6 §5 says publish goes through the gateway (`sm_apply_shift_op`, which does `FOR UPDATE` and a version check). The toolbar's normal path bypasses it.
- **Scenario.** Manager A publishes the week. During that statement, Manager B assigns someone to an S1 shift through the gateway. A's update still writes the S5 columns (`bidding_status='on_bidding'`, `fulfillment_status='bidding'`) onto a now-assigned shift. Two concurrent publishes of the same range re-write `published_at`, `offer_sent_at` and `offer_expires_at`. Duplicate employee notifications are **not** expected, because the trigger keys on `OLD.lifecycle_status='Draft'` and dedupes by key.
- **Remediation.** In the RPC, lock target rows (`SELECT … FOR UPDATE` in the CTE) and re-check state in the UPDATE (`AND public.get_shift_state_id(s.id) = vt.current_state`), or carry versions from the plan. Ship it as a migration following the project's DB workflow (hash-check the live body, apply via MCP after confirmation).
- **Test plan.** See §D.

### F-09 · "Accept or decline" notification for shifts confirmed directly — Medium · Confirmed (FT path)

- **Evidence (live `trg_shift_notifications`).** Path A fires on Draft → Published with an assignee, whatever `assignment_outcome` is. It sends "New shift offer … check your Offers inbox to accept or decline". FT shifts (S2 → S4) and emergency shifts (S2 → S4) are published as `assignment_outcome='confirmed'`, and the dialog tells the manager "Confirmed directly — contracted hours, no offer to accept".
- **Unverified.** Whether `trg_emergency_assignment_notification` sends a second, correct message on the emergency path.
- **Remediation.** Branch the notification on `NEW.assignment_outcome`.

### F-10 · Auto-Schedule ignores the period on screen — Low · Confirmed by code

`autoScheduleRange` is computed for the current view (`RosterFunctionBar.tsx:322-334`) and never used. The modal's default window is the min–max date of the page's unassigned drafts (`useAutoScheduler.ts:206-210`). In Month + Group Bucket View the page's shift list is gated off, so it is empty and the modal opens with no dates and the error "Please select both start and end dates". **Fix:** pass `autoScheduleRange` as the initial window.

### F-11 · Publish dialog edge cases — Low · Confirmed

- If the plan holds only skips (e.g. everything already published), Confirm stays enabled (`PublishRosterButton.tsx:87-93, 343`). It runs with no ids and toasts "Roster published — Nothing to publish."
- Drafts whose start has passed (assigned, or unassigned and already ended) fall into no bucket (`bulk-action-engine.ts:259`), so a view of only past drafts says "No draft shifts in the current view". The doc comment at `:205` ("every draft shift falls into exactly one bucket") is not true.
- The range card falls back to a hard-coded `'6 Jul - 12 Jul'` (`:260`). This isn't reachable today, but it is wrong.

### F-12 · DnD can stay on in Events mode with no way off — Low · Confirmed by code

`setActiveMode` does not clear `isDnDModeActive` (`useRosterStore.ts:155`). In Events the DnD button is disabled (`RosterFunctionBar.tsx:523`), and Bulk is disabled while DnD is on (`:542`). The Unfilled panel stays open. The only way out is to switch mode.

### F-13 · Disabled controls explain themselves only in a tooltip — Low · Confirmed (keyboard), Unknown (hover)

Every gated IconButton is a native `disabled` `<button>` whose only explanation ("select a department first", the new `VIEW_ONLY_TIP`) is its tooltip and `aria-label` (`RosterFunctionBar.tsx:184-201`). Disabled buttons leave the tab order, so keyboard users can never open the tooltip (confirmed by HTML semantics). Whether hover opens a Radix tooltip on a disabled button depends on the browser's pointer-event dispatch, which is unverified here. A disabled Publish button gives no explanation at all. **Fix:** `aria-disabled` + no-op handler instead of `disabled`, or a focusable wrapper.

### F-14 · Add Subgroup edge cases — Low · Confirmed

- The toolbar enables the button with only a department selected (`RosterFunctionBar.tsx:469`), but the dialog then requires a sub-department (`CentralAddSubGroupDialog.tsx:121`). It does explain why.
- The custom range has no validation. End-before-start or an emptied date makes `format()` throw inside the `try` before `mutateAsync`, so Submit silently does nothing (`:127-145`). There is no length cap.
- Server (live `add_roster_subgroup_range`): an unbounded day loop, and the past-day skip uses `CURRENT_DATE`, which is UTC. Before 10–11 am Sydney, yesterday's Sydney date is not skipped.

### F-15 · Templates capture count hides failures — Low · Confirmed by code

The capture-count query (`RosterTemplatesDialog.tsx:482-503`) treats an error as `count = 0` and shows "No shifts in this range to capture".

### S-01 · Server-side authorisation — Verified working

Live definitions: `sm_bulk_publish_shifts` (per-shift `sm_require_shift_action('shift.publish')`, actor forced to `auth.uid()`), `sm_apply_shift_op`, `add_roster_subgroup_range` (7-arg: `sm_require_scope('roster.edit')`), `apply_template_to_date_range_v2` and `preview_template_application` (`sm_require_template_apply`). All are SECURITY DEFINER and none can be executed by `anon`. The unguarded legacy 5-arg `add_roster_subgroup_range` cannot be executed by `authenticated` either. Frontend gating is not relied on for security. Publish authorisation is HTTP-tested (`shift-lifecycle.int.test.ts:96-119`). CSRF: not applicable, since supabase-js sends a bearer JWT in a header, not a cookie (inferred). Injection: PostgREST/RPC parameters are typed; none found.

### S-02 · Template-apply audit attribution trusts the client — Low · Confirmed

`apply_template_to_date_range_v2` inserts `roster_template_batches.applied_by = p_user_id` (client-supplied) after its guard. An authorised applier can attribute a batch to someone else. This is the same pattern that was fixed in `sm_bulk_publish_shifts` on 2026-10-13. **Fix:** use `auth.uid()` unless the caller is the system.

### Maintainability

- **M-01** Dead wiring in `RosterFunctionBar`: unused imports (`ChevronLeft/Right`, `PanelRight`, `Send`, `Calendar`, `Select*`, `Button`), unused `queryClient`, `rosters`, `selectedTemplate`, `autoScheduleRange`, seven never-rendered or never-passed props. `tsconfig.app.json` has `noUnusedLocals: false`, so none of this is flagged. The availability overlay in People mode is now unreachable. **Open question:** is that intended?
- **M-02** Two exports named `ROSTER_STRUCTURE_KEY` with different values: `queryKeys.ts:68` (`['rosters']`, unused by the structure hook) and `useRosterStructure.ts:6` (`'rosterStructure'`, the real one). Probe M-2 confirms the values. This is a trap for the next person who imports the wrong one.
- **M-03** Stale comments:
  - `RosterFunctionBar.tsx:133-139` and `RostersPlannerPage.tsx:1159` say Publish deletes "dead" shifts. It no longer does.
  - `useRosterStore.ts:126` says the selected date is not persisted, but `partialize` persists it (`:281`).
- **M-04** The 4-hour emergency boundary is defined in at least four places (`EMERGENT_WINDOW_MS`, `FOUR_H_MS`, `FOUR_HOURS_MS`, SQL `get_time_category`), with `<` in some and `≤` in others. That is a drift risk at exactly 4 h.

---

## D. Performance and scalability results

**Environment for measurements:** Apple M4 Pro, macOS, Node v24.13.0, Vitest 4.0.18 (jsdom). Probes run the real module code with only the network boundary mocked. Simulated latency is 5 ms per request. The probe tests lived in the audit session's scratchpad and are not committed. Each one is described in its finding and can be turned into a permanent regression test.

| ID | What | Method | Result | Verdict |
|---|---|---|---|---|
| P-01 | Requests per Publish click | Probe P-1: count + max in-flight of `getShiftById` and `functions.invoke` in real `bulkPublishShifts` | N=50 → 50 + 50; N=200 → 200 + 200; N=500 → **500 fetches + 500 edge calls, all in flight simultaneously**; +1 RPC | **Bottleneck (Medium).** 2N+1 requests, unbounded concurrency, re-fetches rows the plan already has. Already listed as open in rulebook Ch. 17 §9; this adds the measured concurrency and the link to F-02 |
| P-02 | Plan computation | Probe P-2: `planPublishRoster`, mean of 20 | 1,500 shifts 0.32 ms; 8,000 shifts 1.62 ms | Not a bottleneck |
| P-03 | Optimistic patch in `useBulkPublishShifts` | Probe P-3: real hook via `renderHook`, command mocked instant, 3 cached lists | 1,500 shifts 6.0 ms; 5,000 shifts **54.8 ms** (3.3× data → 9× time) | Low. Quadratic `ids.includes` inside `map` (`useRosterShifts.ts:927, 945`); use a `Set` |
| P-04 | Wasted toolbar queries | Code reading | `useRostersLookup` (result unused), `useTemplates` (no `enabled` guard; feeds only an effect whose output is unused), plus a separate single-day `useRosterStructure` for the badge: about 3 requests per load or date change | Low; easy win |
| P-05 | Pagination correctness at scale | Code + PostgreSQL semantics | `ORDER BY shift_date, display_order, start_time` is not unique, so `LIMIT/OFFSET` pages can skip or repeat tied rows above 1,000 rows | Medium, inferred. Add `id` as the final sort key |
| P-06 | Render churn | Code reading | `autoSchedulerShifts` / `autoSchedulerEmployees` rebuilt inline every page render (`RostersPlannerPage.tsx:1473-1500`); `RosterFunctionBar` not memoised and receives fresh inline callbacks; one `TooltipProvider` per IconButton | **Not measured.** Needs React Profiler in a browser |
| P-07 | Server cost of `sm_bulk_publish_shifts` | Live definition | Per row: `get_shift_state_id` (extra row lookup), `employee_on_approved_leave`, `sm_require_shift_action` → `user_has_action_in_scope`. One statement, all-or-nothing | **Not measured.** The dev DB has **0 shifts** (501 profiles). Indexes for the range read exist (`idx_shifts_org_dept_date`, `idx_shifts_org_dept_subdept_date`, both partial on `deleted_at IS NULL`) |

**Not measured, and what is missing:** real API latency and payload size (no browser, no data), DB query plans with data (0 rows; seeding is a write), edge-function behaviour under 500 concurrent calls (rate or concurrency limits unknown), memory and leaks (needs browser heap snapshots), INP and long tasks on toolbar clicks.

**Proposed SLOs** (no targets exist in the repo; these are proposals to agree, not measured facts):
- Plan load p95 ≤ 2 s for ≤ 1,500 shifts.
- Confirm-to-result p95 ≤ 5 s for ≤ 500 drafts.
- **Zero silent partial publishes** (hard invariant).
- Reload p95 ≤ 1.5 s.
- Toolbar interaction INP ≤ 200 ms.

**Safe test plan (do not run against the shared dev DB):**
1. *Load:* on the CI throwaway stack (`api-integration` job), seed 500 / 1,500 / 5,000 drafts across 3 departments. Measure plan-fetch time, `bulkPublishShifts` wall time with the real edge function, and the edge-function error rate at concurrency N. Time the RPC inside `BEGIN; EXPLAIN (ANALYZE, BUFFERS) SELECT sm_bulk_publish_shifts(...); ROLLBACK;`.
2. *Concurrency (F-08):* two persona clients on the same stack. (a) Bulk-publish 200 S1 shifts while the other assigns one of them through `sm_apply_shift_op`; repeat 50 times. Assert the final state is a legal FSM state with consistent `assignment_status`/`bidding_status`. (b) Two simultaneous bulk publishes of the same ids. Assert one notification per employee and an unchanged `published_at` after the first commit.
3. *Failure injection:* fail page 2 of the plan fetch, and fail 10% of edge-function calls. Assert Publish refuses or blocks rather than passing.

---

## E. Test coverage matrix

| Control / requirement | Existing tests | Required new tests | Unverified |
|---|---|---|---|
| Publish routing S1→S5, S2→S3, S2→S4 (<4h), FT S2→S4, skips (rulebook Ch. 6 §5) | `bulk-action-engine.test.ts` (12, pass): `planPublishRoster` buckets | `bulkPublishShifts`: routes emergency to gateway, normal to RPC; reconciles on `failure_count>0` | Server FSM with real data |
| Publish authorisation | `shift-lifecycle.int.test.ts` 96-119 (HTTP): in-scope OK, employee refused, mixed batch refused whole | Client partitions plan by scope (F-04) | — |
| Publish fails closed on fetch/engine errors | none | F-01, F-02 cases (probes, inverted) | Real edge-function error rate |
| Publish dialog range = acted range | none | F-03 single range function test | Week alignment via ghost cells |
| Publish result feedback | none | Shows server reason; shows per-reason groups (F-05) | — |
| Publish concurrency / idempotency | none | Plan §D-2 | Everything (needs two sessions) |
| Employee notification content | none | FT / emergency publish → "rostered", not "offer" (F-09) | Emergency double notification |
| Reload | none | Invalidates list + summary + stats + structure; toast after settle (F-06) | Visual |
| Filters | none for UI; `applyAdvancedFilters` untested directly | Bucket View respects filters, or Filter disabled there (F-07) | Visual |
| Navigator | `navigatorViews.test.tsx` (3, pass): `views` prop only | prev/next bounds, picker snap | — |
| Mode toggle / DnD / Bulk | none | DnD cleared or escapable in Events (F-12); Esc exits bulk | Touch DnD (HTML5 backend) |
| Add Subgroup | none | Invalid custom range shows an error (F-14) | Server range cap |
| Auto-Schedule entry | none | Opens on the viewed range (F-10) | Solver behaviour (out of scope) |
| Templates | not traced in this audit | Count error ≠ zero (F-15) | Apply/undo correctness (see memory: template-application facts) |
| Accessibility | `e2e/accessibility.spec.ts` (not run here) | Disabled reasons reachable by keyboard (F-13) | Screen-reader output |
| E2E publish | `e2e/manager-publish.spec.ts`: page renders only | Seeded draft → Publish → state + notification | — |

---

## F. Remediation plan

**1. Critical** — none found.

**2. High: correctness, security and reliability (do first, together).**
- **F-01 + F-02 + P-01** form one change: Publish should plan from a strict, complete fetch, then send those plan rows (no per-shift re-fetch) to a compliance check that fails closed. The batched or server-side version also removes the 2N fan-out.
  - *Dependencies:* `getShiftsForDateRange` is shared by the grid, so add a strict variant rather than change it. `validateCompliance`'s fallback is shared by single-shift paths, so decide fail-closed globally or per caller.
  - *Risk:* more publishes blocked when the engine is unhealthy. That is the intended trade, but say so in the UI.
  - *Done when:* the inverted probes pass as permanent tests, and the failure-injection plan (§D-3) passes on the CI stack.

**3. Medium: correctness, integrity, feedback.**
- **F-05** (read `error`; show reasons). Smallest and safest; do alongside F-01/F-02.
- **F-03** (needs a product decision: buffer or no buffer). **F-04** (scope-aware plan).
- **F-08** (row lock + state re-check in `sm_bulk_publish_shifts`). DB migration: hash-check the live body, apply via MCP after confirmation, then run concurrency test §D-2 in CI.
- **F-09** (notification copy by outcome). DB migration; check for overlap with `trg_emergency_assignment_notification`.
- **F-06** (Reload scope). **F-07** (needs a product decision). **S-02** (`auth.uid()` for `applied_by`).

**4. Performance and scalability.**
- P-05: unique sort key for pagination.
- P-04: drop the wasted toolbar queries.
- P-03: use a `Set` in the optimistic patch.
- P-06: memoise the derived props, after profiling in a browser.
- Then run the load plan (§D-1) and set the SLOs.

**5. Maintainability and low priority.**
- F-10, F-11, F-12, F-13, F-14, F-15, M-01…M-04.
- M-02 and M-03 are quick and remove traps that caused real bugs elsewhere in this codebase.

**Open questions for the product owner:**
- Should Month-view Publish include the buffer days (F-03)?
- Should Filters apply to the summary cells (F-07)?
- Is the People-mode availability overlay retired (M-01)?
- Can one person hold different managerial levels across contracts (F-04)?
