# Implicit Roster Activation — research + implementation plan

**Date:** 2026-08-05
**Goal:** Remove the manual "activate the roster first" step. A manager should be able to
apply a template or add a shift on any future date without a separate activation action.

---

## 1. What "activation" actually is

`rosters` is one row per `(start_date, department_id, sub_department_id)` — a *day container*,
not a plan document. Enforced by:

```
uk_rosters_date_dept_subdept ON rosters (start_date, department_id, COALESCE(sub_department_id, '000…'::uuid))
```

`shifts.roster_id` is **`NOT NULL`** (verified against prod, not just the migration file).
So "no activation" cannot mean "no roster row" — it has to mean **the roster row is created
implicitly, on first write**. This is a lazy-create feature, not a delete-the-concept feature.

The grid is already date-driven, not roster-driven: [GroupModeView.tsx:1832](src/modules/rosters/ui/modes/GroupModeView.tsx#L1832)
seeds the four fixed venue groups unconditionally, and the date columns come from the selected
range. Un-activated days already **render** fine. Only **writes** are blocked.

### Correction to the earlier read of this

I previously said the backend "already handles it" for templates and that this was purely a
frontend guardrail. The first half is right, the second half is too generous — see §3, blocker 3
(`sm_create_shift` raises server-side) and §4 (a live NULL-handling bug in the template path).
There are also **four** blocked write paths, not two.

---

## 2. Verified prod state (project `srfozdlphoempdattvtx`)

| Check | Result |
|---|---|
| `shifts.roster_id` nullable | **NO** |
| `rosters` rows | 163 |
| `rosters` with `sub_department_id IS NULL` | **0** |
| `rosters` with no `roster_groups` | **0** |
| `shifts` rows (incl. soft-deleted) | **0** |
| `sm_create_shift` has `target_employment_type` | **NO** — migration `20260805060000` is **unapplied** |
| `sm_create_shift` raises `Roster ID is required` | **YES** |
| `apply_template_to_date_range_v2` uses `sub_department_id = v_sub_dept_id` | **YES** (NULL-unsafe) |
| `rosters` RLS INSERT policy | `user_has_action_in_scope('roster.edit', org, dept, sub_dept)` |
| `roster_groups` / `roster_subgroups` RLS | `FOR ALL … USING (true)` to `authenticated` |

Two of these deserve a flag before anything is built:

- **`shifts` is empty in prod.** 892 shifts existed when migration `20260805060000` was written
  earlier today. Worth confirming this was an intentional reset before we ship anything that
  writes to the table. It does simplify the migration (no backfill).
- **`20260805060000_sm_create_shift_target_employment_type_passthrough.sql` is unapplied.** Any
  new `sm_create_shift` migration must be sequenced *after* it and rebased onto its body, or the
  two `CREATE OR REPLACE`s clobber each other. Same trap as the `approve_trade` regression.

---

## 3. The four blockers

| # | Path | Location | Behaviour |
|---|---|---|---|
| 1 | Grid → Add Shift | [GroupModeView.tsx:2234](src/modules/rosters/ui/modes/GroupModeView.tsx#L2234) | toast `Roster Not Activated`, returns |
| 2 | Apply Template | [ApplyTemplateDialog.tsx:166](src/modules/rosters/ui/dialogs/ApplyTemplateDialog.tsx#L166), [:179](src/modules/rosters/ui/dialogs/ApplyTemplateDialog.tsx#L179), [:423](src/modules/rosters/ui/dialogs/ApplyTemplateDialog.tsx#L423) | `isFullyActivated` disables Inject |
| 3 | Shift form | [useShiftFormOrchestrator.ts:309](src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/hooks/useShiftFormOrchestrator.ts#L309), [:631](src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/hooks/useShiftFormOrchestrator.ts#L631), [:806](src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/hooks/useShiftFormOrchestrator.ts#L806) + `sm_create_shift` | `hasRoster` blocks `canSave`; RPC raises `Roster ID is required` |
| 4 | Demand → Inject | [LaborDemandForecastingPage.tsx:1315](src/modules/rosters/pages/LaborDemandForecastingPage.tsx#L1315) | `No active roster found for {date}. Create a roster first.` |

Secondary paths that pass a possibly-undefined `rosterId` and currently fall through to
blocker 3: [RolesModeView.tsx:539](src/modules/rosters/ui/modes/RolesModeView.tsx#L539),
[EventsModeView.tsx:400](src/modules/rosters/ui/modes/EventsModeView.tsx#L400),
[DrillDownPanel.tsx:285](src/modules/rosters/ui/components/DrillDownPanel.tsx#L285).

### The group-id subtlety

`sm_create_shift` auto-creates a missing **subgroup** — but only when `shift_group_id` is already
non-null (`sm_create_shift` L56). When no roster exists, `buildShiftContext` passes
`groupId: group.id`, and `group.id` is **`null`** for the four seeded standard groups
([GroupModeView.tsx:1833](src/modules/rosters/ui/modes/GroupModeView.tsx#L1833) calls
`ensureGroup(null, …)`). So naively deleting the gate produces shifts with `shift_group_id = NULL`
and `roster_subgroup_id = NULL`. They'd still *render* (the ad-hoc bucket at
[GroupModeView.tsx:1870](src/modules/rosters/ui/modes/GroupModeView.tsx#L1870)) but would be
invisible to the structure RPCs — `rename_roster_subgroup_v2`, `delete_roster_subgroup_v2`,
`clone_roster_subgroup_v2` all operate on `roster_subgroups` rows. **Lazy roster creation must
also ensure the four `roster_groups`, and `sm_create_shift` must re-resolve `shift_group_id`
from `(roster_id, group_type)` when it arrives NULL.**

---

## 4. Two bugs this work must fix, not inherit

**4a — `apply_template_to_date_range_v2` is NULL-unsafe.** Its find-or-create does
`… AND sub_department_id = v_sub_dept_id`. When the target sub-department is NULL that predicate
is never true, so the SELECT misses, the INSERT fires, and it collides with
`uk_rosters_date_dept_subdept` → `23505`, aborting the whole apply. Latent today only because all
163 prod rosters have a non-null `sub_department_id`. Removing the activation gate makes the
NULL path reachable. Fix with `IS NOT DISTINCT FROM`.

Note `activate_roster_for_range` gets this right (explicit `IS NULL` branch) and
`create_planning_period` gets it right a third way (`ON CONFLICT … DO NOTHING` on the expression
index). Three implementations of one operation — collapsing them is most of the value here.

**4b — SECURITY DEFINER bypasses the RBAC policy.** `rosters` has a correct INSERT policy
(`user_has_action_in_scope('roster.edit', …)`), but both `activate_roster_for_range` and
`apply_template_to_date_range_v2` are `SECURITY DEFINER` with **no authorization check of any
kind** — any authenticated user can create rosters in any org. Today that's reachable only
through two explicit manager actions. Making roster creation implicit puts it behind *every*
write path, so the guard has to be added as part of this change, not after it.

---

## 5. Design — one resolver, three callers

### `public.sm_resolve_roster(p_org_id, p_dept_id, p_sub_dept_id, p_date, p_allow_past default false) RETURNS uuid`

`SECURITY DEFINER`, `search_path` pinned. Behaviour:

1. **Guard:** `IF NOT user_has_action_in_scope('roster.edit', p_org_id, p_dept_id, p_sub_dept_id) THEN RAISE …`
2. **Past-date policy:** if `p_date < CURRENT_DATE AND NOT p_allow_past` → raise. Keeps today's
   rule (`activate_roster_for_range` skips past dates; the UI blocks at
   [GroupModeView.tsx:2217](src/modules/rosters/ui/modes/GroupModeView.tsx#L2217) and
   [useShiftFormOrchestrator.ts:812](src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/hooks/useShiftFormOrchestrator.ts#L812)).
3. **Race-safe upsert:** `INSERT … ON CONFLICT (start_date, department_id, COALESCE(sub_department_id, '000…'::uuid)) DO NOTHING`,
   then `SELECT … WHERE sub_department_id IS NOT DISTINCT FROM p_sub_dept_id`. Two managers
   clicking the same empty cell must not deadlock or duplicate.
4. **Ensure structure:** idempotently create the four `roster_groups`
   (`convention_centre`, `exhibition_centre`, `theatre`, `the_cutaway`). Precedent already exists
   client-side at [shiftSynthesizer.orchestrator.ts:94-133](src/modules/rosters/services/shiftSynthesizer.orchestrator.ts#L94-L133).

### Callers

- **`sm_create_shift`** — when `roster_id` is NULL, resolve from
  `(organization_id, department_id, sub_department_id, shift_date)`, all already in the payload.
  Additionally: when `shift_group_id` is NULL but `group_type` is set, look it up from
  `roster_groups` on the resolved roster. The explicit-`roster_id` path stays byte-identical.
- **`apply_template_to_date_range_v2`** — replace the inline find-or-create with the resolver.
  Fixes 4a and 4b in one edit. It loops dates, so pass `p_allow_past` through from `p_force_stack`
  to preserve the existing re-apply-to-today escape hatch.
- **Demand injection** — the synthesizer does a direct `.from('shifts').insert()` (deliberately,
  bypassing `sm_create_shift`'s allow-list). It goes through RLS, so it needs the roster id
  up-front: have [LaborDemandForecastingPage.tsx:1315](src/modules/rosters/pages/LaborDemandForecastingPage.tsx#L1315)
  call `sm_resolve_roster` instead of erroring when `active` is undefined.

---

## 6. Phases

**Phase 1 — SQL** (3 migrations, or 1 file with 3 statements)
1. `sm_resolve_roster` — new function + grants (`REVOKE FROM PUBLIC, anon` explicitly; Supabase
   re-grants to *both* `anon` and `authenticated` on replace).
2. `sm_create_shift` — NULL-roster fallback + group re-resolution. **Must be rebased onto
   `20260805060000`'s body and timestamped after it.**
3. `apply_template_to_date_range_v2` — swap inline find-or-create for the resolver.

Validate on local PG before applying. Run `get_advisors` after apply (new definer functions
auto-grant EXECUTE to `anon`).

**Phase 2 — Frontend gate removal**
- `GroupModeView.tsx:2233-2241` — drop the block; keep the past-date guard above it.
- `ApplyTemplateDialog.tsx` — delete `isFullyActivated` and its error branch; the calendar
  preview stays (it's genuinely useful, just no longer a gate).
- `useShiftFormOrchestrator.ts` — drop `hasRoster` from `canSave` and the submit-time guard; keep
  the roster **picker** in `ScheduleStep` (stacking onto a chosen roster is a real feature) but
  make it optional.
- `LaborDemandForecastingPage.tsx` — resolve instead of erroring.

**Phase 3 — UI repositioning**
- [ActivateRosterDialog.tsx](src/modules/rosters/ui/dialogs/ActivateRosterDialog.tsx) has **no
  mount point anywhere in the app** — it is already dead code. The live dialog is
  `PlanRosterPeriodDialog` ([RosterFunctionBar.tsx:576](src/modules/rosters/ui/components/RosterFunctionBar.tsx#L576)).
  Delete the dead file and the now-unused `useActivateRoster`
  ([useRosterMutations.ts:126](src/modules/rosters/state/useRosterMutations.ts#L126)).
- Keep **Plan Period** — it still does something implicit activation doesn't: create a named
  `planning_periods` record and bulk-seed a template across a month. Re-label it from an
  activation prerequisite to a bulk-seeding convenience.
- The ⚡ "Active Roster Found" badge ([GroupModeView.tsx:971](src/modules/rosters/ui/modes/GroupModeView.tsx#L971))
  becomes meaningless — it would light up on every day anyone has ever touched. Re-point it at
  "has shifts" or drop it.

**Phase 4 — Tests + gates**
- pgTAP/SQL: resolver idempotency, concurrent-call safety, NULL sub-dept, past-date rejection,
  RBAC denial for a non-manager.
- Vitest: shift-form submit with no `rosterId`; template apply on a cold range.
- `npx tsc -p tsconfig.app.json --noEmit` + vitest + build.

---

## 7. Out of scope, but adjacent

- **`sm_move_shift` doesn't re-point `roster_id`.** Verified live: it updates `shift_date` and
  `roster_date` but leaves `roster_id` on the *old* day's roster. Cross-date DnD is already
  producing inconsistent rows (0 today only because `shifts` is empty). Implicit activation makes
  cross-date moves more common. Recommend folding a `sm_resolve_roster` call into `sm_move_shift`
  in the same effort — it's ~4 lines once the resolver exists.
- **`roster_groups` / `roster_subgroups` RLS is `USING (true)` for `authenticated`** — wide open,
  pre-existing, unrelated to this change. Flagging only.
- **Empty roster rows accumulate**, one per date touched. Harmless at this scale (163 rows) and
  they're what makes the day addressable, but worth a cleanup job eventually for rosters with no
  shifts and no `planning_period_id`.

---

## 8. Decisions — CLOSED 2026-08-05

1. **Past dates — hard block kept.** Shifts must not be created, edited or updated in the past.
   `sm_resolve_roster` refuses to *create* for a past date. Note the DB runs in **UTC** while the
   business timezone is Australia/Sydney, so the cutoff is
   `(now() AT TIME ZONE 'Australia/Sydney')::date`, **not** `CURRENT_DATE` — the latter is what
   `activate_roster_for_range` uses today and it lags Sydney by up to 11 hours, which would have
   left exactly the past-date hole this decision closes.
2. **Plan Period — kept** as a bulk-seeding convenience. Re-labelled from prerequisite to
   convenience; `create_planning_period` is untouched.
3. **`sm_move_shift` — in scope.** The `roster_id` re-point ships with this effort.
4. **Empty `shifts` table — deliberate.** No backfill needed.

---

## 9. Implementation record — 2026-08-05

Built and validated. **Not applied to prod, not committed.**

### Migrations (6 new, none applied)

| File | What |
|---|---|
| `20260805100000_sm_resolve_roster.sql` | New canonical resolver |
| `20260805110000_sm_create_shift_lazy_roster.sql` | NULL `roster_id` → resolve; NULL `shift_group_id` → resolve |
| `20260805120000_apply_template_use_roster_resolver.sql` | Delegates find-or-create; fixes §4a + §4b |
| `20260805130000_sm_move_shift_repoint_roster.sql` | Re-points `roster_id`; NULL params no longer destructive |
| `20260805140000_seed_all_four_roster_groups.sql` | Trigger seeds 4 not 3; backfills existing rosters |
| `20260805150000_add_roster_subgroup_range_use_resolver.sql` | Last live find-or-create delegates; UTC + RBAC fixes |

Sequenced after `20260805090000`, and `sm_create_shift` is rebased onto the
still-unapplied `20260805060000` body.

### Frontend

- `GroupModeView.tsx` — "Roster Not Activated" block removed; badge tooltip retitled
- `ApplyTemplateDialog.tsx` — `isFullyActivated` gate removed, along with the
  `useRostersByDateRange` query that only existed to feed it
- `useShiftFormOrchestrator.ts` — roster dropped from `canSave` and the submit guard
- `ModalFooter.tsx` — a **fifth** gate found during implementation: the footer's
  `roster` status chip went red on a rosterless day. Now informational
- `LaborDemandForecastingPage.tsx` — resolves instead of erroring
- `rosters.api.ts` — `rostersApi.resolveRoster()` wrapper
- `assignShift.command.ts` — cross-date moves routed through `sm_move_shift`
- `useRosterMutations.ts` — `useActivateRoster` deleted; `forceStack` default flipped
- `ActivateRosterDialog.tsx` — deleted (was unreachable)

### Findings that emerged during implementation

1. **`trigger_seed_standard_roster_groups` seeds only THREE groups**, omitting
   `the_cutaway`. This is why prod shows 163/163/163/**160**. Any roster created
   outside `apply_template` is missing The Cutaway, and because
   `shifts.roster_subgroup_id` is **NOT NULL**, creating a Cutaway shift on such a
   day fails outright. `sm_resolve_roster` backfills it on both paths. Covered by
   T7/T7b.
2. **`shifts.roster_subgroup_id` is NOT NULL**, which upgrades §3's group-resolution
   note from "produces an orphaned row" to "fails the insert". The resolution chain
   is load-bearing, not defensive.
3. **`sm_move_shift`'s NULL params were destructive.** `shift_group_id` and
   `roster_subgroup_id` were assigned without `COALESCE` while every other column
   used it, so omitting them meant "set to NULL" — a guaranteed 23502 on the NOT
   NULL column. That is exactly what Group Mode's drop-into-Unassigned path sends,
   directly below a comment saying it must not null them out. Fixed; T13.
4. **The live cross-date write was never `sm_move_shift`.** `assignShift.command.ts`
   did a raw `.update({ shift_date })`, so fixing only the RPC would not have fixed
   the drift the decision was about. Now routed through the RPC.
5. **The grid's group ids are not per-roster.** `GroupModeView` keeps one visual row
   per group NAME across the whole range, so a drop hands back an id from whichever
   roster was seen first — often another day. `sm_move_shift` now validates any
   supplied id against the shift's own roster and re-resolves by name if it does
   not belong. T13b.
6. **`add_roster_subgroup_range` is a fourth find-or-create** implementation and
   already auto-creates rosters.

### Root-cause pass — findings 1 and 6 closed at source

Findings 2–5 were fixed in place. Findings 1 and 6 had only been *worked around* —
the resolver repaired the symptom while the code that produced it stayed broken —
so both are now fixed where they originate:

- **`seed_standard_roster_groups` seeds four groups, not three** (`20260805140000`).
  The trigger's own comment called them "the three standard groups"; The Cutaway was
  simply never added when the venue was. Newly created rosters are now correct on
  arrival from every path, not just repaired on next resolve. The resolver's
  backfill stays as the repair for legacy rows — both are idempotent against
  `roster_groups_roster_id_external_id_key`.
- **Existing rosters backfilled** in the same migration. Dry-run against prod:
  **exactly 3 rows, all `the_cutaway`** — matching the predicted 163/163/163/160
  gap with no collateral inserts.
- **`add_roster_subgroup_range` delegates to the resolver** (`20260805150000`),
  which closes three defects at once: its past-date skip used `CURRENT_DATE` (UTC —
  wrong by up to 11 hours against Sydney, so it could create a roster for a day
  already past locally); it had no authorization check; and it created only the one
  group it was asked for. The skip stays a *skip* rather than becoming a raise, so a
  range that merely starts in the past still processes its future days.

The 5-arg `add_roster_subgroup_range` overload is untouched — no callers in the
client or in SQL, but it still raises `Roster not activated for date`, a message
from the model this work removes. Worth deleting once confirmed dead.

### Verification

- `supabase/tests/implicit_roster_activation.sql` — 23 assertions, all green on
  PostgreSQL 17 against baseline + all 93 migrations replayed in order.
  §4a's 23505 was reproduced against the old function body first, so T15 is not
  vacuous. T20 is a closing invariant: no roster anywhere is missing any of the
  four venue groups.
- Two unrelated migrations fail a from-scratch replay and are **pre-existing**:
  `20260727024158` (needs the `cron` schema) and `20260802150000` (references
  `attendance_records.deleted_at`, which the baseline does not define).
- `tsc -p tsconfig.app.json --noEmit` clean · 1781 vitest tests pass · build succeeds.

### Residual activation UI — removed 2026-08-05

The concept was gone but its vocabulary and iconography were not. All of it was in
`PlanRosterPeriodDialog`, which decision 2 kept:

- "Activate rosters + seed shifts in a single action" → now describes bulk seeding
  and says explicitly that it is optional.
- `DayStatus 'active'` → `'existing'`; the legend chip "⚡ Active" → "● Has roster".
  The distinction it draws is now purely informational — seeding works either way.
- ⚡ icons replaced on the day cells, the duplicate-period warning (now
  `AlertTriangle`, since it is a warning), the CTA, and the function-bar button
  (now `CalendarPlus`).
- The per-day ⚡ badge in the `GroupModeView` date header was **deleted**, not
  relabelled. With implicit activation it lights up on every day anyone has ever
  touched, so it distinguishes nothing. Its `rosterStructures` prop went with it.
- `getDayStatus` compared against `new Date()` — browser-local. The backend skips
  past days on **Sydney**'s clock, so a browser in another timezone painted a
  different set of days as past than the ones actually skipped. Now `getSydneyToday()`.

The remaining ⚡ in `GroupModeView` is the "DnD Mode Active" badge — unrelated.

### Sub-group date ranges — not a bug, but two things make it look like one

Reported as "adding a sub-group for a certain timeframe adds it to every month".
The write is correctly bounded — verified against prod, every sub-group occupies
one **contiguous** date range (`TESTY` 28d, `test` 31d, `Standard` 60d, all
contiguous; only `XYZ` has a gap, and that is two separate adds). Two other things
produce the impression:

1. **`CentralAddSubGroupDialog` defaults to the `current-month` preset.** Unless
   the preset is changed you get the whole month. `add_roster_subgroup_range` then
   skips past days, which is why `TESTY` reads Aug 4–31 (28 days) rather than
   Aug 1–31 — it was added on Aug 4.
2. **The grid renders one row per sub-group NAME for the entire visible range.**
   `GroupModeView` merges sub-groups across every roster in range
   (`groupEntry.subGroups.set(sg.name, …)`, first id wins — the same conflation
   behind finding 5). A three-day sub-group therefore renders as a full-width row,
   and the days it does not exist on are empty cells indistinguishable from
   "exists, no shifts yet".

Per-day rows are inherent to the schema: `roster_subgroups` → `roster_groups` →
a per-day `rosters` row, so a range add *is* N per-day rows. There is no
"sub-group spanning a range" entity. Point 2 is arguably a real UX defect — you
cannot see which days a sub-group actually covers — but fixing it means making
sub-group rows date-aware in the grid, which is a substantial change and is not
attempted here.

### Behaviour change to review

`forceStack` defaulted to **true**, so every template apply from the roster modal
created shifts in the past. That contradicts decision 1, so the default is now
**false** and past shifts are soft-skipped via `shifts_skipped`. This is the one
change that goes beyond removing gates — revert the one-line default in
`useRosterMutations.ts` if backfilling was intentional.
